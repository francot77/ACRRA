import { z } from 'zod';

const envSchema = z.object({
  RESULTS_DIR: z.string().default('/app/results'),
  DATABASE_PATH: z.string().default('/app/data/ac-race-monitor.sqlite'),
  DATABASE_ARCHIVE_DIR: z.string().default(''),
  TRACK_MODEL_PATH: z.string().default('track-models/monza/track-model.json'),
  TRACK_MODEL_TRACK: z.string().default('monza'),
  TRACK_MODEL_LAYOUT: z.string().default(''),
  DISCORD_WEBHOOK_URL: z.string().default(''),
  INCIDENTS_DISCORD_WEBHOOK_URL: z.string().default(''),
  INCIDENTS_WEBHOOK_ENABLED: z.enum(['true', 'false']).default('false'),
  LIVE_UDP_ENABLED: z.enum(['true', 'false']).default('false'),
  LIVE_UDP_DEBUG: z.enum(['true', 'false']).default('false'),
  AC_UDP_SERVER_HOST: z.string().default('127.0.0.1'),
  AC_UDP_SERVER_PLUGIN_PORT: z.coerce.number().int().positive().default(11000),
  AC_UDP_PLUGIN_LISTEN_PORT: z.coerce.number().int().positive().default(12000),
  REALTIME_REPORT_INTERVAL_MS: z.coerce.number().int().positive().default(250),
  SNAPSHOT_RING_BUFFER_MS: z.coerce.number().int().positive().default(10000),
  INCIDENT_PRE_MS: z.coerce.number().int().nonnegative().default(3000),
  INCIDENT_POST_MS: z.coerce.number().int().nonnegative().default(1500),
  INCIDENT_DEBUG: z.enum(['true', 'false']).default('false'),
  INCIDENT_MATCH_MAX_DISTANCE_M: z.coerce.number().positive().default(30),
  INCIDENT_MATCH_MAX_IMPACT_DIFF_KMH: z.coerce.number().nonnegative().default(35),
  PROCESSED_FILE_STRATEGY: z.literal('sqlite').default('sqlite'),
  SCAN_ON_START: z.enum(['true', 'false']).default('true'),
  MIN_FILE_AGE_MS: z.coerce.number().int().nonnegative().default(3000),
  WATCH_GLOB: z.string().default('*RACE*.json'),
  SCORING_ENABLED: z.enum(['true', 'false']).default('false'),
  SCORING_SOURCE_GLOB: z.string().min(1).default('*_RACE.json'),
  SCORING_SCHEDULE: z.string().refine((value) => value === '0 21 * * *', 'SCORING_SCHEDULE must be 0 21 * * *').default('0 21 * * *'),
  SCORING_TIMEZONE: z.string().refine((value) => value === 'America/Argentina/Buenos_Aires', 'SCORING_TIMEZONE must be America/Argentina/Buenos_Aires').default('America/Argentina/Buenos_Aires'),
  SCORING_RACE_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
  SCORING_DST_POLICY: z.enum(['reject-ambiguous']).default('reject-ambiguous'),
  SCORING_RESULTS_WEBHOOK_URL: z.string().default(''),
  DEFAULT_SAFETY_RATING: z.coerce.number().min(0).max(100).default(75),
  SAFETY_MEMORY_FACTOR: z.coerce.number().min(0).max(1).default(0.85),
  MIN_ACTIVE_DRIVERS_FOR_SAFETY_GAIN: z.coerce.number().int().positive().default(3),
  NUCLEAR_MISSILE_MIN_CAR_IMPACT_KMH: z.coerce.number().nonnegative().default(100),
  NODE_ENV: z.string().default('production')
});

export const DEPRECATED_LEGACY_SETTINGS = [
  'LIVE_UDP_ENABLED',
  'LIVE_UDP_DEBUG',
  'INCIDENTS_WEBHOOK_ENABLED',
  'INCIDENTS_DISCORD_WEBHOOK_URL',
  'AC_UDP_SERVER_HOST',
  'AC_UDP_SERVER_PLUGIN_PORT',
  'AC_UDP_PLUGIN_LISTEN_PORT',
  'REALTIME_REPORT_INTERVAL_MS',
  'SNAPSHOT_RING_BUFFER_MS',
  'INCIDENT_PRE_MS',
  'INCIDENT_POST_MS',
  'INCIDENT_DEBUG',
  'INCIDENT_MATCH_MAX_DISTANCE_M',
  'INCIDENT_MATCH_MAX_IMPACT_DIFF_KMH'
] as const;

export function getConfiguredDeprecatedLegacySettings(env: NodeJS.ProcessEnv = process.env): string[] {
  return DEPRECATED_LEGACY_SETTINGS.filter((key) => env[key] !== undefined);
}

