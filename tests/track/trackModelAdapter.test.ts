import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTrackModelRuntime } from '../../src/track/trackModelAdapter';

test('trackModelAdapter accepts the authoritative Monza subset, ignores extras, and freezes the runtime shape', () => {
  const runtime = parseTrackModelRuntime({
    schemaVersion: 1,
    track: 'monza',
    layout: null,
    totalLengthMeters: 5757.195801,
    pointCount: 1,
    source: 'fast_lane.ai',
    points: [
      {
        index: 0,
        s: 0,
        normalized: 0,
        x: -206.929398,
        y: -8.408029,
        z: 414.00296,
        forwardX: 0.06863857,
        forwardY: 0.00465211,
        forwardZ: -0.99764159,
        sideLeft: 2.982615,
        sideRight: 8.855338,
        width: 11.837953,
        leftX: -203.953817,
        leftY: -8.408029,
        leftZ: 414.207683,
        rightX: -215.763851,
        rightY: -8.408029,
        rightZ: 413.395142,
        speedReference: 27.066317,
      },
    ],
    stats: { ignored: true },
  });

  assert.equal(runtime.track, 'monza');
  assert.equal(runtime.layout, null);
  assert.equal(runtime.points.length, 1);
  assert.deepEqual(runtime.points[0], {
    index: 0,
    s: 0,
    normalized: 0,
    center: { x: -206.929398, y: -8.408029, z: 414.00296 },
    forward: { x: 0.06863857, y: 0.00465211, z: -0.99764159 },
    sideLeft: 2.982615,
    sideRight: 8.855338,
    width: 11.837953,
    leftEdge: { x: -203.953817, y: -8.408029, z: 414.207683 },
    rightEdge: { x: -215.763851, y: -8.408029, z: 413.395142 },
  });
  assert.equal('source' in runtime, false);
  assert.equal('stats' in runtime, false);
  assert.equal('speedReference' in runtime.points[0], false);
  assert.ok(Object.isFrozen(runtime));
  assert.ok(Object.isFrozen(runtime.points));
  assert.ok(Object.isFrozen(runtime.points[0]));
  assert.ok(Object.isFrozen(runtime.points[0]?.center));
});

test('trackModelAdapter rejects missing required geometry fields', () => {
  assert.throws(
    () => parseTrackModelRuntime({
      schemaVersion: 1,
      track: 'monza',
      layout: null,
      totalLengthMeters: 5757.195801,
      pointCount: 1,
      points: [
        {
          index: 0,
          s: 0,
          normalized: 0,
          x: -206.929398,
          y: -8.408029,
          z: 414.00296,
          forwardX: 0.06863857,
          forwardY: 0.00465211,
          forwardZ: -0.99764159,
          sideLeft: 2.982615,
          sideRight: 8.855338,
          width: 11.837953,
          leftX: -203.953817,
          leftY: -8.408029,
          leftZ: 414.207683,
          rightX: -215.763851,
          rightY: -8.408029,
        },
      ],
    }),
    /rightZ/
  );
});
