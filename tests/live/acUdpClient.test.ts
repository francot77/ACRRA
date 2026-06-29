import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { RemoteInfo, Socket } from 'node:dgram';
import type { AppConfig } from '../../src/config';
import { startAcUdpClient, type LiveLogger } from '../../src/live/acUdpClient';
import { parseTrackModelRuntime } from '../../src/track/trackModelAdapter';

test('acUdpClient uses the real realtime enable packet and logs real packet semantics when live UDP debug is enabled', async () => {
  const socket = new FakeSocket();
  const logs: Array<{ level: string; component: string; message: string; fields: Record<string, unknown> }> = [];
  const logger: LiveLogger = (level, component, message, fields) => {
    logs.push({ level, component, message, fields });
  };

  const client = await startAcUdpClient(createConfig(), {
    socketFactory: () => socket as unknown as Socket,
    logger,
  });

  assert.equal(socket.sentPackets.length, 1);
  assert.equal(socket.sentPackets[0]?.payload.toString('hex'), 'c8fa00');

  socket.emitMessage(createCarUpdatePacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 33 });
  socket.emitMessage(createCollisionWithCarPacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 32 });
  socket.emitMessage(createCollisionWithEnvPacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 31 });

  const packetLogs = logs.filter((entry) => entry.message === 'Received live UDP packet');
  assert.equal(packetLogs.length, 3);

  const recordedSnapshots = client.getSnapshots(7, 0, Number.MAX_SAFE_INTEGER);
  assert.equal(recordedSnapshots.length, 1);
  assert.equal(recordedSnapshots[0]?.speedKmh, 36);
  assert.equal(recordedSnapshots[0]?.trackContext, null);
  assert.deepEqual(client.getFinalizedIncidents(), []);

  assert.deepEqual(packetLogs[0]?.fields, {
    remoteAddress: '127.0.0.1',
    remotePort: 11000,
    packetType: 'car_update',
    carId: 7,
    speedKmh: 36,
    spline: 0.625,
    gear: 4,
    engineRpm: 6123,
    worldPos: { x: 1, y: 2, z: 3 },
    velocity: { x: 10, y: 0, z: 0 },
    smokeGateReady: false,
    captureEnabled: false,
  });

  assert.deepEqual(packetLogs[1]?.fields, {
    remoteAddress: '127.0.0.1',
    remotePort: 11000,
    packetType: 'collision_with_car',
    carId: 4,
    otherCarId: 8,
    impact: 72.4,
    worldPos: { x: 100, y: 5, z: -20 },
    relPos: { x: 1.5, y: 0.25, z: -0.5 },
    smokeGateReady: false,
    captureEnabled: false,
  });

  assert.deepEqual(packetLogs[2]?.fields, {
    remoteAddress: '127.0.0.1',
    remotePort: 11000,
    packetType: 'collision_with_env',
    carId: 9,
    impact: 41.75,
    worldPos: { x: -10, y: 0.5, z: 80 },
    relPos: { x: 0.75, y: 0, z: -1.25 },
    smokeGateReady: true,
    captureEnabled: false,
  });

  const smokeGateLog = logs.find((entry) => entry.message === 'Live UDP smoke gate satisfied');
  assert.ok(smokeGateLog);
  assert.equal(smokeGateLog?.fields.ready, true);
  assert.deepEqual(smokeGateLog?.fields.seen, {
    car_update: true,
    collision_with_car: true,
    collision_with_env: true,
  });

  await client.close();
});

test('acUdpClient suppresses per-packet logs when live UDP debug is disabled', async () => {
  const socket = new FakeSocket();
  const logs: Array<{ level: string; component: string; message: string; fields: Record<string, unknown> }> = [];
  const logger: LiveLogger = (level, component, message, fields) => {
    logs.push({ level, component, message, fields });
  };

  const client = await startAcUdpClient(createConfig({ liveUdpDebug: false }), {
    socketFactory: () => socket as unknown as Socket,
    logger,
  });

  socket.emitMessage(createCarUpdatePacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 33 });
  socket.emitMessage(createCollisionWithCarPacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 32 });

  const packetLogs = logs.filter((entry) => entry.message === 'Received live UDP packet');
  assert.equal(packetLogs.length, 0);

  await client.close();
});

