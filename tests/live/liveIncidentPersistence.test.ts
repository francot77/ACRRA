import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { RemoteInfo, Socket } from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AppConfig } from '../../src/config';
import { openDatabase } from '../../src/db/db';
import { createRepositories } from '../../src/db/repositories';
import { startAcUdpClient } from '../../src/live/acUdpClient';

test('finalized env incident persists incident row and isolated snapshots', async (t) => {
  const context = await createLiveContext();
  t.after(async () => {
    await context.client.close();
    context.database.close();
  });

  context.socket.emitMessage(createCarUpdatePacket({ carId: 9, posX: -12 }), fakeRemote());
  await sleep(10);
  context.socket.emitMessage(createCarUpdatePacket({ carId: 9, posX: -11 }), fakeRemote());
  await sleep(10);
  context.socket.emitMessage(createCollisionWithEnvPacket({ carId: 9, impactSpeed: 41.75 }), fakeRemote());
  await sleep(10);
  context.socket.emitMessage(createCarUpdatePacket({ carId: 9, posX: -9 }), fakeRemote());
  await sleep(40);

  context.client.getFinalizedIncidents();

  const incidents = context.repositories.liveIncidents.list();
  assert.equal(incidents.length, 1);
  assert.match(incidents[0]?.incidentUid ?? '', /^live-incident-\d+-collision_with_env-9-1$/);
  assert.equal(incidents[0]?.type, 'collision_with_env');
  assert.equal(incidents[0]?.carId, 9);
  assert.equal(incidents[0]?.otherCarId, null);
  assert.equal(incidents[0]?.matched, false);
  assert.equal(incidents[0]?.raceId, null);
  assert.equal(incidents[0]?.snapshots.length, 3);
  assert.deepEqual(incidents[0]?.snapshots.map((snapshot) => snapshot.carId), [9, 9, 9]);
  assert.ok((incidents[0]?.snapshots[0]?.relativeMs ?? 0) < 0);
  assert.ok((incidents[0]?.snapshots[2]?.relativeMs ?? 0) > 0);
});

test('finalized car-car incident persists both cars snapshot timelines', async (t) => {
  const context = await createLiveContext();
  t.after(async () => {
    await context.client.close();
    context.database.close();
  });

  context.socket.emitMessage(createCarUpdatePacket({ carId: 7, posX: 1 }), fakeRemote());
  context.socket.emitMessage(createCarUpdatePacket({ carId: 8, posX: 2 }), fakeRemote());
  await sleep(10);
  context.socket.emitMessage(createCarUpdatePacket({ carId: 7, posX: 3 }), fakeRemote());
  context.socket.emitMessage(createCarUpdatePacket({ carId: 8, posX: 4 }), fakeRemote());
  await sleep(10);
  context.socket.emitMessage(createCollisionWithCarPacket({ carId: 7, otherCarId: 8, impactSpeed: 72.4 }), fakeRemote());
  await sleep(10);
  context.socket.emitMessage(createCarUpdatePacket({ carId: 7, posX: 5 }), fakeRemote());
  context.socket.emitMessage(createCarUpdatePacket({ carId: 8, posX: 6 }), fakeRemote());
  await sleep(40);

  context.client.getFinalizedIncidents();

  const incidents = context.repositories.liveIncidents.list();
  assert.equal(incidents.length, 1);
  assert.match(incidents[0]?.incidentUid ?? '', /^live-incident-\d+-collision_with_car-7-8-1$/);
  assert.equal(incidents[0]?.type, 'collision_with_car');
  assert.equal(incidents[0]?.carId, 7);
  assert.equal(incidents[0]?.otherCarId, 8);
  assert.deepEqual(new Set(incidents[0]?.snapshots.map((snapshot) => snapshot.carId)), new Set([7, 8]));
  assert.equal(incidents[0]?.snapshots.filter((snapshot) => snapshot.carId === 7).length, 3);
  assert.equal(incidents[0]?.snapshots.filter((snapshot) => snapshot.carId === 8).length, 3);
});

test('live telemetry stays out of SQLite until the incident package is finalized', async (t) => {
  const context = await createLiveContext();
  t.after(async () => {
    await context.client.close();
    context.database.close();
  });

  context.socket.emitMessage(createCarUpdatePacket({ carId: 4, posX: 100 }), fakeRemote());
  context.socket.emitMessage(createCarUpdatePacket({ carId: 8, posX: 102 }), fakeRemote());
  await sleep(10);
  context.socket.emitMessage(createCollisionWithCarPacket({ carId: 4, otherCarId: 8, impactSpeed: 65 }), fakeRemote());

  assert.deepEqual(context.repositories.liveIncidents.list(), []);

  await sleep(40);
  context.client.getFinalizedIncidents();

  const incidents = context.repositories.liveIncidents.list();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.snapshots.length, 2);
});

