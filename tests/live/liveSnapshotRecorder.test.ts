import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveSnapshotRecorder } from '../../src/live/liveSnapshotRecorder';
import { LiveCarUpdatePacket } from '../../src/live/liveTypes';

test('live snapshot recorder records snapshots with computed speed', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 5000);

  recorder.recordCarUpdate(createCarUpdatePacket({ receivedAt: new Date(1000).toISOString() }));

  const snapshots = recorder.getSnapshots(7, 0, 5000);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.receivedAtMs, 1000);
  assert.equal(snapshots[0]?.speedKmh, 36);
});

function createCarUpdatePacket(overrides: Partial<LiveCarUpdatePacket> = {}): LiveCarUpdatePacket {
  const receivedAt = overrides.receivedAt ?? new Date(0).toISOString();
  const receivedAtMs = overrides.receivedAtMs ?? Date.parse(receivedAt);

  return {
    type: 'car_update',
    receivedAt,
    receivedAtMs,
    raw: Buffer.alloc(0),
    carId: 7,
    worldPosition: { x: 1, y: 2, z: 3 },
    velocity: { x: 10, y: 0, z: 0 },
    speedKmh: 0,
    gear: 4,
    engineRpm: 6123,
    normalizedSplinePos: 0.625,
    ...overrides,
  };
}
