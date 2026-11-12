import test from 'node:test';
import assert from 'node:assert/strict';
import { createDayStore } from '../src/state/day-store.js';
import { createMemoryArchive } from '../src/state/day-archive.js';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { createSealedTransport, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, createSeal } from '../src/sync/seal.js';
import * as ledger139 from './support/sync-1.39.3/ledger.js';
import * as engine139 from './support/sync-1.39.3/engine.js';
import { QuotaStorage, SAFARI_BUDGET, historyDays } from './support/history.js';

// Personal sync with days in two homes (1.40, §7 of the design): moving is invisible to sync (the same keys, the
// same strings, the same hashes, no marks), and every change to an archived day syncs as any other. Each scenario
// runs over a plain copy and over a sealed one.

const DAYS = historyDays(90);
const OLD = DAYS.slice(0, 30).map(([day]) => day);
const key = day => `daily-planner:${day}`;
const record = day => `day:${day}`;
const NOW = () => new Date('2026-11-11T09:00:00.000Z');

/** A device: Safari's quota, its day store over an archive of its own, its ledger and engine (a reload: open()). */
function device(name, { seed = true, quota = SAFARI_BUDGET, days = DAYS } = {}) {
  const storage = new QuotaStorage(quota);
  const archive = createMemoryArchive({ now: NOW });
  if (seed) for (const [day, value] of days) storage.setItem(key(day), JSON.stringify(value));
  const d = { name, storage, archive };
  d.open = () => {
    d.ledger = createSyncLedger(storage, { now: NOW });
    d.store = createDayStore(storage, { archive, onMutation: d.ledger.recordMutation, ledgerDays: () => d.ledger.dayMarks(), forgetDays: days => d.ledger.forgetDays(days) });
    d.engine = createSyncEngine({ store: d.store, ledger: d.ledger, now: NOW });
    return d;
  };
  return d.open();
}

/** A fresh plain copy (an object) or sealed one (text, opened through each device's seal); `writes` counts provider writes. */
async function makeCloud(kind) {
  const plain = { document: null, writes: 0 };
  const plainProvider = { read: async () => (plain.document ? { exists: true, document: plain.document } : { exists: false }), write: async document => { plain.writes += 1; plain.document = JSON.parse(JSON.stringify(document)); } };
  const file = { text: null, writes: 0 };
  const raw = { id: 'google', configured: true, signIn: 'popup', hasUsableToken: () => true, clearToken() {}, async readText() { return file.text == null ? { exists: false, fileId: '', version: '', text: '' } : { exists: true, fileId: 'file_1', version: `v${file.writes}`, text: file.text }; }, async writeText(text) { file.text = text; file.writes += 1; return { id: 'file_1', version: `v${file.writes}` }; } };
  const seal = await createSeal('quiet harbour lantern', { iterations: MIN_ITERATIONS });
  const sealed = async d => {
    if (!d.protection) {
      d.protection = createSyncProtection({ storage: d.storage, keyStore: createMemoryKeyStore(), now: NOW });
      await d.protection.adopt(seal);
    }
    return createSealedTransport({ provider: raw, protection: d.protection });
  };
  return kind === 'plain' ? { kind, transport: async () => plainProvider, writes: () => plain.writes } : { kind, transport: sealed, writes: () => file.writes };
}

const sync = async (cloud, d, options) => d.engine.sync(await cloud.transport(d), options);
const move = d => d.store.moveDays([OLD]);

