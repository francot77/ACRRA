PRAGMA foreign_keys = ON;

-- Schema version 5 adds the Phase-2 scoring outbox. Race exports, results,
-- drivers, safety ratings, and processed filenames are authoritative data.
-- Legacy live incident/snapshot tables are intentionally absent from fresh DBs;
-- migration 2 archives and removes them from existing DBs.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_files (
  file_name TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_hash TEXT,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  guid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  safety_rating REAL NOT NULL DEFAULT 75,
  races INTEGER NOT NULL DEFAULT 0,
  total_car_incidents INTEGER NOT NULL DEFAULT 0,
  total_env_hits INTEGER NOT NULL DEFAULT 0,
  total_cuts INTEGER NOT NULL DEFAULT 0,
  max_impact REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT UNIQUE NOT NULL,
  track TEXT NOT NULL,
  track_config TEXT,
  car_model TEXT,
  race_laps INTEGER,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS race_driver_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL,
  guid TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER,
  completed_laps INTEGER NOT NULL,
  finished INTEGER NOT NULL,
  best_lap INTEGER,
  avg_lap REAL,
  ideal_lap INTEGER,
  consistency REAL,
  cuts INTEGER NOT NULL,
  car_incidents INTEGER NOT NULL,
  env_hits INTEGER NOT NULL,
  max_impact REAL NOT NULL,
  race_score REAL NOT NULL,
  old_safety REAL NOT NULL,
  new_safety REAL NOT NULL,
  FOREIGN KEY (race_id) REFERENCES races(id),
  FOREIGN KEY (guid) REFERENCES drivers(guid)
);

CREATE TABLE IF NOT EXISTS scoring_run_slots (
  slot_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'expired')),
  source_file_name TEXT,
  source_file_hash TEXT,
  claimed_at TEXT
);

CREATE TABLE IF NOT EXISTS scoring_drivers (id INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE, display_name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS scoring_driver_aliases (normalized_name TEXT PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES scoring_drivers(id));
CREATE TABLE IF NOT EXISTS scoring_runs (run_id TEXT PRIMARY KEY, race_id TEXT NOT NULL, committed_at TEXT NOT NULL, UNIQUE (race_id, run_id));
CREATE TABLE IF NOT EXISTS championship_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES scoring_runs(run_id), driver_id INTEGER NOT NULL REFERENCES scoring_drivers(id), driver_name TEXT NOT NULL, position INTEGER NOT NULL, points INTEGER NOT NULL, UNIQUE (run_id, driver_id));
CREATE TABLE IF NOT EXISTS scoring_results (run_id TEXT NOT NULL REFERENCES scoring_runs(run_id), driver_id INTEGER NOT NULL REFERENCES scoring_drivers(id), position INTEGER NOT NULL, classified INTEGER NOT NULL, PRIMARY KEY (run_id, driver_id));
CREATE TABLE IF NOT EXISTS scoring_report_outbox (
  report_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES scoring_runs(run_id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed-retryable')),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
