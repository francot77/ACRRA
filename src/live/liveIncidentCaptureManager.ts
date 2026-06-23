import {
  FinalizedLiveIncidentPackage,
  LiveCarSnapshot,
  LiveCollisionEvent,
  LiveCollisionPacketKind,
  LiveIncidentTrackedCar,
  Vector3,
} from './liveTypes';

const DEFAULT_GROUPING_WINDOW_MS = 1500;
const DEFAULT_GROUPING_DISTANCE_METERS = 15;

type SnapshotSource = {
  getSnapshots: (carId: number, startMs: number, endMs: number) => LiveCarSnapshot[];
  getTrackedCarIds?: () => number[];
};

type IncidentDebugLogger = (message: string, fields: Record<string, unknown>) => void;

type FinalizeDebugContext = {
  postLookupCounts: Record<number, number>;
  totalSnapshotCount: number;
};

type PendingLiveIncident = {
  incidentId: string;
  type: LiveCollisionPacketKind;
  firstReceivedAtMs: number;
  lastReceivedAtMs: number;
  captureStartMs: number;
  captureEndMs: number;
  anchorPosition: Vector3;
  events: LiveCollisionEvent[];
  trackedCars: Map<number, LiveCarSnapshot[]>;
};

export class LiveIncidentCaptureManager {
  private readonly finalizedIncidents: FinalizedLiveIncidentPackage[] = [];
  private readonly pendingIncidents: PendingLiveIncident[] = [];
  private nextIncidentSequence = 1;

  constructor(
    private readonly snapshotSource: SnapshotSource,
    private readonly config: {
      incidentPreMs: number;
      incidentPostMs: number;
      groupingWindowMs?: number;
      groupingDistanceMeters?: number;
      onFinalize?: (incident: FinalizedLiveIncidentPackage, debug: FinalizeDebugContext) => void;
      debugLogger?: IncidentDebugLogger;
    }
  ) {}

  observeCollision(event: LiveCollisionEvent): void {
    this.finalizeExpired(event.receivedAtMs);

    const pending = this.findGroupableIncident(event);
    if (pending) {
      pending.lastReceivedAtMs = Math.max(pending.lastReceivedAtMs, event.receivedAtMs);
      pending.captureEndMs = Math.max(pending.captureEndMs, event.receivedAtMs + this.config.incidentPostMs);
      pending.events.push(event);
      const preLookupCounts = this.seedSnapshots(pending, getTrackedCarIds(event), pending.captureStartMs, event.receivedAtMs);
      this.config.debugLogger?.('Grouped live incident collision observed', {
        incidentId: pending.incidentId,
        incidentType: event.type,
        carIds: getTrackedCarIds(event),
        impact: event.impactSpeed,
        ts: event.receivedAt,
        availableRingBufferCarIds: this.snapshotSource.getTrackedCarIds?.() ?? [],
        preLookupCounts,
        pendingIncidentCreated: false,
      });
      return;
    }

    const incident: PendingLiveIncident = {
      incidentId: buildIncidentId(event, this.nextIncidentSequence++),
      type: event.type,
      firstReceivedAtMs: event.receivedAtMs,
      lastReceivedAtMs: event.receivedAtMs,
      captureStartMs: event.receivedAtMs - this.config.incidentPreMs,
      captureEndMs: event.receivedAtMs + this.config.incidentPostMs,
      anchorPosition: event.worldPosition,
      events: [event],
      trackedCars: new Map<number, LiveCarSnapshot[]>(),
    };

    const preLookupCounts = this.seedSnapshots(incident, getTrackedCarIds(event), incident.captureStartMs, event.receivedAtMs);
    this.pendingIncidents.push(incident);
    this.config.debugLogger?.('Live incident collision observed', {
      incidentId: incident.incidentId,
      incidentType: event.type,
      carIds: getTrackedCarIds(event),
      impact: event.impactSpeed,
      ts: event.receivedAt,
      availableRingBufferCarIds: this.snapshotSource.getTrackedCarIds?.() ?? [],
      preLookupCounts,
      pendingIncidentCreated: true,
    });
  }

  observeSnapshot(snapshot: LiveCarSnapshot): void {
    this.finalizeExpired(snapshot.receivedAtMs);

    for (const incident of this.pendingIncidents) {
      const trackedSnapshots = incident.trackedCars.get(snapshot.carId);
      if (!trackedSnapshots) {
        continue;
      }

      if (snapshot.receivedAtMs < incident.captureStartMs || snapshot.receivedAtMs > incident.captureEndMs) {
        continue;
      }

      appendUniqueSnapshot(trackedSnapshots, snapshot);
    }
  }