for (const kind of ['plain', 'sealed']) {
  test(`${kind} copy: after a move, a sync changes nothing and writes nothing, on either device`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    const b = device('B', { seed: false });
    assert.equal((await sync(cloud, a)).pushed.length, DAYS.length);
    assert.equal((await sync(cloud, b)).pulled.length, DAYS.length);
    const result = await move(a);
    assert.equal(result.moved, OLD.length);
    assert.equal(a.storage.getItem(key(OLD[0])), null, 'moved out of localStorage');
    const writes = cloud.writes();
    a.storage.readsOf('daily-planner-sync:ledger');
    const again = await sync(cloud, a);
    assert.deepEqual([again.status, again.pushed, again.pulled], ['ok', [], []]);
    assert.equal(cloud.writes(), writes, 'provider.write not called');
    assert.ok(a.storage.readsOf('daily-planner-sync:ledger') <= 2, 'the ledger read at most twice in the sync, archived days and all');
    assert.equal(a.ledger.hasDirty(), false, 'no dirty marks');
    const fromB = await sync(cloud, b);
    assert.deepEqual([fromB.pushed, fromB.pulled], [[], []]);
    assert.equal(cloud.writes(), writes);
  });

  test(`${kind} copy: B edits a day archived on A; A pulls it: hot again, the archived copy gone, B’s content`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    const b = device('B', { seed: false });
    await sync(cloud, a);
    await sync(cloud, b);
    await move(a);
    const edited = { ...b.store.readJSON(key(OLD[0])), focus: 'Edited on B' };
    b.store.writeJSON(key(OLD[0]), edited);
    assert.deepEqual((await sync(cloud, b)).pushed, [record(OLD[0])]);
    const pull = await sync(cloud, a);
    assert.deepEqual([pull.pulled, pull.refused], [[record(OLD[0])], []]);
    await a.store.settled();
    assert.deepEqual(JSON.parse(a.storage.getItem(key(OLD[0]))), edited, 'in localStorage');
    assert.equal(a.archive.data.has(OLD[0]), false, 'the archived copy gone');
    assert.equal(a.archive.aside.length, 0, 'an edit, not a blind write: nothing kept aside');
    assert.deepEqual((await sync(cloud, a)).pushed, [], 'agreed on');
  });

  test(`${kind} copy: A edits an archived day: pushed, then B pulls it`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    const b = device('B', { seed: false });
    await sync(cloud, a);
    await sync(cloud, b);
    await move(a);
    const edited = { ...a.store.readJSON(key(OLD[1])), lesson: 'Edited on A, long after' };
    assert.equal(a.store.writeJSON(key(OLD[1]), edited), true);
    assert.deepEqual((await sync(cloud, a)).pushed, [record(OLD[1])]);
    assert.deepEqual((await sync(cloud, b)).pulled, [record(OLD[1])]);
    assert.deepEqual(b.store.readJSON(key(OLD[1])), edited);
  });

  test(`${kind} copy: B deletes an archived day: gone from both homes on A, and it stays gone after a reload`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    const b = device('B', { seed: false });
    await sync(cloud, a);
    await sync(cloud, b);
    await move(a);
    assert.equal(b.store.remove(key(OLD[2])), true);
    assert.deepEqual((await sync(cloud, b)).pushed, [record(OLD[2])]);
    // A's IndexedDB delete is lost (the tab closes first): the tombstone in the ledger still removes it at the next start.
    a.archive.faults.remove = new Error('lost');
    assert.deepEqual((await sync(cloud, a)).pulled, [record(OLD[2])]);
    await a.store.settled();
    a.archive.faults.remove = null;
    assert.equal(a.store.get(key(OLD[2])), null);
    assert.ok(a.archive.data.has(OLD[2]), 'still in the database, for now');
    a.open();
    await a.store.ready();
    await a.store.settled();
    assert.equal(a.store.get(key(OLD[2])), null, 'not back after a reload');
    assert.equal(a.archive.data.has(OLD[2]), false, 'and gone from the database too');
    assert.deepEqual((await sync(cloud, a)).pushed, []);
  });

  test(`${kind} copy: a pass interrupted on A, then a sync: nothing to push`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    await sync(cloud, a);
    for (const stopAt of ['put', 'verify', 'manifest', 7]) {
      const writes = cloud.writes();
      a.open();
      await a.store.moveDays([OLD], { stopAt });
      a.open();
      const result = await sync(cloud, a);
      assert.deepEqual([result.status, result.pushed, result.pulled], ['ok', [], []], String(stopAt));
      assert.equal(cloud.writes(), writes, String(stopAt));
    }
  });

  test(`${kind} copy: a 1.39 tab’s sync on A drops the archived days from the copy; B never deletes them; A’s next sync puts them back`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    const b = device('B', { seed: false });
    await sync(cloud, a);
    await sync(cloud, b);
    await move(a);
    // The same browser, a tab of 1.39: a plain store over A's localStorage, its own ledger code over the same key.
    const old = { storage: a.storage, protection: a.protection };
    const oldLedger = ledger139.createSyncLedger(a.storage, { now: NOW });
    const oldStore = createLocalStore(a.storage, { onMutation: oldLedger.recordMutation });
    const stripped = await engine139.createSyncEngine({ store: oldStore, ledger: oldLedger, now: NOW }).sync(await cloud.transport(old));
    assert.equal(stripped.status, 'ok');
    assert.ok(OLD.every(day => stripped.pushed.includes(record(day))), 'the moved days look deleted to it: removed from the copy, without tombstones');
    // B syncs meanwhile: it keeps its days (no tombstone), and puts them back.
    const fromB = await sync(cloud, b);
    assert.ok(OLD.every(day => b.store.get(key(day)) !== null), 'B never deletes them');
    assert.deepEqual(fromB.pulled, []);
    a.open();
    await a.store.ready();
    await sync(cloud, a);
    const reader = device('reader', { seed: false });
    if (cloud.kind === 'sealed') reader.protection = a.protection;
    await sync(cloud, reader);
    assert.ok(OLD.every(day => reader.store.get(key(day)) === a.store.get(key(day))), 'the copy has every day again');
    assert.equal(b.ledger.deletedDays().size, 0);
  });
}

