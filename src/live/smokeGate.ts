import { KnownLivePacketKind, SmokeGateState } from './liveTypes';

const REQUIRED_PACKET_KINDS: KnownLivePacketKind[] = ['car_update', 'collision_with_car', 'collision_with_env'];

export class LiveSmokeGate {
  private readonly seenAt = new Map<KnownLivePacketKind, string>();

  private completedAt?: string;

  observe(packetKind: KnownLivePacketKind, observedAt = new Date()): SmokeGateState {
    if (!this.seenAt.has(packetKind)) {
      this.seenAt.set(packetKind, observedAt.toISOString());
    }

    if (!this.completedAt && REQUIRED_PACKET_KINDS.every((kind) => this.seenAt.has(kind))) {
      this.completedAt = observedAt.toISOString();
    }

    return this.getState();
  }

  getState(): SmokeGateState {
    const seen = REQUIRED_PACKET_KINDS.reduce<Record<KnownLivePacketKind, boolean>>((accumulator, kind) => {
      accumulator[kind] = this.seenAt.has(kind);
      return accumulator;
    }, { car_update: false, collision_with_car: false, collision_with_env: false });

    const seenAt = REQUIRED_PACKET_KINDS.reduce<Partial<Record<KnownLivePacketKind, string>>>((accumulator, kind) => {
      const value = this.seenAt.get(kind);
      if (value) {
        accumulator[kind] = value;
      }

      return accumulator;
    }, {});

    return {
      ready: REQUIRED_PACKET_KINDS.every((kind) => seen[kind]),
      captureEnabled: false,
      seen,
      seenAt,
      completedAt: this.completedAt
    };
  }
}
