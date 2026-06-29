import assert from 'node:assert/strict';
import test from 'node:test';
import { createIncidentArtifacts } from '../../src/reconstruction/createIncidentArtifacts';
import { renderIncidentSvg } from '../../src/reconstruction/renderIncidentSvg';
import type { IncidentScene } from '../../src/reconstruction/reconstructionTypes';

test('renderIncidentSvg is deterministic and preserves degraded markers', () => {
  const scene = createScene();

  const first = renderIncidentSvg(scene);
  const second = renderIncidentSvg(scene);

  assert.equal(first.content, second.content);
  assert.match(first.content, /data-car-id="7"/);
  assert.match(first.content, /data-car-id="8"/);
  assert.doesNotMatch(first.content, /data-car-id="100"/);
  assert.match(first.content, /data-evidence="degraded"/);
  assert.match(first.content, /car 9: missing local placement/);
});

test('createIncidentArtifacts packages svg and omits it when budget is exceeded', () => {
  const scene = createScene();

  const ready = createIncidentArtifacts({ scene });
  assert.equal(ready.delivery, 'sequence_ready');
  assert.equal(ready.staticSvg?.filename, 'incident.svg');
  assert.ok((ready.staticSvg?.bytes.length ?? 0) > 0);

  const omitted = createIncidentArtifacts({ scene, maxSvgBytes: 24 });
  assert.equal(omitted.delivery, 'omitted');
  assert.equal(omitted.staticSvg, undefined);
  assert.ok(omitted.notes.some((note) => note.includes('incident.svg omitted')));
});

function createScene(): IncidentScene {
  return Object.freeze({
    incidentId: 1,
    incidentUid: 'incident-svg-1',
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
      turnSide: 'left',
    }),
    cars: Object.freeze([
      Object.freeze({
        carId: 100,
        role: 'context',
        evidence: Object.freeze({
          state: 'observed',
          degraded: false,
          projectionSource: 'progress',
          reasons: Object.freeze([]),
        }),
        placements: Object.freeze([]),
      }),
      Object.freeze({
        carId: 9,
        role: 'context',
        evidence: Object.freeze({
          state: 'missing',
          degraded: true,
          projectionSource: 'missing',
          reasons: Object.freeze(['No persisted snapshots were available for the involved car']),
        }),
        placements: Object.freeze([
          Object.freeze({
            snapshotId: null,
            relativeMs: 0,
            forwardM: null,
            lateralM: null,
            speedKmh: null,
            trackIndex: null,
            evidence: Object.freeze({
              state: 'missing',
              degraded: true,
              projectionSource: 'missing',
              reasons: Object.freeze(['No persisted snapshots were available for the involved car']),
            }),
          }),
        ]),
      }),
      Object.freeze({
        carId: 8,
        role: 'involved',
        evidence: Object.freeze({
          state: 'observed',
          degraded: true,
          projectionSource: 'world_position',
          reasons: Object.freeze(['World-position reprojection fallback was used']),
        }),
        placements: Object.freeze([
          Object.freeze({
            snapshotId: 2,
            relativeMs: -120,
            forwardM: -6,
            lateralM: -1.5,
            speedKmh: 95,
            trackIndex: 9,
            evidence: Object.freeze({
              state: 'observed',
              degraded: true,
              projectionSource: 'world_position',
              reasons: Object.freeze(['World-position reprojection fallback was used']),
            }),
          }),
          Object.freeze({
            snapshotId: 3,
            relativeMs: 120,
            forwardM: 8,
            lateralM: -0.5,
            speedKmh: 98,
            trackIndex: 10,
            evidence: Object.freeze({
              state: 'observed',
              degraded: true,
              projectionSource: 'world_position',
              reasons: Object.freeze(['World-position reprojection fallback was used']),
            }),
          }),
        ]),
      }),
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
            relativeMs: -120,
            forwardM: -8,
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
            snapshotId: 4,
            relativeMs: 120,
            forwardM: 6,
            lateralM: 0.4,
            speedKmh: 102,
            trackIndex: 10,
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
    notes: Object.freeze(['World-position reprojection fallback was required for part of the scene']),
    degraded: true,
  });
}
