import type { DiscordWebhookMessage } from './sendWebhook';

export type StandingsRow = Readonly<{
  driverName: string;
  position: number;
  points: number;
}>;

export type StandingsReport = Readonly<{
  reportId: string;
  raceId: string;
  runId: string;
  title: string;
  rows: readonly StandingsRow[];
  message: DiscordWebhookMessage;
}>;

export function buildStandingsMessage(input: {
  reportId: string;
  raceId: string;
  runId: string;
  rows: readonly StandingsRow[];
}): StandingsReport {
  const rows = input.rows.slice().sort((left, right) => left.position - right.position).slice(0, 10);
  const title = 'Copa NHRacing — resultados de hoy';
  const description = rows.length === 0
    ? 'Sin pilotos clasificados con puntos.'
    : rows.map((row) => `${row.position}. ${row.driverName} — ${row.points} pts`).join('\n');

  return {
    ...input,
    rows,
    title,
    message: {
      title,
      summaryText: `${title}\n${description}`,
      webhookBody: {
        content: title,
        embeds: [{
          title,
          description,
          color: 0x2f7df6,
          fields: [{ name: 'Top 10', value: description, inline: false }],
          footer: { text: `Race ${input.raceId} · Run ${input.runId}` }
        }]
      }
    }
  };
}
