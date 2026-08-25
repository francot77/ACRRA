import assert from 'node:assert/strict';
import test from 'node:test';
import { TrackQueryService } from '../../src/track/trackQueryService';
import type { TrackRuntimeModel } from '../../src/track/trackTypes';

test('track query service normalizes blank default-layout identities', () => {
  const service = new TrackQueryService(createRuntime([
    createPoint({ index: 0, normalized: 0 }),
  ]));

  assert.equal(service.resolveTrack({ trackName: 'monza', trackConfig: '' }), true);
  assert.equal(service.resolveTrack({ trackName: 'monza', trackConfig: '   ' }), true);
  assert.equal(service.resolveTrack({ trackName: 'monza', trackConfig: null }), true);
  assert.equal(service.resolveTrack({ trackName: 'monza', trackConfig: 'gp' }), false);
});

test('track query service uses the lower point index for equal progress distance ties', () => {
  const service = new TrackQueryService(createRuntime([
    createPoint({ index: 8, normalized: 0.4 }),
    createPoint({ index: 3, normalized: 0.6 }),
  ]));

  const projection = service.projectByProgress(0.5);

  assert.equal(projection.index, 3);
  assert.equal(projection.source, 'progress');
});

test('track query service uses the lower point index for equal world position distance ties', () => {
  const service = new TrackQueryService(createRuntime([
    createPoint({ index: 11, center: { x: -1, y: 0, z: 0 } }),
    createPoint({ index: 5, center: { x: 1, y: 0, z: 0 } }),
  ]));

  const projection = service.projectByWorldPosition({ x: 0, y: 0, z: 0 });

  assert.equal(projection.index, 5);
  assert.equal(projection.source, 'world_position');
});

test('track query service resolves neighboring points with wraparound', () => {
  const service = new TrackQueryService(createRuntime([
    createPoint({ index: 10, normalized: 0.1 }),
    createPoint({ index: 20, normalized: 0.2 }),
    createPoint({ index: 30, normalized: 0.3 }),
  ]));

  const neighbors = service.getNeighboringPoints(10);

  assert.equal(neighbors.previous.index, 30);
  assert.equal(neighbors.current.index, 10);
  assert.equal(neighbors.next.index, 20);
});

function createRuntime(points: TrackRuntimeModel['points']): TrackRuntimeModel {
  return Object.freeze({
    schemaVersion: 1,
    track: 'monza',
    layout: null,
    totalLengthMeters: 5757.195801,
    pointCount: points.length,
    points: Object.freeze([...points]),
  });
}

function createPoint(overrides: Partial<TrackRuntimeModel['points'][number]> = {}): TrackRuntimeModel['points'][number] {
  return Object.freeze({
    index: overrides.index ?? 0,
    s: overrides.s ?? 0,
    normalized: overrides.normalized ?? 0,
    center: Object.freeze(overrides.center ?? { x: 0, y: 0, z: 0 }),
    forward: Object.freeze(overrides.forward ?? { x: 1, y: 0, z: 0 }),
    sideLeft: overrides.sideLeft ?? 4,
    sideRight: overrides.sideRight ?? 4,
    width: overrides.width ?? 8,
    leftEdge: Object.freeze(overrides.leftEdge ?? { x: -4, y: 0, z: 0 }),
    rightEdge: Object.freeze(overrides.rightEdge ?? { x: 4, y: 0, z: 0 }),
  });
}
