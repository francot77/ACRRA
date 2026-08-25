import { postDiscordWebhook } from './sendWebhook';
import type { StandingsReport } from './buildStandingsMessage';

export async function sendStandingsWebhook(webhookUrl: string, report: StandingsReport): Promise<'sent' | 'logged' | 'failed'> {
  return postDiscordWebhook(webhookUrl, report.message, {
    disabledLogMessage: 'Dedicated scoring results webhook disabled',
    successLogMessage: 'Sent dedicated scoring results'
  });
}
