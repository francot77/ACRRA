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