test('acUdpClient aggregates per-window packet counts in the incident debug summary without per-packet spam', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(0);

  const socket = new FakeSocket();
  const logs: Array<{ level: string; component: string; message: string; fields: Record<string, unknown> }> = [];
  const logger: LiveLogger = (level, component, message, fields) => {
    logs.push({ level, component, message, fields });
  };

  const client = await startAcUdpClient(createConfig({ liveUdpDebug: false, incidentDebug: true }), {
    socketFactory: () => socket as unknown as Socket,
    logger,
  });

  socket.emitMessage(createCarUpdatePacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 33 });

  t.mock.timers.tick(1000);
  socket.emitMessage(createCarUpdatePacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 33 });
  socket.emitMessage(createCollisionWithCarPacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 32 });
  socket.emitMessage(createUnknownPacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 4 });

  t.mock.timers.tick(4000);
  socket.emitMessage(createCollisionWithEnvPacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 31 });

  const packetLogs = logs.filter((entry) => entry.message === 'Received live UDP packet');
  assert.equal(packetLogs.length, 0);

  const summaryLogs = logs.filter((entry) => entry.message === 'Live incident debug summary');
  assert.equal(summaryLogs.length, 2);
  assert.deepEqual(summaryLogs[1]?.fields, {
    ts: '1970-01-01T00:00:05.000Z',
    ringBufferCarIds: [7],
    pendingIncidentCount: 1,
    finalizedIncidentCount: 1,
    windowPacketCount: 4,
    windowCarUpdateCount: 1,
    windowCollisionWithCarCount: 1,
    windowCollisionWithEnvCount: 1,
    windowUnknownPacketCount: 1,
  });

  await client.close();
});

test('acUdpClient wires optional track runtime into snapshot and incident enrichment without changing fallbacks', async () => {
  const socket = new FakeSocket();

  const client = await startAcUdpClient(createConfig({ incidentPostMs: 1 }), {
    socketFactory: () => socket as unknown as Socket,
    logger: () => undefined,
    trackRuntime: loadMonzaRuntime(),
  });

  socket.emitMessage(createCarUpdatePacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 33 });
  socket.emitMessage(createCollisionWithEnvPacket(), { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 31 });

  await sleep(10);

  const snapshots = client.getSnapshots(7, 0, Number.MAX_SAFE_INTEGER);
  const incidents = client.getFinalizedIncidents();

  assert.equal(snapshots[0]?.trackContext?.source, 'progress');
  assert.equal(incidents[0]?.trackContext?.source, 'world_position');

  await client.close();
});

class FakeSocket extends EventEmitter {
  readonly sentPackets: Array<{ payload: Buffer; port: number; host: string }> = [];

  bind(_port: number): void {
    queueMicrotask(() => this.emit('listening'));
  }

  send(payload: Buffer, port: number, host: string, callback: (error: Error | null) => void): void {
    this.sentPackets.push({ payload, port, host });
    callback(null);
  }

  close(callback: () => void): void {
    callback();
  }

  emitMessage(payload: Buffer, remote: RemoteInfo): void {
    this.emit('message', payload, remote);
  }
}

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    resultsDir: '/app/results',
    databasePath: '/app/data/ac-race-monitor.sqlite',
    trackModelPath: '/app/track-models/monza/track-model.json',
    trackModelTrack: 'monza',
    trackModelLayout: null,
    discordWebhookUrl: '',
    incidentsDiscordWebhookUrl: '',
    incidentsWebhookEnabled: false,
    liveUdpEnabled: true,
    liveUdpDebug: true,
    acUdpServerHost: '127.0.0.1',
    acUdpServerPluginPort: 11000,
    acUdpPluginListenPort: 12000,
    realtimeReportIntervalMs: 250,
    snapshotRingBufferMs: 10000,
    incidentPreMs: 3000,
    incidentPostMs: 1500,
    incidentDebug: false,
    incidentMatchMaxDistanceM: 30,
    incidentMatchMaxImpactDiffKmh: 35,
    processedFileStrategy: 'sqlite',
    scanOnStart: true,
    minFileAgeMs: 3000,
    watchGlob: '*RACE*.json',
    defaultSafetyRating: 75,
    safetyMemoryFactor: 0.85,
    minActiveDriversForSafetyGain: 3,
    nuclearMissileMinCarImpactKmh: 100,
    nodeEnv: 'test',
    ...overrides,
  };
}

function createCarUpdatePacket(): Buffer {
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
  return raw;
}

function createCollisionWithCarPacket(): Buffer {
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
  return raw;
}

function createCollisionWithEnvPacket(): Buffer {
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
  return raw;
}

function createUnknownPacket(): Buffer {
  return Buffer.from([0xde, 0xad, 0xbe, 0xef]);
}

function loadMonzaRuntime() {
  return parseTrackModelRuntime(JSON.parse(readFileSync(resolve('track-models/monza/track-model.json'), 'utf8')));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
