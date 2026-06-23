export type LivePacketKind = 'car_update' | 'collision_with_car' | 'collision_with_env' | 'unknown';

export type KnownLivePacketKind = Exclude<LivePacketKind, 'unknown'>;

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type LiveCarSnapshot = {
  receivedAtMs: number;
  carId: number;
  pos: Vector3;
  velocity: Vector3;
  speedKmh: number;
  gear?: number;
  engineRpm?: number;
  normalizedSplinePos?: number;
};

export type LiveCollisionPacketKind = 'collision_with_car' | 'collision_with_env';

type BaseLivePacket = {
  type: LivePacketKind;
  receivedAt: string;
  raw: Buffer;
};

export type LiveCarUpdatePacket = BaseLivePacket & {
  type: 'car_update';
  carId: number;
  worldPosition: Vector3;
  velocity: Vector3;
  speedKmh: number;
  gear: number;
  engineRpm: number;
  normalizedSplinePos: number;
};

export type LiveCollisionWithCarPacket = BaseLivePacket & {
  type: 'collision_with_car';
  carId: number;
  otherCarId: number;
  impactSpeed: number;
  worldPosition: Vector3;
  relativePosition: Vector3;
};

export type LiveCollisionWithEnvPacket = BaseLivePacket & {
  type: 'collision_with_env';
  carId: number;
  impactSpeed: number;
  worldPosition: Vector3;
  relativePosition: Vector3;
};

export type LiveCollisionEvent =
  | {
      type: 'collision_with_car';
      receivedAt: string;
      receivedAtMs: number;
      carId: number;
      otherCarId: number;
      impactSpeed: number;
      worldPosition: Vector3;
      relativePosition: Vector3;
    }
  | {
      type: 'collision_with_env';
      receivedAt: string;
      receivedAtMs: number;
      carId: number;
      impactSpeed: number;
      worldPosition: Vector3;
      relativePosition: Vector3;
    };

export type LiveIncidentTrackedCar = {
  carId: number;
  snapshots: LiveCarSnapshot[];
};

export type FinalizedLiveIncidentPackage = {
  incidentId: string;
  type: LiveCollisionPacketKind;
  firstReceivedAtMs: number;
  lastReceivedAtMs: number;
  captureStartMs: number;
  captureEndMs: number;
  anchorPosition: Vector3;
  events: LiveCollisionEvent[];
  cars: LiveIncidentTrackedCar[];
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
  finalizedIncidentCount: number;
  pendingIncidentCount: number;
};
