import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { backupDatabase, openDatabase } from '../src/db/db';
import { applyMigrations, migrations, verifyIncidentArchive } from '../src/db/migrations';

function legacyDatabasePath(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'acrra-migration-')), 'legacy.sqlite');
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE races (id INTEGER PRIMARY KEY, file_name TEXT UNIQUE NOT NULL, track TEXT NOT NULL, processed_at TEXT NOT NULL);
    CREATE TABLE drivers (guid TEXT PRIMARY KEY, name TEXT NOT NULL, safety_rating REAL NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE race_driver_results (id INTEGER PRIMARY KEY, race_id INTEGER NOT NULL, guid TEXT NOT NULL, position INTEGER, completed_laps INTEGER NOT NULL, finished INTEGER NOT NULL, cuts INTEGER NOT NULL, car_incidents INTEGER NOT NULL, env_hits INTEGER NOT NULL, max_impact REAL NOT NULL, race_score REAL NOT NULL, old_safety REAL NOT NULL, new_safety REAL NOT NULL);
    CREATE TABLE live_incidents (id INTEGER PRIMARY KEY, incident_uid TEXT UNIQUE NOT NULL, race_id INTEGER, type TEXT NOT NULL, car_id INTEGER NOT NULL, other_car_id INTEGER, impact_speed REAL NOT NULL, world_pos_x REAL NOT NULL, world_pos_y REAL NOT NULL, world_pos_z REAL NOT NULL, rel_pos_x REAL, rel_pos_y REAL, rel_pos_z REAL, created_at TEXT NOT NULL, first_received_at TEXT NOT NULL, last_received_at TEXT NOT NULL, capture_start_ms INTEGER NOT NULL, capture_end_ms INTEGER NOT NULL, matched INTEGER NOT NULL, matched_at TEXT, verdict_type TEXT, verdict_confidence REAL, verdict_blamed_car_id INTEGER, verdict_explanation_json TEXT);
    CREATE TABLE live_incident_snapshots (id INTEGER PRIMARY KEY, incident_id INTEGER NOT NULL, relative_ms INTEGER NOT NULL, car_id INTEGER NOT NULL, snapshot_received_at TEXT NOT NULL, pos_x REAL NOT NULL, pos_y REAL NOT NULL, pos_z REAL NOT NULL, vel_x REAL NOT NULL, vel_y REAL NOT NULL, vel_z REAL NOT NULL, speed_kmh REAL NOT NULL, gear INTEGER, engine_rpm INTEGER, normalized_spline_pos REAL);
    CREATE INDEX idx_live_incidents_race_id ON live_incidents(race_id);
    CREATE INDEX idx_live_incidents_created_at ON live_incidents(created_at);
    CREATE INDEX idx_live_incident_snapshots_incident_id ON live_incident_snapshots(incident_id);
    INSERT INTO drivers VALUES ('driver-1', 'Driver One', 82.5, '2026-01-01T00:00:00.000Z');
    INSERT INTO races VALUES (1, 'RACE.json', 'monza', '2026-01-01T00:00:00.000Z');
    INSERT INTO race_driver_results VALUES (1, 1, 'driver-1', 1, 10, 1, 0, 0, 0, 0, 95, 80, 82);
    INSERT INTO live_incidents VALUES (7, 'incident-7', 1, 'collision_with_car', 3, 4, 88, 1, 2, 3, 4, 5, 6, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', 0, 1000, 1, '2026-01-01T00:00:02.000Z', 'possible_rear_end', 0.9, 4, '["archived"]');
    INSERT INTO live_incident_snapshots VALUES (9, 7, 0, 3, '2026-01-01T00:00:00.000Z', 1, 2, 3, 0, 0, 0, 88, 4, 5000, 0.2);
  `);
  database.close();
  return path;
}

test('populated databases archive incidents and snapshots before deleting legacy schema', () => {
  const path = legacyDatabasePath();
  const archiveDirectory = mkdtempSync(join(tmpdir(), 'acrra-archive-'));
  const database = openDatabase(path, { archiveDirectory });
  const archivePath = join(archiveDirectory, readdirSync(archiveDirectory)[0]);
  const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
  verifyIncidentArchive(readFileSync(archivePath, 'utf8'));
  assert.equal(archive.liveIncidents.length, 1);
  assert.equal(archive.liveIncidentSnapshots.length, 1);
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'live_incident%'").get(), undefined);
  assert.equal(database.prepare('SELECT name FROM drivers WHERE guid = ?').get('driver-1').name, 'Driver One');
  assert.equal(database.prepare('SELECT count(*) AS count FROM race_driver_results').get().count, 1);
  database.close();
});

test('empty fresh databases converge without creating legacy incident tables', () => {
  const database = openDatabase(join(mkdtempSync(join(tmpdir(), 'acrra-migration-')), 'fresh.sqlite'));
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'live_incident%'").get(), undefined);
  assert.equal(database.prepare('SELECT max(version) AS version FROM schema_migrations').get().version, 7);
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'scoring_run_slots'").get());
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'championship_awards'").get());
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'scoring_report_outbox'").get());
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'scoring_results'").get());
  database.close();
});

test('migration rerun is idempotent and does not create another archive', () => {
  const path = legacyDatabasePath();
  const archiveDirectory = mkdtempSync(join(tmpdir(), 'acrra-archive-'));
  const first = openDatabase(path, { archiveDirectory });
  first.close();
  const firstArchives = readdirSync(archiveDirectory);
  const second = openDatabase(path, { archiveDirectory });
  second.close();
  assert.deepEqual(readdirSync(archiveDirectory), firstArchives);
});

test('archive failure happens before delete and leaves the live schema intact', () => {
  const path = legacyDatabasePath();
  const database = new DatabaseSync(path);
  const notDirectory = join(mkdtempSync(join(tmpdir(), 'acrra-archive-')), 'not-a-directory');
  writeFileSync(notDirectory, 'occupied');
  assert.throws(() => applyMigrations(database, [migrations[1]], { databasePath: path, archiveDirectory: notDirectory }));
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'live_incidents'").get());
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'live_incident_snapshots'").get());
  database.close();
});

test('backup integrity covers a temporary database and optional WAL sidecars', () => {
  const directory = mkdtempSync(join(tmpdir(), 'acrra-migration-'));
  const source = join(directory, 'backup.sqlite');
  const database = openDatabase(source);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec("INSERT INTO processed_files (file_name, file_path, processed_at) VALUES ('RACE.json', '/tmp/RACE.json', '2026-01-01T00:00:00.000Z')");
  const destination = join(directory, 'verified-backup.sqlite');
  const backup = backupDatabase(source, destination);
  assert.equal(backup.databasePath, destination);
  const restored = openDatabase(destination);
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  restored.close();
  database.close();
});
