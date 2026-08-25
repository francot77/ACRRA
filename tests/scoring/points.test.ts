import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAwards, calculatePoints, pointsForPosition } from '../../src/scoring/calculatePoints';
import type { FinishResult } from '../../src/scoring/types';

test('maps every classified top-ten position to the approved points table', () => {
  assert.deepEqual(calculatePoints(Array.from({ length: 10 }, (_, index) => ({ driverName: `D${index}`, position: index + 1, classified: true }))), [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
});

test('rejects classified positions outside the top ten', () => {
  for (const position of [0, 11, 1.5, Number.NaN]) assert.throws(() => pointsForPosition(position), RangeError);
});

test('DNF receives zero even when its position is outside the points range', () => {
  const result: FinishResult = { driverName: 'DNF', position: 99, classified: false };
  assert.deepEqual(calculatePoints([result]), [0]);
});

test('ties retain supplied JSON order without secondary ranking', () => {
  const results: FinishResult[] = [
    { driverName: 'First in JSON', position: 1, classified: true },
    { driverName: 'Second in JSON', position: 1, classified: true }
  ];
  assert.deepEqual(calculateAwards(results).map(({ driverName, points }) => ({ driverName, points })), [
    { driverName: 'First in JSON', points: 25 },
    { driverName: 'Second in JSON', points: 25 }
  ]);
});
