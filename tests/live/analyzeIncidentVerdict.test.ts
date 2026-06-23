import assert from 'node:assert/strict';
import test from 'node:test';
import { PersistedLiveIncident, PersistedLiveIncidentSnapshot } from '../../src/db/repositories';
import { analyzeIncidentVerdict } from '../../src/incidents/analyzeIncidentVerdict';

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

test('returns unknown when snapshots are missing', () => {
  const verdict = analyzeIncidentVerdict(createIncident({ snapshots: [] }));

  assert.equal(verdict.type, 'unknown');
  assert.match(verdict.explanation[0] ?? '', /missing pre-impact snapshots/i);
});

test('classifies environment collisions without involving safety logic', () => {
  const verdict = analyzeIncidentVerdict(createIncident({ type: 'collision_with_env', otherCarId: null, snapshots: [] }));

  assert.equal(verdict.type, 'environment_crash');
  assert.equal(verdict.blamedCarId, 7);
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

function createSnapshot(overrides: Partial<PersistedLiveIncidentSnapshot> = {}): PersistedLiveIncidentSnapshot {
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
  };
}
