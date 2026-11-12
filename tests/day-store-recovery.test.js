import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from './support/archive-tabs.js';
import { HISTORY_TODAY, QuotaStorage, SAFARI_BUDGET, historyBackup, historyDay, historyDays, seedHistory } from './support/history.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createDayStore, RESET_KEY } from '../src/state/day-store.js';
import { createMemoryArchive } from '../src/state/day-archive.js';
import { createArchiveKeeper } from '../src/features/archive-keeper.js';
import { MANIFEST_KEY, encodeManifest, isBlankDay } from '../src/state/day-placement.js';
import { createBlankDay, normalizeDayState } from '../src/state/day-state.js';
import { buildPlannerBackup } from '../src/state/planner-backup.js';
import { createPlannerWrites, moveBetweenDays } from '../src/state/day-move.js';

// The 1.40.0 review's other proofs (scratchpad review-1.40.0: lost-archive, live-tabs test 1, load-window,
// reset-import, interrupted-place, no-archive, pending-writes), ported. Those that failed before the fix say so.

const key = day => `daily-planner:${day}`;
const NOW = () => new Date('2026-11-11T09:00:00.000Z');

function plainCopy() {
  const copy = { document: null, writes: 0 };
  copy.provider = { read: async () => (copy.document ? { exists: true, document: copy.document } : { exists: false }), write: async document => { copy.writes += 1; copy.document = JSON.parse(JSON.stringify(document)); } };
  copy.has = day => !!copy.document?.records?.[`day:${day}`];
  copy.value = day => copy.document?.records?.[`day:${day}`]?.value ?? null;
  return copy;
}

async function syncedAndMoved() {
  const browser = createBrowser();
  const a = browser.tab();
  const copy = plainCopy();
  assert.equal((await createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW }).sync(copy.provider)).status, 'ok');
  const pass = await a.pass();
  assert.equal(pass.stopped, null);
  const moved = browser.days.slice(0, pass.moved).map(([day]) => day);
  return { browser, copy, moved };
}

// --- Lost (M1, M2) -------------------------------------------------------------------------------------------------

test('M2 (failed before): lost, then Import backup with a backup that lacks some older days: still lost, so no automatic sync runs, and Sync now brings the rest back from the copy', async () => {
  const { browser, copy, moved } = await syncedAndMoved();
  browser.archive.data.clear();
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'lost');
  const report = await b.store.importDays(historyBackup(browser.days.slice(0, 100)), { today: HISTORY_TODAY });
  assert.deepEqual(report.refused, []);
  assert.equal(b.store.status(), 'lost', 'an import is no proof that nothing is missing');
  const engine = createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW });
  // personal-sync.js runs no automatic sync while lost; the engine refuses one without restoreMissing.
  await assert.rejects(engine.sync(copy.provider), error => error.code === 'archive' && error.archive === 'lost');
  const synced = await engine.sync(copy.provider, { restoreMissing: b.store.status() === 'lost' });
  assert.equal(synced.status, 'ok');
  assert.deepEqual(moved.filter(day => !copy.has(day)), [], 'the copy keeps every day');
  assert.equal(await b.store.settle(), true, 'and once that sync is done, the archive is in use again');
  assert.equal(b.store.status(), 'ready');
  assert.deepEqual(browser.differences(b.store), []);
});

test('M2: lost, then an import of every day: nothing is missing any more, so the archive is in use again at once', async () => {
  const { browser } = await syncedAndMoved();
  browser.archive.data.clear();
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'lost');
  await b.store.importDays(historyBackup(browser.days), { today: HISTORY_TODAY });
  assert.equal(b.store.status(), 'ready');
  assert.deepEqual(browser.differences(b.store), []);
});

test('the right order: lost, then Sync now (restoreMissing) brings every day back from the copy', async () => {
  const { browser, copy, moved } = await syncedAndMoved();
  browser.archive.data.clear();
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'lost');
  const result = await createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW }).sync(copy.provider, { restoreMissing: true });
  assert.equal(result.status, 'ok');
  await b.store.settle();
  assert.deepEqual(browser.differences(b.store), []);
  assert.ok(moved.every(copy.has));
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/features/personal-sync.js', import.meta.url), 'utf8'));
  assert.match(source, /if \(archive === 'lost' && result\?\.status === 'ok' && !result\.refused\?\.length\) await store\.settle\?\.\(\);/, 'the planner settles only after that sync, all of it stored');
});

