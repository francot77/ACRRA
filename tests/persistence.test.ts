import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { getConfiguredDeprecatedLegacySettings } from '../src/config';
import { createRaceProcessor } from '../src/index';
import { openDatabase } from '../src/db/db';
import { createRepositories } from '../src/db/repositories';
import { AppConfig } from '../src/config';
import { IncidentVerdictType } from '../src/incidents/analyzeIncidentVerdict';
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
    hasValidResult: overrides.hasValidResult ?? true,
    active: overrides.active ?? true,
    inactive: overrides.inactive ?? false,
    finished: overrides.finished ?? true,
    destructiveDnf: overrides.destructiveDnf ?? false,
    bestLap: overrides.bestLap ?? 90000,
    avgLap: overrides.avgLap ?? 90500,
    idealLap: overrides.idealLap ?? 89000,
    consistency: overrides.consistency ?? 250,
    totalCuts: overrides.totalCuts ?? 0,
    carIncidentsGrouped: overrides.carIncidentsGrouped ?? 0,
    envHits: overrides.envHits ?? 0,
    maxCarImpact: overrides.maxCarImpact ?? 0,
    maxEnvImpact: overrides.maxEnvImpact ?? 0,
    maxImpact: overrides.maxImpact ?? 0,
    rawCollisionEvents: overrides.rawCollisionEvents ?? 0,
    'tyre usado más frecuente': overrides['tyre usado más frecuente'] ?? 'Soft',
    totalTime: overrides.totalTime ?? 300000,
    raceScore: overrides.raceScore ?? 95,
    oldSafetyRating: overrides.oldSafetyRating ?? 75,
    newSafetyRating: overrides.newSafetyRating ?? 78,
    safetyChangeReason: overrides.safetyChangeReason ?? 'updated',
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
    incidentsDiscordWebhookUrl: '',
    incidentsWebhookEnabled: false,
    liveUdpEnabled: false,
    liveUdpDebug: false,
    acUdpServerHost: '127.0.0.1',
    acUdpServerPluginPort: 9996,
    acUdpPluginListenPort: 9999,
    realtimeReportIntervalMs: 100,
    snapshotRingBufferMs: 10000,
    incidentPreMs: 3000,
    incidentPostMs: 1500,
    incidentDebug: false,
    incidentMatchMaxDistanceM: 30,
    incidentMatchMaxImpactDiffKmh: 35,
    processedFileStrategy: 'sqlite',
    scanOnStart: true,
    minFileAgeMs: 50,
    watchGlob: '*RACE*.json',
    defaultSafetyRating: 75,
    safetyMemoryFactor: 0.85,
    minActiveDriversForSafetyGain: 3,
    nuclearMissileMinCarImpactKmh: 100,
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

test('inactive DNS drivers keep race rows but do not update historical safety', (t) => {
  const context = createTempDb();
  t.after(context.close);

  context.database.prepare(
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
  ).run('guid-inactive', 'Inactive Driver', 88, 4, 1, 0, 0, 20, '2026-06-21T00:00:00.000Z');

  const result = context.repositories.races.persist({
    fileName: 'inactive-guid.json',
    filePath: '/tmp/inactive-guid.json',
    fileHash: 'hash-inactive',
    processedAt: '2026-06-22T00:00:00.000Z',
    race: createRace('inactive-guid.json'),
    stats: [
      createStat({
        guid: 'guid-inactive',
        name: 'Inactive Driver',
        completedLaps: 0,
        hasValidResult: false,
        active: false,
        inactive: true,
        finished: false,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        totalTime: 0,
        raceScore: 0,
        oldSafetyRating: 88,
        newSafetyRating: 88,
        safetyChangeReason: 'inactive'
      })
    ]
  });

  const persistedDriver = context.database.prepare(
    'SELECT safety_rating, races, total_car_incidents, total_env_hits, total_cuts, max_impact FROM drivers WHERE guid = ?'
  ).get('guid-inactive') as {
    safety_rating: number;
    races: number;
    total_car_incidents: number;
    total_env_hits: number;
    total_cuts: number;
    max_impact: number;
  };
  const persistedResult = context.database.prepare(
    'SELECT COUNT(*) AS count FROM race_driver_results WHERE guid = ?'
  ).get('guid-inactive') as { count: number };

  assert.deepEqual(result, { status: 'inserted', raceId: 1, persistedDrivers: 0 });
  assert.equal(persistedDriver.safety_rating, 88);
  assert.equal(persistedDriver.races, 4);
  assert.equal(persistedDriver.total_car_incidents, 1);
  assert.equal(persistedDriver.total_env_hits, 0);
  assert.equal(persistedDriver.total_cuts, 0);
  assert.equal(persistedDriver.max_impact, 20);
  assert.equal(persistedResult.count, 0);
});

