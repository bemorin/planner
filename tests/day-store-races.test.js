import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from './support/archive-tabs.js';
import { HISTORY_TODAY, historyBackup, historyDay, historyDays } from './support/history.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { MANIFEST_KEY, decodeManifest, encodeLease } from '../src/state/day-placement.js';
import { LEASE_KEY } from '../src/state/day-store.js';
import { createArchiveKeeper } from '../src/features/archive-keeper.js';
import { documentRecord, localSyncRecords } from '../src/sync/document.js';
import { createLocalStore } from '../src/state/local-store.js';
import { createScratchLedger } from '../src/sync/ledger.js';

// The 1.40.0 review's races (scratchpad review-1.40.0: race-clear, deviation, live-tabs test 2, two-passes,
// manifest-count), ported: passes, pulls, imports and syncs never interleave on the archive, in one tab or across
// tabs, and no missing manifest ever clears it. Each failed before the fix. Here the steps that now wait for the
// archive lock are started without being awaited first, so the test doesn't wait on itself.

const key = day => `daily-planner:${day}`;
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
const NOW = () => new Date('2026-11-11T09:00:00.000Z');

/** Holds the archive's next read() (after it has read) until release(): the verify step of whoever reads next. */
function holdNextRead(archive) {
  const real = archive.read;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let armed = true;
  archive.read = async list => {
    const found = await real(list);
    if (armed) { armed = false; await gate; }
    return found;
  };
  return () => release();
}

function plainCopy() {
  const copy = { document: null, writes: 0 };
  copy.provider = { read: async () => (copy.document ? { exists: true, document: copy.document } : { exists: false }), write: async document => { copy.writes += 1; copy.document = JSON.parse(JSON.stringify(document)); } };
  copy.has = day => !!copy.document?.records?.[`day:${day}`];
  return copy;
}

test('B1, same tab: a first pass and a sync pull of one old day at the same time: nothing lost', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  assert.equal(browser.base.getItem(MANIFEST_KEY), null, 'nothing archived yet: this is the first pass');
  const release = holdNextRead(browser.archive);
  const passing = a.pass();
  await tick();
  const pulling = a.store.placeMany([[key('2019-03-04'), historyDay('2019-03-04')]], { today: HISTORY_TODAY });
  await tick(20);
  release();
  const [result, pulled] = await Promise.all([passing, pulling]);
  assert.equal(result.stopped, null);
  assert.deepEqual(pulled.refused, []);
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'ready');
  assert.deepEqual(browser.differences(b.store), [], 'every day reads back after the reload');
  assert.equal(b.store.get(key('2019-03-04')), JSON.stringify(historyDay('2019-03-04')), 'and the pulled day');
});

test('B1, two tabs: tab A runs the first pass, tab B applies a pull: nothing lost', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  const release = holdNextRead(browser.archive);
  const passing = a.pass();
  await tick();
  const pulling = b.store.placeMany([[key('2019-03-04'), historyDay('2019-03-04')]], { today: HISTORY_TODAY });
  await tick(20);
  release();
  const [result] = await Promise.all([passing, pulling]);
  assert.equal(result.stopped, null);
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(browser.differences(c.store), []);
  assert.ok(c.store.get(key('2019-03-04')));
});

test('B1, two tabs: tab A runs the first pass, tab B imports a backup with old days: nothing lost', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  const release = holdNextRead(browser.archive);
  const passing = a.pass();
  await tick();
  const backup = historyBackup(historyDays(3, { today: '2018-06-01' }));
  const importing = b.store.importDays(backup, { today: HISTORY_TODAY });
  await tick(20);
  release();
  const [, report] = await Promise.all([passing, importing]);
  assert.deepEqual(report.refused, []);
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(browser.differences(c.store), []);
  for (const day of Object.keys(backup.days)) assert.equal(c.store.get(key(day)), JSON.stringify(backup.days[day]), day);
});

