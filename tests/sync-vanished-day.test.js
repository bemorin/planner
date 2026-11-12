// 1.40.0: a day that disappears from this browser without a tracked removal (no tombstone) is never deleted from the
// copy by a sync: it is pulled back. Deletions leave a tombstone, and those still sync as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from './support/archive-tabs.js';
import { QuotaStorage, SAFARI_BUDGET } from './support/history.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createDayStore } from '../src/state/day-store.js';
import { createMemoryArchive } from '../src/state/day-archive.js';
import { MANIFEST_KEY } from '../src/state/day-placement.js';

const key = day => `daily-planner:${day}`;
const NOW = () => new Date('2026-11-11T09:00:00.000Z');

function plainCopy() {
  const copy = { document: null };
  copy.provider = {
    read: async () => (copy.document ? { exists: true, document: copy.document } : { exists: false }),
    write: async document => { copy.document = JSON.parse(JSON.stringify(document)); }
  };
  copy.record = day => copy.document?.records?.[`day:${day}`];
  return copy;
}

function device() {
  const storage = new QuotaStorage(SAFARI_BUDGET);
  const ledger = createSyncLedger(storage, { now: NOW });
  const store = createDayStore(storage, { archive: createMemoryArchive({ now: NOW }), onMutation: ledger.recordMutation, ledgerDays: () => ledger.dayMarks(), forgetDays: days => ledger.forgetDays(days) });
  return { storage, ledger, store, engine: createSyncEngine({ store, ledger, now: NOW }) };
}

test('a freed day whose manifest never landed (no databases(), so nothing adopted at start): a sync before the next pass pulls it back and the copy keeps it', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const copy = plainCopy();
  assert.equal((await createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW }).sync(copy.provider)).status, 'ok');
  browser.base.setItem('filler', 'x'.repeat(browser.base.quota - browser.base.used() - 'filler'.length));
  const first = browser.days[0][0];
  assert.equal((await a.pass({ stopAt: 'manifest' })).stopped, 'manifest');
  assert.equal(browser.base.getItem(key(first)), null, 'the full-storage step freed the first day');
  browser.base.removeItem(MANIFEST_KEY); // the removal kept, the manifest write lost
  browser.closeTabs();
  browser.base.removeItem('filler');
  const b = browser.tab({ archive: { ...browser.archive, exists: async () => null } });
  assert.equal(await b.store.ready(), 'none', 'nothing adopted at start');
  assert.ok(b.ledger.dayMarks().live.has(first), 'the ledger knows the day, with no tombstone');
  const synced = await createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW }).sync(copy.provider);
  assert.equal(synced.status, 'ok');
  assert.ok(copy.record(first) && !copy.record(first).deletedAt, 'the copy still holds the day');
  assert.ok(b.store.get(key(first)) != null, 'and it reads back here');
});

test('a day gone from localStorage with no tracked removal (cleared by hand) is pulled back, not deleted from the copy', async () => {
  const d = device();
  const copy = plainCopy();
  d.store.writeJSON(key('2026-10-01'), { focus: 'kept' });
  await d.engine.sync(copy.provider);
  d.storage.removeItem(key('2026-10-01'));
  const synced = await d.engine.sync(copy.provider);
  assert.ok(synced.pulled.includes('day:2026-10-01'), 'pulled back');
  assert.ok(!synced.pushed.includes('day:2026-10-01'), 'nothing pushed for it');
  assert.ok(copy.record('2026-10-01') && !copy.record('2026-10-01').deletedAt, 'the copy keeps it');
  assert.equal(d.store.readJSON(key('2026-10-01'))?.focus, 'kept');
});

test('a tracked deletion still syncs: B deletes X while X is archived on A; X goes from both homes on A and stays gone', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const copy = plainCopy();
  const engineA = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  await engineA.sync(copy.provider);
  const b = device();
  await b.engine.sync(copy.provider);
  await a.pass();
  const X = browser.days[3][0];
  assert.equal(browser.base.getItem(key(X)), null, 'archived on A');
  assert.equal(b.store.remove(key(X)), true);
  await b.engine.sync(copy.provider);
  await engineA.sync(copy.provider);
  await a.store.settled();
  assert.equal(a.store.get(key(X)), null);
  assert.equal(browser.archive.data.has(X), false);
  await engineA.sync(copy.provider);
  await b.engine.sync(copy.provider);
  assert.ok(copy.record(X)?.deletedAt, 'the tombstone stays');
  assert.equal(b.store.get(key(X)), null);
});
