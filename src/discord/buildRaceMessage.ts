import { getSafetyCategory } from '../parser/calculateSafety';
import { formatConsistency, formatGap, formatLapTime } from '../parser/formatTime';
import { DriverRaceStats, GroupedIncident, ParsedRace } from '../types/assetto';

/**
 * General race reports use only normalized ParsedRace.events and their
 * derived grouped incidents/statistics. Live or heuristic incident records
 * are not part of this report basis.
 */
export const DISCORD_EVENT_BASIS_VERSION = 'normalized-json-events-v1' as const;

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
  minActiveDriversForSafetyGain: number;
  nuclearMissileMinCarImpactKmh: number;
}): RaceMessage {
  const title = `🏁 Race Report - ${input.race.trackName}`;
  const activeDrivers = input.stats.filter((entry) => entry.active).length;
  const safetyEligible = activeDrivers >= input.minActiveDriversForSafetyGain;
  const officialActiveResults = input.stats
    .slice()
    .sort((left, right) => left.position - right.position)
    .filter((entry) => entry.active);
  const leader = officialActiveResults[0] ?? null;
  const podium = officialActiveResults
    .slice()
    .slice(0, 3)
    .map((entry) => formatPodiumEntry(entry, leader))
    .join('\n') || 'Sin clasificados';
  const fastestLap = pickOne(
    getAwardEligibleDrivers(input.stats).filter((entry) => entry.bestLap != null),
    (left, right) => compareNumbers(left.bestLap, right.bestLap) || compareNumbers(left.position, right.position) || left.name.localeCompare(right.name)
  );
  const safetyUpdated = input.stats
    .slice()
    .sort((left, right) => left.position - right.position)
    .filter((entry) => entry.active && entry.safetyChangeReason === 'updated')
    .map(
      (entry) =>
        `P${entry.position} ${entry.name}${formatStatusSuffix(entry)}: ${entry.oldSafetyRating.toFixed(2)} -> ${entry.newSafetyRating.toFixed(2)} ${getSafetyCategory(entry.newSafetyRating)}`
    )
    .join('\n');
  const safetySummary = safetyEligible
    ? safetyUpdated || 'Sin cambios'
    : `No puntuable: ${activeDrivers} pilotos activos. Mínimo requerido: ${input.minActiveDriversForSafetyGain}.`;
  const awards = buildAwards(input.stats, input.groupedIncidents, input.nuclearMissileMinCarImpactKmh);
  const awardText = awards.map((award) => `${award.label}: ${award.value}`).join('\n');
  const finishedDrivers = input.stats.filter((entry) => entry.active && entry.finished).length;
  const dnfDrivers = input.stats.filter((entry) => entry.active && !entry.finished).length;
  const dnsDrivers = input.stats.filter((entry) => entry.inactive).length;
  const description = [
    `Track: ${input.race.trackName}`,
    ...(input.race.trackConfig?.trim() ? [`Layout: ${input.race.trackConfig}`] : []),
    `Race laps: ${input.race.raceLaps}`,
    `Car model: ${input.race.carModel ?? 'unknown'}`,
    `Drivers: ${activeDrivers} active · ${finishedDrivers} finished · ${dnfDrivers} DNF · ${dnsDrivers} DNS`
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
        value: fastestLap ? `${fastestLap.name} (${formatLapTime(fastestLap.bestLap)})` : 'Sin tiempo válido',
        inline: true
      },
      { name: 'Premios', value: awardText, inline: false },
      { name: 'Safety', value: safetySummary, inline: false }
    ],
    footer: { text: footerText }
  };

  return {
    title,
    summaryText: [
      title,
      description,
      '',
      'Podio',
      podium,
      '',
      'Premios',
      awardText,
      '',
      'Safety',
      safetySummary,
      '',
      footerText
    ].join('\n'),
    webhookBody: {
      content: title,
      embeds: [embed]
    }
  };
}

