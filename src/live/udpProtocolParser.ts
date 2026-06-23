import {
  AcLivePacket,
  LiveCarUpdatePacket,
  LiveCollisionWithCarPacket,
  LiveCollisionWithEnvPacket,
  UnknownLivePacket,
  Vector3,
} from './liveTypes';

type JsonPacket = Record<string, unknown>;

const CAR_UPDATE_PACKET_ID = 53;
const CLIENT_EVENT_PACKET_ID = 130;
const COLLISION_WITH_CAR_EVENT_ID = 10;
const COLLISION_WITH_ENV_EVENT_ID = 11;
const REALTIME_REPORT_ENABLE_PACKET_ID = 200;

export function parseAcUdpPacket(raw: Buffer, receivedAt = new Date()): AcLivePacket {
  const receivedAtMs = receivedAt.getTime();
  const timestamp = new Date(receivedAtMs).toISOString();

  const binaryPacket = tryParseBinaryPacket(raw, timestamp, receivedAtMs);
  if (binaryPacket) {
    return binaryPacket;
  }

  const jsonPacket = tryParseJsonPacket(raw);
  if (jsonPacket) {
    return mapKnownPacket(jsonPacket, raw, timestamp, receivedAtMs);
  }

  const textPacket = raw.toString('utf8').trim();
  if (textPacket.length > 0) {
    const delimitedPacket = parseDelimitedPacket(textPacket);
    if (delimitedPacket) {
      return mapKnownPacket(delimitedPacket, raw, timestamp, receivedAtMs);
    }
  }

  return createUnknownPacket(raw, timestamp, receivedAtMs, 'Unsupported packet format');
}

export function buildAssumedRealtimeReportEnableCommand(intervalMs: number): Buffer {
  const payload = Buffer.alloc(3);
  payload.writeUInt8(REALTIME_REPORT_ENABLE_PACKET_ID, 0);
  payload.writeUInt16LE(intervalMs, 1);
  return payload;
}

function tryParseBinaryPacket(raw: Buffer, receivedAt: string, receivedAtMs: number): AcLivePacket | null {
  if (raw.length < 1) {
    return null;
  }

  const packetId = raw.readUInt8(0);
  if (packetId === CAR_UPDATE_PACKET_ID) {
    return parseCarUpdatePacket(raw, receivedAt, receivedAtMs);
  }

  if (packetId === CLIENT_EVENT_PACKET_ID) {
    return parseClientEventPacket(raw, receivedAt, receivedAtMs);
  }

  return null;
}