  finalizeExpired(nowMs: number): void {
    const stillPending: PendingLiveIncident[] = [];

    for (const incident of this.pendingIncidents) {
      if (incident.captureEndMs >= nowMs) {
        stillPending.push(incident);
        continue;
      }

      const postLookupCounts = this.seedSnapshots(
        incident,
        Array.from(incident.trackedCars.keys()),
        incident.firstReceivedAtMs,
        incident.captureEndMs
      );

      const finalizedIncident = {
        incidentId: incident.incidentId,
        type: incident.type,
        firstReceivedAtMs: incident.firstReceivedAtMs,
        lastReceivedAtMs: incident.lastReceivedAtMs,
        captureStartMs: incident.captureStartMs,
        captureEndMs: incident.captureEndMs,
        anchorPosition: incident.anchorPosition,
        events: incident.events.slice().sort((left, right) => left.receivedAtMs - right.receivedAtMs),
        cars: Array.from(incident.trackedCars.entries())
          .sort(([left], [right]) => left - right)
          .map(([carId, snapshots]): LiveIncidentTrackedCar => ({
            carId,
            snapshots: snapshots.slice().sort((left, right) => left.receivedAtMs - right.receivedAtMs),
          })),
      };

      const totalSnapshotCount = finalizedIncident.cars.reduce((count, car) => count + car.snapshots.length, 0);
      this.finalizedIncidents.push(finalizedIncident);
      this.config.debugLogger?.('Finalized live incident snapshot capture', {
        incidentId: finalizedIncident.incidentId,
        incidentType: finalizedIncident.type,
        ts: new Date(finalizedIncident.lastReceivedAtMs).toISOString(),
        postLookupCounts,
        totalSnapshotCount,
      });
      if (totalSnapshotCount === 0) {
        this.config.debugLogger?.('Live incident finalized without snapshots', {
          incidentId: finalizedIncident.incidentId,
          incidentType: finalizedIncident.type,
          reason: 'No snapshots found inside capture window',
        });
      }
      this.config.onFinalize?.(cloneIncident(finalizedIncident), {
        postLookupCounts,
        totalSnapshotCount,
      });
    }

    this.pendingIncidents.length = 0;
    this.pendingIncidents.push(...stillPending);
  }

  getFinalizedIncidents(nowMs = Date.now()): FinalizedLiveIncidentPackage[] {
    this.finalizeExpired(nowMs);
    return this.finalizedIncidents.map(cloneIncident);
  }

  getPendingIncidentCount(nowMs = Date.now()): number {
    this.finalizeExpired(nowMs);
    return this.pendingIncidents.length;
  }

  getFinalizedIncidentCount(nowMs = Date.now()): number {
    this.finalizeExpired(nowMs);
    return this.finalizedIncidents.length;
  }

  private findGroupableIncident(event: LiveCollisionEvent): PendingLiveIncident | undefined {
    const groupingWindowMs = this.config.groupingWindowMs ?? DEFAULT_GROUPING_WINDOW_MS;
    const groupingDistanceMeters = this.config.groupingDistanceMeters ?? DEFAULT_GROUPING_DISTANCE_METERS;

    return this.pendingIncidents.find((incident) => {
      if (incident.type !== event.type) {
        return false;
      }

      const latestEvent = incident.events[incident.events.length - 1];
      if (!latestEvent || !eventsShareParticipants(latestEvent, event)) {
        return false;
      }

      if (event.receivedAtMs - incident.lastReceivedAtMs > groupingWindowMs) {
        return false;
      }

      return distanceBetween(incident.anchorPosition, event.worldPosition) <= groupingDistanceMeters;
    });
  }

  private seedSnapshots(
    incident: PendingLiveIncident,
    carIds: number[],
    startMs: number,
    endMs: number
  ): Record<number, number> {
    const lookupCounts: Record<number, number> = {};

    for (const carId of carIds) {
      const trackedSnapshots = incident.trackedCars.get(carId) ?? [];
      const seededSnapshots = this.snapshotSource.getSnapshots(carId, startMs, endMs);
      lookupCounts[carId] = seededSnapshots.length;
      for (const snapshot of seededSnapshots) {
        appendUniqueSnapshot(trackedSnapshots, snapshot);
      }

      incident.trackedCars.set(carId, trackedSnapshots);
    }

    return lookupCounts;
  }
}

function getTrackedCarIds(event: LiveCollisionEvent): number[] {
  return event.type === 'collision_with_car'
    ? uniqueNumbers([event.carId, event.otherCarId])
    : [event.carId];
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values));
}

function appendUniqueSnapshot(target: LiveCarSnapshot[], snapshot: LiveCarSnapshot): void {
  if (target.some((entry) => entry.receivedAtMs === snapshot.receivedAtMs && entry.carId === snapshot.carId)) {
    return;
  }

  target.push(snapshot);
}

function buildIncidentId(event: LiveCollisionEvent, sequence: number): string {
  const participantIds = getTrackedCarIds(event).sort((left, right) => left - right).join('-');
  return `live-incident-${event.receivedAtMs}-${event.type}-${participantIds}-${sequence}`;
}

function distanceBetween(left: Vector3, right: Vector3): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  const z = left.z - right.z;
  return Math.sqrt((x * x) + (y * y) + (z * z));
}

function eventsShareParticipants(left: LiveCollisionEvent, right: LiveCollisionEvent): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === 'collision_with_env' && right.type === 'collision_with_env') {
    return left.carId === right.carId;
  }

  if (left.type === 'collision_with_car' && right.type === 'collision_with_car') {
    const leftCars = new Set([left.carId, left.otherCarId]);
    return leftCars.has(right.carId) || leftCars.has(right.otherCarId);
  }

  return false;
}

function cloneIncident(incident: FinalizedLiveIncidentPackage): FinalizedLiveIncidentPackage {
  return {
    ...incident,
    anchorPosition: { ...incident.anchorPosition },
    events: incident.events.map((event) => ({
      ...event,
      worldPosition: { ...event.worldPosition },
      relativePosition: { ...event.relativePosition },
    })),
    cars: incident.cars.map((car) => ({
      carId: car.carId,
      snapshots: car.snapshots.map((snapshot) => ({
        ...snapshot,
        pos: { ...snapshot.pos },
        velocity: { ...snapshot.velocity },
      })),
    })),
  };
}
