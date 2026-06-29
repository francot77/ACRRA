import type { PersistedLiveIncident, PersistedLiveIncidentSnapshot } from '../db/repositories';
import { inferTurnSide, resolveVerdictTrackContext } from '../incidents/incidentVerdictGeometry';
import type { ReconstructionTrackContextInput } from './reconstructionTypes';
import type {
  IncidentScene,
  IncidentSceneCar,
  IncidentSceneCorridor,
  IncidentScenePlacement,
  ReconstructionEvidence,
  ReconstructionProjectionSource,
} from './reconstructionTypes';

const DEFAULT_FORWARD_RANGE_M = 45;
const DEFAULT_BACKWARD_RANGE_M = 25;
const DEFAULT_LATERAL_HALF_WIDTH_M = 12;

type ResolvedPlacementContext = NonNullable<ReturnType<typeof resolveVerdictTrackContext>>;

type AnchorCandidate = Readonly<{
  carId: number;
  relativeMs: number;
  context: ResolvedPlacementContext;
}>;

export type BuildIncidentReconstructionInput = Readonly<{
  incident: PersistedLiveIncident;
  trackContextInput?: ReconstructionTrackContextInput;
}>;

export function buildIncidentReconstruction(input: BuildIncidentReconstructionInput): IncidentScene {
  const involvedCarIds = new Set<number>([input.incident.carId]);
  if (input.incident.otherCarId != null) {
    involvedCarIds.add(input.incident.otherCarId);
  }

  const validTrackInput = hasValidTrackInput(input.trackContextInput);
  const anchor = resolveSceneAnchor(input.incident, involvedCarIds, validTrackInput ? input.trackContextInput : undefined);
  const localFrame = anchor.context ? createLocalFrame(anchor.context, input.trackContextInput) : null;
  const corridor = createCorridor(anchor.context, localFrame?.turnSide ?? 'straight');
  const cars = buildSceneCars(input.incident, involvedCarIds, anchor, corridor, localFrame, validTrackInput ? input.trackContextInput : undefined);
  const notes = buildSceneNotes(anchor.evidence, cars);

  return Object.freeze({
    incidentId: input.incident.id,
    incidentUid: input.incident.incidentUid,
    incidentType: input.incident.type,
    anchorCarId: anchor.carId,
    anchorRelativeMs: anchor.relativeMs,
    anchorEvidence: anchor.evidence,
    corridor,
    cars,
    notes,
    degraded: anchor.evidence.degraded || cars.some((car) => car.evidence.degraded) || notes.length > 0,
  });
}

function hasValidTrackInput(trackContextInput?: ReconstructionTrackContextInput): trackContextInput is ReconstructionTrackContextInput {
  return Boolean(trackContextInput?.queryService.resolveTrack(trackContextInput.sessionTrackIdentity));
}

function resolveSceneAnchor(
  incident: PersistedLiveIncident,
  involvedCarIds: ReadonlySet<number>,
  trackContextInput?: ReconstructionTrackContextInput,
): Readonly<{
  carId: number | null;
  relativeMs: number;
  context: ResolvedPlacementContext | null;
  evidence: ReconstructionEvidence;
}> {
  const candidate = incident.snapshots
    .filter((snapshot) => involvedCarIds.has(snapshot.carId))
    .map((snapshot) => ({
      snapshot,
      context: resolveSnapshotTrackContext(snapshot, trackContextInput),
    }))
    .filter((entry): entry is { snapshot: PersistedLiveIncidentSnapshot; context: ResolvedPlacementContext } => entry.context !== null)
    .sort((left, right) => compareAnchorCandidates(left.snapshot, left.context, right.snapshot, right.context))[0];

  if (candidate) {
    return Object.freeze({
      carId: candidate.snapshot.carId,
      relativeMs: candidate.snapshot.relativeMs,
      context: candidate.context,
      evidence: summarizeResolvedEvidence(candidate.context, candidate.snapshot),
    });
  }

  if (trackContextInput && hasFiniteVector(incident.worldPosition)) {
    const context = Object.freeze({
      trackContext: trackContextInput.queryService.projectByWorldPosition(incident.worldPosition),
      resolutionSource: 'world_position' as const,
    });

    return Object.freeze({
      carId: incident.carId,
      relativeMs: 0,
      context,
      evidence: Object.freeze({
        state: 'observed',
        degraded: true,
        projectionSource: 'world_position',
        reasons: Object.freeze(['Anchor required world-position reprojection fallback']),
      }),
    });
  }

  return Object.freeze({
    carId: incident.carId,
    relativeMs: 0,
    context: null,
    evidence: Object.freeze({
      state: 'missing',
      degraded: true,
      projectionSource: 'missing',
      reasons: Object.freeze(buildMissingContextReasons(trackContextInput, null)),
    }),
  });
}

