import assert from 'node:assert/strict';
import test from 'node:test';
import { PersistedLiveIncident } from '../../src/db/repositories';
import { extractRaceCollisionEvents, matchLiveIncidentsToRaceEvents } from '../../src/live/matchLiveIncidents';
import { ParsedRace } from '../../src/types/assetto';

const thresholds = {
  maxDistanceM: 30,
  maxImpactDiffKmh: 35,
};

test('matches car-car incidents by unordered car ids plus distance and impact thresholds', () => {
  const result = matchLiveIncidentsToRaceEvents(
    [createLiveIncident({ id: 1, type: 'collision_with_car', carId: 8, otherCarId: 4, impactSpeed: 76, worldPosition: { x: 105, y: 5, z: -10 } })],
    extractRaceCollisionEvents(createRace({
      events: [
        createCarEvent({ index: 10, carId: 4, otherCarId: 8, impactSpeed: 72, worldPosition: { X: 100, Y: 5, Z: -20 } })
      ]
    })),
    thresholds
  );

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]?.liveIncidentId, 1);
  assert.equal(result.matched[0]?.jsonEventIndex, 10);
  assert.equal(result.liveOnly.length, 0);
  assert.equal(result.jsonOnly.length, 0);
});

test('matches env incidents by car id plus distance and impact thresholds', () => {
  const result = matchLiveIncidentsToRaceEvents(
    [createLiveIncident({ id: 2, type: 'collision_with_env', carId: 9, impactSpeed: 50, worldPosition: { x: -10, y: 1, z: 70 } })],
    extractRaceCollisionEvents(createRace({
      events: [
        createEnvEvent({ index: 22, carId: 9, impactSpeed: 60, worldPosition: { X: -5, Y: 1, Z: 60 } })
      ]
    })),
    thresholds
  );

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]?.liveIncidentId, 2);
  assert.equal(result.matched[0]?.jsonEventIndex, 22);
});

test('does not match when distance or impact exceed thresholds', () => {
  const tooFar = matchLiveIncidentsToRaceEvents(
    [createLiveIncident({ id: 3, type: 'collision_with_env', carId: 9, impactSpeed: 50, worldPosition: { x: 100, y: 0, z: 100 } })],
    extractRaceCollisionEvents(createRace({
      events: [createEnvEvent({ index: 30, carId: 9, impactSpeed: 55, worldPosition: { X: 0, Y: 0, Z: 0 } })]
    })),
    thresholds
  );
  const tooFast = matchLiveIncidentsToRaceEvents(
    [createLiveIncident({ id: 4, type: 'collision_with_car', carId: 4, otherCarId: 8, impactSpeed: 120, worldPosition: { x: 10, y: 0, z: 10 } })],
    extractRaceCollisionEvents(createRace({
      events: [createCarEvent({ index: 31, carId: 4, otherCarId: 8, impactSpeed: 40, worldPosition: { X: 12, Y: 0, Z: 12 } })]
    })),
    thresholds
  );

  assert.equal(tooFar.matched.length, 0);
  assert.equal(tooFar.liveOnly.length, 1);
  assert.equal(tooFar.jsonOnly.length, 1);
  assert.ok(tooFar.unmatched.some((entry) => entry.reasons.includes('distance_exceeded')));

  assert.equal(tooFast.matched.length, 0);
  assert.equal(tooFast.liveOnly.length, 1);
  assert.equal(tooFast.jsonOnly.length, 1);
  assert.ok(tooFast.unmatched.some((entry) => entry.reasons.includes('impact_exceeded')));
});

function createRace(overrides: Partial<ParsedRace> = {}): ParsedRace {
  return {
    sourceFileName: 'test-race.json',
    trackName: 'monza',
    trackConfig: '',
    type: 'RACE',
    raceLaps: 3,
    carModel: 'gt3',
    drivers: [],
    lapsByCarId: new Map(),
    events: overrides.events ?? [],
  };
}

function createCarEvent(input: { index: number; carId: number; otherCarId: number; impactSpeed: number; worldPosition: { X: number; Y: number; Z: number } }) {
  return {
    index: input.index,
    type: 'COLLISION_WITH_CAR' as const,
    carId: input.carId,
    otherCarId: input.otherCarId,
    driverIdentity: { kind: 'guid' as const, value: `guid:${input.carId}` },
    otherDriverIdentity: { kind: 'guid' as const, value: `guid:${input.otherCarId}` },
    driverName: `Driver ${input.carId}`,
    otherDriverName: `Driver ${input.otherCarId}`,
    impactSpeed: input.impactSpeed,
    worldPosition: input.worldPosition,
  };
}

function createEnvEvent(input: { index: number; carId: number; impactSpeed: number; worldPosition: { X: number; Y: number; Z: number } }) {
  return {
    index: input.index,
    type: 'COLLISION_WITH_ENV' as const,
    carId: input.carId,
    driverIdentity: { kind: 'guid' as const, value: `guid:${input.carId}` },
    driverName: `Driver ${input.carId}`,
    impactSpeed: input.impactSpeed,
    worldPosition: input.worldPosition,
  };
}

function createLiveIncident(overrides: Partial<PersistedLiveIncident> & Pick<PersistedLiveIncident, 'id' | 'type' | 'carId' | 'impactSpeed' | 'worldPosition'>): PersistedLiveIncident {
  return {
    id: overrides.id,
    incidentUid: overrides.incidentUid ?? `incident-${overrides.id}`,
    raceId: overrides.raceId ?? null,
    type: overrides.type,
    carId: overrides.carId,
    otherCarId: overrides.otherCarId ?? null,
    impactSpeed: overrides.impactSpeed,
    worldPosition: overrides.worldPosition,
    relativePosition: overrides.relativePosition ?? null,
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
