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
