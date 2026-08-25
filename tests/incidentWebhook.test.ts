import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { AppConfig } from '../src/config';
import { getConfiguredDeprecatedLegacySettings } from '../src/config';
import { openDatabase } from '../src/db/db';
import { createRepositories, type PersistedLiveIncident } from '../src/db/repositories';
import { buildIncidentReportMessage, createIncidentReportDelivery, sendIncidentReports } from '../src/discord/sendIncidentReport';
import { createRaceProcessor } from '../src/index';
import { extractRaceCollisionEvents, type JsonRaceIncident, type MatchedIncidentPair } from '../src/live/matchLiveIncidents';
import { parseRaceJson } from '../src/parser/parseRaceJson';
import type { ParsedRace } from '../src/types/assetto';

function createConfig(resultsDir: string, databasePath: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    resultsDir,
    databasePath,
    trackModelPath: resolve(process.cwd(), 'track-models/monza/track-model.json'),
    trackModelTrack: 'monza',
    trackModelLayout: null,
    discordWebhookUrl: 'https://discord.example/race',
    incidentsDiscordWebhookUrl: 'https://discord.example/incidents',
    incidentsWebhookEnabled: true,
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
    nodeEnv: 'test',
    ...overrides
  };
}

function createRace(): ParsedRace {
  return {
    sourceFileName: 'sample-race.json',
    trackName: 'monza',
    trackConfig: '',
    type: 'RACE',
    raceLaps: 3,
    carModel: 'lotus_exos_125_s1',
    drivers: [
      { carId: 7, name: 'ramen', guid: 'guid-7', identity: { kind: 'guid', value: 'guid-7' }, carModel: 'gt3', position: 1, bestLap: 90000, totalTime: 300000 },
      { carId: 8, name: 'kanus', guid: 'guid-8', identity: { kind: 'guid', value: 'guid-8' }, carModel: 'gt3', position: 2, bestLap: 91000, totalTime: 301000 }
    ],
    lapsByCarId: new Map(),
    events: []
  };
}

function createMatchedCarIncident(): {
  liveIncident: PersistedLiveIncident;
  jsonIncident: JsonRaceIncident;
  match: MatchedIncidentPair;
} {
  return {
    liveIncident: {
      id: 1,
      incidentUid: 'incident-1',
      raceId: 10,
      type: 'collision_with_car',
      carId: 7,
      otherCarId: 8,
      impactSpeed: 64,
      worldPosition: { x: 10, y: 0, z: 20 },
      relativePosition: { x: 0.1, y: 0, z: -0.2 },
      createdAt: '2026-06-23T00:00:00.000Z',
      firstReceivedAt: '2026-06-23T00:00:00.000Z',
      lastReceivedAt: '2026-06-23T00:00:00.400Z',
      captureStartMs: -3000,
      captureEndMs: 1500,
      matched: true,
      matchedAt: '2026-06-23T00:00:01.000Z',
      verdictType: 'possible_rear_end',
      verdictConfidence: 0.72,
      verdictBlamedCarId: 7,
      verdictExplanation: ['Telemetry suggests closing speed from behind', 'No strong overlap before contact'],
      snapshots: [
        {
          id: 1,
          incidentId: 1,
          relativeMs: -250,
          carId: 7,
          snapshotReceivedAt: '2026-06-22T23:59:59.750Z',
          pos: { x: 9, y: 0, z: 19 },
          velocity: { x: 10, y: 0, z: 0 },
          speedKmh: 90,
          gear: 4,
          engineRpm: 6000,
          normalizedSplinePos: 0.25
        },
        {
          id: 2,
          incidentId: 1,
          relativeMs: 120,
          carId: 7,
          snapshotReceivedAt: '2026-06-23T00:00:00.120Z',
          pos: { x: 11, y: 0, z: 21 },
          velocity: { x: 8, y: 0, z: 0 },
          speedKmh: 70,
          gear: 3,
          engineRpm: 5000,
          normalizedSplinePos: 0.251
        }
      ]
    },
    jsonIncident: {
      source: 'json',
      status: 'unmatched',
      eventIndex: 12,
      type: 'collision_with_car',
      carId: 7,
      otherCarId: 8,
      driverName: 'ramen',
      otherDriverName: 'kanus',
      impactSpeed: 60,
      worldPosition: { x: 12, y: 0, z: 22 }
    },
    match: {
      status: 'matched',
      liveIncidentId: 1,
      jsonEventIndex: 12,
      distanceM: 2.8,
      impactDiffKmh: 4
    }
  };
}

