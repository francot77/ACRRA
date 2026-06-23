import dgram, { Socket } from 'node:dgram';
import { AppConfig } from '../config';
import type { Repositories } from '../db/repositories';
import { LiveIncidentCaptureManager } from './liveIncidentCaptureManager';
import { LiveSnapshotRecorder } from './liveSnapshotRecorder';
import { LiveSmokeGate } from './smokeGate';
import { AcLivePacket, FinalizedLiveIncidentPackage, LiveCarSnapshot, LiveCollisionEvent, LiveUdpRuntimeStatus } from './liveTypes';
import { buildAssumedRealtimeReportEnableCommand, parseAcUdpPacket } from './udpProtocolParser';

type LogLevel = 'info' | 'warn' | 'error';

export type LiveLogger = (level: LogLevel, component: string, message: string, fields: Record<string, unknown>) => void;

export type AcUdpClient = {
  close: () => Promise<void>;
  getStatus: () => LiveUdpRuntimeStatus;
  getSnapshots: (carId: number, startMs: number, endMs: number) => LiveCarSnapshot[];
  getFinalizedIncidents: () => FinalizedLiveIncidentPackage[];
};

export async function startAcUdpClient(
  config: AppConfig,
  dependencies?: {
    socketFactory?: () => Socket;
    logger?: LiveLogger;
    smokeGate?: LiveSmokeGate;
    snapshotRecorder?: LiveSnapshotRecorder;
    liveIncidentRepository?: Repositories['liveIncidents'];
  }
): Promise<AcUdpClient> {
  const socket = dependencies?.socketFactory?.() ?? dgram.createSocket('udp4');
  const logger = dependencies?.logger ?? defaultLogger;
  const smokeGate = dependencies?.smokeGate ?? new LiveSmokeGate();
  const snapshotRecorder = dependencies?.snapshotRecorder ?? new LiveSnapshotRecorder(config.snapshotRingBufferMs);
  const liveIncidentRepository = dependencies?.liveIncidentRepository;
  const incidentCaptureManager = new LiveIncidentCaptureManager(snapshotRecorder, {
    incidentPreMs: config.incidentPreMs,
    incidentPostMs: config.incidentPostMs,
    onFinalize: (incident) => {
      if (!liveIncidentRepository) {
        return;
      }

      const result = liveIncidentRepository.persist({ incident });
      logger('info', 'live-udp', result.status === 'inserted' ? 'Persisted finalized live incident' : 'Skipped duplicate finalized live incident', {
        incidentUid: incident.incidentId,
        incidentType: incident.type,
        trackedCars: incident.cars.map((car) => car.carId),
        eventCount: incident.events.length,
        snapshotCount: result.status === 'inserted'
          ? result.snapshotCount
          : incident.cars.reduce((count, car) => count + car.snapshots.length, 0),
        persistenceStatus: result.status,
      });
    }
  });

  socket.on('message', (rawMessage, remote) => {
    const packet = parseAcUdpPacket(rawMessage);

    if (packet.type === 'unknown') {
      logger('warn', 'live-udp', 'Received unknown live UDP packet', {
        remoteAddress: remote.address,
        remotePort: remote.port,
        reason: packet.reason,
        previewHex: packet.previewHex,
        previewText: packet.previewText
      });
      return;
    }

    const stateBefore = smokeGate.getState();
    const stateAfter = smokeGate.observe(packet.type, new Date(packet.receivedAt));

    if (packet.type === 'car_update') {
      const snapshot = snapshotRecorder.recordCarUpdate(packet);
      incidentCaptureManager.observeSnapshot(snapshot);
    } else {
      incidentCaptureManager.observeCollision(toCollisionEvent(packet));
    }

    logger('info', 'live-udp', 'Received live UDP packet', {
      remoteAddress: remote.address,
      remotePort: remote.port,
      ...buildPacketLogFields(packet),
      smokeGateReady: stateAfter.ready,
      captureEnabled: stateAfter.captureEnabled
    });

    if (!stateBefore.ready && stateAfter.ready) {
      logger('info', 'live-udp', 'Live UDP smoke gate satisfied', stateAfter);
    }
  });

  socket.on('error', (error) => {
    logger('error', 'live-udp', 'Live UDP socket error', { error: error.message });
  });

  await bindSocket(socket, config.acUdpPluginListenPort);

  logger('info', 'live-udp', 'Live UDP listener bound', {
    listenPort: config.acUdpPluginListenPort,
    serverHost: config.acUdpServerHost,
    serverPluginPort: config.acUdpServerPluginPort,
    realtimeReportIntervalMs: config.realtimeReportIntervalMs,
    captureEnabled: false
  });

  const command = buildAssumedRealtimeReportEnableCommand(config.realtimeReportIntervalMs);
  socket.send(command, config.acUdpServerPluginPort, config.acUdpServerHost, (error) => {
    if (error) {
      logger('error', 'live-udp', 'Failed to send realtime report enable command', {
        error: error.message,
        protocol: 'ac-server-plugin-realtime-report-enable',
        packetId: 200,
        intervalEncoding: 'uint16le'
      });
      return;
    }

    logger('info', 'live-udp', 'Sent realtime report enable command', {
      protocol: 'ac-server-plugin-realtime-report-enable',
      packetId: 200,
      intervalEncoding: 'uint16le',
      intervalMs: config.realtimeReportIntervalMs,
      targetHost: config.acUdpServerHost,
      targetPort: config.acUdpServerPluginPort,
      payloadHex: command.toString('hex')
    });
  });

  return {
    close: () => closeSocket(socket),
    getStatus: () => ({
      smokeGate: smokeGate.getState(),
      finalizedIncidentCount: incidentCaptureManager.getFinalizedIncidentCount(),
      pendingIncidentCount: incidentCaptureManager.getPendingIncidentCount(),
    }),
    getSnapshots: (carId, startMs, endMs) => snapshotRecorder.getSnapshots(carId, startMs, endMs),
    getFinalizedIncidents: () => incidentCaptureManager.getFinalizedIncidents()
  };
}

