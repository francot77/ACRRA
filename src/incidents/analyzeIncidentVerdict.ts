import type { PersistedLiveIncident, PersistedLiveIncidentSnapshot } from '../db/repositories';

export type IncidentVerdictType =
  | 'possible_rear_end'
  | 'possible_divebomb'
  | 'possible_squeeze'
  | 'possible_unsafe_rejoin'
  | 'racing_incident'
  | 'environment_crash'
  | 'unknown';

export type IncidentVerdict = {
  type: IncidentVerdictType;
  confidence: number;
  blamedCarId?: number;
  explanation: string[];
};

const MIN_RECENT_SNAPSHOT_MS = 750;
const MIN_REAR_GAP = 0.0015;
const MAX_ALONGSIDE_GAP = 0.0035;
const MAX_SIMILAR_PACE_DELTA_KMH = 12;
const MIN_REAR_END_CLOSING_SPEED_KMH = 15;

export function analyzeIncidentVerdict(incident: PersistedLiveIncident): IncidentVerdict {
  if (incident.snapshots.length === 0) {
    return unknownVerdict('Missing pre-impact snapshots: no snapshot telemetry was captured for this incident');
  }

  if (incident.type === 'collision_with_env') {
    return {
      type: 'environment_crash',
      confidence: 0.98,
      blamedCarId: incident.carId,
      explanation: ['Only environment contact was recorded', `Car ${incident.carId} was the sole involved car`],
    };
  }

  if (incident.otherCarId == null) {
    return unknownVerdict('Missing second car id for a car-contact incident');
  }

  const primaryPreImpact = getLatestPreImpactSnapshot(incident.snapshots, incident.carId);
  const otherPreImpact = getLatestPreImpactSnapshot(incident.snapshots, incident.otherCarId);

  if (!primaryPreImpact || !otherPreImpact) {
    return unknownVerdict('Missing pre-impact snapshots for one or both cars');
  }

  if (!hasRecentSnapshots(primaryPreImpact, otherPreImpact)) {
    return unknownVerdict('Pre-impact telemetry is too far from the contact moment');
  }

  if (
    primaryPreImpact.normalizedSplinePos == null ||
    otherPreImpact.normalizedSplinePos == null
  ) {
    return unknownVerdict('Missing spline position telemetry before impact');
  }

  const splineGap = shortestSplineDelta(primaryPreImpact.normalizedSplinePos, otherPreImpact.normalizedSplinePos);
  const primaryAhead = splineGap > 0;
  const otherAhead = splineGap < 0;
  const absoluteGap = Math.abs(splineGap);
  const speedDelta = primaryPreImpact.speedKmh - otherPreImpact.speedKmh;

  if (primaryAhead && absoluteGap >= MIN_REAR_GAP && speedDelta <= -MIN_REAR_END_CLOSING_SPEED_KMH) {
    return {
      type: 'possible_rear_end',
      confidence: 0.87,
      blamedCarId: incident.otherCarId,
      explanation: [
        `Car ${incident.otherCarId} was behind car ${incident.carId} before impact`,
        `Closing speed favored car ${incident.otherCarId} by ${Math.abs(speedDelta).toFixed(1)} km/h`,
      ],
    };
  }

  if (otherAhead && absoluteGap >= MIN_REAR_GAP && speedDelta >= MIN_REAR_END_CLOSING_SPEED_KMH) {
    return {
      type: 'possible_rear_end',
      confidence: 0.87,
      blamedCarId: incident.carId,
      explanation: [
        `Car ${incident.carId} was behind car ${incident.otherCarId} before impact`,
        `Closing speed favored car ${incident.carId} by ${speedDelta.toFixed(1)} km/h`,
      ],
    };
  }

  if (absoluteGap <= MAX_ALONGSIDE_GAP && Math.abs(speedDelta) <= MAX_SIMILAR_PACE_DELTA_KMH) {
    return {
      type: 'racing_incident',
      confidence: 0.66,
      explanation: [
        'Cars were plausibly alongside before contact',
        `Speed delta was only ${Math.abs(speedDelta).toFixed(1)} km/h`,
      ],
    };
  }

  return unknownVerdict('Telemetry does not show a strong or consistent blame signal');
}

function getLatestPreImpactSnapshot(
  snapshots: PersistedLiveIncidentSnapshot[],
  carId: number
): PersistedLiveIncidentSnapshot | undefined {
  return snapshots
    .filter((snapshot) => snapshot.carId === carId && snapshot.relativeMs <= 0)
    .sort((left, right) => right.relativeMs - left.relativeMs)[0];
}

function hasRecentSnapshots(
  primary: PersistedLiveIncidentSnapshot,
  secondary: PersistedLiveIncidentSnapshot
): boolean {
  return Math.abs(primary.relativeMs) <= MIN_RECENT_SNAPSHOT_MS && Math.abs(secondary.relativeMs) <= MIN_RECENT_SNAPSHOT_MS;
}

function shortestSplineDelta(left: number, right: number): number {
  let delta = left - right;

  if (delta > 0.5) {
    delta -= 1;
  } else if (delta < -0.5) {
    delta += 1;
  }

  return delta;
}

function unknownVerdict(reason: string): IncidentVerdict {
  return {
    type: 'unknown',
    confidence: 0.25,
    explanation: [reason],
  };
}
