import { LiveCarUpdatePacket, LiveCarSnapshot } from './liveTypes';
import { SnapshotRingBuffer } from './snapshotRingBuffer';

export class LiveSnapshotRecorder {
  private readonly ringBuffer: SnapshotRingBuffer;

  constructor(retentionMs: number, now?: () => number) {
    this.ringBuffer = new SnapshotRingBuffer(retentionMs, now);
  }

  recordCarUpdate(packet: LiveCarUpdatePacket): LiveCarSnapshot {
    const snapshot: LiveCarSnapshot = {
      receivedAtMs: packet.receivedAtMs,
      carId: packet.carId,
      pos: packet.worldPosition,
      velocity: packet.velocity,
      speedKmh: calculateSpeedKmh(packet.velocity),
      gear: packet.gear,
      engineRpm: packet.engineRpm,
      normalizedSplinePos: packet.normalizedSplinePos,
    };

    this.ringBuffer.insert(snapshot);
    return snapshot;
  }

  getSnapshots(carId: number, startMs: number, endMs: number): LiveCarSnapshot[] {
    return this.ringBuffer.query(carId, startMs, endMs);
  }

  getTrackedCarIds(): number[] {
    return this.ringBuffer.getTrackedCarIds();
  }
}

function calculateSpeedKmh(velocity: LiveCarSnapshot['velocity']): number {
  return Math.sqrt(
    velocity.x * velocity.x +
      velocity.y * velocity.y +
      velocity.z * velocity.z
  ) * 3.6;
}
