import { DriverRaceStats, ParsedRace } from '../types/assetto';
import type { IncidentVerdict, IncidentVerdictType } from '../incidents/analyzeIncidentVerdict';
import { FinalizedLiveIncidentPackage, LiveCollisionEvent, LiveCollisionPacketKind, LiveIncidentTrackedCar, Vector3 } from '../live/liveTypes';
import { AppDatabase } from './db';
import type { StatementSync } from 'node:sqlite';

type PersistRaceInput = {
  fileName: string;
  filePath: string;
  fileHash: string | null;
  processedAt: string;
  race: ParsedRace;
  stats: DriverRaceStats[];
};

type PersistRaceResult =
  | { status: 'inserted'; raceId: number; persistedDrivers: number }
  | { status: 'duplicate' };

type PersistLiveIncidentInput = {
  incident: FinalizedLiveIncidentPackage;
  raceId?: number | null;
};

type PersistLiveIncidentResult =
  | { status: 'inserted'; incidentId: number; snapshotCount: number }
  | { status: 'duplicate' };

export type PersistedLiveIncidentSnapshot = {
  id: number;
  incidentId: number;
  relativeMs: number;
  carId: number;
  snapshotReceivedAt: string;
  pos: Vector3;
  velocity: Vector3;
  speedKmh: number;
  gear: number | null;
  engineRpm: number | null;
  normalizedSplinePos: number | null;
};

export type PersistedLiveIncident = {
  id: number;
  incidentUid: string;
  raceId: number | null;
  type: LiveCollisionPacketKind;
  carId: number;
  otherCarId: number | null;
  impactSpeed: number;
  worldPosition: Vector3;
  relativePosition: Vector3 | null;
  createdAt: string;
  firstReceivedAt: string;
  lastReceivedAt: string;
  captureStartMs: number;
  captureEndMs: number;
  matched: boolean;
  matchedAt: string | null;
  verdictType: IncidentVerdictType | null;
  verdictConfidence: number | null;
  verdictBlamedCarId: number | null;
  verdictExplanation: string[];
  snapshots: PersistedLiveIncidentSnapshot[];
};

export type Repositories = ReturnType<typeof createRepositories>;

