import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRaceMessage } from '../src/discord/buildRaceMessage';
import { sendWebhook } from '../src/discord/sendWebhook';
import { DriverRaceStats, GroupedIncident, ParsedRace } from '../src/types/assetto';

function createRace(): ParsedRace {
  return {
    sourceFileName: 'sample-race.json',
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
  return {
    carId: overrides.carId ?? 1,
    name: overrides.name ?? 'Guid Driver',
    guid: overrides.guid ?? 'guid-1',
    identity: overrides.identity ?? { kind: 'guid', value: String(overrides.guid ?? 'guid-1') },
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
    newSafetyRating: overrides.newSafetyRating ?? 78
  };
}

function createGroupedIncident(): GroupedIncident {
  return {
    pairKey: '1:2',
    driversInvolved: [
      { carId: 1, name: 'Guid Driver', identity: { kind: 'guid', value: 'guid-1' } },
      { carId: 2, name: 'Rival Driver', identity: { kind: 'guid', value: 'guid-2' } }
    ],
    carIdsInvolved: [1, 2],
    maxImpact: 140,
    avgImpact: 120,
    rawEventCount: 2
  };
}

test('empty webhook falls back to console logging without crashing', async (t) => {
  const infoLogs: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown) => {
    infoLogs.push(String(message));
  };
  t.after(() => {
    console.info = originalInfo;
  });

  const message = buildRaceMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [createStat()],
    groupedIncidents: []
  });

  const result = await sendWebhook('', message);

  assert.equal(result, 'logged');
  assert.equal(infoLogs.length, 1);

  const payload = JSON.parse(infoLogs[0] ?? '{}') as { message?: string; summary?: string };
  assert.equal(payload.message, 'Discord webhook disabled, logging race summary instead');
  assert.match(payload.summary ?? '', /Race Report - monza/);
  assert.match(payload.summary ?? '', /Archivo procesado: sample-race.json/);
});

test('configured webhook sends exactly one request with the required race report contract', async (t) => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const infoLogs: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ input: String(input), init });
    return new Response(null, { status: 200, statusText: 'OK' });
  }) as typeof fetch;
  console.info = (message?: unknown) => {
    infoLogs.push(String(message));
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  });

  const message = buildRaceMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [
      createStat(),
      createStat({
        carId: 2,
        name: 'Rival Driver',
        guid: 'guid-2',
        identity: { kind: 'guid', value: 'guid-2' },
        position: 2,
        bestLap: 93000,
        avgLap: 94000,
        idealLap: 92000,
        consistency: 500,
        carIncidentsGrouped: 1,
        envHits: 1,
        maxImpact: 140,
        rawCollisionEvents: 2,
        raceScore: 62,
        oldSafetyRating: 80,
        newSafetyRating: 77.3
      })
    ],
    groupedIncidents: [createGroupedIncident()]
  });

  const result = await sendWebhook('https://discord.example/webhook', message);

  assert.equal(result, 'sent');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, 'https://discord.example/webhook');
  assert.equal(fetchCalls[0]?.init?.method, 'POST');
  assert.equal((fetchCalls[0]?.init?.headers as Record<string, string>)['content-type'], 'application/json');
  assert.equal(infoLogs.length, 1);

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    content: string;
    embeds: Array<{
      title: string;
      description: string;
      footer?: { text?: string };
      fields: Array<{ name: string; value: string }>;
    }>;
  };
  const embed = body.embeds[0];
  const fieldNames = embed?.fields.map((field) => field.name) ?? [];
  const awardsField = embed?.fields.find((field) => field.name === 'Premios');

  assert.equal(body.content, '🏁 Race Report - monza');
  assert.equal(embed?.title, '🏁 Race Report - monza');
  assert.match(embed?.description ?? '', /Auto principal: lotus_exos_125_s1/);
  assert.match(embed?.description ?? '', /Vueltas pactadas: 3/);
  assert.equal(embed?.footer?.text, 'Archivo procesado: sample-race.json');
  assert.deepEqual(fieldNames, ['Podio', '⚡ Vuelta rápida', 'Premios', 'Safety actualizada', 'Resumen de incidentes']);
  assert.match(awardsField?.value ?? '', /⚡ Vuelta rápida/);
  assert.match(awardsField?.value ?? '', /🧼 Más limpio/);
  assert.match(awardsField?.value ?? '', /🧱 Albañil del día/);
  assert.match(awardsField?.value ?? '', /💥 Misil nuclear/);
  assert.match(awardsField?.value ?? '', /🚜 Cono del día/);
  assert.match(awardsField?.value ?? '', /🪦 DNF destructivo/);
  assert.match(awardsField?.value ?? '', /📈 Más consistente/);
  assert.match(awardsField?.value ?? '', /🐢 Tortuga digna/);
});