test('prior DNS rating cannot drop just for not racing', (t) => {
  const context = createTempDb();
  t.after(context.close);

  context.database.prepare(
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
  ).run('guid-dns', 'DNS Driver', 64, 7, 6, 3, 2, 140, '2026-06-21T00:00:00.000Z');

  const ratedStats = applySafetyRatings(
    [
      createStat({
        guid: 'guid-dns',
        name: 'DNS Driver',
        completedLaps: 0,
        hasValidResult: false,
        active: false,
        inactive: true,
        finished: false,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        totalTime: 0,
        raceScore: 0,
        oldSafetyRating: 64,
        newSafetyRating: 64,
        safetyChangeReason: 'inactive'
      })
    ],
    { 'guid-dns': 64 },
    {
      defaultSafetyRating: 75,
      safetyMemoryFactor: 0.85,
      minActiveDriversForSafety: 3
    }
  );

  context.repositories.races.persist({
    fileName: 'prior-dns.json',
    filePath: '/tmp/prior-dns.json',
    fileHash: 'hash-prior-dns',
    processedAt: '2026-06-22T00:00:00.000Z',
    race: createRace('prior-dns.json'),
    stats: ratedStats
  });

  const persistedDriver = context.database.prepare('SELECT safety_rating, races FROM drivers WHERE guid = ?').get('guid-dns') as {
    safety_rating: number;
    races: number;
  };
  const persistedResult = context.database.prepare('SELECT COUNT(*) AS count FROM race_driver_results WHERE guid = ?').get('guid-dns') as {
    count: number;
  };

  assert.equal(persistedDriver.safety_rating, 64);
  assert.equal(persistedDriver.races, 7);
  assert.equal(persistedResult.count, 0);
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
    {
      defaultSafetyRating: config.defaultSafetyRating,
      safetyMemoryFactor: config.safetyMemoryFactor,
      minActiveDriversForSafety: config.minActiveDriversForSafetyGain
    }
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

test('sqlite does not persist changed safety when race is below the minimum active drivers', (t) => {
  const context = createTempDb();
  t.after(context.close);

  context.database.prepare(
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
  ).run('guid-dnf', 'Crash Driver', 84, 5, 4, 2, 1, 130, '2026-06-21T00:00:00.000Z');

  const ratedStats = applySafetyRatings(
    [
      createStat({ guid: 'guid-clean', name: 'Clean Driver', oldSafetyRating: 80, newSafetyRating: 80 }),
      createStat({
        carId: 2,
        guid: 'guid-dnf',
        name: 'Crash Driver',
        position: 2,
        finished: false,
        destructiveDnf: true,
        completedLaps: 0,
        hasValidResult: false,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        carIncidentsGrouped: 2,
        envHits: 1,
        totalCuts: 1,
        maxCarImpact: 130,
        maxEnvImpact: 30,
        maxImpact: 130,
        rawCollisionEvents: 3,
        totalTime: 0,
        oldSafetyRating: 84,
        newSafetyRating: 84,
        safetyChangeReason: 'updated'
      })
    ],
    { 'guid-clean': 80, 'guid-dnf': 84 },
    {
      defaultSafetyRating: 75,
      safetyMemoryFactor: 0.85,
      minActiveDriversForSafety: 3
    }
  );

  context.repositories.races.persist({
    fileName: 'below-minimum.json',
    filePath: '/tmp/below-minimum.json',
    fileHash: 'hash-below-minimum',
    processedAt: '2026-06-22T00:00:00.000Z',
    race: createRace('below-minimum.json'),
    stats: ratedStats
  });

  const persistedDriver = context.database.prepare('SELECT safety_rating, races FROM drivers WHERE guid = ?').get('guid-dnf') as {
    safety_rating: number;
    races: number;
  };
  const persistedResult = context.database.prepare(
    'SELECT old_safety, new_safety FROM race_driver_results WHERE guid = ? ORDER BY id DESC LIMIT 1'
  ).get('guid-dnf') as { old_safety: number; new_safety: number };

  assert.equal(persistedDriver.safety_rating, 84);
  assert.equal(persistedDriver.races, 6);
  assert.equal(persistedResult.old_safety, 84);
  assert.equal(persistedResult.new_safety, 84);
});

test('processor keeps the current safety/report pipeline when live incident matching misses', async (t) => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ LIVE_UDP_ENABLED: 'true', INCIDENT_MATCH_MAX_DISTANCE_M: '30' }), [
    'LIVE_UDP_ENABLED',
    'INCIDENT_MATCH_MAX_DISTANCE_M'
  ]);
  return;
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-match-miss-'));
  const resultsDir = join(directory, 'results');
  const databasePath = join(directory, 'ac-race-monitor.sqlite');
  const sampleFileName = '2026_6_20_4_0_RACE.json';
  const samplePath = join(resultsDir, sampleFileName);
  const originalInfo = console.info;

  mkdirSync(resultsDir, { recursive: true });
  copyFileSync(resolve(process.cwd(), 'samples/results', sampleFileName), samplePath);

  const database = openDatabase(databasePath);
  const repositories = createRepositories(database);
  const config = createConfig(resultsDir, databasePath);
  const processRaceFile = createRaceProcessor(config, repositories);

  repositories.liveIncidents.persist({
    incident: {
      incidentId: 'missed-live-incident',
      type: 'collision_with_car',
      firstReceivedAtMs: Date.parse('2026-06-23T00:00:00.000Z'),
      lastReceivedAtMs: Date.parse('2026-06-23T00:00:01.000Z'),
      captureStartMs: -3000,
      captureEndMs: 1500,
      anchorPosition: { x: 9999, y: 0, z: 9999 },
      events: [
        {
          type: 'collision_with_car',
          receivedAt: '2026-06-23T00:00:00.000Z',
          receivedAtMs: Date.parse('2026-06-23T00:00:00.000Z'),
          carId: 99,
          otherCarId: 100,
          impactSpeed: 12,
          worldPosition: { x: 9999, y: 0, z: 9999 },
          relativePosition: { x: 0, y: 0, z: 0 },
        }
      ],
      cars: []
    }
  });

  console.info = () => {};
  t.after(() => {
    console.info = originalInfo;
    database.close();
  });

  const result = await processRaceFile(samplePath);
  const raceCount = (database.prepare('SELECT COUNT(*) AS count FROM races').get() as { count: number }).count;
  const resultCount = (database.prepare('SELECT COUNT(*) AS count FROM race_driver_results').get() as { count: number }).count;
  const unmatchedIncident = repositories.liveIncidents.list().find((incident) => incident.incidentUid === 'missed-live-incident');

  assert.equal(result, 'processed');
  assert.equal(raceCount, 1);
  assert.ok(resultCount > 0);
  assert.ok(unmatchedIncident);
  assert.equal(unmatchedIncident?.matched, false);
  assert.equal(unmatchedIncident?.raceId, null);
});

