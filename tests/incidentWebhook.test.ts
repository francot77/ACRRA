import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { AppConfig } from '../src/config';
import { openDatabase } from '../src/db/db';
import { createRepositories, type PersistedLiveIncident } from '../src/db/repositories';
import { buildIncidentReportMessage, createIncidentReportDelivery, sendIncidentReports } from '../src/discord/sendIncidentReport';
import { createRaceProcessor } from '../src/index';
import type { JsonRaceIncident, MatchedIncidentPair } from '../src/live/matchLiveIncidents';
import { TrackQueryService } from '../src/track/trackQueryService';
import type { TrackRuntimeModel } from '../src/track/trackTypes';
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

test('createIncidentReportDelivery attaches incident.svg and visual metadata when reconstruction succeeds', () => {
  const incident = createMatchedCarIncident();
  const delivery = createIncidentReportDelivery({
    fileName: 'sample-race.json',
    race: createRace(),
    liveIncident: incident.liveIncident,
    jsonIncident: incident.jsonIncident,
    match: incident.match,
    reconstructionTrackContext: createReconstructionTrackContext(),
  });

  assert.equal(delivery.primaryMessage.attachments?.[0]?.filename, 'incident.svg');
  const visualField = delivery.primaryMessage.webhookBody.embeds[0]?.fields.find((field) => field.name === 'Reconstrucción visual');
  assert.match(visualField?.value ?? '', /Estado: sequence_ready/);
  assert.match(visualField?.value ?? '', /Adjunto SVG: sí/);
  assert.equal(delivery.fallbackMessage?.attachments, undefined);
  assert.match(delivery.fallbackMessage?.summaryText ?? '', /upload failed/);
});

test('createIncidentReportDelivery keeps text-only message when artifact budget omits the svg', () => {
  const incident = createMatchedCarIncident();
  const delivery = createIncidentReportDelivery(
    {
      fileName: 'sample-race.json',
      race: createRace(),
      liveIncident: incident.liveIncident,
      jsonIncident: incident.jsonIncident,
      match: incident.match,
      reconstructionTrackContext: createReconstructionTrackContext(),
    },
    {
      buildArtifacts: ({ scene }) => ({
        delivery: 'omitted',
        frames: [{ atRelativeMs: 0, source: 'observed', cars: [] }],
        notes: [...scene.notes, 'incident.svg omitted because 999999 bytes exceeded local budget 131072'],
      }),
    }
  );

  assert.equal(delivery.primaryMessage.attachments, undefined);
  assert.equal(delivery.fallbackMessage, undefined);
  assert.match(delivery.primaryMessage.summaryText, /Estado: omitted/);
  assert.match(delivery.primaryMessage.summaryText, /incident\.svg omitted/);
});

test('sendIncidentReports retries text-only delivery after multipart webhook failure', async () => {
  const fetchCalls: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), body: init?.body, headers: init?.headers });
    return fetchCalls.length === 1
      ? new Response('attachment rejected', { status: 500, statusText: 'ERR' })
      : new Response(null, { status: 200, statusText: 'OK' });
  }) as typeof fetch;

  try {
    const result = await sendIncidentReports({
      enabled: true,
      webhookUrl: 'https://discord.example/incidents',
      fileName: 'sample-race.json',
      race: createRace(),
      incidents: [createMatchedCarIncident()],
      reconstructionTrackContext: createReconstructionTrackContext(),
    });

    assert.equal(result, 'sent');
    assert.equal(fetchCalls.length, 2);
    assert.ok(fetchCalls[0]?.body instanceof FormData);
    assert.equal((fetchCalls[1]?.headers as Record<string, string>)['content-type'], 'application/json');
    assert.match(String(fetchCalls[1]?.body ?? ''), /Estado: omitted/);
    assert.match(String(fetchCalls[1]?.body ?? ''), /upload failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createIncidentReportDelivery falls back to text-only metadata when artifact build throws', () => {
  const incident = createMatchedCarIncident();
  const delivery = createIncidentReportDelivery(
    {
      fileName: 'sample-race.json',
      race: createRace(),
      liveIncident: incident.liveIncident,
      jsonIncident: incident.jsonIncident,
      match: incident.match,
      reconstructionTrackContext: createReconstructionTrackContext(),
    },
    {
      buildArtifacts: () => {
        throw new Error('render pipeline exploded');
      },
    }
  );

  assert.equal(delivery.primaryMessage.attachments, undefined);
  assert.equal(delivery.fallbackMessage, undefined);
  assert.match(delivery.primaryMessage.summaryText, /Visual reconstruction omitted after build failure: render pipeline exploded/);
});

function createReconstructionTrackContext() {
  return {
    queryService: new TrackQueryService(createRuntime()),
    sessionTrackIdentity: { trackName: 'monza', trackConfig: null },
  } as const;
}

function createRuntime(): TrackRuntimeModel {
  return Object.freeze({
    schemaVersion: 1,
    track: 'monza',
    layout: null,
    totalLengthMeters: 1000,
    pointCount: 4,
    points: Object.freeze([
      createPoint({ index: 0, normalized: 0, center: { x: 0, y: 0, z: 0 }, leftEdge: { x: 0, y: 0, z: 5 }, rightEdge: { x: 0, y: 0, z: -5 } }),
      createPoint({ index: 1, normalized: 0.25, center: { x: 10, y: 0, z: 0 }, leftEdge: { x: 10, y: 0, z: 5 }, rightEdge: { x: 10, y: 0, z: -5 } }),
      createPoint({ index: 2, normalized: 0.5, center: { x: 20, y: 0, z: 4 }, leftEdge: { x: 20, y: 0, z: 9 }, rightEdge: { x: 20, y: 0, z: -1 } }),
      createPoint({ index: 3, normalized: 0.75, center: { x: 30, y: 0, z: 8 }, leftEdge: { x: 30, y: 0, z: 13 }, rightEdge: { x: 30, y: 0, z: 3 } }),
    ]),
  });
}

function createPoint(overrides: Partial<TrackRuntimeModel['points'][number]> = {}): TrackRuntimeModel['points'][number] {
  return Object.freeze({
    index: overrides.index ?? 0,
    s: overrides.s ?? 0,
    normalized: overrides.normalized ?? 0,
    center: Object.freeze(overrides.center ?? { x: 0, y: 0, z: 0 }),
    forward: Object.freeze(overrides.forward ?? { x: 1, y: 0, z: 0 }),
    sideLeft: overrides.sideLeft ?? 5,
    sideRight: overrides.sideRight ?? 5,
    width: overrides.width ?? 10,
    leftEdge: Object.freeze(overrides.leftEdge ?? { x: 0, y: 0, z: 5 }),
    rightEdge: Object.freeze(overrides.rightEdge ?? { x: 0, y: 0, z: -5 }),
  });
}