function buildAwards(
  stats: DriverRaceStats[],
  groupedIncidents: GroupedIncident[],
  nuclearMissileMinCarImpactKmh: number
): Array<{ label: string; value: string }> {
  const awards: Array<{ label: string; value: string }> = [];
  const eligibleDrivers = getAwardEligibleDrivers(stats);
  const finishedDrivers = eligibleDrivers.filter((entry) => entry.finished);
  const fastestLap = pickOne(
    eligibleDrivers.filter((entry) => entry.bestLap != null),
    (left, right) => compareNumbers(left.bestLap, right.bestLap) || compareNumbers(left.position, right.position) || left.name.localeCompare(right.name)
  );
  const cleanestCandidates = finishedDrivers;
  const cleanest =
    cleanestCandidates.length >= 2
      ? pickOne(
          cleanestCandidates,
          (left, right) =>
            compareNumbers(right.raceScore, left.raceScore) ||
            compareNumbers(left.carIncidentsGrouped, right.carIncidentsGrouped) ||
            compareNumbers(left.envHits, right.envHits) ||
            compareNumbers(left.totalCuts, right.totalCuts) ||
            compareNumbers(left.maxImpact, right.maxImpact) ||
            compareNumbers(left.position, right.position) ||
            left.name.localeCompare(right.name)
        )
      : null;
  const albaNil = pickOne(
    eligibleDrivers.filter((entry) => entry.envHits > 0),
    (left, right) =>
      compareNumbers(right.envHits, left.envHits) ||
      compareNumbers(right.maxEnvImpact, left.maxEnvImpact) ||
      compareNumbers(right.rawCollisionEvents, left.rawCollisionEvents) ||
      left.name.localeCompare(right.name)
  );
  const missileIncident = pickOne(
    groupedIncidents.filter((entry) => entry.maxImpact >= nuclearMissileMinCarImpactKmh),
    (left, right) => compareNumbers(right.maxImpact, left.maxImpact) || compareNumbers(right.rawEventCount, left.rawEventCount) || left.pairKey.localeCompare(right.pairKey)
  );
  const cone = pickOne(
    eligibleDrivers,
    (left, right) =>
      compareNumbers(left.raceScore, right.raceScore) ||
      compareNumbers(right.carIncidentsGrouped, left.carIncidentsGrouped) ||
      compareNumbers(right.totalCuts, left.totalCuts) ||
      compareNumbers(right.envHits, left.envHits) ||
      compareNumbers(right.maxImpact, left.maxImpact) ||
      left.name.localeCompare(right.name)
  );
  const destructiveDnf = pickOne(
    eligibleDrivers.filter((entry) => entry.destructiveDnf),
    (left, right) => compareNumbers(right.rawCollisionEvents, left.rawCollisionEvents) || compareNumbers(right.maxImpact, left.maxImpact) || left.name.localeCompare(right.name)
  );
  const consistentCandidates = finishedDrivers.filter((entry) => entry.consistency != null && entry.completedLaps >= 2);
  const consistent =
    consistentCandidates.length >= 2
      ? pickOne(
          consistentCandidates,
          (left, right) => compareNumbers(left.consistency, right.consistency) || compareNumbers(left.position, right.position) || left.name.localeCompare(right.name)
        )
      : null;
  const tortoiseCandidates = finishedDrivers.filter((entry) => entry.raceScore >= 60 && entry.avgLap != null);
  const tortoise =
    finishedDrivers.length >= 2 && tortoiseCandidates.length >= 2
      ? pickOne(
          tortoiseCandidates,
          (left, right) => compareNumbers(right.avgLap, left.avgLap) || compareNumbers(right.completedLaps, left.completedLaps) || left.name.localeCompare(right.name)
        )
      : null;
  const hideTortoise = tortoise != null && fastestLap != null && tortoise.carId === fastestLap.carId && finishedDrivers.length < 3;
  const shouldRenderCone =
    cone != null &&
    (cone.raceScore < 80 || cone.carIncidentsGrouped > 0 || cone.envHits > 0 || cone.totalCuts > 0 || !cone.finished);

  if (cleanest) {
    awards.push({ label: '🧼 Más limpio', value: formatDriver(cleanest) });
  }
  if (albaNil) {
    awards.push({ label: '🧱 Albañil del día', value: `${albaNil.name} (${albaNil.envHits} golpes al entorno)` });
  }
  const missileAward = formatMissileAward(missileIncident);
  if (missileAward) {
    awards.push({ label: '💥 Misil nuclear', value: missileAward });
  }
  if (shouldRenderCone) {
    awards.push({ label: '🚜 Cono del día', value: `${cone.name} (${cone.raceScore.toFixed(2)} puntos)` });
  }
  if (destructiveDnf) {
    awards.push({ label: '🪦 DNF destructivo', value: `${destructiveDnf.name} (${destructiveDnf.rawCollisionEvents} impactos antes de empezar)` });
  }
  if (consistent) {
    awards.push({ label: '📈 Más consistente', value: `${consistent.name} (desvío ${formatConsistency(consistent.consistency)})` });
  }
  if (tortoise && !hideTortoise) {
    awards.push({ label: '🐢 Tortuga digna', value: `${tortoise.name} (${formatAverageLap(tortoise.avgLap)})` });
  }

  return awards;
}

function formatDriver(entry: DriverRaceStats): string {
  return `${entry.name} (${entry.raceScore.toFixed(2)} puntos)`;
}

function getAwardEligibleDrivers(stats: DriverRaceStats[]): DriverRaceStats[] {
  return stats.filter((entry) => entry.active);
}

function formatPodiumEntry(entry: DriverRaceStats, leader: DriverRaceStats | null): string {
  const statusSuffix = formatStatusSuffix(entry);
  if (statusSuffix) {
    return `P${entry.position} ${entry.name}${statusSuffix}`;
  }

  const gap = leader && leader.position !== entry.position ? entry.totalTime - leader.totalTime : 0;
  const gapLabel = leader && leader.position !== entry.position && entry.hasValidResult && leader.hasValidResult ? ` (${formatGap(gap)})` : '';
  return `P${entry.position} ${entry.name}${gapLabel}`;
}

function formatStatusSuffix(entry: DriverRaceStats): string {
  if (entry.inactive) {
    return ' (DNS / sin actividad)';
  }

  if (!entry.finished) {
    return ` (DNF ${entry.completedLaps}/${entry.raceLaps} vueltas)`;
  }

  return '';
}

function formatMissileAward(incident: GroupedIncident | null): string | null {
  if (!incident) {
    return null;
  }

  const names = incident.driversInvolved.map((entry) => entry.name).filter(Boolean);
  const pairLabel = names.length >= 2 ? `${names[0]} y ${names[1]}` : names[0] ?? `Autos ${incident.carIdsInvolved[0]} y ${incident.carIdsInvolved[1]}`;
  return `${pairLabel} (${incident.maxImpact.toFixed(2)} km/h de impacto)`;
}

function formatAverageLap(value: number | null): string {
  return value == null ? 'Sin tiempo válido' : formatLapTime(Math.round(value));
}

function pickOne<T>(values: T[], compare: (left: T, right: T) => number): T | null {
  return values.slice().sort(compare)[0] ?? null;
}

function compareNumbers(left: number | null | undefined, right: number | null | undefined): number {
  return (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);
}
