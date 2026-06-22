import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateRaceSafety, getSafetyCategory, updateSafetyRating } from '../src/parser/calculateSafety';
import { groupIncidents } from '../src/parser/groupIncidents';
import { NonRaceSessionError, parseRaceJson } from '../src/parser/parseRaceJson';
import { ParsedCarCollisionEvent } from '../src/types/assetto';

function loadSample(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'samples/results', fileName), 'utf8');
}

function createCarEvent(input: Partial<ParsedCarCollisionEvent> & Pick<ParsedCarCollisionEvent, 'index' | 'carId' | 'otherCarId'>): ParsedCarCollisionEvent {
  return {
    index: input.index,
    type: 'COLLISION_WITH_CAR',
    carId: input.carId,
    otherCarId: input.otherCarId,
    driverIdentity: input.driverIdentity ?? { kind: 'guid', value: `guid:${input.carId}` },
    otherDriverIdentity: input.otherDriverIdentity ?? { kind: 'guid', value: `guid:${input.otherCarId}` },
    driverName: input.driverName ?? `Driver ${input.carId}`,
    otherDriverName: input.otherDriverName ?? `Driver ${input.otherCarId}`,
    impactSpeed: input.impactSpeed ?? 0,
    worldPosition: input.worldPosition
  };
}

test('parseRaceJson keeps only active race drivers and filters placeholders', () => {
  const parsed = parseRaceJson(loadSample('2026_6_20_4_0_RACE.json'), '2026_6_20_4_0_RACE.json');

  assert.equal(parsed.type, 'RACE');
  assert.deepEqual(
    parsed.drivers.map((driver) => driver.carId).sort((left, right) => left - right),
    [0, 1, 2, 3, 6]
  );
  assert.ok(parsed.drivers.every((driver) => driver.name.trim().length > 0));
  assert.ok(parsed.drivers.every((driver) => driver.guid));
});

test('parseRaceJson rejects non-RACE sessions', () => {
  assert.throws(
    () => parseRaceJson(loadSample('2026_6_20_1_9_QUALIFY.json'), '2026_6_20_1_9_QUALIFY.json'),
    (error: unknown) => error instanceof NonRaceSessionError && error.message.includes('QUALIFY')
  );
});

test('groupIncidents dedupes mirrored contact and splits separate incidents', () => {
  const grouped = groupIncidents([
    createCarEvent({ index: 10, carId: 4, otherCarId: 8, driverName: 'Alice', otherDriverName: 'Bob', impactSpeed: 80 }),
    createCarEvent({ index: 11, carId: 8, otherCarId: 4, driverName: 'Bob', otherDriverName: 'Alice', impactSpeed: 70 }),
    createCarEvent({ index: 14, carId: 4, otherCarId: 8, driverName: 'Alice', otherDriverName: 'Bob', impactSpeed: 40 })
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]?.pairKey, '4:8');
  assert.equal(grouped[0]?.rawEventCount, 2);
  assert.equal(grouped[0]?.maxImpact, 80);
  assert.equal(grouped[0]?.avgImpact, 75);
  assert.deepEqual(
    grouped[0]?.driversInvolved.map((driver) => driver.name),
    ['Alice', 'Bob']
  );
  assert.equal(grouped[1]?.rawEventCount, 1);
});

test('safety formula, rolling rating, and categories follow the frozen contract', async (t) => {
  const score = calculateRaceSafety({
    carIncidentsGrouped: 2,
    envHits: 1,
    totalCuts: 3,
    maxImpact: 130,
    finished: true,
    completedLaps: 3
  });

  assert.equal(score, 43);
  assert.equal(updateSafetyRating(75.6, 27), 68.31);

  const categories = [
    { score: 90, label: '🧼 Limpio' },
    { score: 75, label: '✅ Correcto' },
    { score: 60, label: '⚠️ Dudoso' },
    { score: 40, label: '🚧 Peligroso' },
    { score: 20, label: '🚜 Terrorista de T1' },
    { score: 19, label: '☢️ Amenaza pública' }
  ] as const;

  for (const entry of categories) {
    await t.test(`maps ${entry.score} to ${entry.label}`, () => {
      assert.equal(getSafetyCategory(entry.score), entry.label);
    });
  }
});