test('restarting the UDP client does not collide incident UIDs with previously persisted incidents', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-live-incident-restart-'));
  const database = openDatabase(join(directory, 'ac-race-monitor.sqlite'));
  const repositories = createRepositories(database);

  await emitAndFinalizeEnvIncident(repositories, join(directory, 'ac-race-monitor.sqlite'));
  await emitAndFinalizeEnvIncident(repositories, join(directory, 'ac-race-monitor.sqlite'));

  const incidents = repositories.liveIncidents.list();
  t.after(() => database.close());

  assert.equal(incidents.length, 2);
  assert.notEqual(incidents[0]?.incidentUid, incidents[1]?.incidentUid);
  assert.equal(incidents[0]?.snapshots.length, 3);
  assert.equal(incidents[1]?.snapshots.length, 3);
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

async function createLiveContext() {
  const directory = mkdtempSync(join(tmpdir(), 'motassettorr-live-incident-'));
  const database = openDatabase(join(directory, 'ac-race-monitor.sqlite'));
  const repositories = createRepositories(database);
  const socket = new FakeSocket();
  const client = await startAcUdpClient(createConfig(join(directory, 'ac-race-monitor.sqlite')), {
    socketFactory: () => socket as unknown as Socket,
    liveIncidentRepository: repositories.liveIncidents,
    logger: () => undefined,
  });

  return {
    database,
    repositories,
    socket,
    client,
  };
}

function createConfig(databasePath: string): AppConfig {
  return {
    resultsDir: '/app/results',
    databasePath,
    trackModelPath: '/app/track-models/monza/track-model.json',
    trackModelTrack: 'monza',
    trackModelLayout: null,
    discordWebhookUrl: '',
    incidentsDiscordWebhookUrl: '',
    incidentsWebhookEnabled: false,
    liveUdpEnabled: true,
    liveUdpDebug: false,
    acUdpServerHost: '127.0.0.1',
    acUdpServerPluginPort: 11000,
    acUdpPluginListenPort: 12000,
    realtimeReportIntervalMs: 250,
    snapshotRingBufferMs: 10000,
    incidentPreMs: 100,
    incidentPostMs: 20,
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
  };
}

async function emitAndFinalizeEnvIncident(
  repositories: ReturnType<typeof createRepositories>,
  databasePath: string
): Promise<void> {
  const socket = new FakeSocket();
  const client = await startAcUdpClient(createConfig(databasePath), {
    socketFactory: () => socket as unknown as Socket,
    liveIncidentRepository: repositories.liveIncidents,
    logger: () => undefined,
  });

  socket.emitMessage(createCarUpdatePacket({ carId: 9, posX: -12 }), fakeRemote());
  await sleep(10);
  socket.emitMessage(createCarUpdatePacket({ carId: 9, posX: -11 }), fakeRemote());
  await sleep(10);
  socket.emitMessage(createCollisionWithEnvPacket({ carId: 9, impactSpeed: 41.75 }), fakeRemote());
  await sleep(10);
  socket.emitMessage(createCarUpdatePacket({ carId: 9, posX: -9 }), fakeRemote());
  await sleep(40);
  client.getFinalizedIncidents();
  await client.close();
}

function createCarUpdatePacket(overrides: { carId?: number; posX?: number; posY?: number; posZ?: number } = {}): Buffer {
  const raw = Buffer.alloc(33);
  raw.writeUInt8(53, 0);
  raw.writeUInt8(overrides.carId ?? 7, 1);
  raw.writeFloatLE(overrides.posX ?? 1, 2);
  raw.writeFloatLE(overrides.posY ?? 2, 6);
  raw.writeFloatLE(overrides.posZ ?? 3, 10);
  raw.writeFloatLE(10, 14);
  raw.writeFloatLE(0, 18);
  raw.writeFloatLE(0, 22);
  raw.writeUInt8(4, 26);
  raw.writeUInt16LE(6123, 27);
  raw.writeFloatLE(0.625, 29);
  return raw;
}

function createCollisionWithCarPacket(overrides: { carId?: number; otherCarId?: number; impactSpeed?: number } = {}): Buffer {
  const raw = Buffer.alloc(32);
  raw.writeUInt8(130, 0);
  raw.writeUInt8(10, 1);
  raw.writeUInt8(overrides.carId ?? 4, 2);
  raw.writeUInt8(overrides.otherCarId ?? 8, 3);
  raw.writeFloatLE(overrides.impactSpeed ?? 72.4, 4);
  raw.writeFloatLE(100, 8);
  raw.writeFloatLE(5, 12);
  raw.writeFloatLE(-20, 16);
  raw.writeFloatLE(1.5, 20);
  raw.writeFloatLE(0.25, 24);
  raw.writeFloatLE(-0.5, 28);
  return raw;
}

function createCollisionWithEnvPacket(overrides: { carId?: number; impactSpeed?: number } = {}): Buffer {
  const raw = Buffer.alloc(31);
  raw.writeUInt8(130, 0);
  raw.writeUInt8(11, 1);
  raw.writeUInt8(overrides.carId ?? 9, 2);
  raw.writeFloatLE(overrides.impactSpeed ?? 41.75, 3);
  raw.writeFloatLE(-10, 7);
  raw.writeFloatLE(0.5, 11);
  raw.writeFloatLE(80, 15);
  raw.writeFloatLE(0.75, 19);
  raw.writeFloatLE(0, 23);
  raw.writeFloatLE(-1.25, 27);
  return raw;
}

function fakeRemote(): RemoteInfo {
  return { address: '127.0.0.1', family: 'IPv4', port: 11000, size: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
