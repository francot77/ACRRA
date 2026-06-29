import assert from 'node:assert/strict';
import test from 'node:test';
import { PersistedLiveIncident, PersistedLiveIncidentSnapshot } from '../../src/db/repositories';
import { analyzeIncidentVerdict } from '../../src/incidents/analyzeIncidentVerdict';
import type { VerdictTrackContextInput } from '../../src/incidents/incidentVerdictGeometry';
import { TrackQueryService } from '../../src/track/trackQueryService';
import type { TrackRuntimeModel, TrackContextEnrichment } from '../../src/track/trackTypes';

test('classifies a likely rear-end from pre-impact gap and closing speed', () => {
  const verdict = analyzeIncidentVerdict(
    createIncident({
      carId: 7,
      otherCarId: 8,
      snapshots: [
        createSnapshot({ carId: 7, relativeMs: -120, normalizedSplinePos: 0.205, speedKmh: 102 }),
        createSnapshot({ carId: 8, relativeMs: -110, normalizedSplinePos: 0.202, speedKmh: 131 }),
      ],
    })
  );

  assert.equal(verdict.type, 'possible_rear_end');
  assert.equal(verdict.blamedCarId, 8);
  assert.match(verdict.explanation.join(' '), /behind car 7/i);
});

test('classifies similar-pace overlap as racing incident', () => {
  const verdict = analyzeIncidentVerdict(
    createIncident({
      carId: 4,
      otherCarId: 9,
      snapshots: [
        createSnapshot({ carId: 4, relativeMs: -90, normalizedSplinePos: 0.411, speedKmh: 118 }),
        createSnapshot({ carId: 9, relativeMs: -70, normalizedSplinePos: 0.409, speedKmh: 113 }),
      ],
    })
  );

  assert.equal(verdict.type, 'racing_incident');
  assert.equal(verdict.blamedCarId, undefined);
});

test('keeps legacy rear-end fallback when bounded geometry is unavailable', () => {
  const verdict = analyzeIncidentVerdict(
    createIncident({
      carId: 7,
      otherCarId: 8,
      snapshots: [
        createSnapshot({ carId: 7, relativeMs: -120, normalizedSplinePos: 0.205, speedKmh: 102 }),
        createSnapshot({ carId: 8, relativeMs: -110, normalizedSplinePos: 0.202, speedKmh: 131 }),
      ],
    }),
    createVerdictTrackInput({ trackName: 'spa' })
  );

  assert.equal(verdict.type, 'possible_rear_end');
  assert.equal(verdict.blamedCarId, 8);
});

test('classifies inside overlap with no remaining corridor as possible squeeze', () => {
  const verdictTrackInput = createVerdictTrackInput();
  const primaryTrackContext = verdictTrackInput.queryService.projectByProgress(0);
  const secondaryTrackContext = verdictTrackInput.queryService.projectByProgress(0);
  const verdict = analyzeIncidentVerdict(
    createIncident({
      carId: 7,
      otherCarId: 8,
      snapshots: [
        createSnapshot({
          carId: 7,
          relativeMs: -80,
          pos: { x: 1, y: 0, z: 4.1 },
          velocity: { x: 29, y: 0, z: 0 },
          speedKmh: 104,
          trackContext: primaryTrackContext,
        }),
        createSnapshot({
          carId: 8,
          relativeMs: -70,
          pos: { x: 2.3, y: 0, z: 2.6 },
          velocity: { x: 28, y: 0, z: 0 },
          speedKmh: 101,
          trackContext: secondaryTrackContext,
        }),
      ],
    }),
    verdictTrackInput
  );

  assert.equal(verdict.type, 'possible_squeeze');
  assert.equal(verdict.blamedCarId, 8);
  assert.match(verdict.explanation.join(' '), /inside overlap/i);
});

test('classifies late inside arrival as possible divebomb', () => {
  const verdictTrackInput = createVerdictTrackInput();
  const trackContext = verdictTrackInput.queryService.projectByProgress(0);
  const verdict = analyzeIncidentVerdict(
    createIncident({
      carId: 7,
      otherCarId: 8,
      snapshots: [
        createSnapshot({
          carId: 7,
          relativeMs: -60,
          pos: { x: 0.8, y: 0, z: 3.2 },
          velocity: { x: 36, y: 0, z: 0 },
          speedKmh: 129.6,
          trackContext,
        }),
        createSnapshot({
          carId: 8,
          relativeMs: -40,
          pos: { x: 3.6, y: 0, z: 1.8 },
          velocity: { x: 26, y: 0, z: 0 },
          speedKmh: 93.6,
          trackContext,
        }),
      ],
    }),
    verdictTrackInput
  );

  assert.equal(verdict.type, 'possible_divebomb');
  assert.equal(verdict.blamedCarId, 7);
  assert.match(verdict.explanation.join(' '), /arrived from behind on the inside/i);
});

test('downgrades decisive blame when spline progress contradicts local geometry', () => {
  const verdictTrackInput = createVerdictTrackInput();
  const primaryTrackContext = verdictTrackInput.queryService.projectByProgress(0.5);
  const secondaryTrackContext = verdictTrackInput.queryService.projectByProgress(0);
  const verdict = analyzeIncidentVerdict(
    createIncident({
      carId: 7,
      otherCarId: 8,
      snapshots: [
        createSnapshot({
          carId: 7,
          relativeMs: -80,
          pos: { x: 0, y: 0, z: 0 },
          velocity: { x: 20, y: 0, z: 0 },
          speedKmh: 72,
          normalizedSplinePos: 0.22,
          trackContext: primaryTrackContext,
        }),
        createSnapshot({
          carId: 8,
          relativeMs: -70,
          pos: { x: 4, y: 0, z: 0 },
          velocity: { x: 10, y: 0, z: 0 },
          speedKmh: 36,
          normalizedSplinePos: 0.20,
          trackContext: secondaryTrackContext,
        }),
      ],
    }),
    verdictTrackInput
  );

  assert.equal(verdict.type, 'unknown');
  assert.ok(verdict.confidence < 0.4);
  assert.match(verdict.explanation.join(' '), /contradict/i);
});

