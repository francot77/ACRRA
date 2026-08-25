import { z } from 'zod';

const envSchema = z.object({
  RESULTS_DIR: z.string().default('/app/results'),
  DATABASE_PATH: z.string().default('/app/data/ac-race-monitor.sqlite'),
  DATABASE_ARCHIVE_DIR: z.string().default(''),
  DISCORD_WEBHOOK_URL: z.string().default(''),
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

export type AppConfig = {
  resultsDir: string;
  databasePath: string;
  databaseArchiveDirectory: string | null;
  discordWebhookUrl: string;
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
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL,
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
