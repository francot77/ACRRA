import { loadConfig } from './config';
import { openDatabase } from './db/db';
import { ScoringRunService } from './scoring/service';
import { ScoringStore } from './scoring/store';

export async function resendLastStandings(): Promise<void> {
  const config = loadConfig();
  const webhookUrl = config.scoringResultsWebhookUrl?.trim() ?? '';
  if (!webhookUrl) throw new Error('Scoring results webhook is disabled: set SCORING_RESULTS_WEBHOOK_URL');

  const database = openDatabase(config.databasePath, { archiveDirectory: config.databaseArchiveDirectory ?? undefined });
  try {
    const service = new ScoringRunService(new ScoringStore(database), webhookUrl);
    const delivery = await service.resendLatest();
    if (delivery !== 'sent') throw new Error('Discord delivery failed; the report remains retryable');
    console.info('Resent the latest persisted standings report');
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'resend-last-standings') {
    throw new Error('Usage: node dist/cli.js resend-last-standings');
  }
  await resendLastStandings();
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
