import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveIncidentVerdictGeometry,
  resolveVerdictTrackContext,
  type VerdictGeometrySnapshotInput,
} from '../../src/incidents/incidentVerdictGeometry';
import { TrackQueryService } from '../../src/track/trackQueryService';
import type { TrackRuntimeModel } from '../../src/track/trackTypes';

test('incident verdict geometry derives shared projections from attached track context', () => {
  const service = new TrackQueryService(createRuntime());
  const primary = createSnapshot({
    carId: 10,
    pos: { x: 1, y: 0, z: 0 },
    velocity: { x: 20, y: 0, z: 0 },
    trackContext: service.projectByProgress(0),
  });
  const secondary = createSnapshot({
    carId: 22,
    pos: { x: 3, y: 0, z: 2 },
    velocity: { x: 15, y: 0, z: 1 },
    trackContext: service.projectByProgress(0),
  });

  const geometry = deriveIncidentVerdictGeometry({
    primary,
    secondary,
    trackContextInput: {
      queryService: service,
      sessionTrackIdentity: { trackName: 'monza', trackConfig: null },
    },
  });

  assert.ok(geometry);
  assert.equal(geometry?.frame.turnSide, 'left');
  assert.equal(geometry?.primary.localPosition.forwardM, 1);
  assert.equal(geometry?.secondary.localPosition.forwardM, 3);
  assert.equal(geometry?.primary.localPosition.lateralM, 0);
  assert.equal(geometry?.secondary.localPosition.lateralM, 2);
  assert.equal(geometry?.pair.forwardDeltaM, 2);
  assert.equal(geometry?.pair.lateralDeltaM, 2);
  assert.equal(geometry?.pair.closingDeltaKmh, 18);
  assert.equal(geometry?.pair.mixedProjectionSources, false);
  assert.equal(geometry?.primary.distanceToLeftEdgeM, 5);
  assert.equal(geometry?.secondary.distanceToRightEdgeM, 7);
});

test('incident verdict geometry reprojects persisted telemetry by progress when track context is absent', () => {
  const service = new TrackQueryService(createRuntime());
  const geometry = deriveIncidentVerdictGeometry({
    primary: createSnapshot({
      carId: 1,
      pos: { x: 0.8, y: 0, z: 0.1 },
      velocity: { x: 10, y: 0, z: 0 },
      normalizedSplinePos: 0.01,
    }),
    secondary: createSnapshot({
      carId: 2,
      pos: { x: 2.4, y: 0, z: 1.8 },
      velocity: { x: 8, y: 0, z: 0 },
      normalizedSplinePos: 0.02,
    }),
    trackContextInput: {
      queryService: service,
      sessionTrackIdentity: { trackName: 'monza', trackConfig: null },
    },
  });

  assert.ok(geometry);
  assert.equal(geometry?.primary.context.resolutionSource, 'progress');
  assert.equal(geometry?.secondary.context.resolutionSource, 'progress');
  assert.equal(geometry?.frame.anchorIndex, 0);
});

test('incident verdict geometry falls back to world-position reprojection and stays nullable-safe', () => {
  const service = new TrackQueryService(createRuntime());
  const trackContextInput = {
    queryService: service,
    sessionTrackIdentity: { trackName: 'monza', trackConfig: null },
  };

  const reprojected = resolveVerdictTrackContext(createSnapshot({
    carId: 5,
    pos: { x: 10.8, y: 0, z: 0.1 },
    velocity: { x: 0, y: 0, z: 0 },
    normalizedSplinePos: null,
  }), trackContextInput);

  assert.ok(reprojected);
  assert.equal(reprojected?.resolutionSource, 'world_position');
  assert.equal(reprojected?.trackContext.index, 1);

  const unresolved = resolveVerdictTrackContext(createSnapshot({
    carId: 6,
    pos: { x: Number.NaN, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    normalizedSplinePos: null,
  }), trackContextInput);

  assert.equal(unresolved, null);
});

function createRuntime(): TrackRuntimeModel {
  return Object.freeze({
    schemaVersion: 1,
    track: 'monza',
    layout: null,
    totalLengthMeters: 1000,
    pointCount: 3,
    points: Object.freeze([
      createPoint({
        index: 0,
        normalized: 0,
        center: { x: 0, y: 0, z: 0 },
        forward: { x: 1, y: 0, z: 0 },
        leftEdge: { x: 0, y: 0, z: 5 },
        rightEdge: { x: 0, y: 0, z: -5 },
      }),
      createPoint({
        index: 1,
        normalized: 0.5,
        center: { x: 10, y: 0, z: 0 },
        forward: { x: 1, y: 0, z: 0 },
        leftEdge: { x: 10, y: 0, z: 5 },
        rightEdge: { x: 10, y: 0, z: -5 },
      }),
      createPoint({
        index: 2,
        normalized: 0.75,
        center: { x: 20, y: 0, z: 5 },
        forward: { x: 1, y: 0, z: 0 },
        leftEdge: { x: 20, y: 0, z: 10 },
        rightEdge: { x: 20, y: 0, z: 0 },
      }),
    ]),
  });
}

function createSnapshot(overrides: Partial<VerdictGeometrySnapshotInput> & Pick<VerdictGeometrySnapshotInput, 'carId'>): VerdictGeometrySnapshotInput {
  return {
    carId: overrides.carId,
    pos: overrides.pos ?? { x: 0, y: 0, z: 0 },
    velocity: overrides.velocity ?? { x: 0, y: 0, z: 0 },
    speedKmh: overrides.speedKmh ?? 0,
    normalizedSplinePos: overrides.normalizedSplinePos,
    trackContext: overrides.trackContext,
  };
}

function createPoint(overrides: Partial<TrackRuntimeModel['points'][number]> = {}): TrackRuntimeModel['points'][number] {
  return Object.freeze({
    index: overrides.index ?? 0,
    s: overrides.s ?? 0,
    normalized: overrides.normalized ?? 0,
    center: Object.freeze(overrides.center ?? { x: 0, y: 0, z: 0 }),
    forward: Object.freeze(overrides.forward ?? { x: 1, y: 0, z: 0 }),
    sideLeft: overrides.sideLeft ?? 5,
    sideRight: overrides.sideRight ?? 5,
    width: overrides.width ?? 10,
    leftEdge: Object.freeze(overrides.leftEdge ?? { x: 0, y: 0, z: 5 }),
    rightEdge: Object.freeze(overrides.rightEdge ?? { x: 0, y: 0, z: -5 }),
  });
}
