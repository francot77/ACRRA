import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../src/db/db';
import { buildStandingsMessage } from '../../src/discord/buildStandingsMessage';
import { ScoringRunService } from '../../src/scoring/service';
import { ScoringStore } from '../../src/scoring/store';
import { DailyRaceScheduler, SqliteRunSlotStore } from '../../src/scoring/scheduler';
import type { ValidatedRaceSource } from '../../src/scoring/acsmAdapter';

function source(): ValidatedRaceSource {
  return {
    fileName: 'RACE.json',
    filePath: 'RACE.json',
    fileHash: 'stable-hash',
    race: {
      type: 'RACE',
      sourceFileName: 'RACE.json',
      trackName: 'Monza',
      trackConfig: '',
      raceLaps: 10,
      carModel: 'car',
      drivers: [
        { carId: 1, name: 'Pilot One', guid: 'guid-1', identity: { kind: 'guid', value: 'guid-1' }, carModel: 'car', position: 1, bestLap: 90, totalTime: 100 },
        { carId: 2, name: 'Pilot Two', guid: null, identity: { kind: 'temp', value: 'temp' }, carModel: 'car', position: 2, bestLap: 91, totalTime: 101 }
      ],
      lapsByCarId: new Map(),
      events: []
    }
  };
}

test('standings report is stable, named, and limited to twenty drivers', () => {
  const report = buildStandingsMessage({
    reportId: 'report-1', raceId: 'race-1', runId: 'run-1',
    rows: Array.from({ length: 12 }, (_, index) => ({ driverName: `Pilot ${index + 1}`, position: index + 1, points: 12 - index }))
  });
  assert.equal(report.title, 'Copa NHRacing — resultados de hoy');
  assert.equal(report.rows.length, 12);
  assert.match(report.message.webhookBody.embeds[0].description, /1\. Pilot 1 — 12 pts · 0 carreras · 0 victorias · 0 podios/);
  assert.match(report.message.webhookBody.embeds[0].description, /Pilot 11/);
});

test('standings message renders one readable ranking without internal identifiers', () => {
  const report = buildStandingsMessage({
    reportId: 'report:internal',
    raceId: 'race:internal',
    runId: 'run:internal',
    rows: [{ driverName: 'Winner', position: 1, points: 25, races: 1, wins: 1, podiums: 1 }]
  });
  const embed = report.message.webhookBody.embeds[0];

  assert.equal(embed.fields.length, 0);
  assert.equal(embed.description, '1. Winner — 25 pts · 1 carrera · 1 victoria · 1 podio');
  assert.equal(embed.footer.text, 'Clasificación del campeonato');
  assert.doesNotMatch(embed.footer.text, /race:|run:/i);
  assert.doesNotMatch(embed.description, /Clasificación/);
});

test('failed delivery retries the stored report without rescoring or duplicate awards', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'acrra-delivery-')), 'scoring.sqlite');
  const firstDb = openDatabase(path);
  const firstStore = new ScoringStore(firstDb);
  let sends = 0;
  const transport = async () => {
    sends += 1;
    return sends === 1 ? 'failed' as const : 'sent' as const;
  };
  const first = new ScoringRunService(firstStore, 'https://example.invalid/results', transport);
  const processed = await first.process('2026-08-19', source());
  assert.equal(processed.committed, 'inserted');
  assert.equal(processed.delivery, 'failed-retryable');
  assert.equal(firstDb.prepare('SELECT count(*) AS count FROM championship_awards').get().count, 2);
  firstDb.close();

  const restartedDb = openDatabase(path);
  const restartedStore = new ScoringStore(restartedDb);
  const restarted = new ScoringRunService(restartedStore, 'https://example.invalid/results', transport);
  assert.equal(await restarted.retry(processed.reportId), 'sent');
  assert.equal(restartedDb.prepare('SELECT count(*) AS count FROM championship_awards').get().count, 2);
  assert.equal(restartedDb.prepare("SELECT status FROM scoring_report_outbox WHERE report_id = ?").get(processed.reportId).status, 'sent');
  restartedDb.close();
});

