import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveSmokeGate } from '../../src/live/smokeGate';

test('smoke gate stays disabled until all required packet types were seen', () => {
  const gate = new LiveSmokeGate();

  gate.observe('car_update', new Date('2026-06-22T10:00:00.000Z'));
  let state = gate.getState();
  assert.equal(state.ready, false);
  assert.equal(state.captureEnabled, false);
  assert.deepEqual(state.seen, {
    car_update: true,
    collision_with_car: false,
    collision_with_env: false
  });

  gate.observe('collision_with_car', new Date('2026-06-22T10:00:01.000Z'));
  state = gate.getState();
  assert.equal(state.ready, false);
  assert.equal(state.completedAt, undefined);
});

test('smoke gate becomes ready only after the third required packet and keeps proof timestamps', () => {
  const gate = new LiveSmokeGate();

  gate.observe('car_update', new Date('2026-06-22T10:00:00.000Z'));
  gate.observe('collision_with_car', new Date('2026-06-22T10:00:01.000Z'));
  const state = gate.observe('collision_with_env', new Date('2026-06-22T10:00:02.000Z'));

  assert.equal(state.ready, true);
  assert.equal(state.captureEnabled, false);
  assert.equal(state.completedAt, '2026-06-22T10:00:02.000Z');
  assert.deepEqual(state.seenAt, {
    car_update: '2026-06-22T10:00:00.000Z',
    collision_with_car: '2026-06-22T10:00:01.000Z',
    collision_with_env: '2026-06-22T10:00:02.000Z'
  });
});
