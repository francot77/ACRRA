import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssumedRealtimeReportEnableCommand, parseAcUdpPacket } from '../../src/live/udpProtocolParser';

test('parser recognizes JSON car_update packets', () => {
  const packet = parseAcUdpPacket(
    Buffer.from(JSON.stringify({ type: 'car_update', carId: 7, speedKmh: 181.5, worldPosition: { x: 1, y: 2, z: 3 } }))
  );

  assert.equal(packet.type, 'car_update');
  assert.equal(packet.carId, 7);
  assert.equal(packet.speedKmh, 181.5);
  assert.deepEqual(packet.worldPosition, { x: 1, y: 2, z: 3 });
});

test('parser recognizes delimited collision packets', () => {
  const packet = parseAcUdpPacket(Buffer.from('collision_with_car|carId=4|otherCarId=8|impactSpeed=72.4'));

  assert.equal(packet.type, 'collision_with_car');
  assert.equal(packet.carId, 4);
  assert.equal(packet.otherCarId, 8);
  assert.equal(packet.impactSpeedKmh, 72.4);
});

test('parser returns unknown for unsupported payloads', () => {
  const packet = parseAcUdpPacket(Buffer.from([0xde, 0xad, 0xbe, 0xef]));

  assert.equal(packet.type, 'unknown');
  assert.equal(packet.reason, 'Unsupported packet format');
  assert.equal(packet.previewHex, 'deadbeef');
});

test('realtime enable command encodes the current protocol assumption', () => {
  const command = buildAssumedRealtimeReportEnableCommand(250);

  assert.equal(command.toString('hex'), '01fa000000');
});