test('M1 (failed before): a partly emptied archive (one record gone) is lost, the day pending, and no sync removes it from the copy', async () => {
  const { browser, copy, moved } = await syncedAndMoved();
  const gone = moved[10];
  browser.archive.data.delete(gone);
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'lost');
  assert.equal(b.store.pending(key(gone)), true, 'not taken for absent');
  assert.equal(b.store.writeJSON(key(gone), createBlankDay()), false, 'nor written over');
  const engine = createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW });
  await assert.rejects(engine.sync(copy.provider), error => error.code === 'archive');
  assert.ok(copy.has(gone));
  const restored = await engine.sync(copy.provider, { restoreMissing: true });
  assert.deepEqual(restored.pushed, []);
  assert.ok(restored.pulled.includes(`day:${gone}`), 'Sync now brings it back');
  assert.ok(copy.has(gone));
  await b.store.settle();
  assert.equal(b.store.get(key(gone)), JSON.stringify(browser.days[10][1]));
});

test('M1: a day missing while the count still adds up (another record in its place) is lost too: the ledger knows the day', async () => {
  const { browser, moved } = await syncedAndMoved();
  const gone = moved[3];
  browser.archive.data.delete(gone);
  browser.archive.data.set('2010-01-01', JSON.stringify(historyDay('2010-01-01')));
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'lost');
  assert.equal(b.store.pending(key(gone)), true);
});

// --- Live tabs (M3) ------------------------------------------------------------------------------------------------

test('M3 (failed before): an older tab’s blank over a moved day, while a 1.40 tab is open: the open tab keeps the real day, and its sync never sends the blank', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A (1.40, open all along)' });
  const copy = plainCopy();
  const engine = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  assert.equal((await engine.sync(copy.provider)).status, 'ok');
  // Device B, another 1.40 browser, synced with the copy.
  const bStorage = new QuotaStorage(SAFARI_BUDGET);
  const bLedger = createSyncLedger(bStorage, { now: NOW });
  const bStore = createDayStore(bStorage, { archive: createMemoryArchive({ now: NOW }), onMutation: bLedger.recordMutation, ledgerDays: () => bLedger.dayMarks(), forgetDays: days => bLedger.forgetDays(days) });
  const bEngine = createSyncEngine({ store: bStore, ledger: bLedger, now: NOW });
  await bEngine.sync(copy.provider);
  assert.ok((await a.pass()).moved > 0);
  await browser.deliver();
  const [X, real] = browser.days[0];
  assert.equal(browser.base.getItem(key(X)), null, 'X moved to the archive');
  // A 1.39.4 tab with X on screen (it sees it empty) saves what it shows.
  browser.olderTab().store.writeJSON(key(X), createBlankDay());
  await browser.deliver();
  assert.equal(a.store.get(key(X)), JSON.stringify(real), 'the open 1.40 tab keeps reading the real day');
  assert.equal(browser.base.getItem(key(X)), null, 'the blank goes from localStorage');
  const synced = await engine.sync(copy.provider);
  assert.ok(!synced.pushed.includes(`day:${X}`), 'the blank is never sent');
  assert.ok(!isBlankDay(copy.value(X)));
  await bEngine.sync(copy.provider);
  assert.ok(!isBlankDay(bStore.get(key(X))), 'and device B never reads it blank');
});

test('M3: another tab’s real edit (made from the day) over an archived day, heard by an open tab: the archived copy goes, the edit stands', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await browser.deliver();
  const b = browser.tab({ name: 'B' });
  await Promise.all([a.store.ready(), b.store.ready()]);
  const [X, value] = browser.days[1];
  const edit = { ...value, focus: 'Edited in B' };
  assert.equal(b.store.writeJSON(key(X), edit), true);
  await browser.deliver();
  assert.deepEqual(a.store.readJSON(key(X)), edit);
  await a.store.settled();
  assert.equal(browser.archive.data.has(X), false, 'moved back: one home');
  assert.equal(browser.archive.aside.length, 0);
});

// --- The moment the archive finishes loading (m2) ------------------------------------------------------------------

const X = '2025-03-04';
const KEY = key(X);
const REAL = JSON.stringify(historyDay(X));

