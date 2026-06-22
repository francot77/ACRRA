# Race Result Monitoring Specification

## Purpose

Define the exact MVP contract for Assetto Corsa `RACE` ingestion, incident grouping, safety scoring, historical persistence, and duplicate-safe processing.

## Requirements

### Requirement: Runtime Configuration

The worker MUST use these env vars exactly: `RESULTS_DIR=/app/results`, `DATABASE_PATH=/app/data/ac-race-monitor.sqlite`, `DISCORD_WEBHOOK_URL=`, `PROCESSED_FILE_STRATEGY=sqlite`, `SCAN_ON_START=true`, `MIN_FILE_AGE_MS=3000`, `WATCH_GLOB=*RACE*.json`, `DEFAULT_SAFETY_RATING=75`, `SAFETY_MEMORY_FACTOR=0.85`, `NODE_ENV=production`. `.env.example` MUST also include `HOST_ASSETTO_RESULTS_DIR=/opt/assetto/server/results` and `HOST_MONITOR_DATA_DIR=/opt/ac-race-monitor/data`.

#### Scenario: Default environment contract

- GIVEN the worker is configured from environment variables
- WHEN defaults are documented or loaded
- THEN the exact keys and default values above MUST be used

### Requirement: Watch, Stability, And Parse Gate

The worker MUST watch only files matching `WATCH_GLOB`, wait `MIN_FILE_AGE_MS` after add/change, verify the file size did not change, and only then read and parse it. This gate MUST avoid incomplete JSON. If JSON is invalid or corrupt, the worker MUST retry or skip with clear logs and MUST NOT crash. Log messages SHOULD align with examples such as `Race file still changing, delaying parse`, `Invalid race JSON, retrying`, `Skipping file because json.Type is not RACE`, and `Skipping already processed file`. The worker MUST process a file only when `json.Type === 'RACE'`. If `SCAN_ON_START=true`, existing matching files MUST pass the same stability gate before processing.

#### Scenario: File is still being written

- GIVEN a matching file changes while the server is still writing it
- WHEN the worker checks age and size stability
- THEN it MUST delay processing until the size is stable and JSON parses correctly

#### Scenario: File is invalid or not a race

- GIVEN a matching file is corrupt or `json.Type !== 'RACE'`
- WHEN the worker evaluates it
- THEN it MUST log the skip reason clearly and avoid persistence or notifications

### Requirement: Parsing, Identity, Grouping, And Driver Stats

The parser MUST extract exactly the race-level fields needed from `TrackName`, `TrackConfig`, `Type`, `RaceLaps`, `Cars`, `Result`, `Laps`, and `Events`, then derive per-driver rows from `Cars`, `Result`, `Laps`, and `Events`. Placeholder slots MUST be ignored when `DriverName=''`, `DriverGuid=''`, `BestLap=999999999`, and `TotalTime=0`. Driver identity MUST use `DriverGuid` as the primary identity. If no GUID exists, the worker MUST ignore that driver for historical ranking or MAY create a temporary identity from `CarId`, but it MUST NOT mix temporary identities with real drivers. `groupIncidents(events)` MUST group only `COLLISION_WITH_CAR`, key by `min(CarId)` and `max(CarId)`, use distance `<= 6` meters when positions exist, otherwise group by nearby array order within a tolerance of `2` events, and produce `drivers involved`, `carIds involved`, `maxImpact`, `avgImpact`, `representativeWorldPosition`, and `rawEventCount`. Incident language MUST avoid absolute blame. Per-driver stats MUST include exactly `position`, `completedLaps`, `raceLaps`, `finished`, `bestLap`, `avgLap`, `idealLap`, `consistency`, `totalCuts`, `carIncidentsGrouped`, `envHits`, `maxImpact`, `rawCollisionEvents`, `tyre usado más frecuente`, `totalTime`, `raceScore`, `oldSafetyRating`, and `newSafetyRating`.

#### Scenario: Symmetric car contact is duplicated in raw events

- GIVEN both cars emit mirrored `COLLISION_WITH_CAR` events
- WHEN grouping runs
- THEN one grouped incident MUST be produced for that pair with the required aggregate fields

#### Scenario: Driver has no GUID

