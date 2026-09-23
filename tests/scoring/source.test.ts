import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { findFirstEligibleRace, getScoringWindowBounds, parseRaceFilenameTimestamp, validateRaceFile } from '../../src/scoring/acsmAdapter';
import { loadConfig } from '../../src/config';
import { parseDailyScoringSchedule } from '../../src/scoring/schedule';

const race = JSON.stringify({ Type: 'RACE', TrackName: 'test', TrackConfig: '', DurationSecs: 0, RaceLaps: 3, Cars: [], Result: [], Laps: [], Events: [] });

const now = new Date('2026-06-21T01:00:00.000Z');
const config = (resultsDir: string, schedule?: string) => ({
  resultsDir,
  sourceGlob: '*_RACE.json',
  minFileAgeMs: 1000,
  stabilityDelayMs: 1,
  ...(schedule ? { schedule: parseDailyScoringSchedule(schedule) } : {})
});

async function stableFile(dir: string, fileName: string, referenceNow = now): Promise<void> {
  const path = join(dir, fileName);
  await writeFile(path, race);
  const old = new Date(referenceNow.getTime() - 10_000);
  await utimes(path, old, old);
}

test('source adapter excludes older dates and files before the 21:00 slot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acrra-source-'));
  await stableFile(dir, '2026_6_19_22_0_RACE.json');
  await stableFile(dir, '2026_6_20_20_59_RACE.json');
  assert.equal(await findFirstEligibleRace(config(dir), now, '2026-06-20'), null);
});

test('source adapter selects the earliest eligible 21:00+ export by parsed timestamp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acrra-source-order-'));
  await stableFile(dir, '2026_6_20_22_0_RACE.json');
  await stableFile(dir, '2026_6_20_21_5_RACE.json');
  const source = await findFirstEligibleRace(config(dir), now, '2026-06-20');
  assert.equal(source?.fileName, '2026_6_20_21_5_RACE.json');
  assert.equal(parseRaceFilenameTimestamp('2026_6_20_1_52_RACE.json')?.timestamp.toISOString(), '2026-06-20T04:52:00.000Z');
  assert.equal(parseRaceFilenameTimestamp('2026_6_20_1_52_RACE.json')?.localDate, '2026-06-20');
});

test('source adapter accepts the 21:00 and 21:59 races but excludes exactly 22:00', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acrra-source-window-'));
  await stableFile(dir, '2026_6_20_21_0_RACE.json');
  await stableFile(dir, '2026_6_20_21_59_RACE.json');
  await stableFile(dir, '2026_6_20_22_0_RACE.json');
  const source = await findFirstEligibleRace(config(dir), now, '2026-06-20');
  assert.equal(source?.fileName, '2026_6_20_21_0_RACE.json');
  const lateDir = await mkdtemp(join(tmpdir(), 'acrra-source-window-late-'));
  await stableFile(lateDir, '2026_6_20_21_59_RACE.json');
  assert.equal((await findFirstEligibleRace(config(lateDir), now, '2026-06-20'))?.fileName, '2026_6_20_21_59_RACE.json');
  assert.equal(await findFirstEligibleRace({ ...config(lateDir), raceWindowMinutes: 1 }, now, '2026-06-20'), null);
});

test('source adapter accepts the configured 12:00 window and excludes 13:00', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acrra-source-noon-window-'));
  const noonNow = new Date('2026-06-20T16:00:00.000Z');
  await stableFile(dir, '2026_6_20_12_59_RACE.json', noonNow);
  await stableFile(dir, '2026_6_20_13_0_RACE.json', noonNow);
  const source = await findFirstEligibleRace(config(dir, '0 12 * * *'), noonNow, '2026-06-20');
  assert.equal(source?.fileName, '2026_6_20_12_59_RACE.json');

  const lateDir = await mkdtemp(join(tmpdir(), 'acrra-source-noon-window-late-'));
  await stableFile(lateDir, '2026_6_20_13_0_RACE.json', noonNow);
  assert.equal(await findFirstEligibleRace(config(lateDir, '0 12 * * *'), noonNow, '2026-06-20'), null);
});

