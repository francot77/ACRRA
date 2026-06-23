import {
  AcLivePacket,
  KnownLivePacketKind,
  LiveCarUpdatePacket,
  LiveCollisionWithCarPacket,
  LiveCollisionWithEnvPacket,
  UnknownLivePacket,
  Vector3
} from './liveTypes';

type JsonPacket = Record<string, unknown>;

export function parseAcUdpPacket(raw: Buffer, receivedAt = new Date()): AcLivePacket {
  const timestamp = receivedAt.toISOString();

  const jsonPacket = tryParseJsonPacket(raw);
  if (jsonPacket) {
    return mapKnownPacket(jsonPacket, raw, timestamp);
  }

  const textPacket = raw.toString('utf8').trim();
  if (textPacket.length > 0) {
    const delimitedPacket = parseDelimitedPacket(textPacket);
    if (delimitedPacket) {
      return mapKnownPacket(delimitedPacket, raw, timestamp);
    }
  }

  return createUnknownPacket(raw, timestamp, 'Unsupported packet format');
}

export function buildAssumedRealtimeReportEnableCommand(intervalMs: number): Buffer {
  const payload = Buffer.alloc(5);
  payload.writeUInt8(1, 0);
  payload.writeUInt32LE(intervalMs, 1);
  return payload;
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

function mapKnownPacket(packet: JsonPacket, raw: Buffer, receivedAt: string): AcLivePacket {
  const packetKind = normalizePacketKind(packet.type ?? packet.packetType ?? packet.event);
  if (!packetKind) {
    return createUnknownPacket(raw, receivedAt, 'Packet type not recognized');
  }

  if (packetKind === 'car_update') {
    const result: LiveCarUpdatePacket = {
      type: 'car_update',
      receivedAt,
      raw,
      carId: toOptionalNumber(packet.carId),
      speedKmh: toOptionalNumber(packet.speedKmh ?? packet.speed),
      worldPosition: toOptionalVector(packet.worldPosition ?? packet.position)
    };
    return result;
  }

  if (packetKind === 'collision_with_car') {
    const result: LiveCollisionWithCarPacket = {
      type: 'collision_with_car',
      receivedAt,
      raw,
      carId: toOptionalNumber(packet.carId),
      otherCarId: toOptionalNumber(packet.otherCarId),
      impactSpeedKmh: toOptionalNumber(packet.impactSpeedKmh ?? packet.impactSpeed),
      worldPosition: toOptionalVector(packet.worldPosition ?? packet.position)
    };
    return result;
  }

  const result: LiveCollisionWithEnvPacket = {
    type: 'collision_with_env',
    receivedAt,
    raw,
    carId: toOptionalNumber(packet.carId),
    impactSpeedKmh: toOptionalNumber(packet.impactSpeedKmh ?? packet.impactSpeed),
    worldPosition: toOptionalVector(packet.worldPosition ?? packet.position)
  };
  return result;
}

function createUnknownPacket(raw: Buffer, receivedAt: string, reason: string): UnknownLivePacket {
  return {
    type: 'unknown',
    receivedAt,
    raw,
    reason,
    previewHex: raw.subarray(0, 32).toString('hex'),
    previewText: raw.toString('utf8', 0, Math.min(raw.length, 64)).replace(/\0/g, ''),
  };
}

function normalizePacketKind(value: unknown): KnownLivePacketKind | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
