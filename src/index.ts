import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AppConfig, loadConfig } from './config';
import { buildRaceMessage } from './discord/buildRaceMessage';
import { sendIncidentReports } from './discord/sendIncidentReport';
import { sendWebhook } from './discord/sendWebhook';
import { openDatabase } from './db/db';
import { createRepositories, Repositories } from './db/repositories';
import { analyzeIncidentVerdict } from './incidents/analyzeIncidentVerdict';
import { startAcUdpClient } from './live/acUdpClient';
import { extractRaceCollisionEvents, matchLiveIncidentsToRaceEvents } from './live/matchLiveIncidents';
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

    let incidentsForReporting: Array<{
      liveIncident: (ReturnType<typeof repositories.liveIncidents.listPendingMatch>)[number];
      jsonIncident: ReturnType<typeof extractRaceCollisionEvents>[number];
      match: ReturnType<typeof matchLiveIncidentsToRaceEvents>['matched'][number];
    }> = [];

    try {
      const pendingLiveIncidents = repositories.liveIncidents.listPendingMatch();
      const jsonIncidents = extractRaceCollisionEvents(race);
      const matchResult = matchLiveIncidentsToRaceEvents(pendingLiveIncidents, jsonIncidents, {
        maxDistanceM: config.incidentMatchMaxDistanceM,
        maxImpactDiffKmh: config.incidentMatchMaxImpactDiffKmh,
      });

      for (const match of matchResult.matched) {
        const liveIncident = pendingLiveIncidents.find((incident) => incident.id === match.liveIncidentId);
        const jsonIncident = jsonIncidents.find((incident) => incident.eventIndex === match.jsonEventIndex);
        const verdict = liveIncident ? analyzeIncidentVerdict(liveIncident) : undefined;
        const matchedAt = new Date().toISOString();
        repositories.liveIncidents.markMatched(
          match.liveIncidentId,
          persistence.raceId,
          matchedAt,
          verdict
        );

        if (liveIncident && jsonIncident) {
          incidentsForReporting.push({
            liveIncident: {
              ...liveIncident,
              raceId: persistence.raceId,
              matched: true,
              matchedAt,
              verdictType: verdict?.type ?? null,
              verdictConfidence: verdict?.confidence ?? null,
              verdictBlamedCarId: verdict?.blamedCarId ?? null,
              verdictExplanation: verdict?.explanation ?? []
            },
            jsonIncident,
            match
          });
        }
      }

      log('info', 'processor', 'Matched persisted live incidents against race JSON', {
        fileName,
        raceId: persistence.raceId,
        matched: matchResult.matched.length,
        liveOnly: matchResult.liveOnly.length,
        jsonOnly: matchResult.jsonOnly.length,
        unmatched: matchResult.unmatched.length,
      });
    } catch (error) {
      log('warn', 'processor', 'Live incident matching skipped after race persistence error', {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const raceMessage = buildRaceMessage({
      fileName,
      race,
      stats: ratedDriverStats,
      groupedIncidents,
      minActiveDriversForSafetyGain: config.minActiveDriversForSafetyGain,
      nuclearMissileMinCarImpactKmh: config.nuclearMissileMinCarImpactKmh
    });
    await sendWebhook(config.discordWebhookUrl, raceMessage);
    await sendIncidentReports({
      enabled: config.incidentsWebhookEnabled,
      webhookUrl: config.incidentsDiscordWebhookUrl,
      fileName,
      race,
      incidents: incidentsForReporting
    });

    return 'processed';
  };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDatabase(config.databasePath);
  const repositories = createRepositories(database);
  const processRaceFile = createRaceProcessor(config, repositories);
  const liveUdpClient = config.liveUdpEnabled
    ? await startAcUdpClient(config, { logger: log, liveIncidentRepository: repositories.liveIncidents })
    : null;
  const watcher = await watchRaceResults({ config, repositories, processFile: processRaceFile });

  log('info', 'bootstrap', 'AC race monitor started', {
    resultsDir: config.resultsDir,
    watchGlob: config.watchGlob,
    processedFileStrategy: config.processedFileStrategy,
    liveUdpEnabled: config.liveUdpEnabled,
    liveUdpSmokeGateReady: liveUdpClient?.getStatus().smokeGate.ready ?? false
  });

  const shutdown = async (signal: string): Promise<void> => {
    log('info', 'bootstrap', 'Shutting down AC race monitor', { signal });
    await liveUdpClient?.close();
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
