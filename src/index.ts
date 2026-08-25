import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AppConfig, getConfiguredDeprecatedLegacySettings, loadConfig } from './config';
import { buildRaceMessage } from './discord/buildRaceMessage';
import { sendWebhook } from './discord/sendWebhook';
import { openDatabase } from './db/db';
import { createRepositories, Repositories } from './db/repositories';
import { startAcUdpClient } from './live/acUdpClient';
import { applySafetyRatings } from './parser/calculateSafety';
import { calculateDriverStats } from './parser/calculateDriverStats';
import { groupIncidents } from './parser/groupIncidents';
import { NonRaceSessionError, parseRaceJson } from './parser/parseRaceJson';
import { loadTrackModelRuntime } from './track/trackModelAdapter';
import type { TrackRuntimeModel } from './track/trackTypes';
import { ParsedCarCollisionEvent } from './types/assetto';
import { watchRaceResults } from './watcher';
import { DailyRaceScheduler, SqliteRunSlotStore } from './scoring/scheduler';
import { ScoringRunService } from './scoring/service';
import { ScoringStore } from './scoring/store';

type BootstrapRuntime = {
  trackRuntime: TrackRuntimeModel;
  database: ReturnType<typeof openDatabase>;
  repositories: Repositories;
  processRaceFile: ReturnType<typeof createRaceProcessor>;
  liveUdpClient: Awaited<ReturnType<typeof startAcUdpClient>> | null;
  watcher: Awaited<ReturnType<typeof watchRaceResults>>;
  scoringScheduler: DailyRaceScheduler | null;
};

type BootstrapDependencies = {
  loadTrackRuntime?: (config: AppConfig) => TrackRuntimeModel;
  openDatabase?: typeof openDatabase;
  createRepositories?: typeof createRepositories;
  startAcUdpClient?: typeof startAcUdpClient;
  watchRaceResults?: typeof watchRaceResults;
};