test('B1, the other order: a sync’s pull put and verified while the first pass waits: the pulled day stays, here and in the copy', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const copy = plainCopy();
  const engine = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  assert.equal((await engine.sync(copy.provider)).status, 'ok');
  const OLD = '2019-03-04';
  const value = historyDay(OLD);
  // Another device adds the old day to the copy.
  const scratch = new Map([[key(OLD), JSON.stringify(value)]]);
  const other = createLocalStore({ get length() { return scratch.size; }, key: i => [...scratch.keys()][i] ?? null, getItem: k => scratch.get(k) ?? null, setItem: (k, v) => scratch.set(k, String(v)), removeItem: k => scratch.delete(k) });
  const records = await localSyncRecords(other, createScratchLedger());
  copy.document.records[`day:${OLD}`] = documentRecord(records[`day:${OLD}`]);
  // The sync pulls it; its verify read is held while the idle pass (the first one) is started.
  const real = browser.archive.read;
  let release;
  let reached;
  const gate = new Promise(resolve => { release = resolve; });
  const atGate = new Promise(resolve => { reached = resolve; });
  browser.archive.read = async list => {
    const found = await real(list);
    if (list.includes(OLD)) { reached(); await gate; }
    return found;
  };
  const syncing = engine.sync(copy.provider);
  await atGate;
  const passing = a.pass();
  await tick(20);
  release();
  const [result, pass] = await Promise.all([syncing, passing]);
  assert.equal(pass.stopped, null);
  assert.deepEqual([result.status, result.pulled, result.refused], ['ok', [`day:${OLD}`], []]);
  browser.closeTabs();
  const b = browser.tab();
  await b.store.ready();
  assert.equal(b.store.get(key(OLD)), JSON.stringify(value), 'the pulled day reads back after a reload');
  await createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW }).sync(copy.provider);
  assert.ok(copy.has(OLD), 'and is never removed from the copy');
});

test('B1, end to end with Personal sync: the race at the first pass, a reload, the next sync: the copy keeps every day', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const copy = plainCopy();
  assert.equal((await createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW }).sync(copy.provider)).status, 'ok');
  const release = holdNextRead(browser.archive);
  const passing = a.pass();
  await tick();
  const pulling = a.store.placeMany([[key('2019-03-04'), historyDay('2019-03-04')]], { today: HISTORY_TODAY });
  await tick(20);
  release();
  await Promise.all([passing, pulling]);
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'ready');
  const lost = browser.differences(b.store);
  await createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW }).sync(copy.provider);
  assert.deepEqual(lost, []);
  assert.deepEqual(browser.days.map(([day]) => day).filter(day => !copy.has(day)), [], 'the copy keeps every day');
});

test('U1, the full-storage step: the first day freed, the manifest never kept: the day is adopted at the next start, never cleared', async () => {
  const browser = createBrowser();
  browser.base.setItem('filler', 'x'.repeat(browser.base.quota - browser.base.used() - 'filler'.length));
  const a = browser.tab();
  const firstDay = browser.days[0][0];
  const result = await a.pass({ stopAt: 'manifest' });
  assert.equal(result.stopped, 'manifest');
  assert.equal(browser.base.getItem(key(firstDay)), null, 'the first day freed for the manifest');
  // The browser kept the removal and not the manifest write that followed it.
  browser.base.removeItem(MANIFEST_KEY);
  browser.closeTabs();
  const b = browser.tab();
  // No manifest, and localStorage half full or more: the planner opening looks in the database (indexedDB.databases()).
  assert.equal(b.store.isReady(), false, 'not ready before it has looked');
  assert.equal(await b.store.ready(), 'ready', 'the day adopted, with a manifest for it');
  assert.equal(b.store.get(key(firstDay)), JSON.stringify(browser.days[0][1]), 'it reads back');
  assert.equal(b.store.pending(key(firstDay)), false);
  browser.base.removeItem('filler');
  await b.pass();
  assert.ok(browser.archive.data.has(firstDay), 'the next pass never clears its only copy');
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(browser.differences(c.store), []);
});

test('U1: below half full with no manifest, nothing is looked for, and no database is ever made', async () => {
  const browser = createBrowser({ days: historyDays(100) });
  let made = 0;
  const archive = browser.archive;
  const t = browser.tab({ archive: () => { made += 1; return archive; } });
  assert.equal(t.store.isReady(), true);
  assert.equal(await t.store.ready(), 'none');
  assert.equal(made, 0);
});

