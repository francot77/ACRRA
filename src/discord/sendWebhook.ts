import { RaceMessage } from './buildRaceMessage';

export async function sendWebhook(webhookUrl: string, message: RaceMessage): Promise<'sent' | 'logged' | 'failed'> {
  return postDiscordWebhook(webhookUrl, message, {
    disabledLogMessage: 'Discord webhook disabled, logging race summary instead',
    successLogMessage: 'Sent Discord race summary'
  });
}

export type DiscordWebhookAttachment = Readonly<{
  filename: string;
  contentType: string;
  bytes: Buffer;
}>;

export type DiscordWebhookMessage = {
  title: string;
  summaryText: string;
  webhookBody: {
    content: string;
    embeds: Array<{
      title: string;
      description: string;
      color: number;
      fields: Array<{
        name: string;
        value: string;
        inline?: boolean;
      }>;
      footer: { text: string };
    }>;
  };
  attachments?: readonly DiscordWebhookAttachment[];
};

export async function postDiscordWebhook(
  webhookUrl: string,
  message: DiscordWebhookMessage,
  options: {
    disabledLogMessage: string;
    successLogMessage: string;
  }
): Promise<'sent' | 'logged' | 'failed'> {
  if (!webhookUrl.trim()) {
    log('info', 'discord', options.disabledLogMessage, { summary: message.summaryText });
    return 'logged';
  }

  try {
    const hasAttachments = (message.attachments?.length ?? 0) > 0;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: hasAttachments
        ? undefined
        : {
            'content-type': 'application/json'
          },
      body: hasAttachments ? buildMultipartWebhookBody(message) : JSON.stringify(message.webhookBody)
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

    log('info', 'discord', options.successLogMessage, { title: message.title });
    return 'sent';
  } catch (error) {
    log('error', 'discord', 'Discord webhook request failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return 'failed';
  }
}

function buildMultipartWebhookBody(message: DiscordWebhookMessage): FormData {
  const form = new FormData();
  form.set('payload_json', JSON.stringify(message.webhookBody));

  for (const [index, attachment] of (message.attachments ?? []).entries()) {
    form.set(
      `files[${index}]`,
      new File([Uint8Array.from(attachment.bytes)], attachment.filename, { type: attachment.contentType })
    );
  }

  return form;
}

function log(level: 'info' | 'error', component: string, message: string, fields: Record<string, unknown>): void {
  const payload = JSON.stringify({ level, component, message, ...fields });
  if (level === 'error') {
    console.error(payload);
    return;
  }

  console.info(payload);
}