test('source adapter rejects invalid suffixes, malformed JSON, and non-RACE JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acrra-source-invalid-'));
  await stableFile(dir, '2026_6_20_21_0_QUALIFY.json');
  assert.equal(await findFirstEligibleRace({ ...config(dir), sourceGlob: '*' }, now, '2026-06-20'), null);
  const path = join(dir, '2026_6_20_21_1_RACE.json');
  await writeFile(path, '{not-json');
  assert.equal(await findFirstEligibleRace({ ...config(dir), minFileAgeMs: 0 }, now, '2026-06-20'), null);
  await writeFile(path, JSON.stringify({ Type: 'PRACTICE' }));
  assert.equal(await findFirstEligibleRace({ ...config(dir), minFileAgeMs: 0 }, now, '2026-06-20'), null);
});

test('source adapter excludes practice and qualifying files and does not reuse a next-day race', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acrra-source-suffix-day-'));
  await stableFile(dir, '2026_6_20_21_10_PRACTICE.json');
  await stableFile(dir, '2026_6_20_21_20_QUALIFY.json');
  await stableFile(dir, '2026_6_21_21_0_RACE.json');
  assert.equal(await findFirstEligibleRace({ ...config(dir), sourceGlob: '*' }, now, '2026-06-20'), null);
});

test('source adapter rejects a file that changes during the stability window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acrra-source-changing-'));
  const path = join(dir, '2026_6_20_21_0_RACE.json');
  await writeFile(path, race);
  const old = new Date(Date.now() - 10_000);
  await utimes(path, old, old);
  setTimeout(() => { void writeFile(path, `${race} `); }, 2);
  assert.equal(await validateRaceFile(path, { minFileAgeMs: 1000, stabilityDelayMs: 15 }, now), null);
});

test('scoring race window setting defaults to 60 minutes and rejects non-positive values', () => {
  assert.equal(loadConfig({}).scoringRaceWindowMinutes, 60);
  assert.deepEqual(loadConfig({}).scoringSchedule, { expression: '0 21 * * *', minute: 0, hour: 21 });
  assert.deepEqual(loadConfig({ SCORING_SCHEDULE: '0 10 * * *' }).scoringSchedule, { expression: '0 10 * * *', minute: 0, hour: 10 });
  assert.deepEqual(loadConfig({ SCORING_SCHEDULE: '0 13 * * *' }).scoringSchedule, { expression: '0 13 * * *', minute: 0, hour: 13 });
  assert.deepEqual(loadConfig({ SCORING_SCHEDULE: '0 21 * * *' }).scoringSchedule, { expression: '0 21 * * *', minute: 0, hour: 21 });
  assert.deepEqual(loadConfig({ SCORING_SCHEDULE: '15 13 * * *' }).scoringSchedule, { expression: '15 13 * * *', minute: 15, hour: 13 });
  for (const schedule of ['13:00', '0 13 * *', '0 13 * * 1', '60 13 * * *', '0 24 * * *']) {
    assert.throws(() => loadConfig({ SCORING_SCHEDULE: schedule }), /SCORING_SCHEDULE/);
  }
  assert.equal(getScoringWindowBounds('2026-06-20', undefined, 60, parseDailyScoringSchedule('0 10 * * *'))?.start.toISOString(), '2026-06-20T13:00:00.000Z');
  assert.equal(getScoringWindowBounds('2026-06-20', undefined, 60, parseDailyScoringSchedule('0 13 * * *'))?.start.toISOString(), '2026-06-20T16:00:00.000Z');
  assert.equal(getScoringWindowBounds('2026-06-20', undefined, 60, parseDailyScoringSchedule('0 21 * * *'))?.start.toISOString(), '2026-06-21T00:00:00.000Z');
  assert.equal(loadConfig({}).safetyMinImpactKmh, 30);
  assert.equal(loadConfig({ SAFETY_MIN_IMPACT_KMH: '45' }).safetyMinImpactKmh, 45);
  assert.throws(() => loadConfig({ SAFETY_MIN_IMPACT_KMH: '-1' }));
  assert.throws(() => loadConfig({ SCORING_RACE_WINDOW_MINUTES: '0' }), /greater than 0/);
});
