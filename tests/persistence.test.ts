import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createRaceProcessor } from '../src/index';
import { openDatabase } from '../src/db/db';
import { createRepositories } from '../src/db/repositories';
import { AppConfig } from '../src/config';
import { applySafetyRatings } from '../src/parser/calculateSafety';
import { calculateDriverStats } from '../src/parser/calculateDriverStats';
import { groupIncidents } from '../src/parser/groupIncidents';
import { parseRaceJson } from '../src/parser/parseRaceJson';
import { DriverRaceStats, ParsedRace } from '../src/types/assetto';

function createRace(fileName: string): ParsedRace {
  return {
    sourceFileName: fileName,
    trackName: 'monza',
    trackConfig: '',
    type: 'RACE',
    raceLaps: 3,
    carModel: 'lotus_exos_125_s1',
    drivers: [],
    lapsByCarId: new Map(),
    events: []
  };
}

function createStat(overrides: Partial<DriverRaceStats> = {}): DriverRaceStats {
  const guid = overrides.guid === undefined ? 'guid-1' : overrides.guid;

  return {
    carId: overrides.carId ?? 1,
    name: overrides.name ?? 'Driver 1',
    guid,
    identity: overrides.identity ?? (guid ? { kind: 'guid', value: guid } : { kind: 'temp', value: 'temp:test-race:1' }),
    position: overrides.position ?? 1,
    completedLaps: overrides.completedLaps ?? 3,
    raceLaps: overrides.raceLaps ?? 3,
    finished: overrides.finished ?? true,
    bestLap: overrides.bestLap ?? 90000,
    avgLap: overrides.avgLap ?? 90500,
    idealLap: overrides.idealLap ?? 89000,
    consistency: overrides.consistency ?? 250,
    totalCuts: overrides.totalCuts ?? 0,
    carIncidentsGrouped: overrides.carIncidentsGrouped ?? 0,
    envHits: overrides.envHits ?? 0,
    maxImpact: overrides.maxImpact ?? 0,
    rawCollisionEvents: overrides.rawCollisionEvents ?? 0,
    'tyre usado más frecuente': overrides['tyre usado más frecuente'] ?? 'Soft',
    totalTime: overrides.totalTime ?? 300000,
    raceScore: overrides.raceScore ?? 95,
    oldSafetyRating: overrides.oldSafetyRating ?? 75,
    newSafetyRating: overrides.newSafetyRating ?? 78,
  };
}

function createTempDb() {
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-tests-'));
  const database = openDatabase(join(directory, 'ac-race-monitor.sqlite'));

  return {
    database,
    repositories: createRepositories(database),
    close: () => database.close()
  };
}

function createConfig(resultsDir: string, databasePath: string): AppConfig {
  return {
    resultsDir,
    databasePath,
    discordWebhookUrl: '',
    processedFileStrategy: 'sqlite',
    scanOnStart: true,
    minFileAgeMs: 50,
    watchGlob: '*RACE*.json',
    defaultSafetyRating: 75,
    safetyMemoryFactor: 0.85,
    nodeEnv: 'test'
  };
}

test('persistence stores only GUID-backed drivers and skips temp identities', (t) => {
  const context = createTempDb();
  t.after(context.close);

  const result = context.repositories.races.persist({
    fileName: 'guid-filter.json',
    filePath: '/tmp/guid-filter.json',
    fileHash: 'hash-1',
    processedAt: '2026-06-22T00:00:00.000Z',
    race: createRace('guid-filter.json'),
    stats: [
      createStat({ carId: 1, name: 'Guid Driver', guid: 'guid-1', identity: { kind: 'guid', value: 'guid-1' } }),
      createStat({
        carId: 2,
        name: 'Temp Driver',
        guid: null,
        identity: { kind: 'temp', value: 'temp:guid-filter.json:2' }
      })
    ]
  });

  assert.deepEqual(result, { status: 'inserted', raceId: 1, persistedDrivers: 1 });
  assert.equal((context.database.prepare('SELECT COUNT(*) AS count FROM drivers').get() as { count: number }).count, 1);
  assert.equal((context.database.prepare('SELECT COUNT(*) AS count FROM race_driver_results').get() as { count: number }).count, 1);
  assert.equal((context.database.prepare('SELECT COUNT(*) AS count FROM processed_files').get() as { count: number }).count, 1);
});

