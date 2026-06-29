import type { TrackContextEnrichment, TrackVector3 } from '../track/trackTypes';
import type { TrackIdentityInput, TrackPointNeighbors, TrackQueryService } from '../track/trackQueryService';

export type VerdictTrackContextInput = Readonly<{
  queryService: TrackQueryService;
  sessionTrackIdentity: TrackIdentityInput;
}>;

export type VerdictGeometrySnapshotInput = Readonly<{
  carId: number;
  pos: TrackVector3;
  velocity: TrackVector3;
  speedKmh: number;
  normalizedSplinePos?: number | null;
  trackContext?: TrackContextEnrichment | null;
}>;

export type LocalTurnSide = 'left' | 'right' | 'straight';

export type ResolvedVerdictTrackContext = Readonly<{
  trackContext: TrackContextEnrichment;
  resolutionSource: 'attached' | 'progress' | 'world_position';
}>;

export type VerdictGeometryProjection = Readonly<{
  carId: number;
  context: ResolvedVerdictTrackContext;
  localPosition: Readonly<{
    forwardM: number;
    lateralM: number;
  }>;
  localVelocity: Readonly<{
    forwardKmh: number;
    lateralKmh: number;
  }>;
  distanceToLeftEdgeM: number;
  distanceToRightEdgeM: number;
}>;

export type IncidentVerdictGeometry = Readonly<{
  frame: Readonly<{
    anchorIndex: number;
    turnSide: LocalTurnSide;
    forwardAxis: TrackVector3;
    lateralAxis: TrackVector3;
  }>;
  primary: VerdictGeometryProjection;
  secondary: VerdictGeometryProjection;
  pair: Readonly<{
    forwardDeltaM: number;
    lateralDeltaM: number;
    closingDeltaKmh: number;
    progressDelta: number;
    mixedProjectionSources: boolean;
  }>;
}>;

export function deriveIncidentVerdictGeometry(input: {
  primary: VerdictGeometrySnapshotInput;
  secondary: VerdictGeometrySnapshotInput;
  trackContextInput?: VerdictTrackContextInput;
}): IncidentVerdictGeometry | null {
  const primaryContext = resolveVerdictTrackContext(input.primary, input.trackContextInput);
  const secondaryContext = resolveVerdictTrackContext(input.secondary, input.trackContextInput);

  if (!primaryContext || !secondaryContext) {
    return null;
  }

  const anchorContext = selectAnchorContext(primaryContext, secondaryContext);
  const neighbors = input.trackContextInput?.queryService.getNeighboringPoints(anchorContext.trackContext.index)
    ?? toSelfNeighbors(anchorContext.trackContext);
  const forwardAxis = normalizeVector(anchorContext.trackContext.forward);
  const lateralAxis = resolveLateralAxis(anchorContext.trackContext, forwardAxis);
  const turnSide = inferTurnSide(neighbors);
  const primary = projectSnapshot(input.primary, primaryContext, anchorContext.trackContext, forwardAxis, lateralAxis);
  const secondary = projectSnapshot(input.secondary, secondaryContext, anchorContext.trackContext, forwardAxis, lateralAxis);

  return Object.freeze({
    frame: Object.freeze({
      anchorIndex: anchorContext.trackContext.index,
      turnSide,
      forwardAxis,
      lateralAxis,
    }),
    primary,
    secondary,
    pair: Object.freeze({
      forwardDeltaM: secondary.localPosition.forwardM - primary.localPosition.forwardM,
      lateralDeltaM: secondary.localPosition.lateralM - primary.localPosition.lateralM,
      closingDeltaKmh: primary.localVelocity.forwardKmh - secondary.localVelocity.forwardKmh,
      progressDelta: shortestProgressDelta(primaryContext.trackContext.normalized, secondaryContext.trackContext.normalized),
      mixedProjectionSources: primaryContext.resolutionSource !== secondaryContext.resolutionSource,
    }),
  });
}

export function resolveVerdictTrackContext(
  snapshot: VerdictGeometrySnapshotInput,
  trackContextInput?: VerdictTrackContextInput
): ResolvedVerdictTrackContext | null {
  if (snapshot.trackContext) {
    return Object.freeze({
      trackContext: snapshot.trackContext,
      resolutionSource: 'attached',
    });
  }

  if (!trackContextInput || !trackContextInput.queryService.resolveTrack(trackContextInput.sessionTrackIdentity)) {
    return null;
  }

  if (snapshot.normalizedSplinePos != null && Number.isFinite(snapshot.normalizedSplinePos)) {
    return Object.freeze({
      trackContext: trackContextInput.queryService.projectByProgress(snapshot.normalizedSplinePos),
      resolutionSource: 'progress',
    });
  }

  if (!hasFiniteVector(snapshot.pos)) {
    return null;
  }

  return Object.freeze({
    trackContext: trackContextInput.queryService.projectByWorldPosition(snapshot.pos),
    resolutionSource: 'world_position',
  });
}

