import { DriverRaceStats, ParsedRace } from '../types/assetto';
import { AppDatabase } from './db';

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
  /* Legacy live-incident SQL remains only in migration/archive compatibility code. */
  /*
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
  */

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
  };

}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}
