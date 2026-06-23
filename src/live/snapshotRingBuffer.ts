import { LiveCarSnapshot } from './liveTypes';

export class SnapshotRingBuffer {
  private readonly snapshotsByCarId = new Map<number, LiveCarSnapshot[]>();

  constructor(
    private readonly retentionMs: number,
    private readonly now: () => number = Date.now
  ) {}

  insert(snapshot: LiveCarSnapshot): void {
    const snapshots = this.snapshotsByCarId.get(snapshot.carId) ?? [];
    snapshots.push(snapshot);
    this.snapshotsByCarId.set(snapshot.carId, snapshots);
    this.purgeOlderThan(snapshot.receivedAtMs - this.retentionMs, snapshot.carId);
  }

  query(carId: number, startMs: number, endMs: number): LiveCarSnapshot[] {
    this.purgeExpired();

    const snapshots = this.snapshotsByCarId.get(carId) ?? [];
    return snapshots.filter((snapshot) => snapshot.receivedAtMs >= startMs && snapshot.receivedAtMs <= endMs);
  }

  purgeExpired(): void {
    this.purgeOlderThan(this.now() - this.retentionMs);
  }

  private purgeOlderThan(cutoffMs: number, targetCarId?: number): void {
    const carIds = targetCarId === undefined ? this.snapshotsByCarId.keys() : [targetCarId];

    for (const carId of carIds) {
      const snapshots = this.snapshotsByCarId.get(carId);
      if (!snapshots) {
        continue;
      }

      const retained = snapshots.filter((snapshot) => snapshot.receivedAtMs >= cutoffMs);
      if (retained.length === 0) {
        this.snapshotsByCarId.delete(carId);
        continue;
      }

      this.snapshotsByCarId.set(carId, retained);
    }
  }
}
