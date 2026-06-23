import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssumedRealtimeReportEnableCommand, parseAcUdpPacket } from '../../src/live/udpProtocolParser';

test('parser recognizes binary car_update packets from the AC server plugin protocol', () => {
  const raw = Buffer.alloc(33);
  raw.writeUInt8(53, 0);
  raw.writeUInt8(7, 1);
  raw.writeFloatLE(1, 2);
  raw.writeFloatLE(2, 6);
  raw.writeFloatLE(3, 10);
  raw.writeFloatLE(10, 14);
  raw.writeFloatLE(0, 18);
  raw.writeFloatLE(0, 22);
  raw.writeUInt8(4, 26);
  raw.writeUInt16LE(6123, 27);
  raw.writeFloatLE(0.625, 29);

  const packet = parseAcUdpPacket(raw);

  assert.equal(packet.type, 'car_update');
  assert.equal(packet.carId, 7);
  assert.deepEqual(packet.worldPosition, { x: 1, y: 2, z: 3 });
  assert.deepEqual(packet.velocity, { x: 10, y: 0, z: 0 });
  assert.equal(packet.gear, 4);
  assert.equal(packet.engineRpm, 6123);
  assert.equal(packet.normalizedSplinePos, 0.625);
  assert.equal(packet.speedKmh, 36);
});

test('parser recognizes binary collision_with_car packets from the AC server plugin protocol', () => {
  const raw = Buffer.alloc(32);
  raw.writeUInt8(130, 0);
  raw.writeUInt8(10, 1);
  raw.writeUInt8(4, 2);
  raw.writeUInt8(8, 3);
  raw.writeFloatLE(72.4, 4);
  raw.writeFloatLE(100, 8);
  raw.writeFloatLE(5, 12);
  raw.writeFloatLE(-20, 16);
  raw.writeFloatLE(1.5, 20);
  raw.writeFloatLE(0.25, 24);
  raw.writeFloatLE(-0.5, 28);

  const packet = parseAcUdpPacket(raw);

  assert.equal(packet.type, 'collision_with_car');
  assert.equal(packet.carId, 4);
  assert.equal(packet.otherCarId, 8);
  assert.ok(Math.abs(packet.impactSpeed - 72.4) < 0.0001);
  assert.deepEqual(packet.worldPosition, { x: 100, y: 5, z: -20 });
  assert.deepEqual(packet.relativePosition, { x: 1.5, y: 0.25, z: -0.5 });
});

test('parser recognizes binary collision_with_env packets from the AC server plugin protocol', () => {
  const raw = Buffer.alloc(31);
  raw.writeUInt8(130, 0);
  raw.writeUInt8(11, 1);
  raw.writeUInt8(9, 2);
  raw.writeFloatLE(41.75, 3);
  raw.writeFloatLE(-10, 7);
  raw.writeFloatLE(0.5, 11);
  raw.writeFloatLE(80, 15);
  raw.writeFloatLE(0.75, 19);
  raw.writeFloatLE(0, 23);
  raw.writeFloatLE(-1.25, 27);

  const packet = parseAcUdpPacket(raw);

  assert.equal(packet.type, 'collision_with_env');
  assert.equal(packet.carId, 9);
  assert.ok(Math.abs(packet.impactSpeed - 41.75) < 0.0001);
  assert.deepEqual(packet.worldPosition, { x: -10, y: 0.5, z: 80 });
  assert.deepEqual(packet.relativePosition, { x: 0.75, y: 0, z: -1.25 });
});

test('parser returns unknown for unsupported payloads', () => {
  const packet = parseAcUdpPacket(Buffer.from([0xde, 0xad, 0xbe, 0xef]));

  assert.equal(packet.type, 'unknown');
  assert.equal(packet.reason, 'Unsupported packet format');
  assert.equal(packet.previewHex, 'deadbeef');
});

test('realtime enable command encodes the current protocol assumption', () => {
  const command = buildAssumedRealtimeReportEnableCommand(250);

  assert.equal(command.toString('hex'), 'c8fa00');
});