async function bindSocket(socket: Socket, listenPort: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      socket.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      socket.off('error', handleError);
      resolve();
    };

    socket.once('error', handleError);
    socket.once('listening', handleListening);
    socket.bind(listenPort);
  });
}

async function closeSocket(socket: Socket): Promise<void> {
  await new Promise<void>((resolve) => {
    socket.close(() => resolve());
  });
}

function defaultLogger(level: LogLevel, component: string, message: string, fields: Record<string, unknown>): void {
  const payload = JSON.stringify({ level, component, message, ...fields });
  if (level === 'error') {
    console.error(payload);
    return;
  }

  console.info(payload);
}

function buildPacketLogFields(packet: Exclude<AcLivePacket, { type: 'unknown' }>): Record<string, unknown> {
  if (packet.type === 'car_update') {
    return {
      packetType: packet.type,
      carId: packet.carId,
      speedKmh: roundMetric(packet.speedKmh),
      spline: roundMetric(packet.normalizedSplinePos, 4),
      gear: packet.gear,
      engineRpm: packet.engineRpm,
      worldPos: packet.worldPosition,
      velocity: packet.velocity,
    };
  }

  if (packet.type === 'collision_with_car') {
    return {
      packetType: packet.type,
      carId: packet.carId,
      otherCarId: packet.otherCarId,
      impact: roundMetric(packet.impactSpeed),
      worldPos: packet.worldPosition,
      relPos: packet.relativePosition,
    };
  }

  return {
    packetType: packet.type,
    carId: packet.carId,
    impact: roundMetric(packet.impactSpeed),
    worldPos: packet.worldPosition,
    relPos: packet.relativePosition,
  };
}

function roundMetric(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function toCollisionEvent(packet: Exclude<AcLivePacket, { type: 'car_update' | 'unknown' }>): LiveCollisionEvent {
  const receivedAtMs = Date.parse(packet.receivedAt);

  if (packet.type === 'collision_with_car') {
    return {
      type: packet.type,
      receivedAt: packet.receivedAt,
      receivedAtMs,
      carId: packet.carId,
      otherCarId: packet.otherCarId,
      impactSpeed: packet.impactSpeed,
      worldPosition: packet.worldPosition,
      relativePosition: packet.relativePosition,
    };
  }

  return {
    type: packet.type,
    receivedAt: packet.receivedAt,
    receivedAtMs,
    carId: packet.carId,
    impactSpeed: packet.impactSpeed,
    worldPosition: packet.worldPosition,
    relativePosition: packet.relativePosition,
  };
}