test('selects the newest persisted report and force-resends an already sent report', async () => {
  const database = openDatabase(join(mkdtempSync(join(tmpdir(), 'acrra-resend-')), 'scoring.sqlite'));
  const store = new ScoringStore(database);
  const report = buildStandingsMessage({ reportId: 'latest-report', raceId: 'race-latest', runId: 'run-latest', rows: [] });
  database.prepare('INSERT INTO scoring_runs (run_id, race_id, committed_at) VALUES (?, ?, ?)').run('run-latest', 'race-latest', '2026-08-20T00:00:00.000Z');
  database.prepare('INSERT INTO scoring_report_outbox (report_id, run_id, status, payload_json, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('older-report', 'run-latest', 'sent', JSON.stringify(report), 1, '2026-08-19T00:00:00.000Z');
  database.prepare('INSERT INTO scoring_runs (run_id, race_id, committed_at) VALUES (?, ?, ?)').run('run-newest', 'race-newest', '2026-08-20T00:00:00.000Z');
  database.prepare('INSERT INTO scoring_report_outbox (report_id, run_id, status, payload_json, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('latest-report', 'run-newest', 'sent', JSON.stringify({ ...report, reportId: 'latest-report' }), 3, '2026-08-20T00:00:00.000Z');
  assert.equal(store.getLatestReport()?.reportId, 'latest-report');

  let deliveredReportId = '';
  const service = new ScoringRunService(store, 'https://example.invalid/results', async (_url, delivered) => {
    deliveredReportId = delivered.reportId;
    return 'sent';
  });
  assert.equal(await service.resendLatest(), 'sent');
  assert.equal(deliveredReportId, 'latest-report');
  assert.equal(database.prepare('SELECT attempts FROM scoring_report_outbox WHERE report_id = ?').get('latest-report').attempts, 4);
  assert.equal(database.prepare('SELECT count(*) AS count FROM championship_awards').get().count, 0);
  database.close();
});

test('eligible scheduled run scores once and delivers the dedicated report', async () => {
  const database = openDatabase(join(mkdtempSync(join(tmpdir(), 'acrra-scheduled-')), 'scoring.sqlite'));
  const store = new ScoringStore(database);
  let deliveredTitle = '';
  const service = new ScoringRunService(store, 'https://example.invalid/results', async (_url, report) => {
    deliveredTitle = report.title;
    return 'sent';
  });
  const scheduler = new DailyRaceScheduler({
    source: { resultsDir: '', sourceGlob: 'RACE.json', minFileAgeMs: 0 },
    store: new SqliteRunSlotStore(database),
    now: () => new Date('2026-08-20T21:00:00-03:00'),
    findSource: async () => source(),
    onClaim: (slotKey, validated) => service.process(slotKey, validated).then(() => undefined)
  });
  assert.equal(await scheduler.runSlot(), 'claimed');
  assert.equal(deliveredTitle, 'Copa NHRacing — resultados de hoy');
  assert.equal(database.prepare('SELECT count(*) AS count FROM championship_awards').get().count, 2);
  assert.equal(await scheduler.runSlot(), 'duplicate');
  database.close();
});

test('consolidates duplicate GUID results before scoring and persistence', async () => {
  const database = openDatabase(join(mkdtempSync(join(tmpdir(), 'acrra-duplicate-result-')), 'scoring.sqlite'));
  const store = new ScoringStore(database);
  const service = new ScoringRunService(store, 'https://example.invalid/results', async () => 'sent');
  const duplicateSource = source();
  duplicateSource.race.drivers = [
    { ...duplicateSource.race.drivers[0], carId: 16, position: 2, totalTime: 100 },
    { ...duplicateSource.race.drivers[0], carId: 0, position: 13, totalTime: 0 }
  ];

  const processed = await service.process('2026-08-20', duplicateSource);

  assert.equal(processed.committed, 'inserted');
  assert.equal(database.prepare('SELECT count(*) AS count FROM scoring_results WHERE run_id = ?').get(processed.runId).count, 1);
  const storedResult = database.prepare('SELECT position, classified FROM scoring_results WHERE run_id = ?').get(processed.runId);
  assert.equal(storedResult.position, 2);
  assert.equal(storedResult.classified, 1);
  const storedAward = database.prepare('SELECT position, points FROM championship_awards WHERE run_id = ?').get(processed.runId);
  assert.equal(storedAward.position, 2);
  assert.equal(storedAward.points, 18);
  assert.deepEqual(store.getStandings(), [{ driverName: 'Pilot One', points: 18, races: 1, wins: 0, podiums: 1 }]);
  database.close();
});