- GIVEN a driver appears in race results without `DriverGuid`
- WHEN historical ranking is computed
- THEN that driver MUST stay outside persistent GUID history and MUST NOT be merged into a real driver record

### Requirement: Safety Formula, Categories, And SQLite Persistence

Race safety MUST be computed exactly as: `let score = 100; score -= carIncidentsGrouped * 10; score -= envHits * 6; score -= totalCuts * 2; if (maxImpact > 60) score -= 10; if (maxImpact > 120) score -= 20; if (maxImpact > 200) score -= 35; if (!finished && completedLaps === 0 && (carIncidentsGrouped + envHits) >= 3) { score -= 15; } if (finished) score += 5; if (finished && envHits === 0) score += 5; score = clamp(score, 0, 100);`. Historical safety MUST start every new driver at `DEFAULT_SAFETY_RATING` default `75` and update exactly as `newSafety = oldSafety * SAFETY_MEMORY_FACTOR + raceScore * (1 - SAFETY_MEMORY_FACTOR)` with default `SAFETY_MEMORY_FACTOR=0.85`; `oldSafety`, `raceScore`, and `newSafety` MUST be stored. Categories MUST be exactly `90-100 = 🧼 Limpio`, `75-89 = ✅ Correcto`, `60-74 = ⚠️ Dudoso`, `40-59 = 🚧 Peligroso`, `20-39 = 🚜 Terrorista de T1`, `0-19 = ☢️ Amenaza pública`. SQLite MUST use exactly these tables and columns: `processed_files(file_name TEXT PRIMARY KEY, file_path TEXT NOT NULL, file_hash TEXT, processed_at TEXT NOT NULL)`, `drivers(guid TEXT PRIMARY KEY, name TEXT NOT NULL, safety_rating REAL NOT NULL DEFAULT 75, races INTEGER NOT NULL DEFAULT 0, total_car_incidents INTEGER NOT NULL DEFAULT 0, total_env_hits INTEGER NOT NULL DEFAULT 0, total_cuts INTEGER NOT NULL DEFAULT 0, max_impact REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`, `races(id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT UNIQUE NOT NULL, track TEXT NOT NULL, track_config TEXT, car_model TEXT, race_laps INTEGER, processed_at TEXT NOT NULL)`, `race_driver_results(id INTEGER PRIMARY KEY AUTOINCREMENT, race_id INTEGER NOT NULL, guid TEXT NOT NULL, name TEXT NOT NULL, position INTEGER, completed_laps INTEGER NOT NULL, finished INTEGER NOT NULL, best_lap INTEGER, avg_lap REAL, ideal_lap INTEGER, consistency REAL, cuts INTEGER NOT NULL, car_incidents INTEGER NOT NULL, env_hits INTEGER NOT NULL, max_impact REAL NOT NULL, race_score REAL NOT NULL, old_safety REAL NOT NULL, new_safety REAL NOT NULL, FOREIGN KEY (race_id) REFERENCES races(id), FOREIGN KEY (guid) REFERENCES drivers(guid))`. With `PROCESSED_FILE_STRATEGY=sqlite`, re-seeing the same file name MUST be idempotent.

#### Scenario: Historical rating is updated

- GIVEN a GUID-backed driver with prior or default safety
- WHEN the race score is persisted
- THEN `oldSafety`, `raceScore`, and `newSafety` MUST follow the exact formula above

#### Scenario: Processed file is seen again

- GIVEN a file already exists in `processed_files`
- WHEN the watcher sees it again
- THEN the worker MUST skip duplicate persistence and notifications with a clear log

## Acceptance Criteria

- The spec MUST freeze the exact env vars, stability gate, `json.Type === 'RACE'` validation, placeholder-slot ignore rule, GUID handling, grouped-incident contract, per-driver stat shape, safety formula, historical formula, categories, SQLite schema, and processed-file strategy requested by the user.
- Replaying the provided `RACE` samples MUST produce deterministic grouped incidents, per-driver outputs, and safety history without mixing temporary identities into GUID-backed history.
- Invalid, incomplete, corrupt, duplicate, and non-`RACE` files MUST be handled without crashes and with clear logs aligned to this contract.
