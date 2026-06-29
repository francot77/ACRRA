import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { TrackRuntimeModel, TrackRuntimePoint, TrackVector3 } from './trackTypes';

const trackModelPointSchema = z.object({
  index: z.number().int(),
  s: z.number(),
  normalized: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  forwardX: z.number(),
  forwardY: z.number(),
  forwardZ: z.number(),
  sideLeft: z.number(),
  sideRight: z.number(),
  width: z.number(),
  leftX: z.number(),
  leftY: z.number(),
  leftZ: z.number(),
  rightX: z.number(),
  rightY: z.number(),
  rightZ: z.number(),
}).passthrough();

const trackModelSchema = z.object({
  schemaVersion: z.number().int(),
  track: z.string(),
  layout: z.string().nullable(),
  totalLengthMeters: z.number(),
  pointCount: z.number().int(),
  points: z.array(trackModelPointSchema),
}).passthrough();

export function loadTrackModelRuntime(input: {
  modelPath: string;
  expectedTrack: string;
  expectedLayout: string | null;
}): TrackRuntimeModel {
  const raw = readFileSync(resolve(input.modelPath), 'utf8');
  const runtime = parseTrackModelRuntime(JSON.parse(raw));

  if (runtime.track !== input.expectedTrack || runtime.layout !== input.expectedLayout) {
    throw new Error(
      `Configured track model identity mismatch: expected ${formatIdentity(input.expectedTrack, input.expectedLayout)}, got ${formatIdentity(runtime.track, runtime.layout)}`
    );
  }

  return runtime;
}

export function parseTrackModelRuntime(input: unknown): TrackRuntimeModel {
  const parsed = trackModelSchema.parse(input);
  const points = Object.freeze(parsed.points.map(toTrackRuntimePoint));

  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    track: parsed.track,
    layout: parsed.layout,
    totalLengthMeters: parsed.totalLengthMeters,
    pointCount: parsed.pointCount,
    points,
  });
}

function toTrackRuntimePoint(point: z.infer<typeof trackModelPointSchema>): TrackRuntimePoint {
  return Object.freeze({
    index: point.index,
    s: point.s,
    normalized: point.normalized,
    center: freezeVector(point.x, point.y, point.z),
    forward: freezeVector(point.forwardX, point.forwardY, point.forwardZ),
    sideLeft: point.sideLeft,
    sideRight: point.sideRight,
    width: point.width,
    leftEdge: freezeVector(point.leftX, point.leftY, point.leftZ),
    rightEdge: freezeVector(point.rightX, point.rightY, point.rightZ),
  });
}

function freezeVector(x: number, y: number, z: number): TrackVector3 {
  return Object.freeze({ x, y, z });
}

function formatIdentity(track: string, layout: string | null): string {
  return layout === null ? `${track}/<default>` : `${track}/${layout}`;
}
