import { z } from 'zod';

const envSchema = z.object({
  RESULTS_DIR: z.string().default('/app/results'),
  DATABASE_PATH: z.string().default('/app/data/ac-race-monitor.sqlite'),
  DISCORD_WEBHOOK_URL: z.string().default(''),
  PROCESSED_FILE_STRATEGY: z.literal('sqlite').default('sqlite'),
  SCAN_ON_START: z.enum(['true', 'false']).default('true'),
  MIN_FILE_AGE_MS: z.coerce.number().int().nonnegative().default(3000),
  WATCH_GLOB: z.string().default('*RACE*.json'),
  DEFAULT_SAFETY_RATING: z.coerce.number().min(0).max(100).default(75),
  SAFETY_MEMORY_FACTOR: z.coerce.number().min(0).max(1).default(0.85),
  NODE_ENV: z.string().default('production')
});

export type AppConfig = {
  resultsDir: string;
  databasePath: string;
  discordWebhookUrl: string;
  processedFileStrategy: 'sqlite';
  scanOnStart: boolean;
  minFileAgeMs: number;
  watchGlob: string;
  defaultSafetyRating: number;
  safetyMemoryFactor: number;
  nodeEnv: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    resultsDir: parsed.RESULTS_DIR,
    databasePath: parsed.DATABASE_PATH,
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL,
    processedFileStrategy: parsed.PROCESSED_FILE_STRATEGY,
    scanOnStart: parsed.SCAN_ON_START === 'true',
    minFileAgeMs: parsed.MIN_FILE_AGE_MS,
    watchGlob: parsed.WATCH_GLOB,
    defaultSafetyRating: parsed.DEFAULT_SAFETY_RATING,
    safetyMemoryFactor: parsed.SAFETY_MEMORY_FACTOR,
    nodeEnv: parsed.NODE_ENV
  };
}
