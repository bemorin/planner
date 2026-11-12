import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from './support/archive-tabs.js';
import { HISTORY_TODAY, QuotaStorage, SAFARI_BUDGET, historyBackup, historyDay, historyDays, seedHistory } from './support/history.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { RESET_KEY, createDayStore } from '../src/state/day-store.js';
import { createDayArchive } from '../src/state/day-archive.js';
import { MANIFEST_KEY, decodeManifest, isBlankDay, planMoves } from '../src/state/day-placement.js';
import { createBlankDay } from '../src/state/day-state.js';

// The 1.40.0 second review's attacks (scratchpad review-1.40.0/pass2: attack, attack2, boot-idb), ported. These failed
// on 51435e7: A2a, A3, A4, A1b, A2c, A3b and the start without indexedDB.databases(); the others held already and stay
// as guards.

// --- attack.test.js ---

const key = day => `daily-planner:${day}`;
const NOW = () => new Date('2026-11-11T09:00:00.000Z');
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

function plainCopy() {
  const copy = { document: null, writes: 0 };
  copy.provider = { read: async () => (copy.document ? { exists: true, document: copy.document } : { exists: false }), write: async document => { copy.writes += 1; copy.document = JSON.parse(JSON.stringify(document)); } };
  copy.has = day => !!copy.document?.records?.[`day:${day}`];
  return copy;
}

/** What a Reset that couldn't delete the database leaves: its flag, and old days in the database. */
async function unfinishedReset(browser, tab, { tombstoned = true } = {}) {
  const leftovers = ['2010-01-04', '2010-01-05', '2010-01-06'];
  for (const day of leftovers) await browser.archive.put([{ day, json: JSON.stringify(historyDay(day)) }]);
  if (tombstoned) tab.ledger.deferMarks(() => leftovers.forEach(day => tab.ledger.recordMutation({ type: 'remove', key: key(day) })));
  browser.base.setItem(RESET_KEY, '1');
  return leftovers;
}

/** A plan for moveDays() that holds the lock (as the first pass's snapshotFirst() does) until release(). */
function heldPlan(tab) {
  let release;
  let reached;
  const gate = new Promise(resolve => { release = resolve; });
  const atGate = new Promise(resolve => { reached = resolve; });
  const plan = async () => { reached(); await gate; return planMoves({ days: tab.store.hotDays(), used: tab.storage.length && [...Array(tab.storage.length).keys()].reduce((n, i) => { const k = tab.storage.key(i); return n + k.length + (tab.storage.getItem(k) || '').length; }, 0), today: HISTORY_TODAY }).batches; };
  return { plan, atGate, release: () => release() };
}

test('A1. Reset unfinished: a pass holding the lock finishes it and moves days; finishReset(), waiting meanwhile, never empties them', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await unfinishedReset(browser, a);
  // A pass (an emergency one at start, or another tab's) holds the lock, still planning (snapshotFirst()).
  const held = heldPlan(a);
  const passing = a.store.moveDays(held.plan);
  await held.atGate;
  // The idle start: finishReset() sees the flag, and waits for the lock.
  const finishing = a.store.finishReset();
  await tick(20);
  held.release();
  const [pass, finished] = await Promise.all([passing, finishing]);
  browser.closeTabs();
  const c = browser.tab();
  const status = await c.store.ready();
  const missing = browser.differences(c.store);
  assert.deepEqual(missing, [], 'a Reset finished at start never empties days a pass has just moved');
});

test('A2a (failed on 51435e7, nit). Reset unfinished and the database still can’t be emptied: no pass moves days, so the Reset’s days never come back', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  // Days the ledger doesn't know (never tombstoned: Reset ran while the archive couldn't be read).
  const leftovers = await unfinishedReset(browser, a, { tombstoned: false });
  for (const kind of ['clear', 'destroy']) browser.archive.faults[kind] = new Error('blocked');
  const pass = await a.pass();
  for (const kind of ['clear', 'destroy']) delete browser.archive.faults[kind];
  browser.closeTabs();
  const c = browser.tab();
  await c.store.finishReset();
  await c.store.ready();
  const back = leftovers.filter(day => c.store.get(key(day)) != null);
  assert.deepEqual(back, [], 'days removed by Reset never come back');
});

