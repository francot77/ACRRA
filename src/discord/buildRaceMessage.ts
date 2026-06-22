import { getSafetyCategory } from '../parser/calculateSafety';
import { formatTime } from '../parser/formatTime';
import { DriverRaceStats, GroupedIncident, ParsedRace } from '../types/assetto';

type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title: string;
  description: string;
  color: number;
  fields: DiscordEmbedField[];
  footer: { text: string };
};

export type RaceMessage = {
  title: string;
  summaryText: string;
  webhookBody: {
    content: string;
    embeds: [DiscordEmbed];
  };
};

export function buildRaceMessage(input: {
  fileName: string;
  race: ParsedRace;
  stats: DriverRaceStats[];
  groupedIncidents: GroupedIncident[];
}): RaceMessage {
  const title = `🏁 Race Report - ${input.race.trackName}`;
  const podium = input.stats
    .slice()
    .sort((left, right) => left.position - right.position)
    .slice(0, 3)
    .map((entry) => `P${entry.position} ${entry.name}`)
    .join('\n') || 'Sin clasificados';
  const fastestLap = pickOne(
    input.stats.filter((entry) => entry.bestLap != null),
    (left, right) => compareNumbers(left.bestLap, right.bestLap) || compareNumbers(left.position, right.position) || left.name.localeCompare(right.name)
  );
  const safetyTable = input.stats
    .slice()
    .sort((left, right) => left.position - right.position)
    .map(
      (entry) =>
        `P${entry.position} ${entry.name}: ${entry.oldSafetyRating.toFixed(2)} -> ${entry.newSafetyRating.toFixed(2)} ${getSafetyCategory(entry.newSafetyRating)}`
    )
    .join('\n');
  const incidentSummary = [
    `Contactos entre autos agrupados: ${input.groupedIncidents.length}`,
    `Eventos crudos entre autos: ${sum(input.groupedIncidents.map((entry) => entry.rawEventCount))}`,
    `Golpes con entorno: ${sum(input.stats.map((entry) => entry.envHits))}`,
    `Impacto máximo: ${Math.max(0, ...input.stats.map((entry) => entry.maxImpact)).toFixed(2)}`
  ].join('\n');
  const awards = buildAwards(input.stats, input.groupedIncidents);
  const awardText = awards.map((award) => `${award.label}: ${award.value}`).join('\n');
  const description = [
    `Auto principal: ${input.race.carModel ?? 'unknown'}`,
    `Vueltas pactadas: ${input.race.raceLaps}`,
    fastestLap ? `Vuelta más rápida: ${fastestLap.name} (${formatTime(fastestLap.bestLap)})` : 'Vuelta más rápida: Sin tiempo válido'
  ].join('\n');
  const footerText = `Archivo procesado: ${input.fileName}`;
  const embed: DiscordEmbed = {
    title,
    description,
    color: 0x2f7df6,
    fields: [
      { name: 'Podio', value: podium, inline: true },
      {
        name: '⚡ Vuelta rápida',
        value: fastestLap ? `${fastestLap.name} (${formatTime(fastestLap.bestLap)})` : 'Sin tiempo válido',
        inline: true
      },
      { name: 'Premios', value: awardText, inline: false },
      { name: 'Safety actualizada', value: safetyTable, inline: false },
      { name: 'Resumen de incidentes', value: incidentSummary, inline: false }
    ],
    footer: { text: footerText }
  };

  return {
    title,
    summaryText: [title, description, '', 'Podio', podium, '', 'Premios', awardText, '', 'Safety actualizada', safetyTable, '', 'Resumen de incidentes', incidentSummary, '', footerText].join('\n'),
    webhookBody: {
      content: title,
      embeds: [embed]
    }
  };
}

