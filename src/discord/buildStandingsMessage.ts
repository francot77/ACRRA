import type { DiscordWebhookMessage } from './sendWebhook';

export type StandingsRow = Readonly<{
  driverName: string;
  position: number;
  points: number;
  races: number;
  wins: number;
  podiums: number;
}>;

export type CurrentRaceResult = Readonly<{
  driverName: string;
  position: number;
  points: number;
  status: 'finished' | 'dnf' | 'dns';
  bestLap?: number | null;
}>;

export type CurrentRacePresentation = Readonly<{
  trackName: string;
  trackConfig?: string | null;
  driverCount: number;
  results: readonly CurrentRaceResult[];
}>;

type StandingsInputRow = Omit<StandingsRow, 'races' | 'wins' | 'podiums'> & Partial<Pick<StandingsRow, 'races' | 'wins' | 'podiums'>>;

export type StandingsReport = Readonly<{
  reportId: string;
  raceId: string;
  runId: string;
  title: string;
  rows: readonly StandingsRow[];
  currentRace?: CurrentRacePresentation;
  message: DiscordWebhookMessage;
}>;

export function buildStandingsMessage(input: {
  reportId: string;
  raceId: string;
  runId: string;
  rows: readonly StandingsInputRow[];
  currentRace?: CurrentRacePresentation;
}): StandingsReport {
  const rows: StandingsRow[] = input.rows
    .map((row) => ({ ...row, races: row.races ?? 0, wins: row.wins ?? 0, podiums: row.podiums ?? 0 }))
    .sort((left, right) => left.position - right.position)
    .slice(0, 20);
  const title = 'Copa NHRacing — resultados de hoy';
  const race = input.currentRace ? normalizeRace(input.currentRace) : undefined;
  const classification = rows.length === 0 ? 'Sin pilotos registrados.' : formatClassification(rows);
  const description = race
    ? formatFullDescription(race, classification)
    : `Clasificación general\n\n\`\`\`\n${classification}\n\`\`\``;

  return {
    ...input,
    rows,
    currentRace: race,
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
          fields: [],
          footer: { text: 'Clasificación del campeonato' }
        }]
      }
    }
  };
}

function formatFullDescription(race: CurrentRacePresentation, classification: string): string {
  const winner = race.results.find((result) => result.status === 'finished' && result.position === 1);
  const fastestLap = race.results
    .filter((result) => result.bestLap != null && result.bestLap > 0)
    .sort((left, right) => left.bestLap! - right.bestLap!)[0];
  const metadata = [
    `📍 ${truncate(race.trackName, 50)} · ${truncate(race.trackConfig || 'Layout standard', 40)}`,
    `🚗 ${race.driverCount} ${race.driverCount === 1 ? 'piloto' : 'pilotos'}`,
    winner ? `🏆 Ganador: ${truncate(winner.driverName, 50)}` : null,
    fastestLap ? `⚡ Vuelta rápida: ${truncate(fastestLap.driverName, 35)} · ${formatLapTime(fastestLap.bestLap!)}` : null
  ].filter((line): line is string => line !== null).join('\n');

  return [
    metadata,
    'Resultado de la carrera',
    formatCurrentResult(race.results),
    'Clasificación general',
    `\`\`\n${classification}\n\`\``
  ].join('\n\n');
}

function normalizeRace(race: CurrentRacePresentation): CurrentRacePresentation {
  return {
    ...race,
    results: race.results.slice().sort((left, right) => left.position - right.position)
  };
}

function formatCurrentResult(results: readonly CurrentRaceResult[]): string {
  if (results.length === 0) return 'Sin resultados registrados.';
  return results.map((result) => {
    const medal = result.status === 'finished' && result.position <= 3 ? ['🥇', '🥈', '🥉'][result.position - 1] : `${result.position}.`;
    const status = result.status === 'dnf' ? ' — DNF' : result.status === 'dns' ? ' — DNS' : '';
    return `${medal} ${truncate(result.driverName, 48)} — ${result.points} pts${status}`;
  }).join('\n');
}

function formatClassification(rows: readonly StandingsRow[]): string {
  const header = '#  Piloto'.padEnd(24) + 'Pts  V  Pod';
  return [header, ...rows.map((row) => `${String(row.position).padStart(2)} ${truncate(row.driverName, 20).padEnd(20)} ${String(row.points).padStart(3)} ${String(row.wins).padStart(2)} ${String(row.podiums).padStart(4)}`)].join('\n');
}

function formatLapTime(seconds: number): string {
  return `${seconds.toFixed(3)} s`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