test('A2b. Reset unfinished, the start adopts nothing: the first pass empties Reset’s leftovers, never shows or syncs them', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const copy = plainCopy();
  const engine = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  const leftovers = await unfinishedReset(browser, a, { tombstoned: false });
  await a.pass();
  const shown = leftovers.filter(day => a.store.get(key(day)) != null);
  const synced = await engine.sync(copy.provider);
  const sent = leftovers.filter(copy.has);
  browser.closeTabs();
  const c = browser.tab();
  const status = await c.store.ready();
  assert.deepEqual(shown, [], 'days the Reset removed are never shown again');
  assert.notEqual(status, 'lost');
});

test('A3 (failed on 51435e7, minor 1). Two 1.40 tabs: A applies a pulled blank over archived X, B hears it: X never ends in neither home', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await browser.deliver();
  const b = browser.tab({ name: 'B' });
  await Promise.all([a.store.ready(), b.store.ready()]);
  const [X, real] = browser.days[5];
  assert.equal(browser.base.getItem(key(X)), null, 'X archived');
  // A sync in A pulls a blank X from the copy (a 1.39.4 tab elsewhere saved it blank): placeMany(), into localStorage.
  const result = await a.store.placeMany([[key(X), createBlankDay()]], { today: HISTORY_TODAY, goal: 0.6 });
  assert.deepEqual(result.refused, []);
  await browser.deliver();
  await a.store.settled();
  await b.store.settled();
  const aside = (await a.store.displaced()).filter(entry => entry.day === X).length;
  browser.closeTabs();
  const c = browser.tab();
  const status = await c.store.ready();
  assert.notEqual(status, 'lost', 'two tabs agree on where X is');
  assert.ok(c.store.get(key(X)) != null);
});

test('A4 (failed on 51435e7, major). Restore, then the older tab still open on that day saves its version again: the real day is still kept aside, and can be restored again', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A (1.40)' });
  await a.pass();
  await browser.deliver();
  const [X, real] = browser.days[2];
  const older = browser.olderTab();
  const blind = { ...createBlankDay(), focus: 'Typed in the older tab' };
  older.store.writeJSON(key(X), blind);
  await browser.deliver();
  await a.store.settled();
  const [kept] = await a.store.displaced();
  assert.equal(kept.json, JSON.stringify(real));
  assert.equal(await a.store.restoreAside(kept.id), true);
  await a.store.settled();
  assert.equal(a.store.get(key(X)), JSON.stringify(real), 'restored');
  // The older tab still shows its version of X, and saves it again (a flush before Search, or its sync's flushLocal).
  older.store.writeJSON(key(X), blind);
  await browser.deliver();
  await a.store.settled();
  const everywhere = [browser.base.getItem(key(X)), browser.archive.data.get(X)?.json, ...browser.archive.aside.map(entry => (entry.day === X ? entry.json : null))];
  assert.ok(everywhere.includes(JSON.stringify(real)), 'the restored day is never thrown away');
  // Still listed, marked restored, and it can be put back again (once the older tab is closed).
  const again = (await a.store.displaced()).find(entry => entry.id === kept.id);
  assert.ok(again && !again.restoredAt, 'kept, and said again: no longer marked restored (1.40.1)');
  assert.equal(a.store.lastAside()?.day, X, 'the header tells the person once more');
  assert.equal(await a.store.restoreAside(kept.id), true);
  assert.equal(a.store.get(key(X)), JSON.stringify(real));
  assert.ok(browser.archive.aside.some(entry => entry.day === X && entry.json === JSON.stringify(blind)), 'and the older tab’s version is kept aside too');
});

