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
  eventDate?: string;
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
    .slice(0, 10);
  const race = input.currentRace ? normalizeRace(input.currentRace) : undefined;
  const title = formatTitle(race?.eventDate);
  const classification = rows.length === 0 ? 'Sin pilotos registrados.' : formatClassification(rows);
  const description = race ? formatRaceMetadata(race) : undefined;
  const fields = [
    ...(race ? formatFields('Resultado de la carrera', formatCurrentResult(race.results)) : []),
    ...formatFields('🏆 Campeonato', classification)
  ];
  const summaryText = [title, description, ...fields.map((field) => `${field.name}\n${field.value}`)].filter(Boolean).join('\n\n');

  return {
    ...input,
    rows,
    currentRace: race,
    title,
    message: {
      title,
      summaryText,
      webhookBody: {
        content: title,
        embeds: [{
          title,
          description: description ?? '',
          color: 0x2f7df6,
          fields,
          footer: { text: 'ACRRA · Top 10 del campeonato' }
        }]
      }
    }
  };
}

function formatTitle(eventDate?: string): string {
  const formattedDate = formatEventDate(eventDate);
  return formattedDate ? `🏆 Copa NHRacing\nResultados del ${formattedDate}` : '🏆 Copa NHRacing';
}

function formatEventDate(eventDate?: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : undefined;
}

function formatRaceMetadata(race: CurrentRacePresentation): string {
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
  ].join('\n');
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
    const medal = result.position <= 3 ? ['🥇', '🥈', '🥉'][result.position - 1] : `${result.position}.`;
    const status = result.status === 'dnf' ? ' — DNF' : result.status === 'dns' ? ' — DNS' : '';
    const driverName = result.position <= 3 ? `**${truncate(result.driverName, 48)}**` : truncate(result.driverName, 48);
    return `${medal} ${driverName} — ${result.points} pts${status}`;
  }).join('\n');
}

function formatClassification(rows: readonly StandingsRow[]): string {
  return rows.map((row) => {
    const stats = [
      row.wins > 0 ? `${row.wins} ${row.wins === 1 ? 'victoria' : 'victorias'}` : null,
      row.podiums > 0 ? `${row.podiums} ${row.podiums === 1 ? 'podio' : 'podios'}` : null
    ].filter((stat): stat is string => stat !== null);
    const medal = row.position <= 3 ? ['🥇', '🥈', '🥉'][row.position - 1] : `${row.position}.`;
    return `${medal} ${row.position <= 3 ? `**${truncate(row.driverName, 40)}**` : truncate(row.driverName, 40)} · ${row.points} pts${stats.length > 0 ? ` · ${stats.join(' · ')}` : ''}`;
  }).join('\n');
}

function formatFields(name: string, value: string): Array<{ name: string; value: string; inline: false }> {
  const lines = value.split('\n');
  const fields: Array<{ name: string; value: string; inline: false }> = [];
  let chunk = '';
  for (const line of lines) {
    const candidate = chunk ? `${chunk}\n${line}` : line;
    if (candidate.length > 1024 && chunk) {
      fields.push({ name: fields.length === 0 ? name : '\u200b', value: chunk, inline: false });
      chunk = line;
    } else {
      chunk = candidate;
    }
  }
  fields.push({ name: fields.length === 0 ? name : '\u200b', value: chunk || 'Sin datos.', inline: false });
  return fields;
}

function formatLapTime(seconds: number): string {
  return `${seconds.toFixed(3)} s`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
