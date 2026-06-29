import dgram, { Socket } from 'node:dgram';
import { AppConfig } from '../config';
import type { Repositories } from '../db/repositories';
import { TrackQueryService } from '../track/trackQueryService';
import type { TrackRuntimeModel } from '../track/trackTypes';
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
    trackRuntime?: TrackRuntimeModel;
  }
): Promise<AcUdpClient> {
  const socket = dependencies?.socketFactory?.() ?? dgram.createSocket('udp4');
  const logger = dependencies?.logger ?? defaultLogger;
  const smokeGate = dependencies?.smokeGate ?? new LiveSmokeGate();
  const snapshotRecorder = dependencies?.snapshotRecorder ?? new LiveSnapshotRecorder(config.snapshotRingBufferMs);
  const liveIncidentRepository = dependencies?.liveIncidentRepository;
  const trackContextInput = dependencies?.trackRuntime
    ? {
        queryService: new TrackQueryService(dependencies.trackRuntime),
        sessionTrackIdentity: {
          trackName: dependencies.trackRuntime.track,
          trackConfig: dependencies.trackRuntime.layout,
        },
      }
    : undefined;
  const incidentDebug = createIncidentDebugLogger(config, logger, snapshotRecorder);
  const realtimeReportKeepAlive = createRealtimeReportKeepAlive(config, logger, socket);
  const incidentCaptureManager = new LiveIncidentCaptureManager(snapshotRecorder, {
    incidentPreMs: config.incidentPreMs,
    incidentPostMs: config.incidentPostMs,
    trackContextInput,
    debugLogger: incidentDebug,
    onFinalize: (incident, finalizeDebug) => {
      if (finalizeDebug.totalSnapshotCount === 0) {
        logger('warn', 'live-udp', 'Skipped finalized live incident persistence because no snapshots were captured', {
          incidentUid: incident.incidentId,
          incidentType: incident.type,
          trackedCars: incident.cars.map((car) => car.carId),
          eventCount: incident.events.length,
          snapshotCount: 0,
          persistenceStatus: 'skipped_zero_snapshots',
        });
        incidentDebug('Skipped finalized live incident persistence', {
          incidentUid: incident.incidentId,
          incidentType: incident.type,
          postLookupCounts: finalizeDebug.postLookupCounts,
          totalPersistedCount: 0,
          persistenceStatus: 'skipped_zero_snapshots',
          reason: 'No snapshots found inside capture window',
        });
        return;
      }

      if (!liveIncidentRepository) {
        incidentDebug('Skipped live incident persistence because repository is unavailable', {
          incidentUid: incident.incidentId,
          incidentType: incident.type,
          totalSnapshotCount: finalizeDebug.totalSnapshotCount,
          reason: 'liveIncidentRepository missing',
        });
        return;
      }

      try {
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
        incidentDebug('Finalized live incident persisted', {
          incidentUid: incident.incidentId,
          incidentType: incident.type,
          postLookupCounts: finalizeDebug.postLookupCounts,
          totalPersistedCount: result.status === 'inserted' ? result.snapshotCount : finalizeDebug.totalSnapshotCount,
          persistenceStatus: result.status,
        });
      } catch (error) {
        logger('error', 'live-udp', 'Failed to persist finalized live incident', {
          incidentUid: incident.incidentId,
          incidentType: incident.type,
          reason: error instanceof Error ? error.message : String(error),
        });
        incidentDebug('Failed to persist finalized live incident', {
          incidentUid: incident.incidentId,
          incidentType: incident.type,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  });

  socket.on('message', (rawMessage, remote) => {
    const packet = parseAcUdpPacket(rawMessage);
    incidentDebug.observePacket(packet.type);
    realtimeReportKeepAlive.observePacket(packet.type, packet.receivedAtMs);

    if (packet.type === 'unknown') {
      logger('warn', 'live-udp', 'Received unknown live UDP packet', {
        remoteAddress: remote.address,
        remotePort: remote.port,
        reason: packet.reason,
        previewHex: packet.previewHex,
        previewText: packet.previewText
      });
      incidentDebug.maybeLogSummary(packet.receivedAtMs, incidentCaptureManager);
      return;
    }

    const stateBefore = smokeGate.getState();
    const stateAfter = smokeGate.observe(packet.type, new Date(packet.receivedAtMs));

    if (packet.type === 'car_update') {
      const snapshot = snapshotRecorder.recordCarUpdate(packet, trackContextInput);
      incidentCaptureManager.observeSnapshot(snapshot);
    } else {
      incidentCaptureManager.observeCollision(toCollisionEvent(packet));
    }

    incidentDebug.maybeLogSummary(packet.receivedAtMs, incidentCaptureManager);

    if (config.liveUdpDebug) {
      logger('info', 'live-udp', 'Received live UDP packet', {
        remoteAddress: remote.address,
        remotePort: remote.port,
        ...buildPacketLogFields(packet),
        smokeGateReady: stateAfter.ready,
        captureEnabled: stateAfter.captureEnabled
      });
    }

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

  sendRealtimeReportEnableCommand(socket, config, logger, 'Sent realtime report enable command');

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

function sendRealtimeReportEnableCommand(
  socket: Socket,
  config: AppConfig,
  logger: LiveLogger,
  successMessage: string
): void {
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

    logger('info', 'live-udp', successMessage, {
      protocol: 'ac-server-plugin-realtime-report-enable',
      packetId: 200,
      intervalEncoding: 'uint16le',
      intervalMs: config.realtimeReportIntervalMs,
      targetHost: config.acUdpServerHost,
      targetPort: config.acUdpServerPluginPort,
      payloadHex: command.toString('hex')
    });
  });
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
  const receivedAtMs = packet.receivedAtMs;

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

type IncidentDebugLoggerFn = ((message: string, fields: Record<string, unknown>) => void) & {
  observePacket: (packetType: AcLivePacket['type']) => void;
  maybeLogSummary: (nowMs: number, incidentCaptureManager: LiveIncidentCaptureManager) => void;
};

type RealtimeReportKeepAlive = {
  observePacket: (packetType: AcLivePacket['type'], nowMs: number) => void;
};

function createRealtimeReportKeepAlive(
  config: AppConfig,
  logger: LiveLogger,
  socket: Socket
): RealtimeReportKeepAlive {
  const summaryIntervalMs = 5000;
  const baseCooldownMs = 15000;
  const maxCooldownMs = 60000;
  let nextSummaryAtMs = 0;
  let windowPacketCount = 0;
  let windowCarUpdateCount = 0;
  let sawCarUpdateOnce = false;
  let currentCooldownMs = baseCooldownMs;
  let nextAllowedAttemptAtMs = 0;

  return {
    observePacket: (packetType, nowMs) => {
      windowPacketCount += 1;

      if (packetType === 'car_update') {
        windowCarUpdateCount += 1;
        sawCarUpdateOnce = true;
      }

      if (nowMs < nextSummaryAtMs) {
        return;
      }

      const shouldAttemptReenable = sawCarUpdateOnce
        && windowPacketCount > 0
        && windowCarUpdateCount === 0
        && nowMs >= nextAllowedAttemptAtMs;

      if (shouldAttemptReenable) {
        logger('warn', 'live-udp', 'Live UDP stream missing car_update packets while other traffic continues; re-sending realtime report enable command', {
          windowPacketCount,
          windowCarUpdateCount,
          summaryIntervalMs,
          cooldownMs: currentCooldownMs,
          intervalMs: config.realtimeReportIntervalMs,
          targetHost: config.acUdpServerHost,
          targetPort: config.acUdpServerPluginPort,
        });
        sendRealtimeReportEnableCommand(socket, config, logger, 'Re-sent realtime report enable command');
        nextAllowedAttemptAtMs = nowMs + currentCooldownMs;
        currentCooldownMs = Math.min(currentCooldownMs * 2, maxCooldownMs);
      }

      if (windowCarUpdateCount > 0) {
        currentCooldownMs = baseCooldownMs;
      }

      windowPacketCount = 0;
      windowCarUpdateCount = 0;
      nextSummaryAtMs = nowMs + summaryIntervalMs;
    }
  };
}

function createIncidentDebugLogger(
  config: AppConfig,
  logger: LiveLogger,
  snapshotRecorder: LiveSnapshotRecorder
): IncidentDebugLoggerFn {
  let nextSummaryAtMs = 0;
  const summaryIntervalMs = 5000;
  let windowPacketCount = 0;
  let windowCarUpdateCount = 0;
  let windowCollisionWithCarCount = 0;
  let windowCollisionWithEnvCount = 0;
  let windowUnknownPacketCount = 0;

  const debugLogger = ((message: string, fields: Record<string, unknown>) => {
    if (!config.incidentDebug) {
      return;
    }

    logger('info', 'live-incident-debug', message, fields);
  }) as IncidentDebugLoggerFn;

  debugLogger.observePacket = (packetType) => {
    if (!config.incidentDebug) {
      return;
    }

    windowPacketCount += 1;

    if (packetType === 'car_update') {
      windowCarUpdateCount += 1;
      return;
    }

    if (packetType === 'collision_with_car') {
      windowCollisionWithCarCount += 1;
      return;
    }

    if (packetType === 'collision_with_env') {
      windowCollisionWithEnvCount += 1;
      return;
    }

    windowUnknownPacketCount += 1;
  };

  debugLogger.maybeLogSummary = (nowMs, incidentCaptureManager) => {
    if (!config.incidentDebug || nowMs < nextSummaryAtMs) {
      return;
    }

    nextSummaryAtMs = nowMs + summaryIntervalMs;
    logger('info', 'live-incident-debug', 'Live incident debug summary', {
      ts: new Date(nowMs).toISOString(),
      ringBufferCarIds: snapshotRecorder.getTrackedCarIds(),
      pendingIncidentCount: incidentCaptureManager.getPendingIncidentCount(nowMs),
      finalizedIncidentCount: incidentCaptureManager.getFinalizedIncidentCount(nowMs),
      windowPacketCount,
      windowCarUpdateCount,
      windowCollisionWithCarCount,
      windowCollisionWithEnvCount,
      windowUnknownPacketCount,
    });

    windowPacketCount = 0;
    windowCarUpdateCount = 0;
    windowCollisionWithCarCount = 0;
    windowCollisionWithEnvCount = 0;
    windowUnknownPacketCount = 0;
  };

  return debugLogger;
}