function compareAnchorCandidates(
  leftSnapshot: PersistedLiveIncidentSnapshot,
  leftContext: ResolvedPlacementContext,
  rightSnapshot: PersistedLiveIncidentSnapshot,
  rightContext: ResolvedPlacementContext,
): number {
  const relativeDelta = Math.abs(leftSnapshot.relativeMs) - Math.abs(rightSnapshot.relativeMs);
  if (relativeDelta !== 0) {
    return relativeDelta;
  }

  const sourceDelta = projectionSourceRank(leftContext.resolutionSource) - projectionSourceRank(rightContext.resolutionSource);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  return leftSnapshot.carId - rightSnapshot.carId;
}

function projectionSourceRank(source: ReconstructionProjectionSource): number {
  switch (source) {
    case 'attached':
      return 0;
    case 'progress':
      return 1;
    case 'world_position':
      return 2;
    default:
      return 3;
  }
}

function createLocalFrame(context: ResolvedPlacementContext, trackContextInput?: ReconstructionTrackContextInput): {
  forwardAxis: { x: number; y: number; z: number };
  lateralAxis: { x: number; y: number; z: number };
  turnSide: IncidentSceneCorridor['turnSide'];
} {
  const forwardAxis = normalizeVector(context.trackContext.forward);
  const lateralAxis = resolveLateralAxis(context.trackContext.leftEdge, context.trackContext.center, forwardAxis);
  const neighbors = trackContextInput
    ? trackContextInput.queryService.getNeighboringPoints(context.trackContext.index)
    : {
        previous: context.trackContext,
        current: context.trackContext,
        next: context.trackContext,
      };

  return {
    forwardAxis,
    lateralAxis,
    turnSide: inferTurnSide(neighbors),
  };
}

function createCorridor(anchorContext: ResolvedPlacementContext | null, turnSide: IncidentSceneCorridor['turnSide']): IncidentSceneCorridor {
  const widthM = anchorContext?.trackContext.width ?? null;
  return Object.freeze({
    anchorIndex: anchorContext?.trackContext.index ?? null,
    anchorS: anchorContext?.trackContext.s ?? null,
    center: anchorContext?.trackContext.center ?? null,
    forwardRangeM: DEFAULT_FORWARD_RANGE_M,
    backwardRangeM: DEFAULT_BACKWARD_RANGE_M,
    lateralHalfWidthM: Math.max(anchorContext?.trackContext.width ?? 0, DEFAULT_LATERAL_HALF_WIDTH_M),
    widthM,
    turnSide,
  });
}

function buildSceneCars(
  incident: PersistedLiveIncident,
  involvedCarIds: ReadonlySet<number>,
  anchor: Readonly<{ context: ResolvedPlacementContext | null }>,
  corridor: IncidentSceneCorridor,
  localFrame: { forwardAxis: { x: number; y: number; z: number }; lateralAxis: { x: number; y: number; z: number } } | null,
  trackContextInput?: ReconstructionTrackContextInput,
): readonly IncidentSceneCar[] {
  const orderedCarIds = Array.from(new Set([...incident.snapshots.map((snapshot) => snapshot.carId), ...involvedCarIds])).sort((left, right) => left - right);

  return orderedCarIds
    .map((carId) => {
      const role = involvedCarIds.has(carId) ? 'involved' : 'context';
      const carSnapshots = incident.snapshots
        .filter((snapshot) => snapshot.carId === carId)
        .sort((left, right) => left.relativeMs - right.relativeMs || left.id - right.id);
      const placements = buildCarPlacements(carSnapshots, role, anchor.context, corridor, localFrame, trackContextInput);

      if (role === 'context' && !placements.some((placement) => placement.forwardM !== null && placement.lateralM !== null)) {
        return null;
      }

      if (role === 'involved' && placements.length === 0) {
        const missingEvidence = Object.freeze({
          state: 'missing',
          degraded: true,
          projectionSource: 'missing',
          reasons: Object.freeze(['No persisted snapshots were available for the involved car']),
        } satisfies ReconstructionEvidence);

        return Object.freeze({
          carId,
          role,
          placements: Object.freeze([{ snapshotId: null, relativeMs: 0, forwardM: null, lateralM: null, speedKmh: null, trackIndex: null, evidence: missingEvidence }]),
          evidence: missingEvidence,
        } satisfies IncidentSceneCar);
      }

      const evidence = summarizeCarEvidence(placements);
      return Object.freeze({
        carId,
        role,
        placements,
        evidence,
      } satisfies IncidentSceneCar);
    })
    .filter((car): car is IncidentSceneCar => car !== null);
}

