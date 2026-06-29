import type { PersistedLiveIncident, PersistedLiveIncidentSnapshot } from '../db/repositories';
import {
  deriveIncidentVerdictGeometry,
  type VerdictTrackContextInput,
} from './incidentVerdictGeometry';

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
const MAX_STRONG_SAMPLE_AGE_MS = 300;
const MAX_SNAPSHOT_SPREAD_MS = 180;
const MIN_GEOMETRY_CLEAR_FORWARD_M = 2.5;
const CAR_LENGTH_M = 4.8;
const CAR_WIDTH_M = 1.9;
const MIN_SQUEEZE_OVERLAP_RATIO = 0.35;
const MIN_SQUEEZE_WIDTH_M = 1.8;
const MIN_DIVEBOMB_CLOSING_SPEED_KMH = 18;
const MAX_DIVEBOMB_OVERLAP_RATIO = 0.45;
const MIN_LATERAL_CONFLICT_M = -0.3;
const MIN_PROGRESS_CONTRADICTION = 0.002;
const MIN_FORWARD_CONTRADICTION_M = 1.5;

type SnapshotWithOptionalTrackContext = PersistedLiveIncidentSnapshot & {
  trackContext?: import('../track/trackTypes').TrackContextEnrichment | null;
};

type LegacyVerdictMode = 'full' | 'rear_end_only';

type GeometryFacts = Readonly<{
  overlapRatio: number;
  longitudinalOrder: 'car_ahead' | 'car_beside' | 'other_ahead' | 'unknown';
  primaryInside: boolean | null;
  primaryAvailableWidthM: number | null;
  secondaryAvailableWidthM: number | null;
  lateralOverlapM: number;
  contradiction: boolean;
  confidencePenalty: number;
}>;

export function analyzeIncidentVerdict(
  incident: PersistedLiveIncident,
  trackContextInput?: VerdictTrackContextInput
): IncidentVerdict {
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

  const geometry = deriveIncidentVerdictGeometry({
    primary: primaryPreImpact,
    secondary: otherPreImpact,
    trackContextInput,
  });

  if (geometry) {
    const facts = deriveGeometryFacts(primaryPreImpact, otherPreImpact, geometry);
    const geometryVerdict = mapGeometryVerdict(incident, geometry, facts);
    if (geometryVerdict) {
      return geometryVerdict;
    }

    if (!facts.contradiction && facts.confidencePenalty < 0.5) {
      return unknownVerdict('Bounded geometry did not show a decisive blame signal');
    }
  }

  const legacyMode: LegacyVerdictMode = trackContextInput ? 'rear_end_only' : 'full';
  const legacyVerdict = analyzeLegacyVerdict(incident, primaryPreImpact, otherPreImpact, legacyMode);
  if (legacyVerdict) {
    return legacyVerdict;
  }

  if (trackContextInput && geometry == null) {
    return unknownVerdict('Track-context geometry could not be resolved from persisted telemetry');
  }

  if (
    primaryPreImpact.normalizedSplinePos == null ||
    otherPreImpact.normalizedSplinePos == null
  ) {
    return unknownVerdict('Missing spline position telemetry before impact');
  }

  return unknownVerdict('Telemetry does not show a strong or consistent blame signal');
}

