PRAGMA foreign_keys = ON;

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

CREATE TABLE IF NOT EXISTS live_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_uid TEXT UNIQUE NOT NULL,
  race_id INTEGER,
  type TEXT NOT NULL,
  car_id INTEGER NOT NULL,
  other_car_id INTEGER,
  impact_speed REAL NOT NULL,
  world_pos_x REAL NOT NULL,
  world_pos_y REAL NOT NULL,
  world_pos_z REAL NOT NULL,
  rel_pos_x REAL,
  rel_pos_y REAL,
  rel_pos_z REAL,
  created_at TEXT NOT NULL,
  first_received_at TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  capture_start_ms INTEGER NOT NULL,
  capture_end_ms INTEGER NOT NULL,
  matched INTEGER NOT NULL DEFAULT 0,
  matched_at TEXT,
  verdict_type TEXT,
  verdict_confidence REAL,
  verdict_blamed_car_id INTEGER,
  verdict_explanation_json TEXT,
  FOREIGN KEY (race_id) REFERENCES races(id)
);

CREATE INDEX IF NOT EXISTS idx_live_incidents_race_id ON live_incidents(race_id);
CREATE INDEX IF NOT EXISTS idx_live_incidents_created_at ON live_incidents(created_at);

CREATE TABLE IF NOT EXISTS live_incident_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  relative_ms INTEGER NOT NULL,
  car_id INTEGER NOT NULL,
  snapshot_received_at TEXT NOT NULL,
  pos_x REAL NOT NULL,
  pos_y REAL NOT NULL,
  pos_z REAL NOT NULL,
  vel_x REAL NOT NULL,
  vel_y REAL NOT NULL,
  vel_z REAL NOT NULL,
  speed_kmh REAL NOT NULL,
  gear INTEGER,
  engine_rpm INTEGER,
  normalized_spline_pos REAL,
  FOREIGN KEY (incident_id) REFERENCES live_incidents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_live_incident_snapshots_incident_id
  ON live_incident_snapshots(incident_id);