export function inferTurnSide(neighbors: TrackPointNeighbors): LocalTurnSide {
  const previousDirection = normalizeVector(subtractVectors(neighbors.current.center, neighbors.previous.center));
  const nextDirection = normalizeVector(subtractVectors(neighbors.next.center, neighbors.current.center));
  const crossY = (previousDirection.x * nextDirection.z) - (previousDirection.z * nextDirection.x);

  if (Math.abs(crossY) <= 0.0001) {
    return 'straight';
  }

  return crossY > 0 ? 'left' : 'right';
}

function selectAnchorContext(
  primary: ResolvedVerdictTrackContext,
  secondary: ResolvedVerdictTrackContext
): ResolvedVerdictTrackContext {
  if (primary.resolutionSource === 'attached' && secondary.resolutionSource !== 'attached') {
    return primary;
  }

  if (secondary.resolutionSource === 'attached' && primary.resolutionSource !== 'attached') {
    return secondary;
  }

  return primary.trackContext.index <= secondary.trackContext.index ? primary : secondary;
}

function projectSnapshot(
  snapshot: VerdictGeometrySnapshotInput,
  context: ResolvedVerdictTrackContext,
  anchorContext: TrackContextEnrichment,
  forwardAxis: TrackVector3,
  lateralAxis: TrackVector3
): VerdictGeometryProjection {
  const centerToPosition = subtractVectors(snapshot.pos, anchorContext.center);
  const centerToLeftEdge = subtractVectors(anchorContext.leftEdge, anchorContext.center);
  const centerToRightEdge = subtractVectors(anchorContext.rightEdge, anchorContext.center);
  const lateralPosition = dotProduct(centerToPosition, lateralAxis);
  const leftEdgeOffset = dotProduct(centerToLeftEdge, lateralAxis);
  const rightEdgeOffset = dotProduct(centerToRightEdge, lateralAxis);

  return Object.freeze({
    carId: snapshot.carId,
    context,
    localPosition: Object.freeze({
      forwardM: dotProduct(centerToPosition, forwardAxis),
      lateralM: lateralPosition,
    }),
    localVelocity: Object.freeze({
      forwardKmh: msToKmh(dotProduct(snapshot.velocity, forwardAxis)),
      lateralKmh: msToKmh(dotProduct(snapshot.velocity, lateralAxis)),
    }),
    distanceToLeftEdgeM: leftEdgeOffset - lateralPosition,
    distanceToRightEdgeM: lateralPosition - rightEdgeOffset,
  });
}

function resolveLateralAxis(trackContext: TrackContextEnrichment, forwardAxis: TrackVector3): TrackVector3 {
  const edgeDirection = subtractVectors(trackContext.leftEdge, trackContext.center);
  if (vectorMagnitude(edgeDirection) > 0.0001) {
    return normalizeVector(edgeDirection);
  }

  return normalizeVector({
    x: -forwardAxis.z,
    y: 0,
    z: forwardAxis.x,
  });
}

function toSelfNeighbors(trackContext: TrackContextEnrichment): TrackPointNeighbors {
  const point = Object.freeze({
    index: trackContext.index,
    s: trackContext.s,
    normalized: trackContext.normalized,
    center: trackContext.center,
    forward: trackContext.forward,
    sideLeft: trackContext.sideLeft,
    sideRight: trackContext.sideRight,
    width: trackContext.width,
    leftEdge: trackContext.leftEdge,
    rightEdge: trackContext.rightEdge,
  });

  return Object.freeze({ previous: point, current: point, next: point });
}

function hasFiniteVector(vector: TrackVector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function subtractVectors(left: TrackVector3, right: TrackVector3): TrackVector3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function dotProduct(left: TrackVector3, right: TrackVector3): number {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function vectorMagnitude(vector: TrackVector3): number {
  return Math.sqrt(dotProduct(vector, vector));
}

function normalizeVector(vector: TrackVector3): TrackVector3 {
  const magnitude = vectorMagnitude(vector);

  if (magnitude <= 0.0001) {
    return Object.freeze({ x: 1, y: 0, z: 0 });
  }

  return Object.freeze({
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  });
}

function msToKmh(value: number): number {
  return value * 3.6;
}

function shortestProgressDelta(left: number, right: number): number {
  let delta = left - right;

  if (delta > 0.5) {
    delta -= 1;
  } else if (delta < -0.5) {
    delta += 1;
  }

  return delta;
}