test('A5. Lost, then Carry on without them: the next automatic sync pulls the missing days back from the copy and deletes nothing', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const copy = plainCopy();
  assert.equal((await createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW }).sync(copy.provider)).status, 'ok');
  const pass = await a.pass();
  const moved = browser.days.slice(0, pass.moved).map(([day]) => day);
  for (const day of moved.slice(0, 40)) browser.archive.data.delete(day);
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'lost');
  assert.equal(await b.store.settle(), true, 'Carry on');
  const synced = await createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW }).sync(copy.provider);
  assert.deepEqual(moved.filter(day => !copy.has(day)), []);
  assert.deepEqual(browser.differences(b.store), [], 'and every day is back here');
});

test('A6. Lost, Carry on, then the person types into a missing day before the next sync: a conflict, never a silent overwrite of the copy’s day', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const copy = plainCopy();
  assert.equal((await createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW }).sync(copy.provider)).status, 'ok');
  const pass = await a.pass();
  const [X, real] = browser.days[7];
  assert.ok(pass.moved > 7);
  browser.archive.data.delete(X);
  browser.closeTabs();
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'lost');
  await b.store.settle();
  assert.equal(b.store.pending(key(X)), false);
  assert.equal(b.store.writeJSON(key(X), { ...createBlankDay(), focus: 'new' }), true);
  const synced = await createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW }).sync(copy.provider);
  assert.equal(synced.status, 'conflict');
  assert.deepEqual(copy.document.records[`day:${X}`].value, real, 'the copy keeps the real day until the person chooses');
});

test('A7. Defence in depth: with a lock that excludes nothing, B1’s same-tab race still loses nothing', async () => {
  const locks = { request: async (name, options, callback) => (callback || options)({ name }) };
  const browser = createBrowser();
  const a = browser.tab({ locks });
  const real = browser.archive.read;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let armed = true;
  browser.archive.read = async list => { const found = await real(list); if (armed) { armed = false; await gate; } return found; };
  const passing = a.pass();
  await tick();
  const pulled = await a.store.placeMany([[key('2019-03-04'), historyDay('2019-03-04')]], { today: HISTORY_TODAY });
  release();
  await passing;
  assert.deepEqual(pulled.refused, []);
  browser.closeTabs();
  const c = browser.tab();
  await c.store.ready();
  assert.deepEqual(browser.differences(c.store), []);
  void historyBackup; void historyDays;
});

// --- attack2.test.js: once this session has looked for orphans ---

const usedOf = storage => { let n = 0; for (let i = 0; i < storage.length; i += 1) { const k = storage.key(i); n += k.length + (storage.getItem(k) || '').length; } return n; };

function valueCopy() {
  const copy = { document: null };
  copy.provider = { read: async () => (copy.document ? { exists: true, document: copy.document } : { exists: false }), write: async document => { copy.document = JSON.parse(JSON.stringify(document)); } };
  copy.value = day => copy.document?.records?.[`day:${day}`]?.value;
  return copy;
}

async function leftovers(browser, tab, tombstoned) {
  const days = ['2010-01-04', '2010-01-05', '2010-01-06'];
  for (const day of days) await browser.archive.put([{ day, json: JSON.stringify(historyDay(day)) }]);
  if (tombstoned) tab.ledger.deferMarks(() => days.forEach(day => tab.ledger.recordMutation({ type: 'remove', key: key(day) })));
  browser.base.setItem(RESET_KEY, '1');
  return days;
}

test('A1b (failed on 51435e7, minor 2). finishReset() in a second tab while tab A holds the lock, finishes the Reset and moves days: B checks again inside the lock and empties nothing', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  // Earlier this session: A looked for orphans (none), so ready() won't look again.
  await a.store.ready();
  await leftovers(browser, a, true);
  let release; let reached;
  const gate = new Promise(resolve => { release = resolve; });
  const atGate = new Promise(resolve => { reached = resolve; });
  const passing = a.store.moveDays(async () => { reached(); await gate; return planMoves({ days: a.store.hotDays(), used: usedOf(a.storage), today: HISTORY_TODAY }).batches; });
  await atGate;
  const b = browser.tab({ name: 'B (opening now)' });
  const finishing = b.store.finishReset();
  await tick(20);
  release();
  const [pass, finished] = await Promise.all([passing, finishing]);
  browser.closeTabs();
  const c = browser.tab();
  const status = await c.store.ready();
  const missing = browser.differences(c.store);
  assert.deepEqual(missing, [], 'finishing a Reset never empties days a pass has just moved');
});