function buildCarPlacements(
  snapshots: readonly PersistedLiveIncidentSnapshot[],
  role: IncidentSceneCar['role'],
  anchorContext: ResolvedPlacementContext | null,
  corridor: IncidentSceneCorridor,
  localFrame: { forwardAxis: { x: number; y: number; z: number }; lateralAxis: { x: number; y: number; z: number } } | null,
  trackContextInput?: ReconstructionTrackContextInput,
): readonly IncidentScenePlacement[] {
  const placements = snapshots.map((snapshot) => buildPlacement(snapshot, anchorContext, corridor, localFrame, trackContextInput));

  if (role === 'involved') {
    const inCorridor = placements.filter((placement) => isPlacementInCorridor(placement, corridor));
    return Object.freeze((inCorridor.length > 0 ? inCorridor : placements).map(freezePlacement));
  }

  return Object.freeze(placements.filter((placement) => isPlacementInCorridor(placement, corridor)).map(freezePlacement));
}

function buildPlacement(
  snapshot: PersistedLiveIncidentSnapshot,
  anchorContext: ResolvedPlacementContext | null,
  corridor: IncidentSceneCorridor,
  localFrame: { forwardAxis: { x: number; y: number; z: number }; lateralAxis: { x: number; y: number; z: number } } | null,
  trackContextInput?: ReconstructionTrackContextInput,
): IncidentScenePlacement {
  const context = resolveSnapshotTrackContext(snapshot, trackContextInput);

  if (!anchorContext || !context || !localFrame) {
    return {
      snapshotId: snapshot.id,
      relativeMs: snapshot.relativeMs,
      forwardM: null,
      lateralM: null,
      speedKmh: snapshot.speedKmh,
      trackIndex: context?.trackContext.index ?? null,
      evidence: summarizeMissingPlacementEvidence(snapshot, trackContextInput),
    };
  }

  const centerDelta = subtractVectors(snapshot.pos, anchorContext.trackContext.center);
  const forwardM = dotProduct(centerDelta, localFrame.forwardAxis);
  const lateralM = dotProduct(centerDelta, localFrame.lateralAxis);

  return {
    snapshotId: snapshot.id,
    relativeMs: snapshot.relativeMs,
    forwardM,
    lateralM,
    speedKmh: snapshot.speedKmh,
    trackIndex: context.trackContext.index,
    evidence: summarizeResolvedEvidence(context, snapshot),
  };
}

function isPlacementInCorridor(placement: IncidentScenePlacement, corridor: IncidentSceneCorridor): boolean {
  if (placement.forwardM === null || placement.lateralM === null) {
    return false;
  }

  return placement.forwardM >= -corridor.backwardRangeM
    && placement.forwardM <= corridor.forwardRangeM
    && Math.abs(placement.lateralM) <= corridor.lateralHalfWidthM;
}

function freezePlacement(placement: IncidentScenePlacement): IncidentScenePlacement {
  return Object.freeze({
    ...placement,
    evidence: Object.freeze({
      ...placement.evidence,
      reasons: Object.freeze([...placement.evidence.reasons]),
    }),
  });
}

function summarizeResolvedEvidence(context: ResolvedPlacementContext, snapshot: PersistedLiveIncidentSnapshot): ReconstructionEvidence {
  if (context.resolutionSource === 'world_position') {
    return Object.freeze({
      state: 'observed',
      degraded: true,
      projectionSource: 'world_position',
      reasons: Object.freeze(buildWorldFallbackReasons(snapshot)),
    });
  }

  return Object.freeze({
    state: 'observed',
    degraded: false,
    projectionSource: context.resolutionSource,
    reasons: Object.freeze([]),
  });
}