export function createRaceProcessor(
  config: AppConfig,
  repositories: Repositories
) {
  return async function processRaceFile(filePath: string): Promise<'processed' | 'duplicate' | 'non-race'> {
    const fileName = basename(filePath);

    if (repositories.processedFiles.has(fileName)) {
      log('info', 'processor', 'Skipping already processed file', { fileName });
      return 'duplicate';
    }

    const fileContent = readFileSync(filePath, 'utf8');
    const fileHash = createHash('sha256').update(fileContent).digest('hex');

    let race;
    try {
      race = parseRaceJson(fileContent, fileName);
    } catch (error) {
      if (error instanceof NonRaceSessionError) {
        log('info', 'processor', error.message, { fileName });
        return 'non-race';
      }

      throw error;
    }

    const groupedIncidents = groupIncidents(
      race.events.filter((event): event is ParsedCarCollisionEvent => event.type === 'COLLISION_WITH_CAR')
    );
    const driverStats = calculateDriverStats(race, groupedIncidents, config.defaultSafetyRating);
    const historicalRatings = repositories.drivers.getSafetyRatings(
      driverStats.flatMap((entry) => (entry.guid ? [entry.guid] : []))
    );
    const ratedDriverStats = applySafetyRatings(
      driverStats,
      historicalRatings,
      {
        defaultSafetyRating: config.defaultSafetyRating,
        safetyMemoryFactor: config.safetyMemoryFactor,
        minActiveDriversForSafety: config.minActiveDriversForSafetyGain
      }
    );
    const persistence = repositories.races.persist({
      fileName,
      filePath,
      fileHash,
      processedAt: new Date().toISOString(),
      race,
      stats: ratedDriverStats
    });

    if (persistence.status === 'duplicate') {
      log('info', 'processor', 'Skipping already processed file', { fileName });
      return 'duplicate';
    }

    log('info', 'processor', 'Persisted race results', {
      fileName,
      raceId: persistence.raceId,
      persistedDrivers: persistence.persistedDrivers,
      skippedTempDrivers: ratedDriverStats.filter((entry) => !entry.guid).length
    });

    const raceMessage = buildRaceMessage({
      fileName,
      race,
      stats: ratedDriverStats,
      groupedIncidents,
      minActiveDriversForSafetyGain: config.minActiveDriversForSafetyGain,
      nuclearMissileMinCarImpactKmh: config.nuclearMissileMinCarImpactKmh
    });
    await sendWebhook(config.discordWebhookUrl, raceMessage);

    return 'processed';
  };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const deprecatedSettings = getConfiguredDeprecatedLegacySettings();
  if (deprecatedSettings.length > 0) {
    log('warn', 'bootstrap', 'Legacy UDP and incident settings are deprecated and ignored; file race exports remain authoritative', {
      settings: deprecatedSettings
    });
  }
  const runtime = await bootstrapApplication(config);

  log('info', 'bootstrap', 'AC race monitor started', {
    resultsDir: config.resultsDir,
    watchGlob: config.watchGlob,
    processedFileStrategy: config.processedFileStrategy,
    liveUdpEnabled: config.liveUdpEnabled,
    liveUdpSmokeGateReady: runtime.liveUdpClient?.getStatus().smokeGate.ready ?? false,
    trackModelPath: config.trackModelPath,
    trackModelTrack: runtime.trackRuntime.track,
    trackModelLayout: runtime.trackRuntime.layout
  });

  const shutdown = async (signal: string): Promise<void> => {
    log('info', 'bootstrap', 'Shutting down AC race monitor', { signal });
    await runtime.liveUdpClient?.close();
    await runtime.watcher.close();
    runtime.scoringScheduler?.stop();
    runtime.database.close();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

export async function bootstrapApplication(
  config: AppConfig,
  dependencies: BootstrapDependencies = {}
): Promise<BootstrapRuntime> {
  const loadTrackRuntime = dependencies.loadTrackRuntime ?? loadTrackContextRuntime;
  const openDatabaseDependency = dependencies.openDatabase ?? openDatabase;
  const createRepositoriesDependency = dependencies.createRepositories ?? createRepositories;
  const startAcUdpClientDependency = dependencies.startAcUdpClient ?? startAcUdpClient;
  const watchRaceResultsDependency = dependencies.watchRaceResults ?? watchRaceResults;

  const trackRuntime = loadTrackRuntime(config);
  const database = openDatabaseDependency(config.databasePath, { archiveDirectory: config.databaseArchiveDirectory ?? undefined });
  const repositories = createRepositoriesDependency(database);
  const processRaceFile = createRaceProcessor(config, repositories);
  // Legacy UDP and incident orchestration is intentionally quarantined.
  void startAcUdpClientDependency;
  const liveUdpClient = null;
  const watcher = await watchRaceResultsDependency({ config, repositories, processFile: processRaceFile });
  const scoringScheduler = config.scoringEnabled
    ? new DailyRaceScheduler({
        source: {
          resultsDir: config.resultsDir,
          sourceGlob: config.scoringSourceGlob,
           minFileAgeMs: config.minFileAgeMs,
           raceWindowMinutes: config.scoringRaceWindowMinutes
        },
        store: new SqliteRunSlotStore(database),
        timezone: config.scoringTimezone,
        dstPolicy: config.scoringDstPolicy,
        onClaim: async (slotKey, source) => {
          await new ScoringRunService(new ScoringStore(database), config.scoringResultsWebhookUrl ?? '').process(slotKey, source);
        }
      })
    : null;
  scoringScheduler?.start();

  return {
    trackRuntime,
    database,
    repositories,
    processRaceFile,
    liveUdpClient,
    watcher,
    scoringScheduler,
  };
}

export function loadTrackContextRuntime(config: AppConfig): TrackRuntimeModel {
  return loadTrackModelRuntime({
    modelPath: config.trackModelPath,
    expectedTrack: config.trackModelTrack,
    expectedLayout: config.trackModelLayout,
  });
}

function log(level: 'info' | 'warn' | 'error', component: string, message: string, fields: Record<string, unknown>): void {
  const payload = JSON.stringify({ level, component, message, ...fields });
  if (level === 'error') {
    console.error(payload);
    return;
  }

  console.info(payload);
}

if (require.main === module) {
  void main();
}