function analyzeLegacyVerdict(
  incident: PersistedLiveIncident,
  primaryPreImpact: PersistedLiveIncidentSnapshot,
  otherPreImpact: PersistedLiveIncidentSnapshot,
  mode: LegacyVerdictMode
): IncidentVerdict | null {
  if (
    primaryPreImpact.normalizedSplinePos == null ||
    otherPreImpact.normalizedSplinePos == null
  ) {
    return null;
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
      blamedCarId: incident.otherCarId ?? undefined,
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

  if (mode === 'rear_end_only') {
    return null;
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

  return null;
}

function getLatestPreImpactSnapshot(
  snapshots: PersistedLiveIncidentSnapshot[],
  carId: number
): SnapshotWithOptionalTrackContext | undefined {
  return snapshots
    .filter((snapshot) => snapshot.carId === carId && snapshot.relativeMs <= 0)
    .sort((left, right) => right.relativeMs - left.relativeMs)[0] as SnapshotWithOptionalTrackContext | undefined;
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

function deriveGeometryFacts(
  primary: PersistedLiveIncidentSnapshot,
  secondary: PersistedLiveIncidentSnapshot,
  geometry: NonNullable<ReturnType<typeof deriveIncidentVerdictGeometry>>
): GeometryFacts {
  const forwardGap = Math.abs(geometry.pair.forwardDeltaM);
  const overlapRatio = clamp01((CAR_LENGTH_M - forwardGap) / CAR_LENGTH_M);
  const lateralOverlapM = CAR_WIDTH_M - Math.abs(geometry.pair.lateralDeltaM);
  const longitudinalOrder = resolveLongitudinalOrder(geometry.pair.forwardDeltaM, overlapRatio);
  const primaryInside = resolvePrimaryInside(geometry.frame.turnSide, geometry.primary.localPosition.lateralM, geometry.secondary.localPosition.lateralM);
  const contradiction = hasProgressGeometryContradiction(geometry.pair.progressDelta, geometry.pair.forwardDeltaM);

  let confidencePenalty = 0;
  if (Math.abs(primary.relativeMs) > MAX_STRONG_SAMPLE_AGE_MS || Math.abs(secondary.relativeMs) > MAX_STRONG_SAMPLE_AGE_MS) {
    confidencePenalty += 0.12;
  }

  if (Math.abs(primary.relativeMs - secondary.relativeMs) > MAX_SNAPSHOT_SPREAD_MS) {
    confidencePenalty += 0.08;
  }

  if (geometry.pair.mixedProjectionSources) {
    confidencePenalty += 0.12;
  }

  if (contradiction) {
    confidencePenalty += 0.38;
  }

  return Object.freeze({
    overlapRatio,
    longitudinalOrder,
    primaryInside,
    primaryAvailableWidthM: primaryInside == null
      ? null
      : widthForSide(geometry.primary.distanceToLeftEdgeM, geometry.primary.distanceToRightEdgeM, geometry.frame.turnSide, primaryInside),
    secondaryAvailableWidthM: primaryInside == null
      ? null
      : widthForSide(geometry.secondary.distanceToLeftEdgeM, geometry.secondary.distanceToRightEdgeM, geometry.frame.turnSide, !primaryInside),
    lateralOverlapM,
    contradiction,
    confidencePenalty,
  });
}

function mapGeometryVerdict(
  incident: PersistedLiveIncident,
  geometry: NonNullable<ReturnType<typeof deriveIncidentVerdictGeometry>>,
  facts: GeometryFacts
): IncidentVerdict | null {
  if (facts.contradiction) {
    return {
      type: 'unknown',
      confidence: 0.34,
      explanation: [
        'Spline progress and local track geometry disagree on which car was ahead',
        'Blame was downgraded because the bounded evidence is contradictory',
      ],
    };
  }

  const rearEndVerdict = mapRearEndVerdict(incident, geometry, facts);
  if (rearEndVerdict) {
    return rearEndVerdict;
  }

  const divebombVerdict = mapDivebombVerdict(incident, geometry, facts);
  if (divebombVerdict) {
    return divebombVerdict;
  }

  const squeezeVerdict = mapSqueezeVerdict(incident, geometry, facts);
  if (squeezeVerdict) {
    return squeezeVerdict;
  }

  if (
    facts.overlapRatio >= MIN_SQUEEZE_OVERLAP_RATIO
    && Math.abs(geometry.pair.closingDeltaKmh) <= MAX_SIMILAR_PACE_DELTA_KMH
    && hasAdequateWidth(facts.primaryAvailableWidthM)
    && hasAdequateWidth(facts.secondaryAvailableWidthM)
  ) {
    return {
      type: 'racing_incident',
      confidence: clampConfidence(0.68 - (facts.confidencePenalty * 0.4)),
      explanation: [
        'Cars were meaningfully overlapped in the local track frame before contact',
        `Forward closing delta stayed bounded at ${Math.abs(geometry.pair.closingDeltaKmh).toFixed(1)} km/h`,
      ],
    };
  }

  return null;
}

function mapRearEndVerdict(
  incident: PersistedLiveIncident,
  geometry: NonNullable<ReturnType<typeof deriveIncidentVerdictGeometry>>,
  facts: GeometryFacts
): IncidentVerdict | null {
  if (facts.overlapRatio > 0.2 || facts.confidencePenalty >= 0.45) {
    return null;
  }

  if (
    facts.longitudinalOrder === 'other_ahead'
    && geometry.pair.closingDeltaKmh >= MIN_REAR_END_CLOSING_SPEED_KMH
  ) {
    return {
      type: 'possible_rear_end',
      confidence: clampConfidence(0.88 - facts.confidencePenalty),
      blamedCarId: incident.carId,
      explanation: [
        `Car ${incident.carId} was still behind car ${incident.otherCarId} in the local track frame`,
        `Forward closing delta favored car ${incident.carId} by ${geometry.pair.closingDeltaKmh.toFixed(1)} km/h`,
      ],
    };
  }

  if (
    facts.longitudinalOrder === 'car_ahead'
    && geometry.pair.closingDeltaKmh <= -MIN_REAR_END_CLOSING_SPEED_KMH
  ) {
    return {
      type: 'possible_rear_end',
      confidence: clampConfidence(0.88 - facts.confidencePenalty),
      blamedCarId: incident.otherCarId ?? undefined,
      explanation: [
        `Car ${incident.otherCarId} was still behind car ${incident.carId} in the local track frame`,
        `Forward closing delta favored car ${incident.otherCarId} by ${Math.abs(geometry.pair.closingDeltaKmh).toFixed(1)} km/h`,
      ],
    };
  }

  return null;
}

function mapSqueezeVerdict(
  incident: PersistedLiveIncident,
  geometry: NonNullable<ReturnType<typeof deriveIncidentVerdictGeometry>>,
  facts: GeometryFacts
): IncidentVerdict | null {
  if (
    facts.primaryInside == null
    || facts.overlapRatio < MIN_SQUEEZE_OVERLAP_RATIO
    || facts.lateralOverlapM < MIN_LATERAL_CONFLICT_M
    || facts.confidencePenalty >= 0.4
  ) {
    return null;
  }

  if (facts.primaryInside && isTightWidth(facts.primaryAvailableWidthM)) {
    return {
      type: 'possible_squeeze',
      confidence: clampConfidence(0.82 - facts.confidencePenalty),
      blamedCarId: incident.otherCarId ?? undefined,
      explanation: [
        `Car ${incident.carId} had inside overlap with only ${facts.primaryAvailableWidthM?.toFixed(1)} m left to the ${insideEdgeLabel(geometry.frame.turnSide)} edge`,
        `Car ${incident.otherCarId} remained overlapped while the local corridor closed`,
      ],
    };
  }

  if (!facts.primaryInside && isTightWidth(facts.secondaryAvailableWidthM)) {
    return {
      type: 'possible_squeeze',
      confidence: clampConfidence(0.82 - facts.confidencePenalty),
      blamedCarId: incident.carId,
      explanation: [
        `Car ${incident.otherCarId} had inside overlap with only ${facts.secondaryAvailableWidthM?.toFixed(1)} m left to the ${insideEdgeLabel(geometry.frame.turnSide)} edge`,
        `Car ${incident.carId} remained overlapped while the local corridor closed`,
      ],
    };
  }

  return null;
}

function mapDivebombVerdict(
  incident: PersistedLiveIncident,
  geometry: NonNullable<ReturnType<typeof deriveIncidentVerdictGeometry>>,
  facts: GeometryFacts
): IncidentVerdict | null {
  if (
    facts.primaryInside == null
    || facts.overlapRatio <= 0
    || facts.overlapRatio >= MAX_DIVEBOMB_OVERLAP_RATIO
    || facts.confidencePenalty >= 0.35
  ) {
    return null;
  }

  if (
    geometry.pair.forwardDeltaM > 0
    && facts.primaryInside
    && geometry.pair.closingDeltaKmh >= MIN_DIVEBOMB_CLOSING_SPEED_KMH
  ) {
    return {
      type: 'possible_divebomb',
      confidence: clampConfidence(0.8 - facts.confidencePenalty),
      blamedCarId: incident.carId,
      explanation: [
        `Car ${incident.carId} arrived from behind on the inside with only ${Math.round(facts.overlapRatio * 100)}% overlap established`,
        `Forward closing delta favored car ${incident.carId} by ${geometry.pair.closingDeltaKmh.toFixed(1)} km/h`,
      ],
    };
  }

  if (
    geometry.pair.forwardDeltaM < 0
    && !facts.primaryInside
    && geometry.pair.closingDeltaKmh <= -MIN_DIVEBOMB_CLOSING_SPEED_KMH
  ) {
    return {
      type: 'possible_divebomb',
      confidence: clampConfidence(0.8 - facts.confidencePenalty),
      blamedCarId: incident.otherCarId ?? undefined,
      explanation: [
        `Car ${incident.otherCarId} arrived from behind on the inside with only ${Math.round(facts.overlapRatio * 100)}% overlap established`,
        `Forward closing delta favored car ${incident.otherCarId} by ${Math.abs(geometry.pair.closingDeltaKmh).toFixed(1)} km/h`,
      ],
    };
  }

  return null;
}

function resolveLongitudinalOrder(
  forwardDeltaM: number,
  overlapRatio: number
): GeometryFacts['longitudinalOrder'] {
  if (overlapRatio >= 0.35) {
    return 'car_beside';
  }

  if (forwardDeltaM <= -MIN_GEOMETRY_CLEAR_FORWARD_M) {
    return 'car_ahead';
  }

  if (forwardDeltaM >= MIN_GEOMETRY_CLEAR_FORWARD_M) {
    return 'other_ahead';
  }

  return 'unknown';
}

function resolvePrimaryInside(
  turnSide: 'left' | 'right' | 'straight',
  primaryLateralM: number,
  secondaryLateralM: number
): boolean | null {
  if (turnSide === 'straight' || Math.abs(primaryLateralM - secondaryLateralM) < 0.2) {
    return null;
  }

  return turnSide === 'left'
    ? primaryLateralM > secondaryLateralM
    : primaryLateralM < secondaryLateralM;
}

function widthForSide(
  distanceToLeftEdgeM: number,
  distanceToRightEdgeM: number,
  turnSide: 'left' | 'right' | 'straight',
  isInsideCar: boolean
): number | null {
  if (turnSide === 'straight') {
    return null;
  }

  if (turnSide === 'left') {
    return isInsideCar ? distanceToLeftEdgeM : distanceToRightEdgeM;
  }

  return isInsideCar ? distanceToRightEdgeM : distanceToLeftEdgeM;
}

function hasProgressGeometryContradiction(progressDelta: number, forwardDeltaM: number): boolean {
  return Math.abs(progressDelta) >= MIN_PROGRESS_CONTRADICTION
    && Math.abs(forwardDeltaM) >= MIN_FORWARD_CONTRADICTION_M
    && Math.sign(progressDelta) === Math.sign(forwardDeltaM);
}

function isTightWidth(value: number | null): value is number {
  return value != null && value < MIN_SQUEEZE_WIDTH_M;
}

function hasAdequateWidth(value: number | null): boolean {
  return value == null || value >= MIN_SQUEEZE_WIDTH_M;
}

function insideEdgeLabel(turnSide: 'left' | 'right' | 'straight'): string {
  if (turnSide === 'right') {
    return 'right';
  }

  return 'left';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampConfidence(value: number): number {
  return Math.min(0.99, Math.max(0.25, Number(value.toFixed(2))));
}

function unknownVerdict(reason: string): IncidentVerdict {
  return {
    type: 'unknown',
    confidence: 0.25,
    explanation: [reason],
  };
}