function tryParseJsonPacket(raw: Buffer): JsonPacket | null {
  const source = raw.toString('utf8').trim();
  if (!source.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(source);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseDelimitedPacket(source: string): JsonPacket | null {
  const [head, ...segments] = source.split('|');
  const normalizedType = normalizePacketKind(head);
  if (!normalizedType) {
    return null;
  }

  const packet: JsonPacket = { type: normalizedType };
  for (const segment of segments) {
    const [key, value] = segment.split('=');
    if (!key || value === undefined) {
      continue;
    }

    packet[key.trim()] = value.trim();
  }

  return packet;
}

function mapKnownPacket(packet: JsonPacket, raw: Buffer, receivedAt: string, receivedAtMs: number): AcLivePacket {
  const packetKind = normalizePacketKind(packet.type ?? packet.packetType ?? packet.event);
  if (!packetKind) {
    return createUnknownPacket(raw, receivedAt, receivedAtMs, 'Packet type not recognized');
  }

  if (packetKind === 'car_update') {
    const worldPosition = toOptionalVector(packet.worldPosition ?? packet.position);
    const velocity = toOptionalVector(packet.velocity);
    const carId = toOptionalNumber(packet.carId);
    const gear = toOptionalNumber(packet.gear);
    const engineRpm = toOptionalNumber(packet.engineRpm);
    const normalizedSplinePos = toOptionalNumber(packet.normalizedSplinePos);
    if (!worldPosition || !velocity || carId === undefined || gear === undefined || engineRpm === undefined || normalizedSplinePos === undefined) {
      return createUnknownPacket(raw, receivedAt, receivedAtMs, 'Incomplete car_update packet');
    }

    const result: LiveCarUpdatePacket = {
      type: 'car_update',
      receivedAt,
      receivedAtMs,
      raw,
      carId,
      worldPosition,
      velocity,
      speedKmh: toOptionalNumber(packet.speedKmh ?? packet.speed) ?? calculateSpeedKmh(velocity),
      gear,
      engineRpm,
      normalizedSplinePos,
    };
    return result;
  }

  if (packetKind === 'collision_with_car') {
    const worldPosition = toOptionalVector(packet.worldPosition ?? packet.position);
    const relativePosition = toOptionalVector(packet.relativePosition ?? packet.relPos);
    const carId = toOptionalNumber(packet.carId);
    const otherCarId = toOptionalNumber(packet.otherCarId);
    const impactSpeed = toOptionalNumber(packet.impactSpeedKmh ?? packet.impactSpeed);
    if (!worldPosition || !relativePosition || carId === undefined || otherCarId === undefined || impactSpeed === undefined) {
      return createUnknownPacket(raw, receivedAt, receivedAtMs, 'Incomplete collision_with_car packet');
    }

    const result: LiveCollisionWithCarPacket = {
      type: 'collision_with_car',
      receivedAt,
      receivedAtMs,
      raw,
      carId,
      otherCarId,
      impactSpeed,
      worldPosition,
      relativePosition,
    };
    return result;
  }

  const worldPosition = toOptionalVector(packet.worldPosition ?? packet.position);
  const relativePosition = toOptionalVector(packet.relativePosition ?? packet.relPos);
  const carId = toOptionalNumber(packet.carId);
  const impactSpeed = toOptionalNumber(packet.impactSpeedKmh ?? packet.impactSpeed);
  if (!worldPosition || !relativePosition || carId === undefined || impactSpeed === undefined) {
    return createUnknownPacket(raw, receivedAt, receivedAtMs, 'Incomplete collision_with_env packet');
  }

  const result: LiveCollisionWithEnvPacket = {
    type: 'collision_with_env',
    receivedAt,
    receivedAtMs,
    raw,
    carId,
    impactSpeed,
    worldPosition,
    relativePosition,
  };
  return result;
}

function parseCarUpdatePacket(raw: Buffer, receivedAt: string, receivedAtMs: number): AcLivePacket {
  const expectedLength = 33;
  if (raw.length < expectedLength) {
    return createUnknownPacket(raw, receivedAt, receivedAtMs, `CarUpdate packet too short: expected >= ${expectedLength} bytes, got ${raw.length}`);
  }

  const worldPosition = readVector3(raw, 2);
  const velocity = readVector3(raw, 14);

  return {
    type: 'car_update',
    receivedAt,
    receivedAtMs,
    raw,
    carId: raw.readUInt8(1),
    worldPosition,
    velocity,
    speedKmh: calculateSpeedKmh(velocity),
    gear: raw.readUInt8(26),
    engineRpm: raw.readUInt16LE(27),
    normalizedSplinePos: raw.readFloatLE(29),
  };
}

function parseClientEventPacket(raw: Buffer, receivedAt: string, receivedAtMs: number): AcLivePacket {
  if (raw.length < 2) {
    return createUnknownPacket(raw, receivedAt, receivedAtMs, `Client event packet too short: expected >= 2 bytes, got ${raw.length}`);
  }

  const eventType = raw.readUInt8(1);
  if (eventType === COLLISION_WITH_CAR_EVENT_ID) {
    const expectedLength = 32;
    if (raw.length < expectedLength) {
      return createUnknownPacket(raw, receivedAt, receivedAtMs, `collision_with_car packet too short: expected >= ${expectedLength} bytes, got ${raw.length}`);
    }

    return {
      type: 'collision_with_car',
      receivedAt,
      receivedAtMs,
      raw,
      carId: raw.readUInt8(2),
      otherCarId: raw.readUInt8(3),
      impactSpeed: raw.readFloatLE(4),
      worldPosition: readVector3(raw, 8),
      relativePosition: readVector3(raw, 20),
    };
  }

  if (eventType === COLLISION_WITH_ENV_EVENT_ID) {
    const expectedLength = 31;
    if (raw.length < expectedLength) {
      return createUnknownPacket(raw, receivedAt, receivedAtMs, `collision_with_env packet too short: expected >= ${expectedLength} bytes, got ${raw.length}`);
    }

    return {
      type: 'collision_with_env',
      receivedAt,
      receivedAtMs,
      raw,
      carId: raw.readUInt8(2),
      impactSpeed: raw.readFloatLE(3),
      worldPosition: readVector3(raw, 7),
      relativePosition: readVector3(raw, 19),
    };
  }

  return createUnknownPacket(raw, receivedAt, receivedAtMs, `Unsupported client event type: ${eventType}`);
}

function createUnknownPacket(raw: Buffer, receivedAt: string, receivedAtMs: number, reason: string): UnknownLivePacket {
  return {
    type: 'unknown',
    receivedAt,
    receivedAtMs,
    raw,
    reason,
    previewHex: raw.subarray(0, 32).toString('hex'),
    previewText: raw.toString('utf8', 0, Math.min(raw.length, 64)).replace(/\0/g, ''),
  };
}

function normalizePacketKind(value: unknown): 'car_update' | 'collision_with_car' | 'collision_with_env' | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'car_update' || normalized === 'collision_with_car' || normalized === 'collision_with_env') {
    return normalized;
  }

  return null;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toOptionalVector(value: unknown): Vector3 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const x = toOptionalNumber(value.x);
  const y = toOptionalNumber(value.y);
  const z = toOptionalNumber(value.z);
  if (x === undefined || y === undefined || z === undefined) {
    return undefined;
  }

  return { x, y, z };
}

function readVector3(raw: Buffer, offset: number): Vector3 {
  return {
    x: raw.readFloatLE(offset),
    y: raw.readFloatLE(offset + 4),
    z: raw.readFloatLE(offset + 8),
  };
}

function calculateSpeedKmh(velocity: Vector3): number {
  const metersPerSecond = Math.hypot(velocity.x, velocity.y, velocity.z);
  return metersPerSecond * 3.6;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
