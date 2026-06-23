import { z } from 'zod';

const envSchema = z.object({
  RESULTS_DIR: z.string().default('/app/results'),
  DATABASE_PATH: z.string().default('/app/data/ac-race-monitor.sqlite'),
  DISCORD_WEBHOOK_URL: z.string().default(''),
  LIVE_UDP_ENABLED: z.enum(['true', 'false']).default('false'),
  AC_UDP_SERVER_HOST: z.string().default('127.0.0.1'),
  AC_UDP_SERVER_PLUGIN_PORT: z.coerce.number().int().positive().default(11000),
  AC_UDP_PLUGIN_LISTEN_PORT: z.coerce.number().int().positive().default(12000),
  REALTIME_REPORT_INTERVAL_MS: z.coerce.number().int().positive().default(250),
  PROCESSED_FILE_STRATEGY: z.literal('sqlite').default('sqlite'),
  SCAN_ON_START: z.enum(['true', 'false']).default('true'),
  MIN_FILE_AGE_MS: z.coerce.number().int().nonnegative().default(3000),
  WATCH_GLOB: z.string().default('*RACE*.json'),
  DEFAULT_SAFETY_RATING: z.coerce.number().min(0).max(100).default(75),
  SAFETY_MEMORY_FACTOR: z.coerce.number().min(0).max(1).default(0.85),
  MIN_ACTIVE_DRIVERS_FOR_SAFETY_GAIN: z.coerce.number().int().positive().default(3),
  NUCLEAR_MISSILE_MIN_CAR_IMPACT_KMH: z.coerce.number().nonnegative().default(100),
  NODE_ENV: z.string().default('production')
});

export type AppConfig = {
  resultsDir: string;
  databasePath: string;
  discordWebhookUrl: string;
  liveUdpEnabled: boolean;
  acUdpServerHost: string;
  acUdpServerPluginPort: number;
  acUdpPluginListenPort: number;
  realtimeReportIntervalMs: number;
  processedFileStrategy: 'sqlite';
  scanOnStart: boolean;
  minFileAgeMs: number;
  watchGlob: string;
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
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL,
    liveUdpEnabled: parsed.LIVE_UDP_ENABLED === 'true',
    acUdpServerHost: parsed.AC_UDP_SERVER_HOST,
    acUdpServerPluginPort: parsed.AC_UDP_SERVER_PLUGIN_PORT,
    acUdpPluginListenPort: parsed.AC_UDP_PLUGIN_LISTEN_PORT,
    realtimeReportIntervalMs: parsed.REALTIME_REPORT_INTERVAL_MS,
    processedFileStrategy: parsed.PROCESSED_FILE_STRATEGY,
    scanOnStart: parsed.SCAN_ON_START === 'true',
    minFileAgeMs: parsed.MIN_FILE_AGE_MS,
    watchGlob: parsed.WATCH_GLOB,
    defaultSafetyRating: parsed.DEFAULT_SAFETY_RATING,
    safetyMemoryFactor: parsed.SAFETY_MEMORY_FACTOR,
    minActiveDriversForSafetyGain: parsed.MIN_ACTIVE_DRIVERS_FOR_SAFETY_GAIN,
    nuclearMissileMinCarImpactKmh: parsed.NUCLEAR_MISSILE_MIN_CAR_IMPACT_KMH,
    nodeEnv: parsed.NODE_ENV
  };
}