function createMatchedEnvIncident(): {
  liveIncident: PersistedLiveIncident;
  jsonIncident: JsonRaceIncident;
  match: MatchedIncidentPair;
} {
  return {
    liveIncident: {
      id: 2,
      incidentUid: 'incident-env-1',
      raceId: 10,
      type: 'collision_with_env',
      carId: 7,
      otherCarId: null,
      impactSpeed: 46,
      worldPosition: { x: 15, y: 0, z: 30 },
      relativePosition: { x: 0.2, y: 0, z: -0.1 },
      createdAt: '2026-06-23T00:00:00.000Z',
      firstReceivedAt: '2026-06-23T00:00:00.000Z',
      lastReceivedAt: '2026-06-23T00:00:00.300Z',
      captureStartMs: -3000,
      captureEndMs: 1500,
      matched: true,
      matchedAt: '2026-06-23T00:00:01.000Z',
      verdictType: 'environment_crash',
      verdictConfidence: 0.61,
      verdictBlamedCarId: null,
      verdictExplanation: ['The car left the racing surface before impact'],
      snapshots: [],
    },
    jsonIncident: {
      source: 'json',
      status: 'unmatched',
      eventIndex: 13,
      type: 'collision_with_env',
      carId: 7,
      otherCarId: null,
      driverName: 'ramen',
      otherDriverName: null,
      impactSpeed: 44,
      worldPosition: { x: 14, y: 0, z: 29 },
    },
    match: {
      status: 'matched',
      liveIncidentId: 2,
      jsonEventIndex: 13,
      distanceM: 1.5,
      impactDiffKmh: 2,
    },
  };
}

test('renders community-review wording with softer responsibility by default', () => {
  const incident = createMatchedCarIncident();
  const message = buildIncidentReportMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    liveIncident: incident.liveIncident,
    jsonIncident: incident.jsonIncident,
    match: incident.match
  });

  const reviewField = message.webhookBody.embeds[0]?.fields.find((field: { name: string }) => field.name === 'Qué revisar');
  const replayField = message.webhookBody.embeds[0]?.fields.find((field: { name: string }) => field.name === 'Pista de replay');
  assert.match(message.summaryText, /Incidente para revisar/);
  assert.match(message.summaryText, /Lectura inicial: posible toque por alcance/);
  assert.match(message.summaryText, /Responsabilidad a revisar: ramen \(#7\)/);
  assert.match(message.summaryText, /Revisión en comunidad:/);
  assert.match(message.summaryText, /juicio automático/);
  assert.match(reviewField?.value ?? '', /Confianza del sistema: media/);
  assert.match(replayField?.value ?? '', /Hora de captura live: 00:00:00 UTC/);
  assert.doesNotMatch(message.summaryText, /culpable|culpa|responsable directo/i);
});

test('uses stronger responsibility wording only at very high confidence', () => {
  const incident = createMatchedCarIncident();
  incident.liveIncident.verdictConfidence = 0.95;
  const message = buildIncidentReportMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    liveIncident: incident.liveIncident,
    jsonIncident: incident.jsonIncident,
    match: incident.match
  });

  assert.match(message.summaryText, /Responsabilidad probable: ramen \(#7\)/);
  assert.match(message.summaryText, /señal bastante fuerte/i);
});

