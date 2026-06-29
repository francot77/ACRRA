import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIncidentReconstruction } from '../../src/reconstruction/buildIncidentReconstruction';
import { TrackQueryService } from '../../src/track/trackQueryService';
import type { PersistedLiveIncident, PersistedLiveIncidentSnapshot } from '../../src/db/repositories';
import type { TrackRuntimeModel } from '../../src/track/trackTypes';

test('buildIncidentReconstruction assembles a bounded local scene with involved and context cars', () => {
  const service = new TrackQueryService(createRuntime());
  const scene = buildIncidentReconstruction({
    incident: createIncident([
      createSnapshot({ id: 1, carId: 7, relativeMs: 0, pos: { x: 0, y: 0, z: 0 }, normalizedSplinePos: 0 }),
      createSnapshot({ id: 2, carId: 7, relativeMs: 90, pos: { x: 8, y: 0, z: 0.5 }, normalizedSplinePos: 0.02 }),
      createSnapshot({ id: 3, carId: 8, relativeMs: -40, pos: { x: 6, y: 0, z: -2 }, normalizedSplinePos: null }),
      createSnapshot({ id: 4, carId: 8, relativeMs: 110, pos: { x: 10, y: 0, z: -1.5 }, normalizedSplinePos: null }),
      createSnapshot({ id: 5, carId: 99, relativeMs: 20, pos: { x: 12, y: 0, z: 3 }, normalizedSplinePos: 0.03 }),
      createSnapshot({ id: 6, carId: 100, relativeMs: 20, pos: { x: 80, y: 0, z: 1 }, normalizedSplinePos: 0.8 }),
    ]),
    trackContextInput: {
      queryService: service,
      sessionTrackIdentity: { trackName: 'monza', trackConfig: null },
    },
  });

  assert.equal(scene.anchorCarId, 7);
  assert.equal(scene.anchorRelativeMs, 0);
  assert.equal(scene.corridor.anchorIndex, 0);
  assert.ok(scene.corridor.trackPath.length >= 2);
  assert.equal(scene.cars.map((car) => car.carId).join(','), '7,8,99');

  const fallbackCar = scene.cars.find((car) => car.carId === 8);
  assert.ok(fallbackCar);
  assert.equal(fallbackCar?.evidence.degraded, true);
  assert.equal(fallbackCar?.placements[0]?.evidence.projectionSource, 'world_position');

  const contextCar = scene.cars.find((car) => car.carId === 99);
  assert.ok(contextCar);
  assert.equal(contextCar?.role, 'context');
  assert.ok((contextCar?.placements[0]?.forwardM ?? 0) > 0);

  assert.equal(scene.degraded, true);
  assert.ok(scene.notes.includes('World-position reprojection fallback was required for part of the scene'));
});

test('buildIncidentReconstruction stays null-safe when anchor reprojection cannot be resolved', () => {
  const service = new TrackQueryService(createRuntime());

  const scene = buildIncidentReconstruction({
    incident: createIncident([
      createSnapshot({
        id: 10,
        carId: 7,
        relativeMs: 0,
        pos: { x: Number.NaN, y: 0, z: 0 },
        normalizedSplinePos: null,
      }),
    ]),
    trackContextInput: {
      queryService: service,
      sessionTrackIdentity: { trackName: 'spa', trackConfig: null },
    },
  });

  assert.equal(scene.anchorEvidence.state, 'missing');
  assert.equal(scene.corridor.anchorIndex, null);
  assert.equal(scene.corridor.trackPath.length, 0);
  assert.equal(scene.cars.length, 2);

  const primaryCar = scene.cars.find((car) => car.carId === 7);
  assert.ok(primaryCar);
  assert.equal(primaryCar?.placements[0]?.forwardM, null);
  assert.equal(primaryCar?.placements[0]?.lateralM, null);
  assert.equal(primaryCar?.placements[0]?.evidence.state, 'missing');
  assert.ok(scene.notes.includes('Scene anchor could not be reprojected from persisted incident data'));
});

function createIncident(snapshots: PersistedLiveIncidentSnapshot[]): PersistedLiveIncident {
  return {
    id: 1,
    incidentUid: 'incident-1',
    raceId: 99,
    type: 'collision_with_car',
    carId: 7,
    otherCarId: 8,
    impactSpeed: 80,
    worldPosition: { x: 0, y: 0, z: 0 },
    relativePosition: { x: 0, y: 0, z: 0 },
    createdAt: '2026-06-29T00:00:00.000Z',
    firstReceivedAt: '2026-06-29T00:00:00.000Z',
    lastReceivedAt: '2026-06-29T00:00:00.200Z',
    captureStartMs: -3000,
    captureEndMs: 1500,
    matched: true,
    matchedAt: '2026-06-29T00:00:01.000Z',
    verdictType: 'possible_rear_end',
    verdictConfidence: 0.7,
    verdictBlamedCarId: 7,
    verdictExplanation: [],
    snapshots,
  };
}

function createSnapshot(overrides: Partial<PersistedLiveIncidentSnapshot> & Pick<PersistedLiveIncidentSnapshot, 'id' | 'carId' | 'relativeMs' | 'pos'>): PersistedLiveIncidentSnapshot {
  return {
    id: overrides.id,
    incidentId: overrides.incidentId ?? 1,
    relativeMs: overrides.relativeMs,
    carId: overrides.carId,
    snapshotReceivedAt: overrides.snapshotReceivedAt ?? '2026-06-29T00:00:00.000Z',
    pos: overrides.pos,
    velocity: overrides.velocity ?? { x: 1, y: 0, z: 0 },
    speedKmh: overrides.speedKmh ?? 100,
    gear: overrides.gear ?? 4,
    engineRpm: overrides.engineRpm ?? 6000,
    normalizedSplinePos: overrides.normalizedSplinePos ?? null,
  };
}

function createRuntime(): TrackRuntimeModel {
  return Object.freeze({
    schemaVersion: 1,
    track: 'monza',
    layout: null,
    totalLengthMeters: 1000,
    pointCount: 4,
    points: Object.freeze([
      createPoint({ index: 0, normalized: 0, center: { x: 0, y: 0, z: 0 }, leftEdge: { x: 0, y: 0, z: 5 }, rightEdge: { x: 0, y: 0, z: -5 } }),
      createPoint({ index: 1, normalized: 0.25, center: { x: 10, y: 0, z: 0 }, leftEdge: { x: 10, y: 0, z: 5 }, rightEdge: { x: 10, y: 0, z: -5 } }),
      createPoint({ index: 2, normalized: 0.5, center: { x: 20, y: 0, z: 4 }, leftEdge: { x: 20, y: 0, z: 9 }, rightEdge: { x: 20, y: 0, z: -1 } }),
      createPoint({ index: 3, normalized: 0.75, center: { x: 30, y: 0, z: 8 }, leftEdge: { x: 30, y: 0, z: 13 }, rightEdge: { x: 30, y: 0, z: 3 } }),
    ]),
  });
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