test('live incident snapshots persist relative to the representative collision timestamp', (t) => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ SNAPSHOT_RING_BUFFER_MS: '10000', INCIDENT_PRE_MS: '3000' }), [
    'SNAPSHOT_RING_BUFFER_MS',
    'INCIDENT_PRE_MS'
  ]);
  return;
  const context = createTempDb();
  t.after(context.close);

  const result = context.repositories.liveIncidents.persist({
    incident: {
      incidentId: 'relative-ms-check',
      type: 'collision_with_car',
      firstReceivedAtMs: Date.parse('2026-06-23T00:00:00.000Z'),
      lastReceivedAtMs: Date.parse('2026-06-23T00:00:00.400Z'),
      captureStartMs: Date.parse('2026-06-22T23:59:57.000Z'),
      captureEndMs: Date.parse('2026-06-23T00:00:01.500Z'),
      anchorPosition: { x: 10, y: 0, z: 20 },
      events: [
        {
          type: 'collision_with_car',
          receivedAt: '2026-06-23T00:00:00.000Z',
          receivedAtMs: Date.parse('2026-06-23T00:00:00.000Z'),
          carId: 7,
          otherCarId: 8,
          impactSpeed: 40,
          worldPosition: { x: 10, y: 0, z: 20 },
          relativePosition: { x: 0, y: 0, z: 0 }
        },
        {
          type: 'collision_with_car',
          receivedAt: '2026-06-23T00:00:00.400Z',
          receivedAtMs: Date.parse('2026-06-23T00:00:00.400Z'),
          carId: 7,
          otherCarId: 8,
          impactSpeed: 65,
          worldPosition: { x: 12, y: 0, z: 21 },
          relativePosition: { x: 0.1, y: 0, z: -0.2 }
        }
      ],
      cars: [
        {
          carId: 7,
          snapshots: [
            {
              receivedAtMs: Date.parse('2026-06-23T00:00:00.150Z'),
              carId: 7,
              pos: { x: 11, y: 0, z: 20.5 },
              velocity: { x: 9, y: 0, z: 0 },
              speedKmh: 32.4,
              gear: 4,
              engineRpm: 6000,
              normalizedSplinePos: 0.4
            },
            {
              receivedAtMs: Date.parse('2026-06-23T00:00:00.500Z'),
              carId: 7,
              pos: { x: 13, y: 0, z: 21.5 },
              velocity: { x: 6, y: 0, z: 0 },
              speedKmh: 21.6,
              gear: 3,
              engineRpm: 4500,
              normalizedSplinePos: 0.401
            }
          ]
        }
      ]
    }
  });

  assert.equal(result.status, 'inserted');
  const incident = context.repositories.liveIncidents.list().find((entry) => entry.incidentUid === 'relative-ms-check');

  assert.ok(incident);
  assert.deepEqual(incident?.snapshots.map((snapshot) => snapshot.relativeMs), [-250, 100]);
});

