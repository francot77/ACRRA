import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapApplication } from '../src/index';
import type { AppConfig } from '../src/config';

test('legacy settings do not activate live authority or incident side effects at startup', async () => {
  const calls: string[] = [];
  let udpCloseCalls = 0;
  let incidentWriteCalls = 0;
  let verdictWriteCalls = 0;
  let processFileCalls = 0;

  const runtime = await bootstrapApplication(createConfig(), {
    loadTrackRuntime: () => createTrackRuntime(),
    openDatabase: () => ({
      close: () => calls.push('database.close'),
    } as ReturnType<typeof import('../src/db/db').openDatabase>),
    createRepositories: () => ({
      processedFiles: { has: () => false },
      drivers: { getSafetyRatings: () => ({}) },
      races: { persist: () => { throw new Error('race persistence was not expected'); } },
      liveIncidents: {
        persist: () => { incidentWriteCalls += 1; throw new Error('live incident write'); },
        list: () => [],
        listPendingMatch: () => { incidentWriteCalls += 1; return []; },
        markMatched: () => { verdictWriteCalls += 1; return false; },
        deleteMatched: () => { incidentWriteCalls += 1; return 0; },
      },
    } as ReturnType<typeof import('../src/db/repositories').createRepositories>),
    async startAcUdpClient() {
      calls.push('startAcUdpClient');
      return {
        close: async () => { udpCloseCalls += 1; },
        getStatus: () => ({ smokeGate: { ready: false, captureEnabled: false, seen: { car_update: false, collision_with_car: false, collision_with_env: false }, seenAt: {} }, finalizedIncidentCount: 0, pendingIncidentCount: 0 }),
        getSnapshots: () => [],
        getFinalizedIncidents: () => [],
      };
    },
    async watchRaceResults({ processFile }) {
      calls.push('watchRaceResults');
      void processFile;
      return { close: async () => calls.push('watcher.close') };
    },
  });

  assert.deepEqual(calls, ['watchRaceResults']);
  assert.equal(runtime.liveUdpClient, null);
  assert.equal(processFileCalls, 0);
  assert.equal(incidentWriteCalls, 0);
  assert.equal(verdictWriteCalls, 0);
  assert.equal(udpCloseCalls, 0);
});

function createConfig(): AppConfig {
  return {
    resultsDir: '/tmp/results', databasePath: '/tmp/acrra-test.sqlite', trackModelPath: 'unused',
    trackModelTrack: 'monza', trackModelLayout: null, discordWebhookUrl: 'legacy-race-webhook',
    incidentsDiscordWebhookUrl: 'legacy-incident-webhook', incidentsWebhookEnabled: true,
    liveUdpEnabled: true, liveUdpDebug: true, acUdpServerHost: '127.0.0.1', acUdpServerPluginPort: 11000,
    acUdpPluginListenPort: 12000, realtimeReportIntervalMs: 250, snapshotRingBufferMs: 10000,
    incidentPreMs: 3000, incidentPostMs: 1500, incidentDebug: true, incidentMatchMaxDistanceM: 30,
    incidentMatchMaxImpactDiffKmh: 35, processedFileStrategy: 'sqlite', scanOnStart: true, minFileAgeMs: 0,
    watchGlob: '*RACE*.json', defaultSafetyRating: 75, safetyMemoryFactor: 0.85,
    minActiveDriversForSafetyGain: 3, nuclearMissileMinCarImpactKmh: 100, nodeEnv: 'test',
  };
}

function createTrackRuntime() {
  return {
    schemaVersion: 1, track: 'monza', layout: null, totalLengthMeters: 1, pointCount: 1,
    points: [{ index: 0, s: 0, normalized: 0, center: { x: 0, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, sideLeft: 1, sideRight: 1, width: 2, leftEdge: { x: 0, y: 0, z: 1 }, rightEdge: { x: 0, y: 0, z: -1 } }],
  } as const;
}
