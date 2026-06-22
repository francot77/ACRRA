import { NO_TIME_SENTINEL, DriverRaceStats, GroupedIncident, ParsedRace } from '../types/assetto';

export function calculateDriverStats(
  race: ParsedRace,
  groupedIncidents: GroupedIncident[],
  defaultSafetyRating = 75
): DriverRaceStats[] {
  return race.drivers.map((driver) => {
    const laps = race.lapsByCarId.get(driver.carId) ?? [];
    const validLapTimes = laps.map((lap) => lap.lapTime);
    const sectorCount = Math.max(0, ...laps.map((lap) => lap.sectors.length));
    const bestSectors = Array.from({ length: sectorCount }, (_, index) => Math.min(...laps.map((lap) => lap.sectors[index]).filter(isNumber)));
    const envEvents = race.events.filter((event) => event.type === 'COLLISION_WITH_ENV' && event.carId === driver.carId);
    const carCollisionEvents = race.events.filter(
      (event) => event.type === 'COLLISION_WITH_CAR' && (event.carId === driver.carId || event.otherCarId === driver.carId)
    );
    const rawCollisionEvents = race.events.filter(
      (event) => event.carId === driver.carId || (event.type === 'COLLISION_WITH_CAR' && event.otherCarId === driver.carId)
    );
    const driverIncidents = groupedIncidents.filter((incident) => incident.carIdsInvolved.includes(driver.carId));
    const hasValidResult = driver.bestLap != null && driver.bestLap < NO_TIME_SENTINEL && driver.totalTime > 0;
    const active = laps.length > 0 || rawCollisionEvents.length > 0 || hasValidResult;
    const inactive = laps.length === 0 && rawCollisionEvents.length === 0 && !hasValidResult;
    const finished = laps.length >= race.raceLaps;
    const destructiveDnf = laps.length === 0 && rawCollisionEvents.length >= 3;

    return {
      carId: driver.carId,
      name: driver.name,
      guid: driver.guid,
      identity: driver.identity,
      position: driver.position,
      completedLaps: laps.length,
      raceLaps: race.raceLaps,
      hasValidResult,
      active,
      inactive,
      finished,
      destructiveDnf,
      bestLap: driver.bestLap,
      avgLap: average(validLapTimes),
      idealLap: bestSectors.length === 0 || bestSectors.some((value) => !Number.isFinite(value)) ? null : sum(bestSectors),
      consistency: calculateConsistency(validLapTimes),
      totalCuts: sum(laps.map((lap) => lap.cuts)),
      carIncidentsGrouped: driverIncidents.length,
      envHits: envEvents.length,
      maxCarImpact: maxOrZero(carCollisionEvents.map((event) => event.impactSpeed)),
      maxEnvImpact: maxOrZero(envEvents.map((event) => event.impactSpeed)),
      maxImpact: maxOrZero(rawCollisionEvents.map((event) => event.impactSpeed)),
      rawCollisionEvents: rawCollisionEvents.length,
      'tyre usado más frecuente': mostFrequentTyre(laps.map((lap) => lap.tyre)),
      totalTime: driver.totalTime,
      raceScore: 0,
      oldSafetyRating: defaultSafetyRating,
      newSafetyRating: defaultSafetyRating
    };
  });
}

function calculateConsistency(lapTimes: number[]): number | null {
  if (lapTimes.length === 0) {
    return null;
  }

  const avg = average(lapTimes);
  if (avg == null) {
    return null;
  }

  const variance = lapTimes.reduce((sum, lapTime) => sum + Math.pow(lapTime - avg, 2), 0) / lapTimes.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

function mostFrequentTyre(tyres: string[]): string | null {
  if (tyres.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const tyre of tyres) {
    counts.set(tyre, (counts.get(tyre) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return Number((sum(values) / values.length).toFixed(2));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function maxOrZero(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function isNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
