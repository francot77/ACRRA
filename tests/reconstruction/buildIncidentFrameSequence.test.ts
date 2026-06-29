import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIncidentFrameSequence } from '../../src/reconstruction/buildIncidentFrameSequence';
import type { IncidentScene } from '../../src/reconstruction/reconstructionTypes';

test('buildIncidentFrameSequence preserves chronology and marks bounded interpolation as derived', () => {
  const frames = buildIncidentFrameSequence(createScene({ startMs: -200, endMs: 200 }));

  assert.deepEqual(frames.map((frame) => frame.atRelativeMs), [-200, 0, 200]);
  assert.equal(frames[0]?.source, 'observed');
  assert.equal(frames[1]?.source, 'derived');
  assert.equal(frames[2]?.source, 'observed');
  assert.equal(frames[1]?.cars.find((car) => car.carId === 7)?.evidence, 'derived');
  assert.equal(frames[1]?.cars.find((car) => car.carId === 7)?.forwardM, 0);
});

test('buildIncidentFrameSequence skips derived frames when interpolation gap is too large', () => {
  const frames = buildIncidentFrameSequence(createScene({ startMs: -500, endMs: 500 }));

  assert.deepEqual(frames.map((frame) => frame.atRelativeMs), [-500, 500]);
  assert.ok(frames.every((frame) => frame.source === 'observed'));
});

function createScene(range: { startMs: number; endMs: number }): IncidentScene {
  return Object.freeze({
    incidentId: 1,
    incidentUid: 'incident-sequence-1',
    incidentType: 'collision_with_car',
    anchorCarId: 7,
    anchorRelativeMs: 0,
    anchorEvidence: Object.freeze({
      state: 'observed',
      degraded: false,
      projectionSource: 'progress',
      reasons: Object.freeze([]),
    }),
    corridor: Object.freeze({
      anchorIndex: 10,
      anchorS: 220,
      center: Object.freeze({ x: 0, y: 0, z: 0 }),
      forwardRangeM: 45,
      backwardRangeM: 25,
      lateralHalfWidthM: 12,
      widthM: 10,
      turnSide: 'straight',
    }),
    cars: Object.freeze([
      Object.freeze({
        carId: 7,
        role: 'involved',
        evidence: Object.freeze({
          state: 'observed',
          degraded: false,
          projectionSource: 'progress',
          reasons: Object.freeze([]),
        }),
        placements: Object.freeze([
          Object.freeze({
            snapshotId: 1,
            relativeMs: range.startMs,
            forwardM: -10,
            lateralM: 1,
            speedKmh: 100,
            trackIndex: 9,
            evidence: Object.freeze({
              state: 'observed',
              degraded: false,
              projectionSource: 'progress',
              reasons: Object.freeze([]),
            }),
          }),
          Object.freeze({
            snapshotId: 2,
            relativeMs: range.endMs,
            forwardM: 10,
            lateralM: -1,
            speedKmh: 98,
            trackIndex: 11,
            evidence: Object.freeze({
              state: 'observed',
              degraded: false,
              projectionSource: 'progress',
              reasons: Object.freeze([]),
            }),
          }),
        ]),
      }),
      Object.freeze({
        carId: 8,
        role: 'involved',
        evidence: Object.freeze({
          state: 'observed',
          degraded: false,
          projectionSource: 'progress',
          reasons: Object.freeze([]),
        }),
        placements: Object.freeze([
          Object.freeze({
            snapshotId: 3,
            relativeMs: range.startMs,
            forwardM: -8,
            lateralM: -2,
            speedKmh: 95,
            trackIndex: 9,
            evidence: Object.freeze({
              state: 'observed',
              degraded: false,
              projectionSource: 'progress',
              reasons: Object.freeze([]),
            }),
          }),
          Object.freeze({
            snapshotId: 4,
            relativeMs: range.endMs,
            forwardM: 7,
            lateralM: -1,
            speedKmh: 92,
            trackIndex: 11,
            evidence: Object.freeze({
              state: 'observed',
              degraded: false,
              projectionSource: 'progress',
              reasons: Object.freeze([]),
            }),
          }),
        ]),
      }),
    ]),
    notes: Object.freeze([]),
    degraded: false,
  });
}