function loading() {
  const storage = new QuotaStorage(Infinity);
  storage.setItem(MANIFEST_KEY, encodeManifest({ before: '2025-06-01', days: 1, chars: KEY.length + REAL.length }));
  const archive = createMemoryArchive({ days: [{ day: X, json: REAL }] });
  // The read of the copies kept aside is held, as a slow IndexedDB transaction would be.
  const realDisplaced = archive.displaced;
  let release;
  let reached;
  const gate = new Promise(resolve => { release = resolve; });
  const atGate = new Promise(resolve => { reached = resolve; });
  archive.displaced = async () => { reached(); await gate; return realDisplaced(); };
  const writes = [];
  let keeper;
  const store = createDayStore(storage, { archive, onWrite: result => writes.push(result), onReady: () => keeper.loaded() });
  const workspace = { inert: false };
  const note = { hidden: true, textContent: '' };
  const doc = { querySelector: selector => (selector === '[data-workspace]' ? workspace : selector === '[data-day-opening]' ? note : null) };
  const reloads = [];
  // The planner's reload draws the day again, and render() guards it (app.js load() → render()).
  keeper = createArchiveKeeper({ store, storage, doc, win: null, nav: {}, reload: () => { reloads.push(1); keeper.guard([KEY]); }, refresh: () => {}, localDev: true, hook: () => null });
  return { storage, archive, store, keeper, workspace, reloads, writes, release, atGate };
}

test('m2 (failed before): a save that lands while the archive is still being read is refused, and the real day is never replaced', async () => {
  const { store, keeper, release, atGate, archive, writes } = loading();
  const state = normalizeDayState(store.readJSON(KEY), X);
  keeper.guard([KEY]);
  state.tasks[0].text = 'Typed while it opened';
  assert.equal(store.writeJSON(KEY, state), false);
  await atGate; // the days read, the copies kept aside not yet
  assert.equal(store.pending(KEY), true, 'still pending: nothing is ready until all of it is');
  // The 70 ms debounced save (or any flush) fires now.
  assert.equal(store.writeJSON(KEY, state), false);
  release();
  await store.ready();
  await store.settled();
  assert.equal(store.get(KEY), REAL, 'the real day is never replaced by one built on a blank read');
  assert.equal(archive.aside.length, 0);
  assert.equal(writes.length, 0, 'refused before any write, so no “Not saved”: the day was inert, and the floating window too (tests/pip-window.test.js)');
});

test('m2 (failed before): a render() while the archive is read (Week toggle, a sync applying pulls) never cancels the reload', async () => {
  const { store, keeper, release, atGate, workspace, reloads } = loading();
  keeper.guard([KEY]);
  assert.equal(workspace.inert, true);
  await atGate;
  keeper.guard([KEY]);
  release();
  await store.ready();
  assert.equal(reloads.length, 1, 'the day that waited is drawn again from the archive');
  assert.equal(workspace.inert, false);
});

test('m2: the person moves on to a day that needs no archive before it loads: the planner still reloads once', async () => {
  const { store, keeper, release, reloads } = loading();
  keeper.guard([KEY]);
  keeper.guard(['daily-planner:2026-11-11']);
  release();
  await store.ready();
  assert.equal(reloads.length, 1);
});

// --- Reset (m3) ----------------------------------------------------------------------------------------------------

test('export, Reset (both homes), import the backup, reload: every day back, no tombstone left, archive in use again', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  await a.pass();
  await a.store.ready();
  const backup = buildPlannerBackup(a.store);
  assert.equal(Object.keys(backup.days).length, browser.days.length, 'export has every day, archived ones included');
  const bulk = fn => a.ledger.deferMarks(fn).value;
  await a.store.clearAll('daily-planner:', { bulk });
  await a.store.settled();
  assert.equal(browser.base.getItem(MANIFEST_KEY), null);
  assert.equal(browser.archive.data.size, 0, 'the archive cleared');
  assert.ok(a.ledger.deletedDays().size >= browser.days.length, 'Reset left a tombstone for every day');
  assert.deepEqual((await a.store.importDays(backup, { today: HISTORY_TODAY, bulk })).refused, []);
  browser.closeTabs();
  const b = browser.tab();
  await b.store.ready();
  assert.deepEqual(browser.differences(b.store), []);
  assert.equal(b.ledger.deletedDays().size, 0);
});

test('m3 (failed before): Reset while the archive can’t be read this session: every older day gets its tombstone, and the database is deleted', async () => {
  // Synced first, so that the ledger knows every day (a tombstone is what tells the other devices).
  const { browser, moved } = await syncedAndMoved();
  browser.closeTabs();
  const failing = new Error('IndexedDB not answering');
  for (const kind of ['open', 'all', 'read', 'clear', 'remove']) browser.archive.faults[kind] = failing;
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'unavailable');
  await b.store.clearAll('daily-planner:', { bulk: fn => b.ledger.deferMarks(fn).value });
  assert.equal(moved.filter(day => b.ledger.deletedDays().has(day)).length, moved.length, 'each older day deleted, for sync too');
  assert.equal(browser.archive.data.size, 0, 'the database deleted (indexedDB.deleteDatabase) when it couldn’t be emptied');
  assert.equal(b.store.databaseLeft(), false);
  assert.equal(browser.base.getItem(MANIFEST_KEY), null);
});

