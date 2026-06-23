import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { AppConfig } from '../src/config';
import { openDatabase } from '../src/db/db';
import { createRepositories, type PersistedLiveIncident } from '../src/db/repositories';
import { buildIncidentReportMessage, sendIncidentReports } from '../src/discord/sendIncidentReport';
import { createRaceProcessor } from '../src/index';
import type { JsonRaceIncident, MatchedIncidentPair } from '../src/live/matchLiveIncidents';
import type { ParsedRace } from '../src/types/assetto';

function createConfig(resultsDir: string, databasePath: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    resultsDir,
    databasePath,
    discordWebhookUrl: 'https://discord.example/race',
    incidentsDiscordWebhookUrl: 'https://discord.example/incidents',
    incidentsWebhookEnabled: true,
    liveUdpEnabled: false,
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

test('renders assistant-style wording without absolute blame', () => {
  const incident = createMatchedCarIncident();
  const message = buildIncidentReportMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    liveIncident: incident.liveIncident,
    jsonIncident: incident.jsonIncident,
    match: incident.match
  });

  const assistantField = message.webhookBody.embeds[0]?.fields.find((field: { name: string }) => field.name === 'Asistente');
  assert.match(message.summaryText, /Veredicto sugerido: posible choque de atrás/);
  assert.match(message.summaryText, /Confianza: media/);
  assert.match(message.summaryText, /Responsabilidad probable: ramen/);
  assert.doesNotMatch(message.summaryText, /culpable|culpa|responsable directo/i);
  assert.match(assistantField?.value ?? '', /Responsabilidad probable: ramen/);
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

    assert.equal(result, 'skipped');
    assert.equal(fetchCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('processor sends incidents to incident webhook and keeps normal report separate', async (t) => {
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
  assert.equal(fetchCalls.length, 2);

  const raceCall = fetchCalls.find((call) => call.url === 'https://discord.example/race');
  const incidentCall = fetchCalls.find((call) => call.url === 'https://discord.example/incidents');
  assert.ok(raceCall);
  assert.ok(incidentCall);
  assert.match(raceCall?.body ?? '', /Race Report -/);
  assert.doesNotMatch(raceCall?.body ?? '', /Veredicto sugerido/);
  assert.match(incidentCall?.body ?? '', /Veredicto sugerido/);
  assert.match(incidentCall?.body ?? '', /posible golpe con entorno/);
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

    assert.equal(result, 'sent');
    assert.equal(fetchCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