test('persistence suppresses duplicate processing by SQLite filename tracking', (t) => {
  const context = createTempDb();
  t.after(context.close);

  const input = {
    fileName: 'duplicate.json',
    filePath: '/tmp/duplicate.json',
    fileHash: 'hash-duplicate',
    processedAt: '2026-06-22T00:00:00.000Z',
    race: createRace('duplicate.json'),
    stats: [createStat()]
  };

  const first = context.repositories.races.persist(input);
  const second = context.repositories.races.persist(input);

  assert.deepEqual(first, { status: 'inserted', raceId: 1, persistedDrivers: 1 });
  assert.deepEqual(second, { status: 'duplicate' });
  assert.equal((context.database.prepare('SELECT COUNT(*) AS count FROM races').get() as { count: number }).count, 1);
  assert.equal((context.database.prepare('SELECT COUNT(*) AS count FROM processed_files').get() as { count: number }).count, 1);
});

test('processor persists oldSafety, raceScore, and newSafety for existing GUID-backed drivers', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-processor-'));
  const resultsDir = join(directory, 'results');
  const databasePath = join(directory, 'ac-race-monitor.sqlite');
  const sampleFileName = '2026_6_20_4_0_RACE.json';
  const samplePath = join(resultsDir, sampleFileName);
  const existingGuid = '76561198077346632';
  const existingSafety = 88;
  const originalInfo = console.info;

  mkdirSync(resultsDir, { recursive: true });
  copyFileSync(resolve(process.cwd(), 'samples/results', sampleFileName), samplePath);

  const database = openDatabase(databasePath);
  const repositories = createRepositories(database);
  const config = createConfig(resultsDir, databasePath);
  const processRaceFile = createRaceProcessor(config, repositories);

  console.info = () => {};
  t.after(() => {
    console.info = originalInfo;
    database.close();
  });

  database.prepare(
    `INSERT INTO drivers (
      guid,
      name,
      safety_rating,
      races,
      total_car_incidents,
      total_env_hits,
      total_cuts,
      max_impact,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(existingGuid, 'Kanus', existingSafety, 4, 3, 1, 2, 90, '2026-06-21T00:00:00.000Z');

  const result = await processRaceFile(samplePath);

  assert.equal(result, 'processed');

  const race = parseRaceJson(readFileSync(samplePath, 'utf8'), sampleFileName);
  const groupedIncidents = groupIncidents(race.events.filter((event) => event.type === 'COLLISION_WITH_CAR'));
  const expectedStats = applySafetyRatings(
    calculateDriverStats(race, groupedIncidents, config.defaultSafetyRating),
    { [existingGuid]: existingSafety },
    config.defaultSafetyRating,
    config.safetyMemoryFactor
  );
  const expectedDriver = expectedStats.find((entry) => entry.guid === existingGuid);
  const persistedResult = database.prepare(
    'SELECT old_safety, race_score, new_safety FROM race_driver_results WHERE guid = ? LIMIT 1'
  ).get(existingGuid) as { old_safety: number; race_score: number; new_safety: number };
  const persistedDriver = database.prepare('SELECT safety_rating FROM drivers WHERE guid = ?').get(existingGuid) as { safety_rating: number };

  assert.ok(expectedDriver);
  assert.equal(persistedResult.old_safety, existingSafety);
  assert.equal(persistedResult.race_score, expectedDriver.raceScore);
  assert.equal(persistedResult.new_safety, expectedDriver.newSafetyRating);
  assert.equal(persistedDriver.safety_rating, expectedDriver.newSafetyRating);
});