test('m3: Reset when even deleting the database fails (another tab holds it open): the planner says so, and the next start deletes it', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  await a.pass();
  browser.closeTabs();
  const failing = new Error('blocked');
  for (const kind of ['clear', 'destroy']) browser.archive.faults[kind] = failing;
  const b = browser.tab();
  await b.store.ready();
  await b.store.clearAll('daily-planner:', { bulk: fn => b.ledger.deferMarks(fn).value });
  assert.equal(b.store.databaseLeft(), true, 'what the header says after Reset (src/features/storage-alert.js)');
  assert.ok(browser.base.getItem(RESET_KEY) != null);
  assert.ok(browser.archive.data.size > 0);
  browser.closeTabs();
  delete browser.archive.faults.clear;
  delete browser.archive.faults.destroy;
  const c = browser.tab();
  assert.equal(await c.store.finishReset(), true);
  assert.equal(browser.archive.data.size, 0);
  assert.equal(c.store.databaseLeft(), false);
  assert.equal(await c.store.ready(), 'none', 'and nothing archived is ever read again');
});

// --- Other proofs, which held already ------------------------------------------------------------------------------

test('closed between putVerified and placed, with an archive already in use: archived, hot and new days each read back as one version', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const pass = await a.pass();
  const edited = day => JSON.stringify({ ...historyDay(day), focus: `pulled ${day}` });
  const archivedDay = browser.days[0][0];
  const hotDay = browser.days[pass.moved + 5][0];
  const newDay = '2019-01-02';
  for (const day of [archivedDay, hotDay, newDay]) await browser.archive.put([{ day, json: edited(day) }]);
  browser.closeTabs();
  const b = browser.tab();
  await b.store.ready();
  await b.store.settled();
  const keys = b.store.keys('daily-planner:');
  assert.equal(new Set(keys).size, keys.length, 'no duplicate key');
  for (const day of [archivedDay, hotDay, newDay]) assert.ok(!isBlankDay(b.store.get(key(day))), `${day} not blank`);
  assert.equal(b.store.get(key(hotDay)), JSON.stringify(historyDay(hotDay)), 'localStorage wins over an unplaced pull');
  assert.ok([null, 'nothing'].includes((await b.pass()).stopped), 'the next pass completes');
  const c = browser.tab();
  await c.store.ready();
  assert.ok(!isBlankDay(c.store.get(key(archivedDay))));
});

test('no manifest: every read, write, keys(), stats(), ready() and an idle pass below 50% never create the archive', async () => {
  const storage = new QuotaStorage(SAFARI_BUDGET);
  seedHistory(storage, historyDays(200));
  let created = 0;
  const store = createDayStore(storage, { archive: () => { created += 1; return createMemoryArchive(); } });
  store.get('daily-planner:2026-11-10'); store.writeJSON('daily-planner:2026-11-11', { focus: 'x' }); store.keys('daily-planner:'); store.stats();
  assert.equal(await store.ready(), 'none');
  assert.equal(store.isReady(), true);
  const keeper = createArchiveKeeper({ store, storage, nav: {}, win: null, doc: null, localDev: true, hook: () => null });
  assert.equal(await keeper.idle(), null);
  assert.equal(created, 0);
});

test('never migrated, IndexedDB failing, storage full: an emergency pass removes nothing and reports it', async () => {
  const storage = new QuotaStorage(SAFARI_BUDGET);
  seedHistory(storage, historyDays(900));
  storage.setItem('filler', 'x'.repeat(SAFARI_BUDGET - storage.used() - 6));
  const before = storage.used();
  const archive = createMemoryArchive();
  archive.faults.open = new Error('no IndexedDB here');
  const store = createDayStore(storage, { archive });
  const keeper = createArchiveKeeper({ store, storage, nav: {}, win: null, doc: null, localDev: true, recoveryStore: { save: async () => 1 }, hook: () => null });
  const result = await keeper.refused();
  assert.equal(result.moved, 0);
  assert.equal(storage.used(), before, 'nothing removed');
  assert.equal(storage.getItem(MANIFEST_KEY), null, 'no manifest written');
});

