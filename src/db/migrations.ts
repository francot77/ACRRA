import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppDatabase } from './db';

export type DatabaseMigration = {
  version: number;
  name: string;
  apply: (database: AppDatabase, context: MigrationContext) => void;
};

export type MigrationContext = {
  databasePath?: string;
  archiveDirectory?: string;
};

export type IncidentArchive = {
  format: 'acrra-incident-archive-v1';
  createdAt: string;
  sourceDatabase: string | null;
  integrity: { algorithm: 'sha256'; payloadHash: string };
  liveIncidents: Record<string, unknown>[];
  liveIncidentSnapshots: Record<string, unknown>[];
};

export const DATABASE_SCHEMA_VERSION = 7;

/**
 * Migration 1 adds compatibility columns before migration 2 performs the
 * approved archive-and-delete disposition. Migration 2 is transactional and
 * only drops legacy tables after the archive is written and hash-verified.
 */
export const migrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'ensure-live-incident-verdict-columns',
    apply(database) {
      const tableExists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'live_incidents'").get();
      if (!tableExists) return;
      const rows = database.prepare('PRAGMA table_info(live_incidents)').all() as Array<{ name: string }>;
      const columns = new Set(rows.map((row) => row.name));

      for (const column of ['verdict_type', 'verdict_confidence', 'verdict_blamed_car_id', 'verdict_explanation_json']) {
        if (!columns.has(column)) {
          const type = column === 'verdict_confidence' ? 'REAL' : column === 'verdict_blamed_car_id' ? 'INTEGER' : 'TEXT';
          database.exec(`ALTER TABLE live_incidents ADD COLUMN ${column} ${type}`);
        }
      }
    }
  },
  {
    version: 2,
    name: 'archive-and-remove-legacy-live-incidents',
    apply(database, context) {
      const archivePath = createIncidentArchive(database, context);
      verifyIncidentArchive(readFileSync(archivePath, 'utf8'));
      database.exec('DROP INDEX IF EXISTS idx_live_incident_snapshots_incident_id');
      database.exec('DROP INDEX IF EXISTS idx_live_incidents_race_id');
      database.exec('DROP INDEX IF EXISTS idx_live_incidents_created_at');
      database.exec('DROP TABLE IF EXISTS live_incident_snapshots');
      database.exec('DROP TABLE IF EXISTS live_incidents');
    }
  },
  {
    version: 3,
    name: 'add-scoring-run-slots',
    apply(database) {
      database.exec(`CREATE TABLE IF NOT EXISTS scoring_run_slots (
        slot_key TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'claimed')),
        source_file_name TEXT,
        source_file_hash TEXT,
        claimed_at TEXT
      )`);
    }
  },
  {
    version: 4,
    name: 'add-scoring-identity-and-awards',
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS scoring_drivers (id INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE, display_name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS scoring_driver_aliases (normalized_name TEXT PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES scoring_drivers(id));
        CREATE TABLE IF NOT EXISTS scoring_runs (run_id TEXT PRIMARY KEY, race_id TEXT NOT NULL, committed_at TEXT NOT NULL, UNIQUE (race_id, run_id));
        CREATE TABLE IF NOT EXISTS championship_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES scoring_runs(run_id), driver_id INTEGER NOT NULL REFERENCES scoring_drivers(id), driver_name TEXT NOT NULL, position INTEGER NOT NULL, points INTEGER NOT NULL, UNIQUE (run_id, driver_id));
      `);
    }
  },
  {
    version: 5,
    name: 'add-scoring-report-outbox',
    apply(database) {
      database.exec(`
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
      `);
    }
  },
  {
    version: 6,
    name: 'allow-expired-scoring-run-slots',
    apply(database) {
      database.exec(`
        ALTER TABLE scoring_run_slots RENAME TO scoring_run_slots_previous;
        CREATE TABLE scoring_run_slots (
          slot_key TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'expired')),
          source_file_name TEXT,
          source_file_hash TEXT,
          claimed_at TEXT
        );
        INSERT INTO scoring_run_slots SELECT * FROM scoring_run_slots_previous;
        DROP TABLE scoring_run_slots_previous;
      `);
    }
  },
  {
    version: 7,
    name: 'persist-scoring-results-for-standings',
    apply(database) {
      database.exec(`CREATE TABLE IF NOT EXISTS scoring_results (
        run_id TEXT NOT NULL REFERENCES scoring_runs(run_id),
        driver_id INTEGER NOT NULL REFERENCES scoring_drivers(id),
        position INTEGER NOT NULL,
        classified INTEGER NOT NULL,
        PRIMARY KEY (run_id, driver_id)
      )`);
    }
  }
];

export function applyMigrations(
  database: AppDatabase,
  pendingMigrations: readonly DatabaseMigration[] = migrations,
  context: MigrationContext = {}
): void {
  const applied = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
  const appliedVersions = new Set(applied.map((row) => row.version));

  for (const migration of pendingMigrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      migration.apply(database, context);
      database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createIncidentArchive(database: AppDatabase, context: MigrationContext = {}): string {
  const archiveDirectory = context.archiveDirectory ?? (context.databasePath ? dirname(context.databasePath) : process.cwd());
  mkdirSync(archiveDirectory, { recursive: true });
  const createdAt = new Date().toISOString();
  const payload = {
    format: 'acrra-incident-archive-v1' as const,
    createdAt,
    sourceDatabase: context.databasePath ?? null,
    liveIncidents: tableRows(database, 'live_incidents'),
    liveIncidentSnapshots: tableRows(database, 'live_incident_snapshots')
  };
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const archive: IncidentArchive = { ...payload, integrity: { algorithm: 'sha256', payloadHash } };
  const timestamp = createdAt.replace(/[-:.TZ]/g, '').replace(/\D/g, '').slice(0, 17);
  const archivePath = join(archiveDirectory, `acrra-incident-archive-${timestamp}-${process.pid}.json`);
  const temporaryPath = `${archivePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, archivePath);
  verifyIncidentArchive(readFileSync(archivePath, 'utf8'));
  return archivePath;
}

export function verifyIncidentArchive(input: IncidentArchive | string): void {
  const archive = typeof input === 'string' ? JSON.parse(input) as IncidentArchive : input;
  const { integrity, ...payload } = archive;
  const actual = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (archive.format !== 'acrra-incident-archive-v1' || integrity?.algorithm !== 'sha256' || integrity.payloadHash !== actual) {
    throw new Error('Incident archive integrity verification failed');
  }
}

function tableRows(database: AppDatabase, table: string): Record<string, unknown>[] {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return exists ? database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[] : [];
}
