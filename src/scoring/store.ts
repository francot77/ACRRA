import type { AppDatabase } from '../db/db';
import { DriverIdentityStore } from './identity';
import type { Award, ScoringRace, ScoringStanding } from './types';
import type { StandingsReport } from '../discord/buildStandingsMessage';

export type ReportOutboxEntry = {
  reportId: string;
  runId: string;
  status: 'pending' | 'sent' | 'failed-retryable';
  payloadJson: string;
  attempts: number;
};

export class ScoringStore {
  readonly identities: DriverIdentityStore;

  constructor(private readonly database: AppDatabase) {
    this.identities = new DriverIdentityStore(database);
  }

  commitAwards(race: ScoringRace, awards: readonly Award[]): 'inserted' | 'duplicate' {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const run = this.database.prepare('INSERT OR IGNORE INTO scoring_runs (race_id, run_id, committed_at) VALUES (?, ?, ?)').run(race.raceId, race.runId, new Date().toISOString()) as { changes: number };
      if (run.changes !== 1) {
        this.database.exec('ROLLBACK');
        return 'duplicate';
      }
      const insert = this.database.prepare('INSERT INTO championship_awards (run_id, driver_id, driver_name, position, points) VALUES (?, ?, ?, ?, ?)');
      for (const award of awards) insert.run(race.runId, award.driverId, award.driverName, award.position, award.points);
      this.database.exec('COMMIT');
      return 'inserted';
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  commitAwardsAndQueue(race: ScoringRace, awards: readonly Award[], report: StandingsReport): 'inserted' | 'duplicate' {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const run = this.database.prepare('INSERT OR IGNORE INTO scoring_runs (race_id, run_id, committed_at) VALUES (?, ?, ?)').run(race.raceId, race.runId, new Date().toISOString()) as { changes: number };
      if (run.changes !== 1) {
        this.database.exec('ROLLBACK');
        return 'duplicate';
      }
      const insert = this.database.prepare('INSERT INTO championship_awards (run_id, driver_id, driver_name, position, points) VALUES (?, ?, ?, ?, ?)');
      for (const award of awards) insert.run(race.runId, award.driverId, award.driverName, award.position, award.points);
      const resultInsert = this.database.prepare('INSERT INTO scoring_results (run_id, driver_id, position, classified) VALUES (?, ?, ?, ?)');
      for (const result of race.results) {
        if (result.driverId == null) throw new Error(`Scoring result for ${result.driverName} is missing its identity`);
        resultInsert.run(race.runId, result.driverId, result.position, result.classified ? 1 : 0);
      }
      this.database.prepare('INSERT INTO scoring_report_outbox (report_id, run_id, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(report.reportId, race.runId, 'pending', JSON.stringify(report), new Date().toISOString());
      this.database.exec('COMMIT');
      return 'inserted';
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getStandings(): ScoringStanding[] {
    const rows = this.database.prepare(`
      SELECT d.display_name AS driverName,
             COALESCE(SUM(a.points), 0) AS points,
             COUNT(DISTINCT r.run_id) AS races,
             SUM(CASE WHEN r.classified = 1 AND r.position = 1 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN r.classified = 1 AND r.position <= 3 THEN 1 ELSE 0 END) AS podiums
      FROM scoring_drivers d
      LEFT JOIN scoring_results r ON r.driver_id = d.id
      LEFT JOIN championship_awards a ON a.driver_id = d.id AND a.run_id = r.run_id
      GROUP BY d.id, d.display_name
      ORDER BY points DESC, wins DESC, podiums DESC, driverName COLLATE NOCASE ASC
      LIMIT 20
    `).all() as Array<ScoringStanding & { points: number; races: number; wins: number; podiums: number }>;
    return rows.map((row) => ({
      driverName: row.driverName,
      points: Number(row.points),
      races: Number(row.races),
      wins: Number(row.wins),
      podiums: Number(row.podiums)
    }));
  }

  getReport(reportId: string): ReportOutboxEntry | null {
    const row = this.database.prepare('SELECT report_id, run_id, status, payload_json, attempts FROM scoring_report_outbox WHERE report_id = ?').get(reportId) as
      | { report_id: string; run_id: string; status: ReportOutboxEntry['status']; payload_json: string; attempts: number }
      | undefined;
    return row ? { reportId: row.report_id, runId: row.run_id, status: row.status, payloadJson: row.payload_json, attempts: row.attempts } : null;
  }

  markReportSent(reportId: string): void {
    this.database.prepare("UPDATE scoring_report_outbox SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE report_id = ? AND status <> 'sent'").run(new Date().toISOString(), reportId);
  }

  markReportFailed(reportId: string, error: string): void {
    this.database.prepare("UPDATE scoring_report_outbox SET status = 'failed-retryable', attempts = attempts + 1, last_error = ? WHERE report_id = ? AND status <> 'sent'").run(error, reportId);
  }
}
