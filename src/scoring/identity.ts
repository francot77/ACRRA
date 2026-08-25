import type { AppDatabase } from '../db/db';
import type { ScoringDriver } from './types';

export function normalizeDriverName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export class DriverIdentityStore {
  constructor(private readonly database: AppDatabase) {}

  resolve(name: string, guid?: string | null): ScoringDriver {
    const displayName = name.normalize('NFKC').trim();
    const normalizedName = normalizeDriverName(displayName);
    const cleanGuid = guid?.trim() || null;
    if (!normalizedName) throw new Error('Driver identity requires a name');

    const byGuid = cleanGuid
      ? this.database.prepare('SELECT id, guid, display_name AS displayName, normalized_name AS normalizedName FROM scoring_drivers WHERE guid = ?').get(cleanGuid) as ScoringDriver | undefined
      : undefined;
    const byName = this.database.prepare('SELECT d.id, d.guid, d.display_name AS displayName, d.normalized_name AS normalizedName FROM scoring_driver_aliases a JOIN scoring_drivers d ON d.id = a.driver_id WHERE a.normalized_name = ?').get(normalizedName) as ScoringDriver | undefined;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (byGuid && byName && byGuid.id !== byName.id) throw new Error(`Driver GUID conflicts with name alias: ${displayName}`);
      const resolved = byGuid ?? byName ?? this.insertDriver(displayName, normalizedName, cleanGuid);
      if (cleanGuid && resolved.guid && resolved.guid !== cleanGuid) throw new Error(`Driver GUID conflict for ${displayName}`);
      if (cleanGuid && !resolved.guid) {
        this.database.prepare('UPDATE scoring_drivers SET guid = ?, display_name = ? WHERE id = ?').run(cleanGuid, displayName, resolved.id);
        resolved.guid = cleanGuid;
      }
      if (resolved.displayName !== displayName) {
        this.database.prepare('UPDATE scoring_drivers SET display_name = ? WHERE id = ?').run(displayName, resolved.id);
        resolved.displayName = displayName;
      }
      this.database.prepare('INSERT OR IGNORE INTO scoring_driver_aliases (normalized_name, driver_id) VALUES (?, ?)').run(normalizedName, resolved.id);
      this.database.exec('COMMIT');
      return resolved;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private insertDriver(displayName: string, normalizedName: string, guid: string | null): ScoringDriver {
    const result = this.database.prepare('INSERT INTO scoring_drivers (guid, display_name, normalized_name) VALUES (?, ?, ?)').run(guid, displayName, normalizedName);
    return { id: Number(result.lastInsertRowid), guid, displayName, normalizedName };
  }
}
