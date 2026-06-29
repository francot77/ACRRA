export type TrackVector3 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type TrackRuntimePoint = Readonly<{
  index: number;
  s: number;
  normalized: number;
  center: TrackVector3;
  forward: TrackVector3;
  sideLeft: number;
  sideRight: number;
  width: number;
  leftEdge: TrackVector3;
  rightEdge: TrackVector3;
}>;

export type TrackRuntimeModel = Readonly<{
  schemaVersion: number;
  track: string;
  layout: string | null;
  totalLengthMeters: number;
  pointCount: number;
  points: readonly TrackRuntimePoint[];
}>;

export type TrackProjectionSource = 'progress' | 'world_position';

export type TrackContextEnrichment = Readonly<{
  track: string;
  layout: string | null;
  source: TrackProjectionSource;
  index: number;
  s: number;
  normalized: number;
  center: TrackVector3;
  forward: TrackVector3;
  width: number;
  sideLeft: number;
  sideRight: number;
  leftEdge: TrackVector3;
  rightEdge: TrackVector3;
}>;
