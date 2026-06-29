import type { TrackContextEnrichment, TrackRuntimeModel, TrackRuntimePoint, TrackVector3 } from './trackTypes';

export type TrackIdentityInput = Readonly<{
  trackName: string;
  trackConfig: string | null;
}>;

export type TrackPointNeighbors = Readonly<{
  previous: TrackRuntimePoint;
  current: TrackRuntimePoint;
  next: TrackRuntimePoint;
}>;

export type TrackPointWindow = Readonly<{
  points: readonly TrackRuntimePoint[];
}>;

export class TrackQueryService {
  constructor(private readonly runtime: TrackRuntimeModel) {
    if (runtime.points.length === 0) {
      throw new Error('Track runtime must contain at least one point');
    }
  }

  resolveTrack(input: TrackIdentityInput): boolean {
    return this.runtime.track === input.trackName && this.runtime.layout === normalizeTrackConfig(input.trackConfig);
  }

  projectByProgress(normalizedSplinePos: number): TrackContextEnrichment {
    const normalizedQuery = normalizeProgress(normalizedSplinePos);
    const point = selectBestPoint(this.runtime.points, (candidate) => circularDistance(candidate.normalized, normalizedQuery));
    return toTrackContextEnrichment(this.runtime, point, 'progress');
  }

  projectByWorldPosition(position: TrackVector3): TrackContextEnrichment {
    const point = selectBestPoint(this.runtime.points, (candidate) => squaredDistance(candidate.center, position));
    return toTrackContextEnrichment(this.runtime, point, 'world_position');
  }

  getNeighboringPoints(index: number): TrackPointNeighbors {
    const pointIndex = this.runtime.points.findIndex((candidate) => candidate.index === index);

    if (pointIndex === -1) {
      throw new Error(`Track runtime point ${index} was not found`);
    }

    const previous = this.runtime.points[(pointIndex - 1 + this.runtime.points.length) % this.runtime.points.length];
    const current = this.runtime.points[pointIndex];
    const next = this.runtime.points[(pointIndex + 1) % this.runtime.points.length];

    if (!previous || !current || !next) {
      throw new Error(`Track runtime neighbors for point ${index} could not be resolved`);
    }

    return Object.freeze({ previous, current, next });
  }

  getPointsAround(index: number, backwardMeters: number, forwardMeters: number): TrackPointWindow {
    const pointIndex = this.runtime.points.findIndex((candidate) => candidate.index === index);

    if (pointIndex === -1) {
      throw new Error(`Track runtime point ${index} was not found`);
    }

    const selected = new Map<number, TrackRuntimePoint>();
    const anchor = this.runtime.points[pointIndex]!;
    selected.set(anchor.index, anchor);

    let traveled = 0;
    let cursor = pointIndex;
    while (traveled < backwardMeters) {
      const previousIndex = (cursor - 1 + this.runtime.points.length) % this.runtime.points.length;
      const current = this.runtime.points[cursor]!;
      const previous = this.runtime.points[previousIndex]!;
      traveled += distanceBetween(previous.center, current.center);
      selected.set(previous.index, previous);
      cursor = previousIndex;
      if (cursor === pointIndex) {
        break;
      }
    }

    traveled = 0;
    cursor = pointIndex;
    while (traveled < forwardMeters) {
      const nextIndex = (cursor + 1) % this.runtime.points.length;
      const current = this.runtime.points[cursor]!;
      const next = this.runtime.points[nextIndex]!;
      traveled += distanceBetween(current.center, next.center);
      selected.set(next.index, next);
      cursor = nextIndex;
      if (cursor === pointIndex) {
        break;
      }
    }

    const points = this.runtime.points.filter((point) => selected.has(point.index));
    return Object.freeze({ points: Object.freeze(points) });
  }
}

function normalizeTrackConfig(trackConfig: string | null): string | null {
  if (trackConfig === null) {
    return null;
  }

  const normalized = trackConfig.trim();
  return normalized === '' ? null : normalized;
}

function normalizeProgress(value: number): number {
  const normalized = value % 1;
  return normalized < 0 ? normalized + 1 : normalized;
}

function circularDistance(left: number, right: number): number {
  const directDistance = Math.abs(left - right);
  return Math.min(directDistance, 1 - directDistance);
}

function squaredDistance(left: TrackVector3, right: TrackVector3): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  const z = left.z - right.z;
  return (x * x) + (y * y) + (z * z);
}

function distanceBetween(left: TrackVector3, right: TrackVector3): number {
  return Math.sqrt(squaredDistance(left, right));
}

function selectBestPoint(
  points: readonly TrackRuntimePoint[],
  distance: (candidate: TrackRuntimePoint) => number
): TrackRuntimePoint {
  const [firstPoint, ...rest] = points;

  if (!firstPoint) {
    throw new Error('Track runtime must contain at least one point');
  }

  let bestPoint = firstPoint;
  let bestDistance = distance(firstPoint);

  for (const candidate of rest) {
    const candidateDistance = distance(candidate);
    if (candidateDistance < bestDistance) {
      bestPoint = candidate;
      bestDistance = candidateDistance;
      continue;
    }

    if (candidateDistance === bestDistance && candidate.index < bestPoint.index) {
      bestPoint = candidate;
      bestDistance = candidateDistance;
    }
  }

  return bestPoint;
}

function toTrackContextEnrichment(
  runtime: TrackRuntimeModel,
  point: TrackRuntimePoint,
  source: TrackContextEnrichment['source']
): TrackContextEnrichment {
  return Object.freeze({
    track: runtime.track,
    layout: runtime.layout,
    source,
    index: point.index,
    s: point.s,
    normalized: point.normalized,
    center: point.center,
    forward: point.forward,
    width: point.width,
    sideLeft: point.sideLeft,
    sideRight: point.sideRight,
    leftEdge: point.leftEdge,
    rightEdge: point.rightEdge,
  });
}
