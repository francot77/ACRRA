import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = DatabaseSync;

export function openDatabase(databasePath: string): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(readFileSync(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
  ensureLiveIncidentVerdictColumns(database);

  return database;
}

function ensureLiveIncidentVerdictColumns(database: AppDatabase): void {
  const rows = database.prepare('PRAGMA table_info(live_incidents)').all() as Array<{ name: string }>;
  const columnNames = new Set(rows.map((row) => row.name));

  if (!columnNames.has('verdict_type')) {
    database.exec('ALTER TABLE live_incidents ADD COLUMN verdict_type TEXT');
  }

  if (!columnNames.has('verdict_confidence')) {
    database.exec('ALTER TABLE live_incidents ADD COLUMN verdict_confidence REAL');
  }

  if (!columnNames.has('verdict_blamed_car_id')) {
    database.exec('ALTER TABLE live_incidents ADD COLUMN verdict_blamed_car_id INTEGER');
  }

  if (!columnNames.has('verdict_explanation_json')) {
    database.exec('ALTER TABLE live_incidents ADD COLUMN verdict_explanation_json TEXT');
  }
}