for (const kind of ['plain', 'sealed']) {
  test(`${kind} copy: a fresh device under Safari’s quota pulls a 3,000-day copy: every day placed, and later syncs never remove one`, async () => {
    const cloud = await makeCloud(kind);
    const history = historyDays(3000);
    const a = device('A', { quota: Infinity, days: history });
    assert.equal((await sync(cloud, a)).pushed.length, 3000);
    const b = device('B', { seed: false });
    const first = await sync(cloud, b);
    assert.deepEqual([first.status, first.pulled.length, first.refused], ['ok', 3000, []]);
    assert.ok(history.every(([day, value]) => b.store.get(key(day)) === JSON.stringify(value)), 'every day placed, the identical string');
    assert.ok(b.storage.used() <= SAFARI_BUDGET * 0.5, `localStorage ${Math.round(b.storage.used() / SAFARI_BUDGET * 100)}% full`);
    assert.ok(b.archive.data.size > 2000, `${b.archive.data.size} older days straight to the archive`);
    assert.equal(b.ledger.hasDirty(), false, 'a pull is no change of B’s');
    const records = async () => {
      if (kind === 'plain') return Object.keys((await (await cloud.transport(b)).read()).document.records).length;
      return Object.keys((await (await cloud.transport(b)).read()).document.records).length;
    };
    for (let round = 0; round < 3; round += 1) {
      b.open();
      const again = await sync(cloud, b);
      assert.deepEqual([again.status, again.pushed, again.pulled], ['ok', [], []], `sync ${round + 1}`);
      assert.equal(await records(), 3000, 'never a record removed from the copy');
    }
  });

  test(`${kind} copy: the archive lost (site data partly cleared): no sync by itself; one asked for brings the days back from the copy`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    await sync(cloud, a);
    await move(a);
    // The database is emptied behind the planner's back; the manifest still counts the days.
    a.archive.data.clear();
    a.open();
    assert.equal(await a.store.ready(), 'lost');
    await assert.rejects(sync(cloud, a), error => error.code === 'archive', 'never taken for deletions');
    const restored = await sync(cloud, a, { restoreMissing: true });
    assert.equal(restored.status, 'ok');
    assert.deepEqual(restored.pushed, [], 'nothing removed from the copy');
    assert.deepEqual([...restored.pulled].sort(), OLD.map(record).sort(), 'what was missing, fetched back');
    assert.ok(DAYS.every(([day, value]) => a.store.get(key(day)) === JSON.stringify(value)));
    assert.equal(await a.store.settle(), true);
    assert.equal(a.store.status(), 'ready');
    assert.deepEqual((await sync(cloud, a)).pushed, []);
  });
}

test('IndexedDB failing after a move: the engine doesn’t run at all (older days would look deleted)', async () => {
  const cloud = await makeCloud('plain');
  const a = device('A');
  await sync(cloud, a);
  await move(a);
  a.archive.faults.open = new Error('IndexedDB unavailable');
  a.archive.faults.all = new Error('IndexedDB unavailable');
  a.open();
  const writes = cloud.writes();
  await assert.rejects(sync(cloud, a), error => error.code === 'archive' && error.archive === 'unavailable');
  await assert.rejects(sync(cloud, a, { restoreMissing: true }), error => error.code === 'archive');
  assert.equal(cloud.writes(), writes, 'the copy untouched');
});

test('a blank day pulled over an archived one is applied, the archived version kept aside: never refused forever', async () => {
  const cloud = await makeCloud('plain');
  const a = device('A');
  const b = device('B', { seed: false });
  await sync(cloud, a);
  await sync(cloud, b);
  await move(a);
  const { createBlankDay } = await import('../src/state/day-state.js');
  const archived = a.store.get(key(OLD[3]));
  b.store.writeJSON(key(OLD[3]), createBlankDay());
  await sync(cloud, b);
  const pull = await sync(cloud, a);
  assert.deepEqual([pull.pulled, pull.refused], [[record(OLD[3])], []]);
  await a.store.settled();
  assert.deepEqual(a.archive.aside.map(entry => [entry.day, entry.json]), [[OLD[3], archived]]);
  // The person's own blank read, on the other hand, is still refused (tests/day-store.test.js).
});
