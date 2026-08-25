import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapApplication } from '../src/index';
import type { AppConfig } from '../src/config';

test('JSON-only bootstrap starts the race-file watcher without live side effects', async () => {
  const calls: string[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  const runtime = await bootstrapApplication(createConfig(), {
    openDatabase: () => ({
      close: () => calls.push('database.close'),
    } as ReturnType<typeof import('../src/db/db').openDatabase>),
    createRepositories: () => ({
      processedFiles: { has: () => false },
      drivers: { getSafetyRatings: () => ({}) },
      races: { persist: () => { throw new Error('race persistence was not expected'); } },
    } as ReturnType<typeof import('../src/db/repositories').createRepositories>),
    async watchRaceResults({ processFile }) {
      calls.push('watchRaceResults');
      void processFile;
      return { close: async () => calls.push('watcher.close') };
    },
  });
  console.warn = originalWarn;

  assert.deepEqual(calls, ['watchRaceResults']);
  assert.equal('liveUdpClient' in runtime, false);
  assert.deepEqual(warnings, []);
});

function createConfig(): AppConfig {
  return {
    resultsDir: '/tmp/results', databasePath: '/tmp/acrra-test.sqlite', discordWebhookUrl: 'legacy-race-webhook',
    processedFileStrategy: 'sqlite', scanOnStart: true, minFileAgeMs: 0,
    watchGlob: '*RACE*.json', defaultSafetyRating: 75, safetyMemoryFactor: 0.85,
    minActiveDriversForSafetyGain: 3, nuclearMissileMinCarImpactKmh: 100, nodeEnv: 'test',
  };
}
