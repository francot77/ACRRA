export type LivePacketKind = 'car_update' | 'collision_with_car' | 'collision_with_env' | 'unknown';

export type KnownLivePacketKind = Exclude<LivePacketKind, 'unknown'>;

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

type BaseLivePacket = {
  type: LivePacketKind;
  receivedAt: string;
  raw: Buffer;
};

export type LiveCarUpdatePacket = BaseLivePacket & {
  type: 'car_update';
  carId?: number;
  speedKmh?: number;
  worldPosition?: Vector3;
};

export type LiveCollisionWithCarPacket = BaseLivePacket & {
  type: 'collision_with_car';
  carId?: number;
  otherCarId?: number;
  impactSpeedKmh?: number;
  worldPosition?: Vector3;
};

export type LiveCollisionWithEnvPacket = BaseLivePacket & {
  type: 'collision_with_env';
  carId?: number;
  impactSpeedKmh?: number;
  worldPosition?: Vector3;
};

export type UnknownLivePacket = BaseLivePacket & {
  type: 'unknown';
  reason: string;
  previewHex: string;
  previewText: string;
};

export type AcLivePacket =
  | LiveCarUpdatePacket
  | LiveCollisionWithCarPacket
  | LiveCollisionWithEnvPacket
  | UnknownLivePacket;

export type SmokeGateState = {
  ready: boolean;
  captureEnabled: false;
  seen: Record<KnownLivePacketKind, boolean>;
  seenAt: Partial<Record<KnownLivePacketKind, string>>;
  completedAt?: string;
};

export type LiveUdpRuntimeStatus = {
  smokeGate: SmokeGateState;
};