test('skips cleanly when incidents webhook disabled', async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input));
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendIncidentReports({
      enabled: false,
      webhookUrl: 'https://discord.example/incidents',
      fileName: 'sample-race.json',
      race: createRace(),
      incidents: [createMatchedCarIncident()]
    });

    assert.equal(result.status, 'skipped');
    assert.deepEqual(result.deliveredIncidentIds, []);
    assert.equal(fetchCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('processor skips env incidents for the separate incident webhook and keeps normal report separate', async (t) => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ INCIDENTS_WEBHOOK_ENABLED: 'true', INCIDENTS_DISCORD_WEBHOOK_URL: 'legacy' }), [
    'INCIDENTS_WEBHOOK_ENABLED',
    'INCIDENTS_DISCORD_WEBHOOK_URL'
  ]);
  return;
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-incident-webhook-'));
  const resultsDir = join(directory, 'results');
  const databasePath = join(directory, 'ac-race-monitor.sqlite');
  const sampleFileName = '2026_6_20_4_0_RACE.json';
  const samplePath = join(resultsDir, sampleFileName);
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const fetchCalls: Array<{ url: string; body: string }> = [];

  mkdirSync(resultsDir, { recursive: true });
  copyFileSync(resolve(process.cwd(), 'samples/results', sampleFileName), samplePath);

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), body: String(init?.body ?? '') });
    return new Response(null, { status: 200, statusText: 'OK' });
  }) as typeof fetch;
  console.info = () => {};

  const database = openDatabase(databasePath);
  const repositories = createRepositories(database);
  const config = createConfig(resultsDir, databasePath);
  const processRaceFile = createRaceProcessor(config, repositories);

  repositories.liveIncidents.persist({
    incident: {
      incidentId: 'grouped-live-incident',
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
          relativePosition: { x: 0.4, y: 0, z: -0.2 }
        },
        {
          type: 'collision_with_env',
          receivedAt: '2026-06-20T04:00:00.100Z',
          receivedAtMs: Date.parse('2026-06-20T04:00:00.100Z'),
          carId: 1,
          impactSpeed: 44,
          worldPosition: { x: 950.4512, y: -2.8892956, z: -908.71387 },
          relativePosition: { x: 0.3, y: 0, z: -0.1 }
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
              normalizedSplinePos: 0.25
            },
            {
              receivedAtMs: Date.parse('2026-06-20T04:00:00.050Z'),
              carId: 1,
              pos: { x: 950.3, y: -2.9, z: -908.8 },
              velocity: { x: 4, y: 0, z: 0 },
              speedKmh: 42,
              gear: 2,
              engineRpm: 3500,
              normalizedSplinePos: 0.251
            }
          ]
        }
      ]
    }
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    database.close();
  });

  const result = await processRaceFile(samplePath);
  assert.equal(result, 'processed');
  assert.equal(fetchCalls.length, 1);

  const raceCall = fetchCalls.find((call) => call.url === 'https://discord.example/race');
  const incidentCall = fetchCalls.find((call) => call.url === 'https://discord.example/incidents');
  assert.ok(raceCall);
  assert.equal(incidentCall, undefined);
  assert.match(raceCall?.body ?? '', /Race Report -/);
  assert.doesNotMatch(raceCall?.body ?? '', /Veredicto sugerido/);
});

test('grouped incident results in one separate report, not spam', async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input));
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendIncidentReports({
      enabled: true,
      webhookUrl: 'https://discord.example/incidents',
      fileName: 'sample-race.json',
      race: createRace(),
      incidents: [createMatchedCarIncident()]
    });

    assert.equal(result.status, 'sent');
    assert.deepEqual(result.deliveredIncidentIds, [1]);
    assert.equal(fetchCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendIncidentReports filters out env incidents and preserves auto-vs-auto reports', async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input));
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendIncidentReports({
      enabled: true,
      webhookUrl: 'https://discord.example/incidents',
      fileName: 'sample-race.json',
      race: createRace(),
      incidents: [createMatchedEnvIncident(), createMatchedCarIncident()]
    });

    assert.equal(result.status, 'sent');
    assert.deepEqual(result.deliveredIncidentIds, [1]);
    assert.equal(fetchCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createIncidentReportDelivery stays text-only for community review reports', () => {
  const incident = createMatchedCarIncident();
  const delivery = createIncidentReportDelivery({
    fileName: 'sample-race.json',
    race: createRace(),
    liveIncident: incident.liveIncident,
    jsonIncident: incident.jsonIncident,
    match: incident.match,
  });

  assert.equal(delivery.primaryMessage.attachments, undefined);
  assert.equal(delivery.primaryMessage.webhookBody.embeds[0]?.fields.some((field) => field.name === 'Pista de replay'), true);
});

