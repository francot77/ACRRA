import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AppConfig, loadConfig } from './config';
import { buildRaceMessage } from './discord/buildRaceMessage';
import { sendWebhook } from './discord/sendWebhook';
import { openDatabase } from './db/db';
import { createRepositories, Repositories } from './db/repositories';
import { applySafetyRatings } from './parser/calculateSafety';
import { calculateDriverStats } from './parser/calculateDriverStats';
import { groupIncidents } from './parser/groupIncidents';
import { NonRaceSessionError, parseRaceJson } from './parser/parseRaceJson';
import { ParsedCarCollisionEvent } from './types/assetto';
import { watchRaceResults } from './watcher';

export function createRaceProcessor(config: AppConfig, repositories: Repositories) {
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
  const database = openDatabase(config.databasePath);
  const repositories = createRepositories(database);
  const processRaceFile = createRaceProcessor(config, repositories);
  const watcher = await watchRaceResults({ config, repositories, processFile: processRaceFile });

  log('info', 'bootstrap', 'AC race monitor started', {
    resultsDir: config.resultsDir,
    watchGlob: config.watchGlob,
    processedFileStrategy: config.processedFileStrategy
  });

  const shutdown = async (signal: string): Promise<void> => {
    log('info', 'bootstrap', 'Shutting down AC race monitor', { signal });
    await watcher.close();
    database.close();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

function log(level: 'info' | 'error', component: string, message: string, fields: Record<string, unknown>): void {
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
