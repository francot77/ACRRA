import type { DiscordWebhookMessage } from './sendWebhook';

export type StandingsRow = Readonly<{
  driverName: string;
  position: number;
  points: number;
  races: number;
  wins: number;
  podiums: number;
}>;

type StandingsInputRow = Omit<StandingsRow, 'races' | 'wins' | 'podiums'> & Partial<Pick<StandingsRow, 'races' | 'wins' | 'podiums'>>;

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
  rows: readonly StandingsInputRow[];
}): StandingsReport {
  const rows: StandingsRow[] = input.rows
    .map((row) => ({ ...row, races: row.races ?? 0, wins: row.wins ?? 0, podiums: row.podiums ?? 0 }))
    .sort((left, right) => left.position - right.position)
    .slice(0, 20);
  const title = 'Copa NHRacing — resultados de hoy';
  const description = rows.length === 0
    ? 'Sin pilotos registrados.'
    : rows.map((row) => `${row.position}. ${row.driverName} — ${row.points} pts · ${row.races} carreras · ${row.wins} victorias · ${row.podiums} podios`).join('\n');

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
          fields: [{ name: 'Clasificación', value: description, inline: false }],
          footer: { text: `Race ${input.raceId} · Run ${input.runId}` }
        }]
      }
    }
  };
}
