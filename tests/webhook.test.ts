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
    safetyChangeReason: overrides.safetyChangeReason ?? 'updated'
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
    groupedIncidents: [],
    minActiveDriversForSafetyGain: 3
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
    groupedIncidents: [createGroupedIncident()],
    minActiveDriversForSafetyGain: 3
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

test('report excludes DNS from awards, marks DNF and DNS, and formats impacts without raw milliseconds', () => {
  const message = buildRaceMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [
      createStat(),
      createStat({
        carId: 2,
        name: 'DNS Driver',
        guid: 'guid-2',
        identity: { kind: 'guid', value: 'guid-2' },
        position: 2,
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
      }),
      createStat({
        carId: 3,
        name: 'Crash Driver',
        guid: 'guid-3',
        identity: { kind: 'guid', value: 'guid-3' },
        position: 3,
        completedLaps: 0,
        hasValidResult: false,
        active: true,
        inactive: false,
        finished: false,
        destructiveDnf: true,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        envHits: 1,
        maxCarImpact: 140,
        maxEnvImpact: 70,
        maxImpact: 140,
        rawCollisionEvents: 3,
        totalTime: 0,
        raceScore: 59,
        oldSafetyRating: 80,
        newSafetyRating: 76.85,
        safetyChangeReason: 'updated'
      })
    ],
    groupedIncidents: [createGroupedIncident()],
    minActiveDriversForSafetyGain: 3
  });

  const embed = message.webhookBody.embeds[0];
  const awardsField = embed.fields.find((field) => field.name === 'Premios');
  const podiumField = embed.fields.find((field) => field.name === 'Podio');
  const incidentsField = embed.fields.find((field) => field.name === 'Resumen de incidentes');

  const safetyField = embed.fields.find((field) => field.name === 'Safety actualizada');
  const dnsField = embed.fields.find((field) => field.name === 'DNS / sin cambios');

  assert.match(podiumField?.value ?? '', /DNS Driver \(DNS \/ sin actividad\)/);
  assert.match(podiumField?.value ?? '', /Crash Driver \(DNF 0\/3 vueltas\)/);
  assert.doesNotMatch(awardsField?.value ?? '', /DNS Driver/);
  assert.match(awardsField?.value ?? '', /Crash Driver \(3 impactos antes de empezar\)/);
  assert.match(awardsField?.value ?? '', /±0\.250s/);
  assert.doesNotMatch(awardsField?.value ?? '', /\b\d+(?:\.\d+)? ms\b/);
  assert.doesNotMatch(safetyField?.value ?? '', /DNS Driver/);
  assert.match(safetyField?.value ?? '', /P3 Crash Driver \(DNF 0\/3 vueltas\): 80\.00 -> 76\.85/);
  assert.match(dnsField?.value ?? '', /P2 DNS Driver \(DNS \/ sin actividad\)/);
  assert.match(incidentsField?.value ?? '', /Impacto máximo entre autos: 140\.00/);
  assert.match(incidentsField?.value ?? '', /Impacto máximo con entorno: 70\.00/);
  assert.match(incidentsField?.value ?? '', /Impacto máximo total: 140\.00/);
});

test('report explains unchanged safety below the active-driver minimum and formats tortuga digna as M:SS.mmm', () => {
  const message = buildRaceMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [
      createStat({
        name: 'Solo Driver',
        bestLap: 91513,
        avgLap: 91513,
        oldSafetyRating: 75,
        newSafetyRating: 75,
        safetyChangeReason: 'min-active-drivers'
      }),
      createStat({
        carId: 2,
        name: 'DNS Driver',
        guid: 'guid-2',
        identity: { kind: 'guid', value: 'guid-2' },
        position: 2,
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
    ],
    groupedIncidents: [],
    minActiveDriversForSafetyGain: 3
  });

  const embed = message.webhookBody.embeds[0];
  const awardsField = embed.fields.find((field) => field.name === 'Premios');
  const safetyField = embed.fields.find((field) => field.name === 'Safety actualizada');
  const unchangedField = embed.fields.find((field) => field.name === 'Safety sin cambios');

  assert.match(awardsField?.value ?? '', /🐢 Tortuga digna: Solo Driver \(1:31\.513\)/);
  assert.equal(safetyField?.value, 'Sin cambios');
  assert.match(unchangedField?.value ?? '', /mínimo 3 pilotos activos requerido para ganar Safety\./);
  assert.match(unchangedField?.value ?? '', /P1 Solo Driver/);
});