test('compare-and-delete: another tab’s edit that lands between the compare and the delete (a stale cache) is put back by that tab', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  await Promise.all([a.store.ready(), b.store.ready()]);
  const [X, value] = browser.days[3];
  const edit = { ...value, focus: 'Edited in B as A moved it' };
  // A's view of X is stale: it compares the archived string, and B's edit lands just before A removes it.
  const getItem = a.storage.getItem;
  let armed = true;
  a.storage.getItem = name => {
    const found = getItem(name);
    if (armed && name === key(X) && browser.base.getItem(MANIFEST_KEY)) {
      armed = false;
      b.store.writeJSON(key(X), edit);
    }
    return found;
  };
  await a.pass();
  a.storage.getItem = getItem;
  assert.equal(browser.base.getItem(key(X)), null, 'A’s removal took B’s edit with it');
  await browser.deliver();
  await browser.deliver();
  assert.deepEqual(JSON.parse(browser.base.getItem(key(X))), edit, 'B put its edit back, hearing the removal’s oldValue');
  assert.deepEqual(a.store.readJSON(key(X)), edit);
  assert.deepEqual(b.store.readJSON(key(X)), edit);
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(c.store.readJSON(key(X)), edit, 'and after a reload');
});

test('m1: a sync in tab B while tab A’s pass has just moved days, before B has heard: nothing removed from the copy', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  const copy = plainCopy();
  const engineB = createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW });
  assert.equal((await engineB.sync(copy.provider)).status, 'ok');
  const all = Object.keys(copy.document.records).length;
  const plan = a.plan();
  assert.ok(plan.batches.length >= 2);
  await a.store.moveDays([plan.batches[0]]);
  await browser.deliver();
  assert.equal(b.store.status(), 'ready');
  // A's next pass moves another batch; B's storage events are still queued when B syncs.
  await a.store.moveDays([plan.batches[1]]);
  const synced = await engineB.sync(copy.provider);
  assert.deepEqual(synced.pushed, [], 'nothing sent');
  assert.equal(Object.keys(copy.document.records).length, all, 'a move never removes a day from the copy');
  await browser.deliver();
  assert.deepEqual((await engineB.sync(copy.provider)).pushed, []);
});

const keeperFor = tab => createArchiveKeeper({ store: tab.store, storage: tab.storage, nav: {}, win: null, doc: null, today: () => new Date('2026-11-11T12:00:00'), recoveryStore: { save: async () => 1 }, localDev: true, hook: () => null });
const fill = browser => browser.base.setItem('filler', 'x'.repeat(browser.base.quota - browser.base.used() - 'filler'.length));

test('m4: no Web Locks, storage full before any lease was written: two tabs’ emergency passes at once lose nothing, and the manifest counts each day once', async () => {
  const browser = createBrowser();
  fill(browser);
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  await Promise.all([keeperFor(a).refused(), keeperFor(b).refused()]);
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(browser.differences(c.store), []);
  assert.equal(decodeManifest(browser.base.getItem(MANIFEST_KEY)).days, browser.archive.data.size, 'counted in the archive, never added up twice');
});

test('m4: no Web Locks, the lease written while there was room: storage full, the second tab’s emergency pass waits for the first', async () => {
  const browser = createBrowser();
  // A lease written once (any earlier step on the archive did), released: rewritten in place from then on.
  browser.base.setItem(LEASE_KEY, encodeLease({ owner: 'earliers', until: 0 }));
  fill(browser);
  const order = [];
  const archive = browser.archive;
  const proxy = name => ({ ...archive, put: async entries => { order.push(`${name}:put`); return archive.put(entries); }, read: async list => { order.push(`${name}:read`); return archive.read(list); } });
  const a = browser.tab({ name: 'A', archive: proxy('A') });
  const b = browser.tab({ name: 'B', archive: proxy('B') });
  await Promise.all([keeperFor(a).refused(), keeperFor(b).refused()]);
  const firstB = order.findIndex(entry => entry.startsWith('B'));
  const lastA = order.map(entry => entry.startsWith('A')).lastIndexOf(true);
  assert.ok(firstB === -1 || firstB > lastA || order.slice(0, firstB).every(entry => entry.startsWith('A')) && order.slice(firstB).every(entry => entry.startsWith('B')), `one pass, then the other: ${order.join(' ')}`);
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(browser.differences(c.store), []);
  assert.equal(decodeManifest(browser.base.getItem(MANIFEST_KEY)).days, browser.archive.data.size);
});

test('m4 control: one emergency pass alone, full to the last character: every day reads back', async () => {
  const browser = createBrowser();
  fill(browser);
  const a = browser.tab({ name: 'A' });
  const result = await keeperFor(a).refused();
  assert.equal(result.stopped, null);
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(browser.differences(c.store), []);
});
