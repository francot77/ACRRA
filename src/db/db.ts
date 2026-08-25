import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrations';

export type AppDatabase = DatabaseSync;

export type DatabaseBackup = {
  databasePath: string;
  walPath: string | null;
  shmPath: string | null;
};

export function openDatabase(databasePath: string, options: { archiveDirectory?: string } = {}): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });
  const hadDatabase = existsSync(databasePath);
  const database = new DatabaseSync(databasePath);

  if (hadDatabase) {
    backupDatabase(databasePath);
  }

  database.exec(readFileSync(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
  applyMigrations(database, undefined, { databasePath, archiveDirectory: options.archiveDirectory });
  return database;
}

/** Create a recoverable copy before schema writes. Existing WAL sidecars are copied too. */
export function backupDatabase(databasePath: string, destinationPath = `${databasePath}.backup-${Date.now()}`): DatabaseBackup {
  const walSource = `${databasePath}-wal`;
  const shmSource = `${databasePath}-shm`;
  const walPath = existsSync(walSource) ? `${destinationPath}-wal` : null;
  const shmPath = existsSync(shmSource) ? `${destinationPath}-shm` : null;

  copyFileSync(databasePath, destinationPath);
  if (walPath) copyFileSync(walSource, walPath);
  if (shmPath) copyFileSync(shmSource, shmPath);

  const verification = new DatabaseSync(destinationPath);
  try {
    const result = verification.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (result.integrity_check !== 'ok') {
      throw new Error(`SQLite backup integrity check failed: ${result.integrity_check}`);
    }
  } finally {
    verification.close();
  }

  return { databasePath: destinationPath, walPath, shmPath };
}
