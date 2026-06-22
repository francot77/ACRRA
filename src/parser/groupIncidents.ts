import { GroupedIncident, ParsedCarCollisionEvent, Vector3 } from '../types/assetto';

type IncidentBucket = {
  pairKey: string;
  carIdsInvolved: [number, number];
  events: ParsedCarCollisionEvent[];
};

export function groupIncidents(events: ParsedCarCollisionEvent[]): GroupedIncident[] {
  const buckets: IncidentBucket[] = [];

  for (const event of events) {
    const carIdsInvolved = [Math.min(event.carId, event.otherCarId), Math.max(event.carId, event.otherCarId)] as [number, number];
    const pairKey = `${carIdsInvolved[0]}:${carIdsInvolved[1]}`;
    const bucket = buckets.find((candidate) => candidate.pairKey === pairKey && isSameIncident(candidate.events[candidate.events.length - 1], event));

    if (bucket) {
      bucket.events.push(event);
      continue;
    }

    buckets.push({ pairKey, carIdsInvolved, events: [event] });
  }

  return buckets.map((bucket) => {
    const impacts = bucket.events.map((event) => event.impactSpeed);
    const positions = bucket.events.map((event) => event.worldPosition).filter((value): value is Vector3 => Boolean(value));
    const representativeWorldPosition = positions.length === 0 ? undefined : averagePosition(positions);

    return {
      pairKey: bucket.pairKey,
      driversInvolved: uniqueDrivers(bucket.events),
      carIdsInvolved: bucket.carIdsInvolved,
      maxImpact: Math.max(...impacts),
      avgImpact: impacts.reduce((sum, value) => sum + value, 0) / impacts.length,
      representativeWorldPosition,
      rawEventCount: bucket.events.length
    };
  });
}

function isSameIncident(left: ParsedCarCollisionEvent, right: ParsedCarCollisionEvent): boolean {
  if (right.index - left.index > 2) {
    return false;
  }

  if (!left.worldPosition || !right.worldPosition) {
    return true;
  }

  return distance(left.worldPosition, right.worldPosition) <= 6;
}

function distance(left: Vector3, right: Vector3): number {
  const dx = left.X - right.X;
  const dy = left.Y - right.Y;
  const dz = left.Z - right.Z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function averagePosition(positions: Vector3[]): Vector3 {
  const total = positions.reduce(
    (accumulator, position) => ({
      X: accumulator.X + position.X,
      Y: accumulator.Y + position.Y,
      Z: accumulator.Z + position.Z
    }),
    { X: 0, Y: 0, Z: 0 }
  );

  return {
    X: total.X / positions.length,
    Y: total.Y / positions.length,
    Z: total.Z / positions.length
  };
}

function uniqueDrivers(events: ParsedCarCollisionEvent[]): GroupedIncident['driversInvolved'] {
  const byCarId = new Map<number, GroupedIncident['driversInvolved'][number]>();

  for (const event of events) {
    byCarId.set(event.carId, { carId: event.carId, name: event.driverName, identity: event.driverIdentity });
    byCarId.set(event.otherCarId, { carId: event.otherCarId, name: event.otherDriverName, identity: event.otherDriverIdentity });
  }

  return [...byCarId.values()].sort((left, right) => left.carId - right.carId);
}