function pendingWrites() {
  const OLD = '2025-03-04';
  const HOT = '2026-11-10';
  const storage = new QuotaStorage(Infinity);
  storage.setItem(MANIFEST_KEY, encodeManifest({ before: '2025-06-01', days: 1, chars: 100 }));
  storage.setItem(key(HOT), JSON.stringify(historyDay(HOT)));
  const archive = createMemoryArchive({ days: [{ day: OLD, json: JSON.stringify(historyDay(OLD)) }] });
  const ledger = createSyncLedger(storage);
  const store = createDayStore(storage, { archive, onMutation: ledger.recordMutation, ledgerDays: () => ledger.dayMarks(), forgetDays: days => ledger.forgetDays(days) });
  return { OLD, HOT, storage, archive, store, ledger, writes: createPlannerWrites({ store, ledger }) };
}

test('commit: hot day first, then a pending archived day: false, the hot day back as it was, no mark left', () => {
  const { OLD, HOT, storage, store, ledger, writes } = pendingWrites();
  const hotBefore = storage.getItem(key(HOT));
  const hot = JSON.parse(hotBefore);
  hot.focus = 'changed';
  assert.equal(writes.commit([[key(HOT), hot], [key(OLD), normalizeDayState(null, OLD)]]), false);
  assert.equal(storage.getItem(key(HOT)), hotBefore);
  assert.equal(storage.getItem(key(OLD)), null);
  assert.equal(ledger.hasDirty(), false);
  assert.equal(store.pending(key(OLD)), true);
});

test('moveBetweenDays: a block from a loaded archived day to today, and the only block out of it: both land, nothing displaced', async () => {
  const { OLD, HOT, storage, store, archive, writes } = pendingWrites();
  await store.ready();
  const read = name => normalizeDayState(store.readJSON(name), name.slice(-10));
  const result = moveBetweenDays({
    sourceKey: key(OLD), targetKey: key(HOT), read,
    change: (source, target) => { target.blocks.push(...source.blocks.splice(0)); source.tasks.forEach(t => { t.text = ''; }); source.priorities.forEach(p => { p.text = ''; }); source.focus = source.notes = source.memory = source.lesson = source.endedAt = ''; source.carriedForward = []; source.triaged = []; },
    ...writes
  });
  await store.settled();
  assert.equal(result, 'moved');
  assert.ok(storage.getItem(key(OLD)) !== null);
  assert.equal(archive.aside.length, 0);
});

// --- Kept aside, and put back (m6) ---------------------------------------------------------------------------------

test('m6: Restore puts the earlier version back, and keeps what the other tab wrote aside in its place: nothing is thrown away', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await browser.deliver();
  const [X, real] = browser.days[2];
  const blind = { ...createBlankDay(), focus: 'Typed in the older tab' };
  browser.olderTab().store.writeJSON(key(X), blind);
  await browser.deliver();
  await a.store.settled();
  assert.deepEqual(a.store.readJSON(key(X)), blind, 'the older tab’s day stands');
  const [kept] = await a.store.displaced();
  assert.equal(kept.json, JSON.stringify(real));
  assert.equal(a.store.lastAside().day, X, 'what the header says once');
  a.events.length = 0;
  assert.equal(await a.store.restoreAside(kept.id), true);
  await a.store.settled();
  assert.equal(a.store.get(key(X)), JSON.stringify(real));
  assert.deepEqual(a.events.map(event => [event.type, event.key]), [['set', key(X)]], 'a change: it syncs');
  const after = await a.store.displaced();
  assert.deepEqual(after.map(entry => [entry.day, entry.reason, entry.json, !!entry.restoredAt]), [[X, 'restored-over', JSON.stringify(blind), false], [X, 'older-tab', JSON.stringify(real), true]], 'the older tab’s version kept aside in its place, and the copy restored kept too, marked so');
  browser.closeTabs();
  const b = browser.tab();
  await b.store.ready();
  assert.equal(b.store.get(key(X)), JSON.stringify(real));
  assert.equal(b.store.lastAside(), null, 'what restoring kept aside is no news to the header');
});

test('m6: Restore waits for the archive, and does nothing while it can’t be read', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  await a.pass();
  await browser.archive.keepAside([{ day: browser.days[0][0], json: '{"focus":"aside"}', reason: 'older-tab' }]);
  browser.closeTabs();
  browser.archive.faults.all = new Error('IndexedDB not answering');
  const b = browser.tab();
  const [entry] = await browser.archive.displaced();
  assert.equal(await b.store.restoreAside(entry.id), false);
  assert.equal(browser.archive.aside.length, 1);
});