test('A2c (failed on 51435e7, minor 3). Same session, orphans already looked for: the first pass clears Reset’s leftovers itself, and never carries, shows or syncs them', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.store.ready();
  const days = await leftovers(browser, a, false);
  const copy = valueCopy();
  await a.pass();
  const shown = days.filter(day => a.store.get(key(day)) != null);
  await createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW }).sync(copy.provider);
  const sent = days.filter(day => copy.value(day) != null);
  browser.closeTabs();
  const c = browser.tab();
  const status = await c.store.ready();
  assert.deepEqual(shown, [], 'days the Reset removed are never shown again');
  assert.notEqual(status, 'lost');
});

test('A3b (failed on 51435e7, minor 1). A pulled blank over archived X, heard by tab B, then each tab syncs: X is never removed from the copy without a tombstone', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const copy = valueCopy();
  const engineA = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  await engineA.sync(copy.provider);
  await a.pass();
  await browser.deliver();
  const b = browser.tab({ name: 'B' });
  const engineB = createSyncEngine({ store: b.store, ledger: b.ledger, now: NOW });
  await Promise.all([a.store.ready(), b.store.ready()]);
  const [X, real] = browser.days[5];
  // The copy's X is blank now (a 1.39.4 tab's sync); A pulls it.
  copy.document.records[`day:${X}`] = { ...copy.document.records[`day:${X}`], value: createBlankDay(), hash: 'blank-from-older-tab', updatedAt: '2026-11-11T10:00:00.000Z' };
  const pulled = await engineA.sync(copy.provider);
  await browser.deliver();
  await a.store.settled(); await b.store.settled();
  const syncA = await engineA.sync(copy.provider);
  const afterA = copy.value(X) === undefined ? 'X removed from the copy' : isBlankDay(copy.value(X)) ? 'blank' : 'the real day';
  const removedByA = copy.value(X) === undefined;
  const syncB = await engineB.sync(copy.provider);
  const afterB = copy.value(X) === undefined ? 'X removed from the copy' : isBlankDay(copy.value(X)) ? 'blank' : 'the real day';
  assert.equal(removedByA, false, 'tab A’s sync never removes X from the copy without a tombstone');
  void real;
});

// --- boot-idb.test.js: what a start asks of IndexedDB with no manifest ---

function fakeIndexedDB({ databases = true } = {}) {
  const calls = { databases: 0, open: 0 };
  const idb = { open: () => { calls.open += 1; return {}; } }; // never answers
  if (databases) idb.databases = async () => { calls.databases += 1; return []; };
  return { idb, calls };
}
const storeOver = (days, idb) => { const storage = new QuotaStorage(SAFARI_BUDGET); seedHistory(storage, historyDays(days)); return createDayStore(storage, { archive: () => createDayArchive({ indexedDB: idb, openTimeoutMs: 300 }) }); };

test('under half full: no IndexedDB call at all, ready at once', async () => {
  const { idb, calls } = fakeIndexedDB();
  const store = storeOver(200, idb);
  assert.equal(store.isReady(), true);
  assert.equal(await store.ready(), 'none');
  assert.deepEqual(calls, { databases: 0, open: 0 });
});

test('half full or more, no manifest yet (the days before the first pass): one indexedDB.databases(), no open', async () => {
  const { idb, calls } = fakeIndexedDB();
  const store = storeOver(700, idb);
  assert.equal(store.isReady(), false, 'history openers wait for this look');
  assert.equal(await store.ready(), 'none');
  assert.equal(store.isReady(), true);
  assert.deepEqual(calls, { databases: 1, open: 0 });
});