export type AppConfig = {
  resultsDir: string;
  databasePath: string;
  databaseArchiveDirectory: string | null;
  trackModelPath: string;
  trackModelTrack: string;
  trackModelLayout: string | null;
  discordWebhookUrl: string;
  incidentsDiscordWebhookUrl: string;
  incidentsWebhookEnabled: boolean;
  liveUdpEnabled: boolean;
  liveUdpDebug: boolean;
  acUdpServerHost: string;
  acUdpServerPluginPort: number;
  acUdpPluginListenPort: number;
  realtimeReportIntervalMs: number;
  snapshotRingBufferMs: number;
  incidentPreMs: number;
  incidentPostMs: number;
  incidentDebug: boolean;
  incidentMatchMaxDistanceM: number;
  incidentMatchMaxImpactDiffKmh: number;
  processedFileStrategy: 'sqlite';
  scanOnStart: boolean;
  minFileAgeMs: number;
  watchGlob: string;
  scoringEnabled: boolean;
  scoringSourceGlob: string;
  scoringSchedule: '0 21 * * *';
  scoringTimezone: 'America/Argentina/Buenos_Aires';
  scoringRaceWindowMinutes: number;
  scoringDstPolicy: 'reject-ambiguous';
  scoringResultsWebhookUrl?: string;
  defaultSafetyRating: number;
  safetyMemoryFactor: number;
  minActiveDriversForSafetyGain: number;
  nuclearMissileMinCarImpactKmh: number;
  nodeEnv: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    resultsDir: parsed.RESULTS_DIR,
    databasePath: parsed.DATABASE_PATH,
    databaseArchiveDirectory: parsed.DATABASE_ARCHIVE_DIR.trim() || null,
    trackModelPath: parsed.TRACK_MODEL_PATH,
    trackModelTrack: parsed.TRACK_MODEL_TRACK,
    trackModelLayout: normalizeTrackModelLayout(parsed.TRACK_MODEL_LAYOUT),
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL,
    incidentsDiscordWebhookUrl: parsed.INCIDENTS_DISCORD_WEBHOOK_URL,
    incidentsWebhookEnabled: parsed.INCIDENTS_WEBHOOK_ENABLED === 'true',
    liveUdpEnabled: parsed.LIVE_UDP_ENABLED === 'true',
    liveUdpDebug: parsed.LIVE_UDP_DEBUG === 'true',
    acUdpServerHost: parsed.AC_UDP_SERVER_HOST,
    acUdpServerPluginPort: parsed.AC_UDP_SERVER_PLUGIN_PORT,
    acUdpPluginListenPort: parsed.AC_UDP_PLUGIN_LISTEN_PORT,
    realtimeReportIntervalMs: parsed.REALTIME_REPORT_INTERVAL_MS,
    snapshotRingBufferMs: parsed.SNAPSHOT_RING_BUFFER_MS,
    incidentPreMs: parsed.INCIDENT_PRE_MS,
    incidentPostMs: parsed.INCIDENT_POST_MS,
    incidentDebug: parsed.INCIDENT_DEBUG === 'true',
    incidentMatchMaxDistanceM: parsed.INCIDENT_MATCH_MAX_DISTANCE_M,
    incidentMatchMaxImpactDiffKmh: parsed.INCIDENT_MATCH_MAX_IMPACT_DIFF_KMH,
    processedFileStrategy: parsed.PROCESSED_FILE_STRATEGY,
    scanOnStart: parsed.SCAN_ON_START === 'true',
    minFileAgeMs: parsed.MIN_FILE_AGE_MS,
    watchGlob: parsed.WATCH_GLOB,
    scoringEnabled: parsed.SCORING_ENABLED === 'true',
    scoringSourceGlob: parsed.SCORING_SOURCE_GLOB,
    scoringSchedule: parsed.SCORING_SCHEDULE,
    scoringTimezone: parsed.SCORING_TIMEZONE,
    scoringRaceWindowMinutes: parsed.SCORING_RACE_WINDOW_MINUTES,
    scoringDstPolicy: parsed.SCORING_DST_POLICY,
    scoringResultsWebhookUrl: parsed.SCORING_RESULTS_WEBHOOK_URL,
    defaultSafetyRating: parsed.DEFAULT_SAFETY_RATING,
    safetyMemoryFactor: parsed.SAFETY_MEMORY_FACTOR,
    minActiveDriversForSafetyGain: parsed.MIN_ACTIVE_DRIVERS_FOR_SAFETY_GAIN,
    nuclearMissileMinCarImpactKmh: parsed.NUCLEAR_MISSILE_MIN_CAR_IMPACT_KMH,
    nodeEnv: parsed.NODE_ENV
  };
}

function normalizeTrackModelLayout(layout: string): string | null {
  const normalized = layout.trim();
  return normalized === '' ? null : normalized;
}