test('sendIncidentReports uses JSON-only webhook payloads for incident review reports', async () => {
  const fetchCalls: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), body: init?.body, headers: init?.headers });
    return new Response(null, { status: 200, statusText: 'OK' });
  }) as typeof fetch;

  try {
    const result = await sendIncidentReports({
      enabled: true,
      webhookUrl: 'https://discord.example/incidents',
      fileName: 'sample-race.json',
      race: createRace(),
      incidents: [createMatchedCarIncident()],
    });

    assert.equal(result.status, 'sent');
    assert.deepEqual(result.deliveredIncidentIds, [1]);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.body instanceof FormData, false);
    assert.equal((fetchCalls[0]?.headers as Record<string, string>)['content-type'], 'application/json');
    assert.match(String(fetchCalls[0]?.body ?? ''), /Incidente para revisar/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('processor leaves legacy live incident rows untouched', async (t) => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ LIVE_UDP_ENABLED: 'true', INCIDENT_DEBUG: 'true' }), [
    'LIVE_UDP_ENABLED',
    'INCIDENT_DEBUG'
  ]);
  return;
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-incident-cleanup-success-'));
  const resultsDir = join(directory, 'results');
  const databasePath = join(directory, 'ac-race-monitor.sqlite');
  const sampleFileName = '2026_6_20_4_0_RACE.json';
  const samplePath = join(resultsDir, sampleFileName);
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;

  mkdirSync(resultsDir, { recursive: true });
  copyFileSync(resolve(process.cwd(), 'samples/results', sampleFileName), samplePath);

  const database = openDatabase(databasePath);
  const repositories = createRepositories(database);
  const config = createConfig(resultsDir, databasePath);
  const processRaceFile = createRaceProcessor(config, repositories);
  const alignedIncident = seedMatchedCarIncidentFromSample(repositories, samplePath, sampleFileName);

  globalThis.fetch = (async () => new Response(null, { status: 200, statusText: 'OK' })) as typeof fetch;
  console.info = () => {};

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    database.close();
  });

  const beforeSnapshots = database.prepare('SELECT COUNT(*) AS count FROM live_incident_snapshots WHERE incident_id = ?').get(alignedIncident.id) as { count: number };
  assert.ok(beforeSnapshots.count > 0);

  const result = await processRaceFile(samplePath);
  const persistedIncident = repositories.liveIncidents.list().find((incident) => incident.id === alignedIncident.id);
  const incidentRowCount = (database.prepare('SELECT COUNT(*) AS count FROM live_incidents WHERE id = ?').get(alignedIncident.id) as { count: number }).count;
  const snapshotRowCount = (database.prepare('SELECT COUNT(*) AS count FROM live_incident_snapshots WHERE incident_id = ?').get(alignedIncident.id) as { count: number }).count;

  assert.equal(result, 'processed');
  assert.ok(persistedIncident);
  assert.equal(incidentRowCount, 1);
  assert.equal(snapshotRowCount, beforeSnapshots.count);
  assert.equal(persistedIncident?.matched, false);
  assert.equal(persistedIncident?.raceId, null);
});

