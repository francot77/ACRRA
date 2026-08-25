import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig, type AppConfig } from '../../src/config';
import { bootstrapApplication, loadTrackContextRuntime } from '../../src/index';

test('loadConfig normalizes a blank TRACK_MODEL_LAYOUT to null', () => {
  const config = loadConfig({ TRACK_MODEL_LAYOUT: '   ' });
  assert.equal(config.trackModelLayout, null);
});

test('bootstrapApplication ignores legacy UDP startup settings', async () => {
  const modelPath = writeTrackModelFixture();
  const calls: string[] = [];
  let receivedTrackRuntime: { track: string; layout: string | null } | null = null;

  const runtime = await bootstrapApplication(createConfig(modelPath, { liveUdpEnabled: true }), {
    loadTrackRuntime(config) {
      calls.push('loadTrackRuntime');
      return loadTrackContextRuntime(config);
    },
    openDatabase() {
      calls.push('openDatabase');
      return { close() {} } as ReturnType<typeof import('../../src/db/db').openDatabase>;
    },
    createRepositories() {
      calls.push('createRepositories');
      return {
        processedFiles: { has: () => false },
        drivers: { getSafetyRatings: () => ({}) },
        races: { persist() { throw new Error('not used'); } },
        liveIncidents: {
          persist() { throw new Error('not used'); },
          list: () => [],
          listPendingMatch: () => [],
          markMatched: () => false,
          deleteMatched: () => 0,
        },
      } as ReturnType<typeof import('../../src/db/repositories').createRepositories>;
    },
    async startAcUdpClient(_config, dependencies) {
      calls.push('startAcUdpClient');
      receivedTrackRuntime = dependencies?.trackRuntime
        ? { track: dependencies.trackRuntime.track, layout: dependencies.trackRuntime.layout }
        : null;
      return {
        close: async () => undefined,
        getStatus: () => ({
          smokeGate: { ready: false, captureEnabled: false, seen: { car_update: false, collision_with_car: false, collision_with_env: false }, seenAt: {} },
          finalizedIncidentCount: 0,
          pendingIncidentCount: 0,
        }),
        getSnapshots: () => [],
        getFinalizedIncidents: () => [],
      };
    },
    async watchRaceResults() {
      calls.push('watchRaceResults');
      return { close: async () => undefined };
    },
  });

  assert.deepEqual(calls, [
    'loadTrackRuntime',
    'openDatabase',
    'createRepositories',
    'watchRaceResults',
  ]);
  assert.equal(runtime.trackRuntime.track, 'monza');
  assert.equal(runtime.trackRuntime.layout, null);
  assert.equal(receivedTrackRuntime, null);
});

test('bootstrapApplication fails fast on invalid track model input before downstream startup', async () => {
  const calls: string[] = [];

  await assert.rejects(
    () => bootstrapApplication(createConfig(join(tmpdir(), 'missing-track-model.json')), {
      loadTrackRuntime(config) {
        calls.push('loadTrackRuntime');
        return loadTrackContextRuntime(config);
      },
      openDatabase() {
        calls.push('openDatabase');
        throw new Error('should not be called');
      },
      createRepositories() {
        calls.push('createRepositories');
        throw new Error('should not be called');
      },
      async startAcUdpClient() {
        calls.push('startAcUdpClient');
        throw new Error('should not be called');
      },
      async watchRaceResults() {
        calls.push('watchRaceResults');
        throw new Error('should not be called');
      },
    }),
    /ENOENT/
  );

  assert.deepEqual(calls, ['loadTrackRuntime']);
});

function createConfig(modelPath: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    resultsDir: '/app/results',
    databasePath: '/app/data/ac-race-monitor.sqlite',
    trackModelPath: modelPath,
    trackModelTrack: 'monza',
    trackModelLayout: null,
    discordWebhookUrl: '',
    incidentsDiscordWebhookUrl: '',
    incidentsWebhookEnabled: false,
    liveUdpEnabled: false,
    liveUdpDebug: false,
    acUdpServerHost: '127.0.0.1',
    acUdpServerPluginPort: 11000,
    acUdpPluginListenPort: 12000,
    realtimeReportIntervalMs: 250,
    snapshotRingBufferMs: 10000,
    incidentPreMs: 3000,
    incidentPostMs: 1500,
    incidentDebug: false,
    incidentMatchMaxDistanceM: 30,
    incidentMatchMaxImpactDiffKmh: 35,
    processedFileStrategy: 'sqlite',
    scanOnStart: true,
    minFileAgeMs: 3000,
    watchGlob: '*RACE*.json',
    defaultSafetyRating: 75,
    safetyMemoryFactor: 0.85,
    minActiveDriversForSafetyGain: 3,
    nuclearMissileMinCarImpactKmh: 100,
    nodeEnv: 'test',
    ...overrides,
  };
}

function writeTrackModelFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-track-model-'));
  const filePath = join(directory, 'track-model.json');

  writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    track: 'monza',
    layout: null,
    totalLengthMeters: 5757.195801,
    pointCount: 1,
    points: [
      {
        index: 0,
        s: 0,
        normalized: 0,
        x: -206.929398,
        y: -8.408029,
        z: 414.00296,
        forwardX: 0.06863857,
        forwardY: 0.00465211,
        forwardZ: -0.99764159,
        sideLeft: 2.982615,
        sideRight: 8.855338,
        width: 11.837953,
        leftX: -203.953817,
        leftY: -8.408029,
        leftZ: 414.207683,
        rightX: -215.763851,
        rightY: -8.408029,
        rightZ: 413.395142,
      },
    ],
  }), 'utf8');

  return filePath;
}
