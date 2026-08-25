import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, type AppConfig } from '../../src/config';
import { bootstrapApplication } from '../../src/index';

test('loadConfig does not require the removed track model settings', () => {
  const config = loadConfig({
    TRACK_MODEL_PATH: '/app/track-models/monza/track-model.json',
    TRACK_MODEL_TRACK: 'monza',
    TRACK_MODEL_LAYOUT: '   ',
  });

  assert.equal('trackModelPath' in config, false);
  assert.equal('trackModelTrack' in config, false);
  assert.equal('trackModelLayout' in config, false);
});

test('bootstrapApplication starts without loading a track model or UDP client', async () => {
  const calls: string[] = [];

  const runtime = await bootstrapApplication(createConfig(), {
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
    async watchRaceResults() {
      calls.push('watchRaceResults');
      return { close: async () => undefined };
    },
  });

  assert.deepEqual(calls, ['openDatabase', 'createRepositories', 'watchRaceResults']);
  assert.equal(runtime.liveUdpClient, null);
});

function createConfig(): AppConfig {
  return {
    resultsDir: '/app/results',
    databasePath: '/app/data/ac-race-monitor.sqlite',
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
  };
}