function summarizeMissingPlacementEvidence(
  snapshot: PersistedLiveIncidentSnapshot,
  trackContextInput?: ReconstructionTrackContextInput,
): ReconstructionEvidence {
  return Object.freeze({
    state: 'missing',
    degraded: true,
    projectionSource: 'missing',
    reasons: Object.freeze(buildMissingContextReasons(trackContextInput, snapshot)),
  });
}

function summarizeCarEvidence(placements: readonly IncidentScenePlacement[]): ReconstructionEvidence {
  const state = placements.some((placement) => placement.evidence.state === 'observed') ? 'observed' : 'missing';
  const degraded = placements.some((placement) => placement.evidence.degraded);
  const projectionSource = summarizeProjectionSources(placements.map((placement) => placement.evidence.projectionSource));
  const reasons = Array.from(new Set(placements.flatMap((placement) => placement.evidence.reasons)));

  return Object.freeze({
    state,
    degraded,
    projectionSource,
    reasons: Object.freeze(reasons),
  });
}

function summarizeProjectionSources(sources: readonly ReconstructionProjectionSource[]): ReconstructionProjectionSource {
  if (sources.includes('progress')) {
    return 'progress';
  }

  if (sources.includes('world_position')) {
    return 'world_position';
  }

  if (sources.includes('attached')) {
    return 'attached';
  }

  return 'missing';
}

function buildSceneNotes(anchorEvidence: ReconstructionEvidence, cars: readonly IncidentSceneCar[]): readonly string[] {
  const notes: string[] = [];

  if (anchorEvidence.state === 'missing') {
    notes.push('Scene anchor could not be reprojected from persisted incident data');
  }

  if (cars.some((car) => car.evidence.state === 'missing')) {
    notes.push('One or more involved cars have missing local placements');
  }

  if (cars.some((car) => car.evidence.projectionSource === 'world_position')) {
    notes.push('World-position reprojection fallback was required for part of the scene');
  }

  return Object.freeze(notes);
}

function resolveSnapshotTrackContext(
  snapshot: PersistedLiveIncidentSnapshot,
  trackContextInput?: ReconstructionTrackContextInput,
): ResolvedPlacementContext | null {
  return resolveVerdictTrackContext({
    carId: snapshot.carId,
    pos: snapshot.pos,
    velocity: snapshot.velocity,
    speedKmh: snapshot.speedKmh,
    normalizedSplinePos: snapshot.normalizedSplinePos,
  }, trackContextInput);
}

function buildMissingContextReasons(
  trackContextInput: ReconstructionTrackContextInput | undefined,
  snapshot: PersistedLiveIncidentSnapshot | null,
): string[] {
  const reasons: string[] = [];

  if (!trackContextInput) {
    reasons.push('Track identity mismatch prevented reprojection');
  }

  if (!snapshot) {
    reasons.push('No anchor snapshot resolved from persisted incident telemetry');
    return reasons;
  }

  if (snapshot.normalizedSplinePos == null || !Number.isFinite(snapshot.normalizedSplinePos)) {
    reasons.push('Normalized spline position was unavailable for reprojection');
  }

  if (!hasFiniteVector(snapshot.pos)) {
    reasons.push('World position was unavailable for reprojection fallback');
  }

  if (reasons.length === 0) {
    reasons.push('Snapshot reprojection could not be resolved safely');
  }

  return reasons;
}

function buildWorldFallbackReasons(snapshot: PersistedLiveIncidentSnapshot): string[] {
  const reasons = ['World-position reprojection fallback was used'];
  if (snapshot.normalizedSplinePos == null || !Number.isFinite(snapshot.normalizedSplinePos)) {
    reasons.push('Normalized spline position was unavailable for a stronger projection source');
  }
  return reasons;
}

function hasFiniteVector(vector: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function subtractVectors(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function dotProduct(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function normalizeVector(vector: { x: number; y: number; z: number }) {
  const magnitude = Math.sqrt(dotProduct(vector, vector));
  if (magnitude <= 0.0001) {
    return { x: 1, y: 0, z: 0 };
  }

  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function resolveLateralAxis(
  leftEdge: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  forwardAxis: { x: number; y: number; z: number },
) {
  const edgeDirection = subtractVectors(leftEdge, center);
  const magnitude = Math.sqrt(dotProduct(edgeDirection, edgeDirection));
  if (magnitude > 0.0001) {
    return normalizeVector(edgeDirection);
  }

  return normalizeVector({
    x: -forwardAxis.z,
    y: 0,
    z: forwardAxis.x,
  });
}