function buildAwards(stats: DriverRaceStats[], groupedIncidents: GroupedIncident[]): Array<{ label: string; value: string }> {
  const awards: Array<{ label: string; value: string }> = [];
  const activeDrivers = stats.filter((entry) => entry.completedLaps > 0 || entry.finished || entry.totalTime > 0);
  const fastestLap = pickOne(
    stats.filter((entry) => entry.bestLap != null),
    (left, right) => compareNumbers(left.bestLap, right.bestLap) || compareNumbers(left.position, right.position) || left.name.localeCompare(right.name)
  );
  const cleanest = pickOne(
    stats,
    (left, right) =>
      compareNumbers(right.raceScore, left.raceScore) ||
      compareNumbers(left.carIncidentsGrouped, right.carIncidentsGrouped) ||
      compareNumbers(left.envHits, right.envHits) ||
      compareNumbers(left.totalCuts, right.totalCuts) ||
      compareNumbers(left.maxImpact, right.maxImpact) ||
      compareNumbers(left.position, right.position) ||
      left.name.localeCompare(right.name)
  );
  const albaNil = pickOne(
    stats,
    (left, right) =>
      compareNumbers(right.envHits, left.envHits) ||
      compareNumbers(right.maxImpact, left.maxImpact) ||
      compareNumbers(right.rawCollisionEvents, left.rawCollisionEvents) ||
      left.name.localeCompare(right.name)
  );
  const missileIncident = pickOne(
    groupedIncidents.filter((entry) => entry.maxImpact > 120),
    (left, right) => compareNumbers(right.maxImpact, left.maxImpact) || compareNumbers(right.rawEventCount, left.rawEventCount) || left.pairKey.localeCompare(right.pairKey)
  );
  const missileDriver = pickOne(
    stats.filter((entry) => entry.maxImpact > 120),
    (left, right) => compareNumbers(right.maxImpact, left.maxImpact) || compareNumbers(right.rawCollisionEvents, left.rawCollisionEvents) || left.name.localeCompare(right.name)
  );
  const cone = pickOne(
    activeDrivers,
    (left, right) =>
      compareNumbers(left.raceScore, right.raceScore) ||
      compareNumbers(right.carIncidentsGrouped, left.carIncidentsGrouped) ||
      compareNumbers(right.totalCuts, left.totalCuts) ||
      compareNumbers(right.envHits, left.envHits) ||
      compareNumbers(right.maxImpact, left.maxImpact) ||
      left.name.localeCompare(right.name)
  );
  const destructiveDnf = pickOne(
    stats.filter((entry) => !entry.finished && entry.completedLaps === 0 && entry.carIncidentsGrouped + entry.envHits >= 3),
    (left, right) => compareNumbers(right.carIncidentsGrouped + right.envHits, left.carIncidentsGrouped + left.envHits) || compareNumbers(right.maxImpact, left.maxImpact) || left.name.localeCompare(right.name)
  );
  const consistent = pickOne(
    stats.filter((entry) => entry.consistency != null && entry.completedLaps >= 2),
    (left, right) => compareNumbers(left.consistency, right.consistency) || compareNumbers(left.position, right.position) || left.name.localeCompare(right.name)
  );
  const tortoise = pickOne(
    stats.filter((entry) => entry.finished && entry.avgLap != null),
    (left, right) => compareNumbers(right.avgLap, left.avgLap) || compareNumbers(right.completedLaps, left.completedLaps) || left.name.localeCompare(right.name)
  );

  awards.push({ label: '⚡ Vuelta rápida', value: fastestLap ? `${fastestLap.name} (${formatTime(fastestLap.bestLap)})` : 'Sin tiempo válido' });
  awards.push({ label: '🧼 Más limpio', value: cleanest ? formatDriver(cleanest) : 'Sin datos' });
  awards.push({ label: '🧱 Albañil del día', value: albaNil ? `${albaNil.name} (${albaNil.envHits} golpes al entorno)` : 'Sin datos' });
  awards.push({ label: '💥 Misil nuclear', value: formatMissileAward(missileIncident, missileDriver) });
  awards.push({ label: '🚜 Cono del día', value: cone ? `${cone.name} (${cone.raceScore.toFixed(2)} puntos)` : 'Sin datos' });
  awards.push({ label: '🪦 DNF destructivo', value: destructiveDnf ? `${destructiveDnf.name} (${destructiveDnf.carIncidentsGrouped + destructiveDnf.envHits} incidentes antes de terminar)` : 'No aplica' });
  awards.push({ label: '📈 Más consistente', value: consistent ? `${consistent.name} (desvío ${consistent.consistency?.toFixed(2)} ms)` : 'Sin datos' });
  if (tortoise) {
    awards.push({ label: '🐢 Tortuga digna', value: `${tortoise.name} (${formatAverageLap(tortoise.avgLap)})` });
  }

  return awards;
}

function formatDriver(entry: DriverRaceStats): string {
  return `${entry.name} (${entry.raceScore.toFixed(2)} puntos)`;
}

function formatMissileAward(incident: GroupedIncident | null, driver: DriverRaceStats | null): string {
  if (incident) {
    const names = incident.driversInvolved.map((entry) => entry.name).filter(Boolean);
    const pairLabel = names.length >= 2 ? `${names[0]} y ${names[1]}` : names[0] ?? `Autos ${incident.carIdsInvolved[0]} y ${incident.carIdsInvolved[1]}`;
    return `${pairLabel} (${incident.maxImpact.toFixed(2)} km/h de impacto)`;
  }

  if (driver) {
    return `${driver.name} (${driver.maxImpact.toFixed(2)} km/h de impacto)`;
  }

  return 'No aplica';
}

function formatAverageLap(value: number | null): string {
  return value == null ? 'Sin tiempo válido' : formatTime(Math.round(value));
}

function pickOne<T>(values: T[], compare: (left: T, right: T) => number): T | null {
  return values.slice().sort(compare)[0] ?? null;
}

function compareNumbers(left: number | null | undefined, right: number | null | undefined): number {
  return (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
