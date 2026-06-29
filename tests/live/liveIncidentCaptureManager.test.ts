import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { LiveIncidentCaptureManager } from '../../src/live/liveIncidentCaptureManager';
import { LiveSnapshotRecorder } from '../../src/live/liveSnapshotRecorder';
import { LiveCarUpdatePacket, LiveCollisionEvent, LiveCollisionWithCarPacket, LiveCollisionWithEnvPacket } from '../../src/live/liveTypes';
import { parseTrackModelRuntime } from '../../src/track/trackModelAdapter';
import { TrackQueryService } from '../../src/track/trackQueryService';

test('car-car incident captures pre and post snapshots for both cars', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 10000);
  const captureManager = new LiveIncidentCaptureManager(recorder, {
    incidentPreMs: 3000,
    incidentPostMs: 1500,
  });

  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 7, receivedAt: toIso(1000) }));
  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 8, receivedAt: toIso(1500) }));
  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 7, receivedAt: toIso(2200) }));
  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 8, receivedAt: toIso(2600) }));

  captureManager.observeCollision(createCarCollisionEvent({ receivedAtMs: 3500, carId: 7, otherCarId: 8 }));

  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 7, receivedAt: toIso(4000) })));
  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 8, receivedAt: toIso(4300) })));
  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 7, receivedAt: toIso(5000) })));
  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 8, receivedAt: toIso(5000) })));

  const incidents = captureManager.getFinalizedIncidents(5001);
  assert.equal(incidents.length, 1);

  const incident = incidents[0]!;
  assert.equal(incident.type, 'collision_with_car');
  assert.equal(incident.trackContext, null);
  assert.deepEqual(incident.events.map((event) => event.receivedAtMs), [3500]);
  assert.deepEqual(incident.cars.map((car) => ({ carId: car.carId, snapshots: car.snapshots.map((snapshot) => snapshot.receivedAtMs) })), [
    { carId: 7, snapshots: [1000, 2200, 4000, 5000] },
    { carId: 8, snapshots: [1500, 2600, 4300, 5000] },
  ]);
});

test('env incident captures only the affected car snapshots', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 10000);
  const captureManager = new LiveIncidentCaptureManager(recorder, {
    incidentPreMs: 3000,
    incidentPostMs: 1500,
  });

  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 9, receivedAt: toIso(500) }));
  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 9, receivedAt: toIso(2500) }));
  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 3, receivedAt: toIso(2600) }));

  captureManager.observeCollision(createEnvCollisionEvent({ receivedAtMs: 3000, carId: 9 }));

  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 9, receivedAt: toIso(4000) })));
  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 3, receivedAt: toIso(4100) })));

  const incidents = captureManager.getFinalizedIncidents(4501);
  assert.equal(incidents.length, 1);
  assert.deepEqual(incidents[0]?.cars.map((car) => ({ carId: car.carId, snapshots: car.snapshots.map((snapshot) => snapshot.receivedAtMs) })), [
    { carId: 9, snapshots: [500, 2500, 4000] },
  ]);
});

test('repeated grouped collisions produce one finalized incident package', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 10000);
  const captureManager = new LiveIncidentCaptureManager(recorder, {
    incidentPreMs: 3000,
    incidentPostMs: 1500,
  });

  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 4, receivedAt: toIso(2000) }));
  recorder.recordCarUpdate(createCarUpdatePacket({ carId: 8, receivedAt: toIso(2100) }));

  captureManager.observeCollision(createCarCollisionEvent({ receivedAtMs: 3000, carId: 4, otherCarId: 8, worldPosition: { x: 100, y: 0, z: 100 } }));
  captureManager.observeCollision(createCarCollisionEvent({ receivedAtMs: 4200, carId: 4, otherCarId: 8, worldPosition: { x: 108, y: 0, z: 104 } }));

  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 4, receivedAt: toIso(5600) })));
  captureManager.observeSnapshot(recorder.recordCarUpdate(createCarUpdatePacket({ carId: 8, receivedAt: toIso(5600) })));

  const incidents = captureManager.getFinalizedIncidents(5701);
  assert.equal(incidents.length, 1);
  assert.deepEqual(incidents[0]?.events.map((event) => event.receivedAtMs), [3000, 4200]);
  assert.equal(incidents[0]?.captureEndMs, 5700);
});