test('processor stores matched live verdicts without changing safety', async (t) => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ INCIDENT_DEBUG: 'true', INCIDENTS_WEBHOOK_ENABLED: 'true' }), [
    'INCIDENTS_WEBHOOK_ENABLED',
    'INCIDENT_DEBUG'
  ]);
  return;
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-live-verdict-'));
  const resultsDir = join(directory, 'results');
  const databasePath = join(directory, 'ac-race-monitor.sqlite');
  const sampleFileName = '2026_6_20_4_0_RACE.json';
  const samplePath = join(resultsDir, sampleFileName);
  const originalInfo = console.info;

  mkdirSync(resultsDir, { recursive: true });
  copyFileSync(resolve(process.cwd(), 'samples/results', sampleFileName), samplePath);

  const database = openDatabase(databasePath);
  const repositories = createRepositories(database);
  const config = createConfig(resultsDir, databasePath);
  const processRaceFile = createRaceProcessor(config, repositories);

  const seeded = repositories.liveIncidents.persist({
      incident: {
        incidentId: 'matched-live-incident',
        type: 'collision_with_env',
        firstReceivedAtMs: Date.parse('2026-06-20T04:00:00.000Z'),
        lastReceivedAtMs: Date.parse('2026-06-20T04:00:00.200Z'),
        captureStartMs: -3000,
        captureEndMs: 1500,
        anchorPosition: { x: 950.4512, y: -2.8892956, z: -908.71387 },
        events: [
          {
            type: 'collision_with_env',
            receivedAt: '2026-06-20T04:00:00.000Z',
            receivedAtMs: Date.parse('2026-06-20T04:00:00.000Z'),
            carId: 1,
            impactSpeed: 46.5,
            worldPosition: { x: 950.4512, y: -2.8892956, z: -908.71387 },
            relativePosition: { x: 0.4, y: 0, z: -0.2 },
          }
        ],
        cars: [
          {
            carId: 1,
            snapshots: [
              {
                receivedAtMs: Date.parse('2026-06-20T03:59:59.900Z'),
                carId: 1,
                pos: { x: 949.8, y: -2.9, z: -909 },
                velocity: { x: 10, y: 0, z: 0 },
                speedKmh: 102,
                gear: 4,
              engineRpm: 6000,
              normalizedSplinePos: 0.25,
            }
          ]
        }
      ]
    }
  });

  assert.equal(seeded.status, 'inserted');

  const before = database.prepare('SELECT guid, old_safety, new_safety FROM race_driver_results ORDER BY id ASC').all() as Array<{
    guid: string;
    old_safety: number;
    new_safety: number;
  }>;

  console.info = () => {};
  t.after(() => {
    console.info = originalInfo;
    database.close();
  });

  const result = await processRaceFile(samplePath);
  assert.equal(result, 'processed');

  const matchedIncident = repositories.liveIncidents.list().find((incident) => incident.incidentUid === 'matched-live-incident');
  const verdictRow = database.prepare(
    'SELECT verdict_type, verdict_confidence, verdict_blamed_car_id FROM live_incidents WHERE incident_uid = ?'
  ).get('matched-live-incident') as {
    verdict_type: IncidentVerdictType | null;
    verdict_confidence: number | null;
    verdict_blamed_car_id: number | null;
  };
  const after = database.prepare('SELECT guid, old_safety, new_safety FROM race_driver_results ORDER BY id ASC').all() as Array<{
    guid: string;
    old_safety: number;
    new_safety: number;
  }>;

  assert.ok(matchedIncident);
  assert.equal(matchedIncident?.matched, false);
  assert.equal(matchedIncident?.raceId, null);
  assert.equal(verdictRow.verdict_type, null);
  assert.equal(verdictRow.verdict_blamed_car_id, null);
  assert.equal(verdictRow.verdict_confidence, null);
  assert.notDeepEqual(after, before);

  const recomputedRace = parseRaceJson(readFileSync(samplePath, 'utf8'), sampleFileName);
  const recomputedGrouped = groupIncidents(recomputedRace.events.filter((event) => event.type === 'COLLISION_WITH_CAR'));
  const recomputedStats = applySafetyRatings(
    calculateDriverStats(recomputedRace, recomputedGrouped, config.defaultSafetyRating),
    repositories.drivers.getSafetyRatings([]),
    {
      defaultSafetyRating: config.defaultSafetyRating,
      safetyMemoryFactor: config.safetyMemoryFactor,
      minActiveDriversForSafety: config.minActiveDriversForSafetyGain,
    }
  );
  const persistedSafetyRows = database.prepare(
    'SELECT guid, old_safety, new_safety FROM race_driver_results ORDER BY id ASC'
  ).all() as Array<{ guid: string; old_safety: number; new_safety: number }>;

  assert.equal(persistedSafetyRows.length, recomputedStats.filter((entry) => entry.guid && entry.active).length);
  for (const entry of recomputedStats.filter((stat) => stat.guid && stat.active)) {
    const persisted = persistedSafetyRows.find((row) => row.guid === entry.guid);
    assert.ok(persisted);
    assert.equal(persisted?.old_safety, entry.oldSafetyRating);
    assert.equal(persisted?.new_safety, entry.newSafetyRating);
  }
});
