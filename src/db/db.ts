import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = DatabaseSync;

export function openDatabase(databasePath: string): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(readFileSync(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));

  return database;
}