test('incident finalization projects anchor track context and preserves snapshot enrichment', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 10000);
  const queryService = new TrackQueryService(loadMonzaRuntime());
  const trackContextInput = {
    queryService,
    sessionTrackIdentity: { trackName: 'monza', trackConfig: null },
  };
  const captureManager = new LiveIncidentCaptureManager(recorder, {
    incidentPreMs: 3000,
    incidentPostMs: 1500,
    trackContextInput,
  });

  recorder.recordCarUpdate(
    createCarUpdatePacket({ carId: 7, receivedAt: toIso(1000), normalizedSplinePos: 0 }),
    trackContextInput
  );
  recorder.recordCarUpdate(
    createCarUpdatePacket({ carId: 8, receivedAt: toIso(1200), normalizedSplinePos: 0.0004 }),
    trackContextInput
  );

  captureManager.observeCollision(
    createCarCollisionEvent({
      receivedAtMs: 3000,
      carId: 7,
      otherCarId: 8,
      worldPosition: { x: -206.929398, y: -8.408029, z: 414.00296 },
    })
  );

  captureManager.observeSnapshot(
    recorder.recordCarUpdate(createCarUpdatePacket({ carId: 7, receivedAt: toIso(3500), normalizedSplinePos: 0.001 }), trackContextInput)
  );
  captureManager.observeSnapshot(
    recorder.recordCarUpdate(createCarUpdatePacket({ carId: 8, receivedAt: toIso(3600), normalizedSplinePos: 0.0012 }), trackContextInput)
  );

  const incidents = captureManager.getFinalizedIncidents(4501);
  const incident = incidents[0];

  assert.equal(incidents.length, 1);
  assert.equal(incident?.trackContext?.source, 'world_position');
  assert.equal(incident?.trackContext?.index, 0);
  assert.equal(incident?.cars[0]?.snapshots[0]?.trackContext?.source, 'progress');
  assert.equal(incident?.cars[1]?.snapshots[0]?.trackContext?.source, 'progress');
});

test('incident finalization leaves track context null when projection input is unavailable', () => {
  const recorder = new LiveSnapshotRecorder(10000, () => 10000);
  const queryService = new TrackQueryService(loadMonzaRuntime());
  const captureManager = new LiveIncidentCaptureManager(recorder, {
    incidentPreMs: 3000,
    incidentPostMs: 1500,
    trackContextInput: {
      queryService,
      sessionTrackIdentity: { trackName: 'spa', trackConfig: null },
    },
  });

  captureManager.observeCollision(
    createCarCollisionEvent({
      receivedAtMs: 3000,
      worldPosition: { x: Number.NaN, y: 0, z: 0 },
    })
  );

  const incidents = captureManager.getFinalizedIncidents(4501);
  assert.equal(incidents[0]?.trackContext, null);
});

function createCarUpdatePacket(overrides: Partial<LiveCarUpdatePacket> = {}): LiveCarUpdatePacket {
  const receivedAt = overrides.receivedAt ?? toIso(0);
  const receivedAtMs = overrides.receivedAtMs ?? Date.parse(receivedAt);

  return {
    type: 'car_update',
    receivedAt,
    receivedAtMs,
    raw: Buffer.alloc(0),
    carId: 7,
    worldPosition: { x: 1, y: 2, z: 3 },
    velocity: { x: 10, y: 0, z: 0 },
    speedKmh: 36,
    gear: 4,
    engineRpm: 6123,
    normalizedSplinePos: 0.625,
    ...overrides,
  };
}

function createCarCollisionEvent(overrides: Partial<LiveCollisionWithCarPacket & { receivedAtMs: number }> = {}): LiveCollisionEvent {
  const receivedAtMs = overrides.receivedAtMs ?? 3000;
  return {
    type: 'collision_with_car',
    receivedAt: toIso(receivedAtMs),
    receivedAtMs,
    carId: overrides.carId ?? 4,
    otherCarId: overrides.otherCarId ?? 8,
    impactSpeed: overrides.impactSpeed ?? 72.4,
    worldPosition: overrides.worldPosition ?? { x: 100, y: 5, z: -20 },
    relativePosition: overrides.relativePosition ?? { x: 1.5, y: 0.25, z: -0.5 },
  };
}

function createEnvCollisionEvent(overrides: Partial<LiveCollisionWithEnvPacket & { receivedAtMs: number }> = {}): LiveCollisionEvent {
  const receivedAtMs = overrides.receivedAtMs ?? 3000;
  return {
    type: 'collision_with_env',
    receivedAt: toIso(receivedAtMs),
    receivedAtMs,
    carId: overrides.carId ?? 9,
    impactSpeed: overrides.impactSpeed ?? 41.75,
    worldPosition: overrides.worldPosition ?? { x: -10, y: 0.5, z: 80 },
    relativePosition: overrides.relativePosition ?? { x: 0.75, y: 0, z: -1.25 },
  };
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function loadMonzaRuntime() {
  return parseTrackModelRuntime(JSON.parse(readFileSync(resolve('track-models/monza/track-model.json'), 'utf8')));
}