test('reprojects nullable-safe world-position telemetry through the verdict engine', () => {
  const verdict = analyzeIncidentVerdict(
    createIncident({
      carId: 7,
      otherCarId: 8,
      snapshots: [
        createSnapshot({
          carId: 7,
          relativeMs: -90,
          pos: { x: 0.5, y: 0, z: 0 },
          velocity: { x: 30, y: 0, z: 0 },
          speedKmh: 108,
          normalizedSplinePos: null,
        }),
        createSnapshot({
          carId: 8,
          relativeMs: -70,
          pos: { x: 4.5, y: 0, z: 0.1 },
          velocity: { x: 20, y: 0, z: 0 },
          speedKmh: 72,
          normalizedSplinePos: null,
        }),
      ],
    }),
    createVerdictTrackInput()
  );

  assert.equal(verdict.type, 'possible_rear_end');
  assert.equal(verdict.blamedCarId, 7);
  assert.match(verdict.explanation.join(' '), /local track frame/i);
});

test('returns unknown when snapshots are missing', () => {
  const verdict = analyzeIncidentVerdict(createIncident({ snapshots: [] }));

  assert.equal(verdict.type, 'unknown');
  assert.match(verdict.explanation[0] ?? '', /missing pre-impact snapshots/i);
});

test('classifies environment collisions without involving safety logic', () => {
  const verdict = analyzeIncidentVerdict(createIncident({ type: 'collision_with_env', otherCarId: null, snapshots: [createSnapshot({ carId: 7, relativeMs: -50 })] }));

  assert.equal(verdict.type, 'environment_crash');
  assert.equal(verdict.blamedCarId, 7);
});

test('returns unknown when no snapshots exist even for environment contact', () => {
  const verdict = analyzeIncidentVerdict(createIncident({ type: 'collision_with_env', otherCarId: null, snapshots: [] }));

  assert.equal(verdict.type, 'unknown');
  assert.match(verdict.explanation[0] ?? '', /no snapshot telemetry/i);
});

function createIncident(overrides: Partial<PersistedLiveIncident> = {}): PersistedLiveIncident {
  return {
    id: overrides.id ?? 1,
    incidentUid: overrides.incidentUid ?? 'incident-1',
    raceId: overrides.raceId ?? null,
    type: overrides.type ?? 'collision_with_car',
    carId: overrides.carId ?? 7,
    otherCarId: overrides.otherCarId ?? 8,
    impactSpeed: overrides.impactSpeed ?? 60,
    worldPosition: overrides.worldPosition ?? { x: 0, y: 0, z: 0 },
    relativePosition: overrides.relativePosition ?? { x: 0, y: 0, z: 0 },
    createdAt: overrides.createdAt ?? '2026-06-23T00:00:00.000Z',
    firstReceivedAt: overrides.firstReceivedAt ?? '2026-06-23T00:00:00.000Z',
    lastReceivedAt: overrides.lastReceivedAt ?? '2026-06-23T00:00:01.000Z',
    captureStartMs: overrides.captureStartMs ?? -3000,
    captureEndMs: overrides.captureEndMs ?? 1500,
    matched: overrides.matched ?? false,
    matchedAt: overrides.matchedAt ?? null,
    verdictType: overrides.verdictType ?? null,
    verdictConfidence: overrides.verdictConfidence ?? null,
    verdictBlamedCarId: overrides.verdictBlamedCarId ?? null,
    verdictExplanation: overrides.verdictExplanation ?? [],
    snapshots: overrides.snapshots ?? [],
  };
}

type SnapshotOverride = Partial<PersistedLiveIncidentSnapshot> & {
  trackContext?: TrackContextEnrichment | null;
};

function createSnapshot(overrides: SnapshotOverride = {}): PersistedLiveIncidentSnapshot & { trackContext?: TrackContextEnrichment | null } {
  return {
    id: overrides.id ?? 1,
    incidentId: overrides.incidentId ?? 1,
    relativeMs: overrides.relativeMs ?? -100,
    carId: overrides.carId ?? 7,
    snapshotReceivedAt: overrides.snapshotReceivedAt ?? '2026-06-23T00:00:00.000Z',
    pos: overrides.pos ?? { x: 0, y: 0, z: 0 },
    velocity: overrides.velocity ?? { x: 0, y: 0, z: 0 },
    speedKmh: overrides.speedKmh ?? 100,
    gear: overrides.gear ?? 4,
    engineRpm: overrides.engineRpm ?? 6200,
    normalizedSplinePos: overrides.normalizedSplinePos ?? 0.2,
    trackContext: overrides.trackContext,
  };
}

function createVerdictTrackInput(overrides: Partial<VerdictTrackContextInput['sessionTrackIdentity']> = {}): VerdictTrackContextInput {
  return {
    queryService: new TrackQueryService(createRuntime()),
    sessionTrackIdentity: {
      trackName: overrides.trackName ?? 'monza',
      trackConfig: overrides.trackConfig ?? null,
    },
  };
}

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
