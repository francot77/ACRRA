import cron, { type ScheduledTask } from 'node-cron';
import type { AppDatabase } from '../db/db';
import { findFirstEligibleRace, getScoringWindowBounds, type RaceSourceConfig, type ValidatedRaceSource } from './acsmAdapter';

export const DAILY_SCORING_CRON = '0 21 * * *' as const;
export const BUENOS_AIRES_TIMEZONE = 'America/Argentina/Buenos_Aires' as const;

// node-cron owns wall-clock/DST triggering. We do not invent a gap/overlap rule:
// the only accepted policy is explicit rejection of ambiguous local slots, while
// the durable slot key makes a repeated callback harmless.

export type PendingRun = {
  slotKey: string;
  status: 'pending' | 'claimed' | 'expired';
  sourceFileName: string | null;
};

export interface RunSlotStore {
  ensurePending(slotKey: string): void;
  claim(slotKey: string, source: ValidatedRaceSource): boolean;
  expire(slotKey: string): boolean;
  get(slotKey: string): PendingRun | null;
}

export class SqliteRunSlotStore implements RunSlotStore {
  constructor(private readonly database: AppDatabase) {}

  ensurePending(slotKey: string): void {
    this.database.prepare('INSERT OR IGNORE INTO scoring_run_slots (slot_key, status) VALUES (?, ?)').run(slotKey, 'pending');
  }

  claim(slotKey: string, source: ValidatedRaceSource): boolean {
    const result = this.database.prepare(
      `UPDATE scoring_run_slots SET status = 'claimed', source_file_name = ?, source_file_hash = ?, claimed_at = ?
       WHERE slot_key = ? AND status = 'pending'`
    ).run(source.fileName, source.fileHash, new Date().toISOString(), slotKey) as { changes: number };
    return result.changes === 1;
  }

  expire(slotKey: string): boolean {
    const result = this.database.prepare(
      "UPDATE scoring_run_slots SET status = 'expired' WHERE slot_key = ? AND status = 'pending'"
    ).run(slotKey) as { changes: number };
    return result.changes === 1;
  }

  get(slotKey: string): PendingRun | null {
    const row = this.database.prepare('SELECT slot_key, status, source_file_name FROM scoring_run_slots WHERE slot_key = ?').get(slotKey) as
      | { slot_key: string; status: 'pending' | 'claimed' | 'expired'; source_file_name: string | null }
      | undefined;
    return row ? { slotKey: row.slot_key, status: row.status, sourceFileName: row.source_file_name } : null;
  }
}

export type SchedulerOptions = {
  source: RaceSourceConfig;
  store: RunSlotStore;
  onClaim: (slotKey: string, source: ValidatedRaceSource) => Promise<void>;
  now?: () => Date;
  timezone?: string;
  dstPolicy?: 'reject-ambiguous';
  findSource?: (source: RaceSourceConfig, now: Date, slotDate?: string, timezone?: string) => Promise<ValidatedRaceSource | null>;
  retryIntervalMs?: number;
};

export class DailyRaceScheduler {
  private task: ScheduledTask | null = null;
  private retryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly options: SchedulerOptions) {}

  async runSlot(at = this.options.now?.() ?? new Date(), requestedSlotDate?: string): Promise<'pending' | 'claimed' | 'duplicate' | 'expired'> {
    const timezone = this.options.timezone ?? BUENOS_AIRES_TIMEZONE;
    if ((this.options.dstPolicy ?? 'reject-ambiguous') === 'reject-ambiguous' && isAmbiguousLocalTime(at, timezone)) {
      throw new Error(`Ambiguous local scoring slot rejected for ${timezone}`);
    }

    const slotKey = requestedSlotDate ?? localDateKey(at, timezone);
    this.options.store.ensurePending(slotKey);
    const current = this.options.store.get(slotKey);
    if (current?.status === 'claimed' || current?.status === 'expired') return 'duplicate';

    const window = getScoringWindowBounds(slotKey, timezone, this.options.source.raceWindowMinutes ?? 60);
    if (window && at >= window.end) {
      this.options.store.expire(slotKey);
      this.retryTimers.delete(slotKey);
      return 'expired';
    }

    const source = await (this.options.findSource ?? findFirstEligibleRace)(this.options.source, at, slotKey, timezone);
    if (!source) {
      this.scheduleRetry(slotKey);
      return 'pending';
    }
    if (!this.options.store.claim(slotKey, source)) return 'duplicate';
    await this.options.onClaim(slotKey, source);
    return 'claimed';
  }

  start(): void {
    this.task = cron.schedule(DAILY_SCORING_CRON, () => {
      void this.runSlot().catch((error) => console.error(JSON.stringify({ level: 'error', component: 'scoring-scheduler', error: String(error) })));
    }, { timezone: this.options.timezone ?? BUENOS_AIRES_TIMEZONE, noOverlap: true });
  }

  stop(): void {
    this.task?.destroy();
    this.task = null;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  private scheduleRetry(slotKey: string): void {
    if (this.retryTimers.has(slotKey)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(slotKey);
      void this.runSlot(undefined, slotKey).catch((error) => console.error(JSON.stringify({ level: 'error', component: 'scoring-scheduler', error: String(error) })));
    }, this.options.retryIntervalMs ?? 60_000);
    timer.unref?.();
    this.retryTimers.set(slotKey, timer);
  }
}

export function localDateKey(date: Date, timezone: string = BUENOS_AIRES_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isAmbiguousLocalTime(date: Date, timezone: string): boolean {
  const target = formatLocalDateTime(date, timezone);
  for (const deltaMinutes of [-120, -90, -60, -30, 30, 60, 90, 120]) {
    const candidate = new Date(date.getTime() + deltaMinutes * 60_000);
    if (formatLocalDateTime(candidate, timezone) === target) return true;
  }
  return false;
}

function formatLocalDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}
