import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyRaceScheduler, isAmbiguousLocalTime, localDateKey, type RunSlotStore } from '../../src/scoring/scheduler';
import type { ValidatedRaceSource } from '../../src/scoring/acsmAdapter';

class MemorySlots implements RunSlotStore {
  rows = new Map<string, { status: 'pending' | 'claimed' | 'expired'; sourceFileName: string | null }>();
  ensurePending(key: string) { this.rows.set(key, this.rows.get(key) ?? { status: 'pending', sourceFileName: null }); }
  claim(key: string, source: ValidatedRaceSource) { const row = this.rows.get(key); if (!row || row.status !== 'pending') return false; row.status = 'claimed'; row.sourceFileName = source.fileName; return true; }
  expire(key: string) { const row = this.rows.get(key); if (!row || row.status !== 'pending') return false; row.status = 'expired'; return true; }
  get(key: string) { const row = this.rows.get(key); return row ? { slotKey: key, ...row } : null; }
}

test('slot identity uses Buenos Aires local date at 21:00', () => {
  assert.equal(localDateKey(new Date('2026-08-20T00:00:00Z')), '2026-08-19');
});

test('pending slot retries late files and claims only once across restart', async () => {
  const store = new MemorySlots();
  let available: ValidatedRaceSource | null = null;
  const scheduler = new DailyRaceScheduler({ source: { resultsDir: '', sourceGlob: '*_RACE.json', minFileAgeMs: 0 }, store, onClaim: async () => {}, now: () => new Date('2026-08-20T21:00:00-03:00'), findSource: async () => null });
  assert.equal(await scheduler.runSlot(), 'pending');
  available = { fileName: '2026_8_20_21_5_RACE.json', filePath: '2026_8_20_21_5_RACE.json', fileHash: 'hash', race: {} as ValidatedRaceSource['race'] };
  const retry = new DailyRaceScheduler({ source: { resultsDir: '', sourceGlob: '*_RACE.json', minFileAgeMs: 0 }, store, onClaim: async () => {}, now: () => new Date('2026-08-20T21:00:00-03:00'), findSource: async () => available });
  assert.equal(await retry.runSlot(), 'claimed');
  assert.equal(await retry.runSlot(), 'duplicate');
  assert.equal(store.get('2026-08-20')?.status, 'claimed');
});

test('pending slot expires at the window close and cannot reuse a future-day race', async () => {
  const store = new MemorySlots();
  let calls = 0;
  const scheduler = new DailyRaceScheduler({
    source: { resultsDir: '', sourceGlob: '*_RACE.json', minFileAgeMs: 0 },
    store,
    onClaim: async () => {},
    findSource: async () => { calls += 1; return null; }
  });
  assert.equal(await scheduler.runSlot(new Date('2026-08-21T00:30:00.000Z'), '2026-08-20'), 'pending');
  assert.equal(await scheduler.runSlot(new Date('2026-08-21T01:00:00.000Z'), '2026-08-20'), 'expired');
  assert.equal(store.get('2026-08-20')?.status, 'expired');
  assert.equal(calls, 1);
  assert.equal(await scheduler.runSlot(new Date('2026-08-21T01:00:00.000Z'), '2026-08-20'), 'duplicate');
});

test('reject-ambiguous DST policy rejects an ambiguous runtime instant before claiming', async () => {
  const store = new MemorySlots();
  let claims = 0;
  const scheduler = new DailyRaceScheduler({
    source: { resultsDir: '', sourceGlob: '*_RACE.json', minFileAgeMs: 0 },
    store,
    timezone: 'America/New_York',
    dstPolicy: 'reject-ambiguous',
    onClaim: async () => { claims += 1; },
    findSource: async () => ({ fileName: '2026_11_1_21_0_RACE.json', filePath: '2026_11_1_21_0_RACE.json', fileHash: 'hash', race: {} as ValidatedRaceSource['race'] })
  });

  // This known fold instant exercises the same Intl timezone machinery used by
  // the configured Buenos Aires scheduler policy.
  const ambiguousInstant = new Date('2026-11-01T05:30:00.000Z');
  assert.equal(isAmbiguousLocalTime(ambiguousInstant, 'America/New_York'), true);
  await assert.rejects(() => scheduler.runSlot(ambiguousInstant), /Ambiguous local scoring slot rejected/);
  assert.equal(claims, 0);
  assert.equal(store.rows.size, 0);
});
