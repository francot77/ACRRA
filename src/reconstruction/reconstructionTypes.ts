import type { TrackIdentityInput, TrackQueryService } from '../track/trackQueryService';
import type { TrackVector3 } from '../track/trackTypes';

export type ReconstructionEvidenceState = 'observed' | 'derived' | 'missing';

export type ReconstructionProjectionSource = 'attached' | 'progress' | 'world_position' | 'missing';

export type IncidentReconstructionDeliveryState = 'static_only' | 'sequence_ready' | 'omitted';

export type IncidentSceneCarRole = 'involved' | 'context';

export type IncidentSceneTurnSide = 'left' | 'right' | 'straight';

export type ReconstructionTrackContextInput = Readonly<{
  queryService: TrackQueryService;
  sessionTrackIdentity: TrackIdentityInput;
}>;

export type ReconstructionEvidence = Readonly<{
  state: ReconstructionEvidenceState;
  degraded: boolean;
  projectionSource: ReconstructionProjectionSource;
  reasons: readonly string[];
}>;

export type IncidentScenePlacement = Readonly<{
  snapshotId: number | null;
  relativeMs: number;
  forwardM: number | null;
  lateralM: number | null;
  speedKmh: number | null;
  trackIndex: number | null;
  evidence: ReconstructionEvidence;
}>;

export type IncidentSceneCar = Readonly<{
  carId: number;
  role: IncidentSceneCarRole;
  placements: readonly IncidentScenePlacement[];
  evidence: ReconstructionEvidence;
}>;

export type IncidentSceneCorridor = Readonly<{
  anchorIndex: number | null;
  anchorS: number | null;
  center: TrackVector3 | null;
  forwardRangeM: number;
  backwardRangeM: number;
  lateralHalfWidthM: number;
  widthM: number | null;
  turnSide: IncidentSceneTurnSide;
}>;

export type IncidentScene = Readonly<{
  incidentId: number;
  incidentUid: string;
  incidentType: 'collision_with_car' | 'collision_with_env';
  anchorCarId: number | null;
  anchorRelativeMs: number;
  anchorEvidence: ReconstructionEvidence;
  corridor: IncidentSceneCorridor;
  cars: readonly IncidentSceneCar[];
  notes: readonly string[];
  degraded: boolean;
}>;

export type IncidentSceneFrame = Readonly<{
  atRelativeMs: number;
  source: 'observed' | 'derived';
  cars: ReadonlyArray<{
    carId: number;
    forwardM: number;
    lateralM: number;
    evidence: ReconstructionEvidenceState;
  }>;
}>;

export type RenderedIncidentSvg = Readonly<{
  width: number;
  height: number;
  content: string;
}>;

export type IncidentVisualArtifacts = Readonly<{
  delivery: IncidentReconstructionDeliveryState;
  staticSvg?: {
    filename: string;
    contentType: 'image/svg+xml';
    bytes: Buffer;
  };
  frames: readonly IncidentSceneFrame[];
  notes: readonly string[];
}>;
