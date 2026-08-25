import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRaceMessage, DISCORD_EVENT_BASIS_VERSION } from '../src/discord/buildRaceMessage';
import {
  applySafetyRatings,
  calculateRaceSafety,
  SAFETY_FORMULA_VERSION,
  SAFETY_V1_INPUTS,
  updateSafetyRating
} from '../src/parser/calculateSafety';
import { calculateDriverStats } from '../src/parser/calculateDriverStats';
import { groupIncidents } from '../src/parser/groupIncidents';
import { parseRaceJson } from '../src/parser/parseRaceJson';
import { DriverRaceStats, ParsedRace } from '../src/types/assetto';

test('safety-v1 exports the frozen formula identity and inputs', () => {
  assert.equal(SAFETY_FORMULA_VERSION, 'safety-v1');
  assert.deepEqual(SAFETY_V1_INPUTS, [
    'carIncidentsGrouped',
    'envHits',
    'totalCuts',
    'maxImpact',
    'destructiveDnf',
    'finished'
  ]);

  assert.equal(
    calculateRaceSafety({
      carIncidentsGrouped: 2,
      envHits: 1,
      totalCuts: 3,
      maxImpact: 130,
      destructiveDnf: false,
      finished: true
    }),
    43
  );
  assert.equal(updateSafetyRating(75.6, 27), 68.31);
});

test('safety-v1 preserves historical ratings and eligibility behavior', () => {
  const stats = [createStat({ guid: 'driver-1', oldSafetyRating: 91, newSafetyRating: 91 })];
  const result = applySafetyRatings(stats, { 'driver-1': 91 }, { minActiveDriversForSafety: 2 });

  assert.equal(result[0]?.raceScore, 100);
  assert.equal(result[0]?.oldSafetyRating, 91);
  assert.equal(result[0]?.newSafetyRating, 91);
  assert.equal(result[0]?.safetyChangeReason, 'not-eligible');
});

test('safety-v1 rejects incomplete or unsupported inputs instead of silently changing the score', () => {
  assert.throws(
    () => calculateRaceSafety({
      carIncidentsGrouped: 0,
      envHits: 0,
      totalCuts: 0,
      maxImpact: undefined as never,
      destructiveDnf: false,
      finished: true
    }),
    /incomplete input maxImpact/
  );

  assert.throws(
    () => calculateRaceSafety({
      carIncidentsGrouped: 0,
      envHits: 0,
      totalCuts: 0,
      maxImpact: 0,
      destructiveDnf: false,
      finished: 'yes' as never
    }),
    /unsupported input types/
  );
});

test('general Discord report derives incident counts from normalized JSON Events', () => {
  const race = parseRaceJson({
    TrackName: 'contract-track',
    TrackConfig: '',
    Type: 'RACE',
    DurationSecs: 600,
    RaceLaps: 2,
    Cars: [
      { CarId: 1, Driver: { Name: 'Alice', Team: 'A', Nation: 'AR', Guid: 'alice', GuidsList: [] }, Model: 'car', Skin: 'skin', BallastKG: 0, Restrictor: 0 },
      { CarId: 2, Driver: { Name: 'Bob', Team: 'B', Nation: 'AR', Guid: 'bob', GuidsList: [] }, Model: 'car', Skin: 'skin', BallastKG: 0, Restrictor: 0 }
    ],
    Result: [
      { DriverName: 'Alice', DriverGuid: 'alice', CarId: 1, CarModel: 'car', BestLap: 90000, TotalTime: 180000, BallastKG: 0, Restrictor: 0 },
      { DriverName: 'Bob', DriverGuid: 'bob', CarId: 2, CarModel: 'car', BestLap: 91000, TotalTime: 181000, BallastKG: 0, Restrictor: 0 }
    ],
    Laps: [],
    Events: [
      { Type: 'COLLISION_WITH_CAR', CarId: 1, OtherCarId: 2, Driver: { Name: 'Alice', Team: 'A', Nation: 'AR', Guid: 'alice', GuidsList: [] }, OtherDriver: { Name: 'Bob', Team: 'B', Nation: 'AR', Guid: 'bob', GuidsList: [] }, ImpactSpeed: 140 },
      { Type: 'COLLISION_WITH_CAR', CarId: 2, OtherCarId: 1, Driver: { Name: 'Bob', Team: 'B', Nation: 'AR', Guid: 'bob', GuidsList: [] }, OtherDriver: { Name: 'Alice', Team: 'A', Nation: 'AR', Guid: 'alice', GuidsList: [] }, ImpactSpeed: 120 },
      { Type: 'COLLISION_WITH_ENV', CarId: 1, Driver: { Name: 'Alice', Team: 'A', Nation: 'AR', Guid: 'alice', GuidsList: [] }, OtherCarId: -1, ImpactSpeed: 30 }
    ]
  }, 'contract-race.json');
  const grouped = groupIncidents(race.events.filter((event) => event.type === 'COLLISION_WITH_CAR'));
  const ratedStats = applySafetyRatings(calculateDriverStats(race, grouped));
  const message = buildRaceMessage({
    fileName: race.sourceFileName,
    race,
    stats: ratedStats,
    groupedIncidents: grouped,
    minActiveDriversForSafetyGain: 1,
    nuclearMissileMinCarImpactKmh: 100
  });

  assert.equal(DISCORD_EVENT_BASIS_VERSION, 'normalized-json-events-v1');
  assert.equal(race.events.length, 3);
  assert.equal(grouped.length, 1);
  assert.match(message.summaryText, /Contactos entre autos agrupados: 1/);
  assert.match(message.summaryText, /Eventos crudos entre autos: 2/);
  assert.match(message.summaryText, /Golpes con entorno: 1/);
  assert.match(message.summaryText, /Misil nuclear/);
});

function createStat(overrides: Partial<DriverRaceStats> = {}): DriverRaceStats {
  return {
    carId: 1, name: 'Driver', guid: 'guid-1', identity: { kind: 'guid', value: 'guid-1' }, position: 1,
    completedLaps: 2, raceLaps: 2, hasValidResult: true, active: true, inactive: false, finished: true,
    destructiveDnf: false, bestLap: 90000, avgLap: 90000, idealLap: 90000, consistency: 0,
    totalCuts: 0, carIncidentsGrouped: 0, envHits: 0, maxCarImpact: 0, maxEnvImpact: 0, maxImpact: 0,
    rawCollisionEvents: 0, 'tyre usado más frecuente': 'Soft', totalTime: 180000, raceScore: 0,
    oldSafetyRating: 75, newSafetyRating: 75, safetyChangeReason: 'updated', ...overrides
  };
}