test('half full, a browser without indexedDB.databases() (Firefox before 126; failed on 51435e7, nit): the start opens (creates) no database, and history never waits on it', async () => {
  const { idb, calls } = fakeIndexedDB({ databases: false });
  const store = storeOver(700, idb);
  const started = Date.now();
  assert.equal(await store.ready(), 'none');
  const waited = Date.now() - started;
  assert.equal(calls.open, 0, 'no database opened (created) at a start with nothing archived');
});

// --- The guards behind minor 1, each in the order the test forces ---------------------------------------------------

test('minor 1: a tab keeps an archived day aside only while the write that replaced it is still there: taken back out meanwhile, the archived day stands', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await a.store.ready();
  const [X, real] = browser.days[5];
  // A pull applies a blank over X (trusted): the archived X is to be kept aside, by a job under the lock.
  const placing = a.store.placeMany([[key(X), createBlankDay()]], { today: HISTORY_TODAY, goal: 0.6 });
  const placed = await placing;
  assert.deepEqual(placed.refused, []);
  // Before that job runs, another tab takes the blank back out (as an older tab's blank).
  browser.base.removeItem(key(X));
  await a.store.settled();
  assert.equal(browser.archive.data.get(X)?.json, JSON.stringify(real), 'X still archived');
  assert.equal(browser.archive.aside.length, 0, 'nothing kept aside for a write that is gone');
  assert.equal(a.store.get(key(X)), JSON.stringify(real));
  browser.closeTabs();
  const c = browser.tab();
  assert.equal(await c.store.ready(), 'ready');
  assert.equal(c.store.get(key(X)), JSON.stringify(real));
});

test('minor 1: a blank over an archived day goes only while the archive still holds the day; kept aside already by the tab that applied it, the blank stands', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await browser.deliver();
  const b = browser.tab({ name: 'B' });
  await b.store.ready();
  const [X, real] = browser.days[5];
  // A applies a pulled blank over X, and its job keeps the archived X aside, before B takes in the write.
  const blank = createBlankDay();
  assert.deepEqual((await a.store.placeMany([[key(X), blank]], { today: HISTORY_TODAY, goal: 0.6 })).refused, []);
  await a.store.settled();
  assert.equal(browser.archive.data.has(X), false, 'kept aside by A');
  await browser.deliver();
  assert.deepEqual(JSON.parse(browser.base.getItem(key(X))), blank, 'the blank stands in localStorage');
  assert.deepEqual(b.store.readJSON(key(X)), blank, 'B reads what A reads');
  assert.ok(browser.archive.aside.some(entry => entry.day === X && entry.json === JSON.stringify(real)), 'the real day kept aside');
  browser.closeTabs();
  const c = browser.tab();
  assert.equal(await c.store.ready(), 'ready', 'never in neither home, so never lost');
});

test('minor 1: a sync starting before an older tab’s blank is heard never reads the blank: its local side reconciles first, under the lock', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const copy = plainCopy();
  const engine = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  assert.equal((await engine.sync(copy.provider)).status, 'ok');
  await a.pass();
  await browser.deliver();
  const [X, real] = browser.days[0];
  browser.olderTab().store.writeJSON(key(X), createBlankDay());
  // A's sync starts before A has even taken in the storage event.
  const synced = await engine.sync(copy.provider);
  assert.ok(!synced.pushed.includes(`day:${X}`), 'the blank never sent');
  assert.ok(!isBlankDay(copy.document.records[`day:${X}`].value));
  await a.store.settled();
  assert.equal(a.store.get(key(X)), JSON.stringify(real));
});

