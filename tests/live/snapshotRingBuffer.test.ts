import assert from 'node:assert/strict';
import test from 'node:test';
import { SnapshotRingBuffer } from '../../src/live/snapshotRingBuffer';
import { LiveCarSnapshot } from '../../src/live/liveTypes';

test('snapshot ring buffer inserts snapshots and returns requested time range', () => {
  const buffer = new SnapshotRingBuffer(10000, () => 5000);

  buffer.insert(createSnapshot({ receivedAtMs: 1000 }));
  buffer.insert(createSnapshot({ receivedAtMs: 2000 }));
  buffer.insert(createSnapshot({ receivedAtMs: 3000 }));

  assert.deepEqual(
    buffer.query(7, 1500, 2500).map((snapshot) => snapshot.receivedAtMs),
    [2000]
  );
});

test('snapshot ring buffer purges old snapshots outside retention window', () => {
  let now = 14000;
  const buffer = new SnapshotRingBuffer(10000, () => now);

  buffer.insert(createSnapshot({ receivedAtMs: 1000 }));
  buffer.insert(createSnapshot({ receivedAtMs: 9000 }));

  now = 19000;

  assert.deepEqual(
    buffer.query(7, 0, 20000).map((snapshot) => snapshot.receivedAtMs),
    [9000]
  );
});

test('snapshot ring buffer keeps snapshots separated by carId', () => {
  const buffer = new SnapshotRingBuffer(10000, () => 5000);

  buffer.insert(createSnapshot({ carId: 7, receivedAtMs: 1000 }));
  buffer.insert(createSnapshot({ carId: 9, receivedAtMs: 1500 }));
  buffer.insert(createSnapshot({ carId: 7, receivedAtMs: 2000 }));

  assert.deepEqual(
    buffer.query(7, 0, 3000).map((snapshot) => snapshot.carId),
    [7, 7]
  );
  assert.deepEqual(
    buffer.query(9, 0, 3000).map((snapshot) => snapshot.carId),
    [9]
  );
});

test('snapshot ring buffer query uses requested live window instead of wall clock', () => {
  const buffer = new SnapshotRingBuffer(10000, () => 50000);

  buffer.insert(createSnapshot({ receivedAtMs: 1000 }));
  buffer.insert(createSnapshot({ receivedAtMs: 2000 }));

  assert.deepEqual(
    buffer.query(7, 0, 3000).map((snapshot) => snapshot.receivedAtMs),
    [1000, 2000]
  );
});

function createSnapshot(overrides: Partial<LiveCarSnapshot> = {}): LiveCarSnapshot {
  return {
    receivedAtMs: 1000,
    carId: 7,
    pos: { x: 1, y: 2, z: 3 },
    velocity: { x: 10, y: 0, z: 0 },
    speedKmh: 36,
    gear: 4,
    engineRpm: 6123,
    normalizedSplinePos: 0.625,
    ...overrides,
  };
}
