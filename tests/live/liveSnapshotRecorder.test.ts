import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { LiveSnapshotRecorder } from '../../src/live/liveSnapshotRecorder';
import { LiveCarUpdatePacket } from '../../src/live/liveTypes';
import { parseTrackModelRuntime } from '../../src/track/trackModelAdapter';
import { TrackQueryService } from '../../src/track/trackQueryService';

test('live snapshot recorder records snapshots with computed speed', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 5000);

  recorder.recordCarUpdate(createCarUpdatePacket({ receivedAt: new Date(1000).toISOString() }));

  const snapshots = recorder.getSnapshots(7, 0, 5000);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.receivedAtMs, 1000);
  assert.equal(snapshots[0]?.speedKmh, 36);
  assert.equal(snapshots[0]?.trackContext, null);
});

test('live snapshot recorder enriches snapshots by progress when the session track resolves', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 5000);
  const queryService = new TrackQueryService(loadMonzaRuntime());

  const snapshot = recorder.recordCarUpdate(
    createCarUpdatePacket({
      normalizedSplinePos: 0,
      worldPosition: { x: 5000, y: 0, z: 5000 },
    }),
    {
      queryService,
      sessionTrackIdentity: { trackName: 'monza', trackConfig: '' },
    }
  );

  assert.deepEqual(snapshot.trackContext, {
    track: 'monza',
    layout: null,
    source: 'progress',
    index: 0,
    s: 0,
    normalized: 0,
    center: { x: -206.929398, y: -8.408029, z: 414.00296 },
    forward: { x: 0.06863857, y: 0.00465211, z: -0.99764159 },
    width: 11.837953,
    sideLeft: 2.982615,
    sideRight: 8.855338,
    leftEdge: { x: -203.953817, y: -8.408029, z: 414.207683 },
    rightEdge: { x: -215.763851, y: -8.408029, z: 413.395142 },
  });
});

test('live snapshot recorder falls back to world position when normalized progress is unavailable', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 5000);
  const queryService = new TrackQueryService(loadMonzaRuntime());

  const snapshot = recorder.recordCarUpdate(
    createCarUpdatePacket({
      normalizedSplinePos: Number.NaN,
      worldPosition: { x: -206.929398, y: -8.408029, z: 414.00296 },
    }),
    {
      queryService,
      sessionTrackIdentity: { trackName: 'monza', trackConfig: null },
    }
  );

  assert.equal(snapshot.trackContext?.source, 'world_position');
  assert.equal(snapshot.trackContext?.index, 0);
});

test('live snapshot recorder leaves track context null when the session track does not resolve', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 5000);
  const queryService = new TrackQueryService(loadMonzaRuntime());

  const snapshot = recorder.recordCarUpdate(createCarUpdatePacket(), {
    queryService,
    sessionTrackIdentity: { trackName: 'spa', trackConfig: null },
  });

  assert.equal(snapshot.trackContext, null);
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

function loadMonzaRuntime() {
  return parseTrackModelRuntime(JSON.parse(readFileSync(resolve('track-models/monza/track-model.json'), 'utf8')));
}
