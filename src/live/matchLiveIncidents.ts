import { PersistedLiveIncident } from '../db/repositories';
import { ParsedCarCollisionEvent, ParsedEnvCollisionEvent, ParsedEvent, ParsedRace } from '../types/assetto';
import { Vector3 } from './liveTypes';

export type IncidentMatchStatus = 'matched' | 'live_only' | 'json_only' | 'unmatched';

export type IncidentMatchConfig = {
  maxDistanceM: number;
  maxImpactDiffKmh: number;
};

export type JsonRaceIncident =
  | {
      source: 'json';
      status: IncidentMatchStatus;
      eventIndex: number;
      type: 'collision_with_car';
      carId: number;
      otherCarId: number;
      driverName: string;
      otherDriverName: string;
      impactSpeed: number;
      worldPosition: Vector3 | null;
    }
  | {
      source: 'json';
      status: IncidentMatchStatus;
      eventIndex: number;
      type: 'collision_with_env';
      carId: number;
      driverName: string;
      impactSpeed: number;
      worldPosition: Vector3 | null;
    };

export type IncidentMismatch = {
  status: 'unmatched';
  liveIncidentId: number;
  jsonEventIndex: number;
  reasons: Array<'position_missing' | 'type_mismatch' | 'car_mismatch' | 'distance_exceeded' | 'impact_exceeded'>;
  distanceM: number | null;
  impactDiffKmh: number;
};

export type MatchedIncidentPair = {
  status: 'matched';
  liveIncidentId: number;
  jsonEventIndex: number;
  distanceM: number;
  impactDiffKmh: number;
};

export type LiveOnlyIncident = PersistedLiveIncident & { status: 'live_only' };
export type JsonOnlyIncident = JsonRaceIncident & { status: 'json_only' };

export type MatchLiveIncidentsResult = {
  matched: MatchedIncidentPair[];
  liveOnly: LiveOnlyIncident[];
  jsonOnly: JsonOnlyIncident[];
  unmatched: IncidentMismatch[];
};

export function extractRaceCollisionEvents(race: ParsedRace): JsonRaceIncident[] {
  return race.events.flatMap((event) => {
    if (event.type === 'COLLISION_WITH_CAR') {
      return [toJsonCarIncident(event)];
    }

    if (event.type === 'COLLISION_WITH_ENV') {
      return [toJsonEnvIncident(event)];
    }

    return [];
  });
}

export function matchLiveIncidentsToRaceEvents(
  liveIncidents: PersistedLiveIncident[],
  jsonEvents: JsonRaceIncident[],
  config: IncidentMatchConfig
): MatchLiveIncidentsResult {
  const matched: MatchedIncidentPair[] = [];
  const unmatched: IncidentMismatch[] = [];
  const matchedLiveIds = new Set<number>();
  const matchedJsonIndexes = new Set<number>();

  for (const jsonEvent of jsonEvents) {
    let bestMatch: MatchedIncidentPair | null = null;

    for (const liveIncident of liveIncidents) {
      if (matchedLiveIds.has(liveIncident.id)) {
        continue;
      }

      const evaluation = evaluateCandidate(liveIncident, jsonEvent, config);
      if (evaluation.status === 'unmatched') {
        unmatched.push(evaluation);
        continue;
      }

      if (
        bestMatch == null ||
        evaluation.distanceM < bestMatch.distanceM ||
        (evaluation.distanceM === bestMatch.distanceM && evaluation.impactDiffKmh < bestMatch.impactDiffKmh)
      ) {
        bestMatch = evaluation;
      }
    }

    if (!bestMatch) {
      continue;
    }

    matched.push(bestMatch);
    matchedLiveIds.add(bestMatch.liveIncidentId);
    matchedJsonIndexes.add(bestMatch.jsonEventIndex);
  }

  return {
    matched,
    liveOnly: liveIncidents
      .filter((incident) => !matchedLiveIds.has(incident.id))
      .map((incident) => ({ ...incident, status: 'live_only' })),
    jsonOnly: jsonEvents
      .filter((event) => !matchedJsonIndexes.has(event.eventIndex))
      .map((event) => ({ ...event, status: 'json_only' })),
    unmatched,
  };
}

function evaluateCandidate(
  liveIncident: PersistedLiveIncident,
  jsonEvent: JsonRaceIncident,
  config: IncidentMatchConfig
): MatchedIncidentPair | IncidentMismatch {
  const reasons: IncidentMismatch['reasons'] = [];

  if (liveIncident.type !== jsonEvent.type) {
    reasons.push('type_mismatch');
  }

  if (!sameCars(liveIncident, jsonEvent)) {
    reasons.push('car_mismatch');
  }

  const distanceM = distanceBetween(liveIncident.worldPosition, jsonEvent.worldPosition);
  if (distanceM == null) {
    reasons.push('position_missing');
  } else if (distanceM > config.maxDistanceM) {
    reasons.push('distance_exceeded');
  }

  const impactDiffKmh = Math.abs(liveIncident.impactSpeed - jsonEvent.impactSpeed);
  if (impactDiffKmh > config.maxImpactDiffKmh) {
    reasons.push('impact_exceeded');
  }

  if (reasons.length > 0) {
    return {
      status: 'unmatched',
      liveIncidentId: liveIncident.id,
      jsonEventIndex: jsonEvent.eventIndex,
      reasons,
      distanceM,
      impactDiffKmh,
    };
  }

  return {
    status: 'matched',
    liveIncidentId: liveIncident.id,
    jsonEventIndex: jsonEvent.eventIndex,
    distanceM: distanceM ?? 0,
    impactDiffKmh,
  };
}

function sameCars(liveIncident: PersistedLiveIncident, jsonEvent: JsonRaceIncident): boolean {
  if (liveIncident.type !== jsonEvent.type) {
    return false;
  }

  if (liveIncident.type === 'collision_with_env') {
    return liveIncident.carId === jsonEvent.carId;
  }

  if (liveIncident.otherCarId == null || jsonEvent.type !== 'collision_with_car') {
    return false;
  }

  const livePair = [Math.min(liveIncident.carId, liveIncident.otherCarId), Math.max(liveIncident.carId, liveIncident.otherCarId)];
  const jsonPair = [Math.min(jsonEvent.carId, jsonEvent.otherCarId), Math.max(jsonEvent.carId, jsonEvent.otherCarId)];

  return livePair[0] === jsonPair[0] && livePair[1] === jsonPair[1];
}

function distanceBetween(left: Vector3, right: Vector3 | null): number | null {
  if (!right) {
    return null;
  }

  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function toJsonCarIncident(event: ParsedCarCollisionEvent): JsonRaceIncident {
  return {
    source: 'json',
    status: 'unmatched',
    eventIndex: event.index,
    type: 'collision_with_car',
    carId: event.carId,
    otherCarId: event.otherCarId,
    driverName: event.driverName,
    otherDriverName: event.otherDriverName,
    impactSpeed: event.impactSpeed,
    worldPosition: toLiveVector(event.worldPosition),
  };
}

function toJsonEnvIncident(event: ParsedEnvCollisionEvent): JsonRaceIncident {
  return {
    source: 'json',
    status: 'unmatched',
    eventIndex: event.index,
    type: 'collision_with_env',
    carId: event.carId,
    driverName: event.driverName,
    impactSpeed: event.impactSpeed,
    worldPosition: toLiveVector(event.worldPosition),
  };
}

function toLiveVector(position: ParsedEvent['worldPosition'] | undefined): Vector3 | null {
  if (!position) {
    return null;
  }

  return {
    x: position.X,
    y: position.Y,
    z: position.Z,
  };
}
