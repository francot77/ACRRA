import { RaceMessage } from './buildRaceMessage';

export async function sendWebhook(webhookUrl: string, message: RaceMessage): Promise<'sent' | 'logged' | 'failed'> {
  if (!webhookUrl.trim()) {
    log('info', 'discord', 'Discord webhook disabled, logging race summary instead', { summary: message.summaryText });
    return 'logged';
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(message.webhookBody)
    });

    if (!response.ok) {
      const body = await response.text();
      log('error', 'discord', 'Discord webhook request failed', {
        status: response.status,
        statusText: response.statusText,
        body
      });
      return 'failed';
    }

    log('info', 'discord', 'Sent Discord race summary', { title: message.title });
    return 'sent';
  } catch (error) {
    log('error', 'discord', 'Discord webhook request failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return 'failed';
  }
}

function log(level: 'info' | 'error', component: string, message: string, fields: Record<string, unknown>): void {
  const payload = JSON.stringify({ level, component, message, ...fields });
  if (level === 'error') {
    console.error(payload);
    return;
  }

  console.info(payload);
}
