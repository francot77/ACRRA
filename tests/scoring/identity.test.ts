import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../src/db/db';
import { DriverIdentityStore } from '../../src/scoring/identity';
import { ScoringStore } from '../../src/scoring/store';

function database() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), 'acrra-scoring-')), 'scoring.sqlite'));
}

test('missing GUID falls back to normalized driver name', () => {
  const db = database();
  const driver = new DriverIdentityStore(db).resolve('  Jane   Doe  ', null);
  assert.equal(driver.guid, null);
  assert.equal(driver.normalizedName, 'jane doe');
  assert.equal(db.prepare('SELECT count(*) AS count FROM scoring_drivers').get().count, 1);
  db.close();
});

test('a later GUID links to the existing name-only pilot', () => {
  const db = database();
  const store = new DriverIdentityStore(db);
  const first = store.resolve('Jane Doe');
  const linked = store.resolve('jane doe', 'guid-42');
  assert.equal(linked.id, first.id);
  assert.equal(db.prepare('SELECT guid FROM scoring_drivers WHERE id = ?').get(first.id).guid, 'guid-42');
  assert.equal(db.prepare('SELECT count(*) AS count FROM scoring_drivers').get().count, 1);
  db.close();
});

test('award commit is idempotent across duplicate processing and restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'acrra-scoring-')), 'scoring.sqlite');
  const db = openDatabase(path);
  const store = new ScoringStore(db);
  const driver = store.identities.resolve('Jane Doe', 'guid-42');
  const race = { raceId: 'race-1', runId: 'run-1', results: [] } as const;
  const award = { driverId: driver.id, driverName: driver.displayName, position: 1, points: 25 };
  assert.equal(store.commitAwards(race, [award]), 'inserted');
  assert.equal(store.commitAwards(race, [award]), 'duplicate');
  db.close();

  const restarted = openDatabase(path);
  assert.equal(new ScoringStore(restarted).commitAwards(race, [award]), 'duplicate');
  assert.equal(restarted.prepare('SELECT count(*) AS count FROM championship_awards').get().count, 1);
  restarted.close();
});