test('a pass in a tab that hasn’t heard an older tab’s write over an archived day yet never puts that write over the archived day', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await browser.deliver();
  const c = browser.tab({ name: 'C' });
  await c.store.ready();
  const [X, real] = browser.days[6];
  const blind = { ...createBlankDay(), focus: 'Typed in the older tab' };
  browser.olderTab().store.writeJSON(key(X), blind);
  // C's pass runs before C has taken in the storage event.
  const result = await c.store.moveDays([[X]]);
  assert.equal(result.moved, 0);
  assert.equal(browser.archive.data.get(X)?.json, JSON.stringify(real), 'the archived day kept as it was');
  await browser.deliver();
  await c.store.settled();
  assert.ok(browser.archive.aside.some(entry => entry.day === X && entry.json === JSON.stringify(real)), 'then kept aside, as any blind write over it');
  assert.deepEqual(c.store.readJSON(key(X)), blind);
});

// --- The 1.40.0 third review's Restore leftovers (scratchpad review-1.40.0/pass3 restore.test.js), 1.40.1 -----------

test('R1, R2: Restore, the older tab saves again, three times over: the real day always kept, the older tab’s version kept once, and the person told each time', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A (1.40)' });
  await a.pass();
  await browser.deliver();
  const [X, real] = browser.days[2];
  const older = browser.olderTab();
  const blind = { ...createBlankDay(), focus: 'Typed in the older tab' };
  const olderSaves = async () => { older.store.writeJSON(key(X), blind); await browser.deliver(); await a.store.settled(); };
  await olderSaves();
  const notices = [a.store.lastAside()?.day || null];
  const [kept] = await a.store.displaced();
  assert.equal(kept.json, JSON.stringify(real));
  for (let round = 1; round <= 3; round += 1) {
    assert.equal(await a.store.restoreAside(kept.id), true, `restore ${round}`);
    await a.store.settled();
    assert.equal(a.store.get(key(X)), JSON.stringify(real), `restored ${round}`);
    assert.equal(a.store.lastAside(), null, 'restored: no news');
    await olderSaves();
    notices.push(a.store.lastAside()?.day || null);
  }
  const list = await a.store.displaced();
  assert.ok(list.some(entry => entry.json === JSON.stringify(real)), 'the real day is never lost');
  assert.equal(list.filter(entry => entry.json === JSON.stringify(blind)).length, 1, 'the older tab’s version kept once, however many rounds (R2)');
  assert.equal(list.length, 2);
  assert.deepEqual(notices, [X, X, X, X], 'each time the older tab saves over the restored day, the person is told again (R1)');
});

test('R2: an older tab saving over an archived day the same version that is kept aside already: kept once', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await browser.deliver();
  const [X, real] = browser.days[4];
  // The real day kept aside already (an earlier round), and archived again since (a pass moved it back).
  await browser.archive.keepAside([{ day: X, json: JSON.stringify(real), reason: 'older-tab' }]);
  browser.olderTab().store.writeJSON(key(X), { ...createBlankDay(), focus: 'Blind' });
  await browser.deliver();
  await a.store.settled();
  assert.equal(browser.archive.aside.filter(entry => entry.day === X && entry.json === JSON.stringify(real)).length, 1, 'not twice');
  assert.equal(browser.archive.data.has(X), false, 'dropped from the archive all the same: localStorage holds the day now');
});

test('R1: the restored day edited in 1.40, then written over blind by the older tab: that edit is kept aside, and said', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  await a.pass();
  await browser.deliver();
  const [X, real] = browser.days[3];
  const older = browser.olderTab();
  const blind = { ...createBlankDay(), focus: 'Typed in the older tab' };
  older.store.writeJSON(key(X), blind);
  await browser.deliver();
  await a.store.settled();
  const [kept] = await a.store.displaced();
  await a.store.restoreAside(kept.id);
  await a.store.settled();
  const edited = { ...real, focus: 'Edited after the restore' };
  assert.equal(a.store.writeJSON(key(X), edited), true);
  older.store.writeJSON(key(X), blind);
  await browser.deliver();
  await a.store.settled();
  assert.ok((await a.store.displaced()).some(entry => entry.json === JSON.stringify(edited)), 'the edit kept aside');
  assert.equal(a.store.lastAside()?.day, X);
});