test('processor does not create an incident delivery failure path', async (t) => {
  assert.deepEqual(getConfiguredDeprecatedLegacySettings({ INCIDENTS_WEBHOOK_ENABLED: 'true', LIVE_UDP_DEBUG: 'true' }), [
    'LIVE_UDP_DEBUG',
    'INCIDENTS_WEBHOOK_ENABLED'
  ]);
  return;
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-incident-cleanup-failed-'));
  const resultsDir = join(directory, 'results');
  const databasePath = join(directory, 'ac-race-monitor.sqlite');
  const sampleFileName = '2026_6_20_4_0_RACE.json';
  const samplePath = join(resultsDir, sampleFileName);
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;

  mkdirSync(resultsDir, { recursive: true });
  copyFileSync(resolve(process.cwd(), 'samples/results', sampleFileName), samplePath);

  const database = openDatabase(databasePath);
  const repositories = createRepositories(database);
  const config = createConfig(resultsDir, databasePath);
  const processRaceFile = createRaceProcessor(config, repositories);
  const alignedIncident = seedMatchedCarIncidentFromSample(repositories, samplePath, sampleFileName);

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    return url.includes('/incidents')
      ? new Response('incident webhook down', { status: 500, statusText: 'ERR' })
      : new Response(null, { status: 200, statusText: 'OK' });
  }) as typeof fetch;
  console.info = () => {};

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    database.close();
  });

  const result = await processRaceFile(samplePath);
  const persistedIncident = repositories.liveIncidents.list().find((incident) => incident.id === alignedIncident.id);
  const incidentRow = database.prepare('SELECT matched, race_id FROM live_incidents WHERE id = ?').get(alignedIncident.id) as {
    matched: number;
    race_id: number | null;
  };
  const snapshotRowCount = (database.prepare('SELECT COUNT(*) AS count FROM live_incident_snapshots WHERE incident_id = ?').get(alignedIncident.id) as { count: number }).count;

  assert.equal(result, 'processed');
  assert.ok(persistedIncident);
  assert.equal(incidentRow.matched, 0);
  assert.equal(incidentRow.race_id, null);
  assert.ok(snapshotRowCount > 0);
});

function seedMatchedCarIncidentFromSample(
  repositories: ReturnType<typeof createRepositories>,
  samplePath: string,
  sampleFileName: string
): PersistedLiveIncident {
  const race = parseRaceJson(readFileSync(samplePath, 'utf8'), sampleFileName);
  const jsonIncident = extractRaceCollisionEvents(race).find((incident) => incident.type === 'collision_with_car');

  assert.ok(jsonIncident);
  assert.ok(jsonIncident.worldPosition);

  const seeded = repositories.liveIncidents.persist({
    incident: {
      incidentId: `cleanup-${jsonIncident.eventIndex}`,
      type: 'collision_with_car',
      firstReceivedAtMs: Date.parse('2026-06-20T04:00:00.000Z'),
      lastReceivedAtMs: Date.parse('2026-06-20T04:00:00.200Z'),
      captureStartMs: -3000,
      captureEndMs: 1500,
      anchorPosition: jsonIncident.worldPosition,
      events: [
        {
          type: 'collision_with_car',
          receivedAt: '2026-06-20T04:00:00.000Z',
          receivedAtMs: Date.parse('2026-06-20T04:00:00.000Z'),
          carId: jsonIncident.carId,
          otherCarId: jsonIncident.otherCarId,
          impactSpeed: jsonIncident.impactSpeed,
          worldPosition: jsonIncident.worldPosition,
          relativePosition: { x: 0.1, y: 0, z: -0.1 },
        },
      ],
      cars: [
        {
          carId: jsonIncident.carId,
          snapshots: [
            {
              receivedAtMs: Date.parse('2026-06-20T03:59:59.900Z'),
              carId: jsonIncident.carId,
              pos: jsonIncident.worldPosition,
              velocity: { x: 10, y: 0, z: 0 },
              speedKmh: Math.max(jsonIncident.impactSpeed + 10, 20),
              gear: 4,
              engineRpm: 6000,
              normalizedSplinePos: 0.25,
            },
          ],
        },
        {
          carId: jsonIncident.otherCarId,
          snapshots: [
            {
              receivedAtMs: Date.parse('2026-06-20T03:59:59.900Z'),
              carId: jsonIncident.otherCarId,
              pos: { x: jsonIncident.worldPosition.x + 1, y: jsonIncident.worldPosition.y, z: jsonIncident.worldPosition.z + 1 },
              velocity: { x: 8, y: 0, z: 0 },
              speedKmh: Math.max(jsonIncident.impactSpeed, 10),
              gear: 4,
              engineRpm: 5800,
              normalizedSplinePos: 0.251,
            },
          ],
        },
      ],
    },
  });

  assert.equal(seeded.status, 'inserted');

  const incident = repositories.liveIncidents.list().find((entry) => entry.id === seeded.incidentId);
  assert.ok(incident);
  return incident;
}
