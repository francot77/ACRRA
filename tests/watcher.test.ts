import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AppConfig } from '../src/config';
import { Repositories } from '../src/db/repositories';
import { watchRaceResults } from '../src/watcher';

function createConfig(resultsDir: string): AppConfig {
  return {
    resultsDir,
    databasePath: join(resultsDir, 'unused.sqlite'),
    trackModelPath: join(process.cwd(), 'track-models/monza/track-model.json'),
    trackModelTrack: 'monza',
    trackModelLayout: null,
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
    scanOnStart: false,
    minFileAgeMs: 80,
    watchGlob: '*RACE*.json',
    defaultSafetyRating: 75,
    safetyMemoryFactor: 0.85,
    minActiveDriversForSafetyGain: 3,
    nuclearMissileMinCarImpactKmh: 100,
    nodeEnv: 'test'
  };
}

function createRepositories(processedFiles: Set<string>): Repositories {
  return {
    processedFiles: {
      has(fileName: string): boolean {
        return processedFiles.has(fileName);
      }
    },
    drivers: {
      getSafetyRatings(): Record<string, number> {
        return {};
      }
    },
    races: {
      persist() {
        throw new Error('Not used in watcher integration tests');
      }
    },
    liveIncidents: {
      persist() {
        throw new Error('Not used in watcher integration tests');
      },
      list() {
        return [];
      },
      listPendingMatch() {
        return [];
      },
      markMatched() {
        return false;
      }
    }
  } as Repositories;
}

async function waitFor(assertion: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function waitForWatcherReady(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

test('watcher delays processing until a growing race file becomes stable', async (t) => {
  const resultsDir = mkdtempSync(join(tmpdir(), 'motassettorr-watcher-grow-'));
  const processedFiles = new Set<string>();
  const processPayloads: string[] = [];
  const infoLogs: string[] = [];
  const originalInfo = console.info;

  console.info = (message?: unknown) => {
    infoLogs.push(String(message));
  };

  const watcher = await watchRaceResults({
    config: createConfig(resultsDir),
    repositories: createRepositories(processedFiles),
    processFile: async (filePath) => {
      processPayloads.push(await readFile(filePath, 'utf8'));
      return 'processed';
    }
  });

  t.after(async () => {
    console.info = originalInfo;
    await watcher.close();
  });

  await waitForWatcherReady();

  const filePath = join(resultsDir, 'partial-RACE.json');
  writeFileSync(filePath, '{"Type":"RACE"', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(processPayloads.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  appendFileSync(filePath, ',"complete":true}', 'utf8');

  await waitFor(() => processPayloads.length === 1);

  assert.equal(processPayloads.length, 1);
  assert.equal(processPayloads[0], '{"Type":"RACE","complete":true}');
  assert.ok(infoLogs.some((entry) => entry.includes('Race file still changing, delaying parse')) || processPayloads.length === 1);
});

test('watcher retries corrupt JSON, skips it, and keeps running', async (t) => {
  const resultsDir = mkdtempSync(join(tmpdir(), 'motassettorr-watcher-invalid-'));
  const processedFiles = new Set<string>();
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  const successfulFiles: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  let invalidAttempts = 0;

  console.info = (message?: unknown) => {
    infoLogs.push(String(message));
  };
  console.error = (message?: unknown) => {
    errorLogs.push(String(message));
  };

  const watcher = await watchRaceResults({
    config: createConfig(resultsDir),
    repositories: createRepositories(processedFiles),
    processFile: async (filePath) => {
      if (basename(filePath) === 'corrupt-RACE.json') {
        invalidAttempts += 1;
        throw new SyntaxError('Unexpected end of JSON input');
      }

      successfulFiles.push(basename(filePath));
      return 'processed';
    }
  });

  t.after(async () => {
    console.info = originalInfo;
    console.error = originalError;
    await watcher.close();
  });

  await waitForWatcherReady();

  writeFileSync(join(resultsDir, 'corrupt-RACE.json'), '{bad-json', 'utf8');

  await waitFor(() => errorLogs.some((entry) => entry.includes('Invalid race JSON, skipping')));

  copyFileSync(join(process.cwd(), 'samples/results', '2026_6_20_2_16_RACE.json'), join(resultsDir, 'valid-RACE.json'));

  await waitFor(() => successfulFiles.includes('valid-RACE.json'));

  assert.equal(invalidAttempts, 5);
  assert.equal(infoLogs.filter((entry) => entry.includes('Invalid race JSON, retrying')).length, 4);
  assert.ok(errorLogs.some((entry) => entry.includes('Invalid race JSON, skipping')));
  assert.deepEqual(successfulFiles, ['valid-RACE.json']);
});

test('watcher suppresses duplicate processing after a successful file run', async (t) => {
  const resultsDir = mkdtempSync(join(tmpdir(), 'motassettorr-watcher-duplicate-'));
  const processedFiles = new Set<string>();
  const infoLogs: string[] = [];
  const originalInfo = console.info;
  const processed: string[] = [];

  console.info = (message?: unknown) => {
    infoLogs.push(String(message));
  };

  const watcher = await watchRaceResults({
    config: createConfig(resultsDir),
    repositories: createRepositories(processedFiles),
    processFile: async (filePath) => {
      const fileName = basename(filePath);
      processed.push(fileName);
      processedFiles.add(fileName);
      return 'processed';
    }
  });

  t.after(async () => {
    console.info = originalInfo;
    await watcher.close();
  });

  await waitForWatcherReady();

  const filePath = join(resultsDir, 'duplicate-RACE.json');
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(filePath, '{"ok":true}', 'utf8');

  await waitFor(() => processed.length === 1);

  appendFileSync(filePath, ' ', 'utf8');

  await waitFor(() => infoLogs.some((entry) => entry.includes('Skipping already processed file')));

  assert.deepEqual(processed, ['duplicate-RACE.json']);
});
