import type { TrackIdentityInput, TrackQueryService } from '../track/trackQueryService';
import { LiveCarUpdatePacket, LiveCarSnapshot } from './liveTypes';
import { SnapshotRingBuffer } from './snapshotRingBuffer';

type SnapshotTrackContextInput = {
  queryService: TrackQueryService;
  sessionTrackIdentity: TrackIdentityInput;
};

export class LiveSnapshotRecorder {
  private readonly ringBuffer: SnapshotRingBuffer;

  constructor(retentionMs: number, now?: () => number) {
    this.ringBuffer = new SnapshotRingBuffer(retentionMs, now);
  }

  recordCarUpdate(packet: LiveCarUpdatePacket, trackContextInput?: SnapshotTrackContextInput): LiveCarSnapshot {
    const snapshot: LiveCarSnapshot = {
      receivedAtMs: packet.receivedAtMs,
      carId: packet.carId,
      pos: packet.worldPosition,
      velocity: packet.velocity,
      speedKmh: calculateSpeedKmh(packet.velocity),
      gear: packet.gear,
      engineRpm: packet.engineRpm,
      normalizedSplinePos: packet.normalizedSplinePos,
      trackContext: resolveTrackContext(packet, trackContextInput),
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

function resolveTrackContext(
  packet: LiveCarUpdatePacket,
  trackContextInput?: SnapshotTrackContextInput
): LiveCarSnapshot['trackContext'] {
  if (!trackContextInput) {
    return null;
  }

  if (!trackContextInput.queryService.resolveTrack(trackContextInput.sessionTrackIdentity)) {
    return null;
  }

  if (Number.isFinite(packet.normalizedSplinePos)) {
    return trackContextInput.queryService.projectByProgress(packet.normalizedSplinePos);
  }

  if (!hasFiniteVector(packet.worldPosition)) {
    return null;
  }

  return trackContextInput.queryService.projectByWorldPosition(packet.worldPosition);
}

function hasFiniteVector(vector: LiveCarUpdatePacket['worldPosition']): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}