export function createRepositories(database: AppDatabase) {
  const hasProcessedStatement = database.prepare('SELECT 1 FROM processed_files WHERE file_name = ? LIMIT 1');
  const getDriverSafetyStatement = database.prepare('SELECT safety_rating FROM drivers WHERE guid = ?');
  const insertRaceStatement = database.prepare(`
    INSERT INTO races (file_name, track, track_config, car_model, race_laps, processed_at)
    VALUES (@fileName, @track, @trackConfig, @carModel, @raceLaps, @processedAt)
  `);
  const upsertDriverStatement = database.prepare(`
    INSERT INTO drivers (
      guid,
      name,
      safety_rating,
      races,
      total_car_incidents,
      total_env_hits,
      total_cuts,
      max_impact,
      updated_at
    ) VALUES (
      @guid,
      @name,
      @safetyRating,
      1,
      @totalCarIncidents,
      @totalEnvHits,
      @totalCuts,
      @maxImpact,
      @updatedAt
    )
    ON CONFLICT(guid) DO UPDATE SET
      name = excluded.name,
      safety_rating = excluded.safety_rating,
      races = drivers.races + 1,
      total_car_incidents = drivers.total_car_incidents + excluded.total_car_incidents,
      total_env_hits = drivers.total_env_hits + excluded.total_env_hits,
      total_cuts = drivers.total_cuts + excluded.total_cuts,
      max_impact = MAX(drivers.max_impact, excluded.max_impact),
      updated_at = excluded.updated_at
  `);
  const insertRaceDriverResultStatement = database.prepare(`
    INSERT INTO race_driver_results (
      race_id,
      guid,
      name,
      position,
      completed_laps,
      finished,
      best_lap,
      avg_lap,
      ideal_lap,
      consistency,
      cuts,
      car_incidents,
      env_hits,
      max_impact,
      race_score,
      old_safety,
      new_safety
    ) VALUES (
      @raceId,
      @guid,
      @name,
      @position,
      @completedLaps,
      @finished,
      @bestLap,
      @avgLap,
      @idealLap,
      @consistency,
      @cuts,
      @carIncidents,
      @envHits,
      @maxImpact,
      @raceScore,
      @oldSafety,
      @newSafety
    )
  `);
  const insertProcessedStatement = database.prepare(`
    INSERT INTO processed_files (file_name, file_path, file_hash, processed_at)
    VALUES (@fileName, @filePath, @fileHash, @processedAt)
  `);
  const insertLiveIncidentStatement = database.prepare(`
    INSERT INTO live_incidents (
      incident_uid,
      race_id,
      type,
      car_id,
      other_car_id,
      impact_speed,
      world_pos_x,
      world_pos_y,
      world_pos_z,
      rel_pos_x,
      rel_pos_y,
      rel_pos_z,
      created_at,
      first_received_at,
      last_received_at,
      capture_start_ms,
      capture_end_ms,
      matched,
      matched_at,
      verdict_type,
      verdict_confidence,
      verdict_blamed_car_id,
      verdict_explanation_json
    ) VALUES (
      @incidentUid,
      @raceId,
      @type,
      @carId,
      @otherCarId,
      @impactSpeed,
      @worldPosX,
      @worldPosY,
      @worldPosZ,
      @relPosX,
      @relPosY,
      @relPosZ,
      @createdAt,
      @firstReceivedAt,
      @lastReceivedAt,
      @captureStartMs,
      @captureEndMs,
      0,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL
    )
  `);
  const insertLiveIncidentSnapshotStatement = database.prepare(`
    INSERT INTO live_incident_snapshots (
      incident_id,
      relative_ms,
      car_id,
      snapshot_received_at,
      pos_x,
      pos_y,
      pos_z,
      vel_x,
      vel_y,
      vel_z,
      speed_kmh,
      gear,
      engine_rpm,
      normalized_spline_pos
    ) VALUES (
      @incidentId,
      @relativeMs,
      @carId,
      @snapshotReceivedAt,
      @posX,
      @posY,
      @posZ,
      @velX,
      @velY,
      @velZ,
      @speedKmh,
      @gear,
      @engineRpm,
      @normalizedSplinePos
    )
  `);
  const listLiveIncidentsStatement = database.prepare(`
    SELECT
      id,
      incident_uid,
      race_id,
      type,
      car_id,
      other_car_id,
      impact_speed,
      world_pos_x,
      world_pos_y,
      world_pos_z,
      rel_pos_x,
      rel_pos_y,
      rel_pos_z,
      created_at,
      first_received_at,
      last_received_at,
      capture_start_ms,
      capture_end_ms,
      matched,
      matched_at,
      verdict_type,
      verdict_confidence,
      verdict_blamed_car_id,
      verdict_explanation_json
    FROM live_incidents
    ORDER BY id ASC
  `);
  const listPendingLiveIncidentsStatement = database.prepare(`
    SELECT
      id,
      incident_uid,
      race_id,
      type,
      car_id,
      other_car_id,
      impact_speed,
      world_pos_x,
      world_pos_y,
      world_pos_z,
      rel_pos_x,
      rel_pos_y,
      rel_pos_z,
      created_at,
      first_received_at,
      last_received_at,
      capture_start_ms,
      capture_end_ms,
      matched,
      matched_at,
      verdict_type,
      verdict_confidence,
      verdict_blamed_car_id,
      verdict_explanation_json
    FROM live_incidents
    WHERE matched = 0 AND race_id IS NULL
    ORDER BY id ASC
  `);
  const markLiveIncidentMatchedStatement = database.prepare(`
    UPDATE live_incidents
    SET race_id = @raceId,
        matched = 1,
        matched_at = @matchedAt,
        verdict_type = @verdictType,
        verdict_confidence = @verdictConfidence,
        verdict_blamed_car_id = @verdictBlamedCarId,
        verdict_explanation_json = @verdictExplanationJson
    WHERE id = @incidentId AND matched = 0
  `);
  const listLiveIncidentSnapshotsStatement = database.prepare(`
    SELECT
      id,
      incident_id,
      relative_ms,
      car_id,
      snapshot_received_at,
      pos_x,
      pos_y,
      pos_z,
      vel_x,
      vel_y,
      vel_z,
      speed_kmh,
      gear,
      engine_rpm,
      normalized_spline_pos
    FROM live_incident_snapshots
    WHERE incident_id = ?
    ORDER BY relative_ms ASC, car_id ASC, id ASC
  `);

  return {
    processedFiles: {
      has(fileName: string): boolean {
        return Boolean(hasProcessedStatement.get(fileName));
      }
    },
    drivers: {
      getSafetyRatings(guids: string[]): Record<string, number> {
        const ratings: Record<string, number> = {};

        for (const guid of new Set(guids)) {
          const row = getDriverSafetyStatement.get(guid) as { safety_rating: number } | undefined;
          if (row) {
            ratings[guid] = row.safety_rating;
          }
        }

        return ratings;
      }
    },
    races: {
      persist(input: PersistRaceInput): PersistRaceResult {
        database.exec('BEGIN IMMEDIATE');

        try {
          if (hasProcessedStatement.get(input.fileName)) {
            database.exec('ROLLBACK');
            return { status: 'duplicate' };
          }

          const raceInsert = insertRaceStatement.run({
            fileName: input.fileName,
            track: input.race.trackName,
            trackConfig: input.race.trackConfig || null,
            carModel: input.race.carModel,
            raceLaps: input.race.raceLaps,
            processedAt: input.processedAt
          });
          const raceId = Number(raceInsert.lastInsertRowid);
          let persistedDrivers = 0;

          for (const stat of input.stats) {
            if (!stat.guid || !stat.active) {
              continue;
            }

            const shouldPersistSafetyChange = stat.safetyChangeReason === 'updated';

            upsertDriverStatement.run({
              guid: stat.guid,
              name: stat.name,
              safetyRating: shouldPersistSafetyChange ? stat.newSafetyRating : stat.oldSafetyRating,
              totalCarIncidents: stat.carIncidentsGrouped,
              totalEnvHits: stat.envHits,
              totalCuts: stat.totalCuts,
              maxImpact: stat.maxImpact,
              updatedAt: input.processedAt
            });

            insertRaceDriverResultStatement.run({
              raceId,
              guid: stat.guid,
              name: stat.name,
              position: stat.position,
              completedLaps: stat.completedLaps,
              finished: stat.finished ? 1 : 0,
              bestLap: stat.bestLap,
              avgLap: stat.avgLap,
              idealLap: stat.idealLap,
              consistency: stat.consistency,
              cuts: stat.totalCuts,
              carIncidents: stat.carIncidentsGrouped,
              envHits: stat.envHits,
              maxImpact: stat.maxImpact,
              raceScore: stat.raceScore,
              oldSafety: stat.oldSafetyRating,
              newSafety: shouldPersistSafetyChange ? stat.newSafetyRating : stat.oldSafetyRating
            });

            persistedDrivers += 1;
          }

          insertProcessedStatement.run({
            fileName: input.fileName,
            filePath: input.filePath,
            fileHash: input.fileHash,
            processedAt: input.processedAt
          });

          database.exec('COMMIT');
          return { status: 'inserted', raceId, persistedDrivers };
        } catch (error) {
          database.exec('ROLLBACK');

          if (isUniqueConstraintError(error)) {
            return { status: 'duplicate' };
          }

          throw error;
        }
      }
    },
    liveIncidents: {
      persist(input: PersistLiveIncidentInput): PersistLiveIncidentResult {
        const representativeEvent = pickRepresentativeEvent(input.incident.events);

        database.exec('BEGIN IMMEDIATE');

        try {
          const incidentInsert = insertLiveIncidentStatement.run({
            incidentUid: input.incident.incidentId,
            raceId: input.raceId ?? null,
            type: input.incident.type,
            carId: representativeEvent.carId,
            otherCarId: representativeEvent.type === 'collision_with_car' ? representativeEvent.otherCarId : null,
            impactSpeed: representativeEvent.impactSpeed,
            worldPosX: representativeEvent.worldPosition.x,
            worldPosY: representativeEvent.worldPosition.y,
            worldPosZ: representativeEvent.worldPosition.z,
            relPosX: representativeEvent.relativePosition.x,
            relPosY: representativeEvent.relativePosition.y,
            relPosZ: representativeEvent.relativePosition.z,
            createdAt: representativeEvent.receivedAt,
            firstReceivedAt: new Date(input.incident.firstReceivedAtMs).toISOString(),
            lastReceivedAt: new Date(input.incident.lastReceivedAtMs).toISOString(),
            captureStartMs: input.incident.captureStartMs,
            captureEndMs: input.incident.captureEndMs,
          });
          const incidentId = Number(incidentInsert.lastInsertRowid);
          let snapshotCount = 0;
          const relativeToMs = representativeEvent.receivedAtMs;

          for (const car of input.incident.cars) {
            snapshotCount += persistSnapshots(
              insertLiveIncidentSnapshotStatement,
              incidentId,
              relativeToMs,
              car
            );
          }

          database.exec('COMMIT');
          return { status: 'inserted', incidentId, snapshotCount };
        } catch (error) {
          database.exec('ROLLBACK');

          if (isUniqueConstraintError(error)) {
            return { status: 'duplicate' };
          }

          throw error;
        }
      },
      list(): PersistedLiveIncident[] {
        return hydrateLiveIncidents(listLiveIncidentsStatement.all() as LiveIncidentRow[]);
      },
      listPendingMatch(): PersistedLiveIncident[] {
        return hydrateLiveIncidents(listPendingLiveIncidentsStatement.all() as LiveIncidentRow[]);
      },
      markMatched(incidentId: number, raceId: number, matchedAt: string, verdict?: IncidentVerdict): boolean {
        const result = markLiveIncidentMatchedStatement.run({
          incidentId,
          raceId,
          matchedAt,
          verdictType: verdict?.type ?? null,
          verdictConfidence: verdict?.confidence ?? null,
          verdictBlamedCarId: verdict?.blamedCarId ?? null,
          verdictExplanationJson: verdict ? JSON.stringify(verdict.explanation) : null,
        });
        return Number(result.changes) > 0;
      },
      deleteMatched(incidentIds: number[]): number {
        const uniqueIds = [...new Set(incidentIds.filter((id) => Number.isInteger(id) && id > 0))];
        if (uniqueIds.length === 0) {
          return 0;
        }

        const placeholders = uniqueIds.map(() => '?').join(', ');
        const deleteMatchedIncidentsStatement = database.prepare(`
          DELETE FROM live_incidents
          WHERE matched = 1 AND race_id IS NOT NULL AND id IN (${placeholders})
        `);

        database.exec('BEGIN IMMEDIATE');

        try {
          const result = deleteMatchedIncidentsStatement.run(...uniqueIds);
          database.exec('COMMIT');
          return Number(result.changes);
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }
    }
  };

  function hydrateLiveIncidents(rows: LiveIncidentRow[]): PersistedLiveIncident[] {
    return rows.map((row) => ({
      id: row.id,
      incidentUid: row.incident_uid,
      raceId: row.race_id,
      type: row.type,
      carId: row.car_id,
      otherCarId: row.other_car_id,
      impactSpeed: row.impact_speed,
      worldPosition: { x: row.world_pos_x, y: row.world_pos_y, z: row.world_pos_z },
      relativePosition: row.rel_pos_x === null || row.rel_pos_y === null || row.rel_pos_z === null
        ? null
        : { x: row.rel_pos_x, y: row.rel_pos_y, z: row.rel_pos_z },
      createdAt: row.created_at,
      firstReceivedAt: row.first_received_at,
      lastReceivedAt: row.last_received_at,
      captureStartMs: row.capture_start_ms,
      captureEndMs: row.capture_end_ms,
      matched: Boolean(row.matched),
      matchedAt: row.matched_at,
      verdictType: row.verdict_type,
      verdictConfidence: row.verdict_confidence,
      verdictBlamedCarId: row.verdict_blamed_car_id,
      verdictExplanation: parseVerdictExplanation(row.verdict_explanation_json),
      snapshots: (listLiveIncidentSnapshotsStatement.all(row.id) as LiveIncidentSnapshotRow[]).map((snapshotRow) => ({
        id: snapshotRow.id,
        incidentId: snapshotRow.incident_id,
        relativeMs: snapshotRow.relative_ms,
        carId: snapshotRow.car_id,
        snapshotReceivedAt: snapshotRow.snapshot_received_at,
        pos: { x: snapshotRow.pos_x, y: snapshotRow.pos_y, z: snapshotRow.pos_z },
        velocity: { x: snapshotRow.vel_x, y: snapshotRow.vel_y, z: snapshotRow.vel_z },
        speedKmh: snapshotRow.speed_kmh,
        gear: snapshotRow.gear,
        engineRpm: snapshotRow.engine_rpm,
        normalizedSplinePos: snapshotRow.normalized_spline_pos,
      })),
    }));
  }
}

type LiveIncidentRow = {
  id: number;
  incident_uid: string;
  race_id: number | null;
  type: LiveCollisionPacketKind;
  car_id: number;
  other_car_id: number | null;
  impact_speed: number;
  world_pos_x: number;
  world_pos_y: number;
  world_pos_z: number;
  rel_pos_x: number | null;
  rel_pos_y: number | null;
  rel_pos_z: number | null;
  created_at: string;
  first_received_at: string;
  last_received_at: string;
  capture_start_ms: number;
  capture_end_ms: number;
  matched: number;
  matched_at: string | null;
  verdict_type: IncidentVerdictType | null;
  verdict_confidence: number | null;
  verdict_blamed_car_id: number | null;
  verdict_explanation_json: string | null;
};

type LiveIncidentSnapshotRow = {
  id: number;
  incident_id: number;
  relative_ms: number;
  car_id: number;
  snapshot_received_at: string;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  vel_x: number;
  vel_y: number;
  vel_z: number;
  speed_kmh: number;
  gear: number | null;
  engine_rpm: number | null;
  normalized_spline_pos: number | null;
};

function persistSnapshots(
  statement: StatementSync,
  incidentId: number,
  firstReceivedAtMs: number,
  car: LiveIncidentTrackedCar
): number {
  let snapshotCount = 0;

  for (const snapshot of car.snapshots) {
    statement.run({
      incidentId,
      relativeMs: snapshot.receivedAtMs - firstReceivedAtMs,
      carId: snapshot.carId,
      snapshotReceivedAt: new Date(snapshot.receivedAtMs).toISOString(),
      posX: snapshot.pos.x,
      posY: snapshot.pos.y,
      posZ: snapshot.pos.z,
      velX: snapshot.velocity.x,
      velY: snapshot.velocity.y,
      velZ: snapshot.velocity.z,
      speedKmh: snapshot.speedKmh,
      gear: snapshot.gear ?? null,
      engineRpm: snapshot.engineRpm ?? null,
      normalizedSplinePos: snapshot.normalizedSplinePos ?? null,
    });
    snapshotCount += 1;
  }

  return snapshotCount;
}

function pickRepresentativeEvent(events: LiveCollisionEvent[]): LiveCollisionEvent {
  const [firstEvent, ...rest] = events;
  if (!firstEvent) {
    throw new Error('Cannot persist live incident without at least one event');
  }

  return rest.reduce((selected, candidate) => {
    if (candidate.impactSpeed > selected.impactSpeed) {
      return candidate;
    }

    if (candidate.impactSpeed === selected.impactSpeed && candidate.receivedAtMs < selected.receivedAtMs) {
      return candidate;
    }

    return selected;
  }, firstEvent);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

function parseVerdictExplanation(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
