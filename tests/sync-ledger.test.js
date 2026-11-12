import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createLocalStore } from '../src/state/local-store.js';
import { compactEntry, createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { createSealedTransport, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, createSeal } from '../src/sync/seal.js';
import * as ledger139 from './support/sync-1.39.3/ledger.js';
import * as document139 from './support/sync-1.39.3/document.js';
import * as engine139 from './support/sync-1.39.3/engine.js';
import { QuotaStorage, historyDays, seedHistory } from './support/history.js';

// Personal sync's ledger with years of history (1.39.4): read once per sync and its marks written in one go, entries
// kept compact within format 1 (read the same by 1.39.x), an import's marks written once.

const LEDGER_KEY = 'daily-planner-sync:ledger';
const CLOCK = '2026-11-10T09:00:00.000Z';

/** A plain copy (an object), as the engine's bare providers present it. */
function plainCloud() {
  const cloud = { document: null, writes: 0, during: null };
  cloud.provider = {
    read: async () => (cloud.document ? { exists: true, document: JSON.parse(JSON.stringify(cloud.document)) } : { exists: false }),
    write: async document => {
      if (cloud.during) { const during = cloud.during; cloud.during = null; await during(); }
      cloud.document = JSON.parse(JSON.stringify(document));
      cloud.writes += 1;
    }
  };
  return cloud;
}

/** A sealed cloud file (text), as Google Drive and Dropbox present it. */
function sealedCloud() {
  const file = { text: null, writes: 0 };
  return { file, raw: { id: 'google', configured: true, signIn: 'popup', hasUsableToken: () => true, clearToken() {}, async readText() { return file.text == null ? { exists: false, fileId: '', version: '', text: '' } : { exists: true, fileId: 'file_1', version: `v${file.writes}`, text: file.text }; }, async writeText(text) { file.text = text; file.writes += 1; return { id: 'file_1', version: `v${file.writes}` }; } } };
}

/** A device over `sync` (this tree's modules, or 1.39.3's), on a storage that counts its reads. */
function device({ sync = { createSyncLedger, createSyncEngine }, clock = () => CLOCK, storage = new QuotaStorage() } = {}) {
  const now = () => new Date(clock());
  const ledger = sync.createSyncLedger(storage, { now });
  const store = createLocalStore(storage, { onMutation: mutation => ledger.recordMutation(mutation) });
  const engine = sync.createSyncEngine({ store, ledger, now });
  let writes = 0;
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === LEDGER_KEY) writes += 1; return setItem(key, value); };
  return { storage, ledger, store, engine, ledgerWrites: () => { const n = writes; writes = 0; return n; } };
}

/** How many times the ledger was read (getItem) and parsed (JSON.parse of its string) while `fn` ran. */
async function counted(d, fn) {
  d.storage.readsOf(LEDGER_KEY);
  d.ledgerWrites();
  const parse = JSON.parse;
  let parses = 0;
  JSON.parse = (text, reviver) => { if (typeof text === 'string' && text === d.storage.data.get(LEDGER_KEY)) parses += 1; return parse(text, reviver); };
  try {
    const value = await fn();
    return { value, reads: d.storage.readsOf(LEDGER_KEY), parses, writes: d.ledgerWrites() };
  } finally {
    JSON.parse = parse;
  }
}

const dayKey = key => `daily-planner:${key}`;
const recordOf = key => `day:${key}`;

test('entries are compact within format 1: no syncedAt, dirtyAt and deletedAt only when set', async () => {
  const d = device();
  d.store.writeJSON(dayKey('2026-11-01'), { focus: 'one' });
  d.store.writeJSON(dayKey('2026-11-02'), { focus: 'two' });
  assert.deepEqual(JSON.parse(d.storage.getItem(LEDGER_KEY)).records[recordOf('2026-11-01')], { dirtyAt: CLOCK }, 'changed, never synced');
  const cloud = plainCloud();
  await d.engine.sync(cloud.provider);
  const stored = JSON.parse(d.storage.getItem(LEDGER_KEY));
  assert.equal(stored.version, 1, 'still format 1');
  const synced = stored.records[recordOf('2026-11-01')];
  assert.deepEqual(Object.keys(synced), ['lastSyncedHash'], 'synced: the base alone');
  d.store.remove(dayKey('2026-11-02'));
  assert.deepEqual(Object.keys(JSON.parse(d.storage.getItem(LEDGER_KEY)).records[recordOf('2026-11-02')]).sort(), ['deletedAt', 'dirtyAt', 'lastSyncedHash']);
  await d.engine.sync(cloud.provider);
  assert.deepEqual(Object.keys(JSON.parse(d.storage.getItem(LEDGER_KEY)).records[recordOf('2026-11-02')]).sort(), ['deletedAt', 'lastSyncedHash'], 'a tombstone agreed on');
  // Read as before: both fields there, null when not set.
  assert.deepEqual(d.ledger.entry(recordOf('2026-11-01')), { lastSyncedHash: synced.lastSyncedHash, dirtyAt: null, deletedAt: null });
  // What 1.39.3 wrote is read the same, and compacted at the next write.
  const full = { lastSyncedHash: 'h', dirtyAt: null, deletedAt: null, syncedAt: CLOCK };
  assert.deepEqual(compactEntry(full), { lastSyncedHash: 'h' });
  assert.deepEqual(compactEntry({ lastSyncedHash: 'h', dirtyAt: CLOCK, deletedAt: CLOCK, syncedAt: CLOCK }), { lastSyncedHash: 'h', dirtyAt: CLOCK, deletedAt: CLOCK });
  const compact = { lastSyncedHash: 'h' };
  assert.equal(compactEntry(compact), compact, 'compact already: the same object');
  const old = new QuotaStorage();
  old.setItem(LEDGER_KEY, JSON.stringify({ version: 1, records: { 'day:2026-11-03': full, 'day:2026-11-04': { ...full, dirtyAt: CLOCK } }, copy: { cloud: 'google', id: '' } }));
  const reader = createSyncLedger(old, { now: () => new Date(CLOCK) });
  assert.deepEqual(reader.entry('day:2026-11-03'), { lastSyncedHash: 'h', dirtyAt: null, deletedAt: null });
  assert.deepEqual(reader.dirtyEntries().map(([id]) => id), ['day:2026-11-04']);
  reader.recordMutation({ type: 'set', key: dayKey('2026-11-05') });
  assert.deepEqual(JSON.parse(old.getItem(LEDGER_KEY)), { version: 1, records: { 'day:2026-11-03': { lastSyncedHash: 'h' }, 'day:2026-11-04': { lastSyncedHash: 'h', dirtyAt: CLOCK }, 'day:2026-11-05': { dirtyAt: CLOCK } }, copy: { cloud: 'google', id: '' } });
});

test('a synced entry takes about 40% less room', async () => {
  const days = historyDays(200);
  const sizes = {};
  for (const [label, sync] of [['1.39.3', { createSyncLedger: ledger139.createSyncLedger, createSyncEngine: engine139.createSyncEngine }], ['1.39.4', { createSyncLedger, createSyncEngine }]]) {
    const d = device({ sync });
    seedHistory(d.storage, days);
    await d.engine.sync(plainCloud().provider);
    const unsynced = device({ sync });
    unsynced.store.writeJSON(dayKey(days[0][0]), days[0][1]);
    sizes[label] = {
      synced: (d.storage.getItem(LEDGER_KEY).length - 40) / days.length,
      unsynced: JSON.stringify(JSON.parse(unsynced.storage.getItem(LEDGER_KEY)).records[recordOf(days[0][0])]).length + recordOf(days[0][0]).length + 4
    };
  }
  assert.ok(sizes['1.39.3'].synced > 170 && sizes['1.39.3'].synced < 180, `1.39.3: ${sizes['1.39.3'].synced} characters per synced record`);
  assert.ok(sizes['1.39.4'].synced < 106, `1.39.4: ${sizes['1.39.4'].synced} characters per synced record`);
  assert.ok(sizes['1.39.4'].unsynced < sizes['1.39.3'].unsynced - 15, `never synced: ${sizes['1.39.3'].unsynced} → ${sizes['1.39.4'].unsynced}`);
});

/**
 * A history where each kind of entry is there: synced, changed since, never synced, deleted since, a tombstone
 * agreed on, the settings; for `sync` (this tree's modules, or 1.39.3's), on the same clock.
 */
async function variedHistory(sync) {
  const d = device({ sync });
  const cloud = plainCloud();
  const days = historyDays(12);
  seedHistory(d.storage, days.slice(0, 8));
  d.store.writeJSON('daily-planner:settings', { startHour: 7 });
  await d.engine.sync(cloud.provider);
  d.store.writeJSON(dayKey(days[1][0]), { ...days[1][1], focus: 'Changed since' });
  d.store.writeJSON(dayKey(days[8][0]), days[8][1]);
  d.store.remove(dayKey(days[2][0]));
  d.store.remove(dayKey(days[3][0]));
  await d.engine.sync(cloud.provider);
  d.store.remove(dayKey(days[4][0]));
  d.store.writeJSON(dayKey(days[9][0]), days[9][1]);
  d.store.writeJSON(dayKey(days[5][0]), { ...days[5][1], focus: 'Changed after the last sync' });
  return { d, cloud, days };
}

/** What 1.39.3's read path says of a ledger: every function it reads the ledger with. */
async function readPath139(storage) {
  const ledger = ledger139.createSyncLedger(storage, { now: () => new Date(CLOCK) });
  const store = createLocalStore(storage);
  const ids = Object.keys(ledger.read().records).sort();
  const nullish = value => value ?? null;
  return {
    entries: ids.map(id => { const entry = ledger.entry(id); return [id, nullish(entry?.lastSyncedHash), nullish(entry?.dirtyAt), nullish(entry?.deletedAt), !!entry?.dirtyAt, !!entry?.deletedAt]; }),
    dirty: ledger.dirtyEntries().map(([id]) => id).sort(),
    hasDirty: ledger.hasDirty(),
    oldestDirtyAt: ledger.oldestDirtyAt(),
    copy: ledger.copy(),
    local: await document139.localSyncRecords(store, ledger),
    restated: await document139.restateRetiredBase(store, ledger)
  };
}

const cloneStorage = storage => { const copy = new QuotaStorage(); for (const [key, value] of storage.data) copy.setItem(key, value); return copy; };

test('1.39.x reads what 1.39.4 writes exactly as it reads its own: 1.39.3’s read path, run on compact entries', async () => {
  const now = await variedHistory({ createSyncLedger, createSyncEngine });
  const then = await variedHistory({ createSyncLedger: ledger139.createSyncLedger, createSyncEngine: engine139.createSyncEngine });
  const compact = JSON.parse(now.d.storage.getItem(LEDGER_KEY));
  const full = JSON.parse(then.d.storage.getItem(LEDGER_KEY));
  // The same history: entry for entry, the compact one is the full one without its nulls and syncedAt.
  assert.deepEqual(Object.keys(compact.records).sort(), Object.keys(full.records).sort());
  for (const [id, entry] of Object.entries(full.records)) assert.deepEqual(compact.records[id], compactEntry(entry), id);
  assert.ok(Object.values(full.records).some(entry => entry.syncedAt && entry.dirtyAt === null), '1.39.3 wrote the long form');
  assert.ok(Object.values(compact.records).every(entry => !('syncedAt' in entry) && entry.dirtyAt !== null && entry.deletedAt !== null), '1.39.4 the compact one');

  // 1.39.3's ledger and document functions say the same of both.
  const onCompact = await readPath139(now.d.storage);
  const onFull = await readPath139(then.d.storage);
  assert.deepEqual(onCompact, onFull);
  assert.ok(onCompact.hasDirty && onCompact.dirty.length === 3, 'changes waiting, a deletion among them');

  // And a 1.39.3 device on those very ledgers syncs the same: same result, same copy, same ledger after.
  const results = [];
  for (const { d, cloud } of [now, then]) {
    const storage = cloneStorage(d.storage);
    const old = device({ sync: { createSyncLedger: ledger139.createSyncLedger, createSyncEngine: engine139.createSyncEngine }, storage });
    const copy = plainCloud();
    copy.document = JSON.parse(JSON.stringify(cloud.document));
    const result = await old.engine.sync(copy.provider);
    results.push({ result, records: copy.document.records, after: await readPath139(storage) });
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].result.pushed.length, 3);
  assert.deepEqual(results[0].after.dirty, []);
});

// The brief's target is two parses per sync, counted through getItem. Every sync here reads the key at most twice,
// except one that both fetches and sends: it reads it a third time, just before the copy is written, to store the
// pulls as agreed on first (a tab closed while the copy is written then leaves them agreed on). That read finds the
// string this ledger wrote moments before, so it parses nothing: parses stay at two or fewer, here zero.
test('one sync reads the ledger at most twice (three times when it both fetches and sends), parses it at most twice, and writes it once per batch: 300 records', async () => {
  const days = historyDays(300);
  const cloud = plainCloud();
  const a = device();
  const b = device();
  seedHistory(a.storage, days);
  const check = async (d, what, { reads = 2, writes = 1, pushed = 0, pulled = 0 } = {}) => {
    const run = await counted(d, () => d.engine.sync(cloud.provider));
    assert.equal(run.value.status, 'ok', what);
    assert.deepEqual([run.value.pushed.length, run.value.pulled.length], [pushed, pulled], what);
    assert.ok(run.reads <= reads, `${what}: ledger read ${run.reads}× (at most ${reads})`);
    assert.ok(run.parses <= 2, `${what}: parsed ${run.parses}×`);
    assert.ok(run.writes <= writes, `${what}: written ${run.writes}× (at most ${writes})`);
    return run;
  };
  await check(a, 'first sync, everything sent', { pushed: 300 });
  await check(b, 'another device, everything fetched', { pulled: 300 });
  const quiet = await check(a, 'no changes', { writes: 0 });
  assert.equal(quiet.reads, 1);
  a.store.writeJSON(dayKey(days[10][0]), { ...days[10][1], focus: 'one change' });
  await check(a, 'one change', { pushed: 1 });
  await check(b, 'that change fetched', { pulled: 1 });
  // Both sides changed something: fetched and sent in the same sync. Read a third time (see above), parsed not at
  // all, written twice (the pulls before the copy is written, what was sent after).
  a.store.writeJSON(dayKey(days[11][0]), { ...days[11][1], focus: 'from A' });
  b.store.writeJSON(dayKey(days[12][0]), { ...days[12][1], focus: 'from B' });
  await check(a, 'A sends', { pushed: 1 });
  const both = await check(b, 'B fetches and sends', { reads: 3, writes: 2, pushed: 1, pulled: 1 });
  assert.equal(both.parses, 0, 'each read found the very string this ledger last wrote: nothing to parse');
  // 1.39.3, for comparison: three reads per record.
  const old = device({ sync: { createSyncLedger: ledger139.createSyncLedger, createSyncEngine: engine139.createSyncEngine } });
  seedHistory(old.storage, days.slice(0, 50));
  const before = await counted(old, () => old.engine.sync(plainCloud().provider));
  assert.equal(before.reads, 50 * 3 + 2);
});

/** Freezes `value` and everything in it: any change made to it afterwards throws (modules run in strict mode). */
const deepFreeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; };

test('what the ledger parsed is never changed in place: frozen, every way of writing it still works', async () => {
  const cloud = plainCloud();
  const a = device();
  const b = device();
  const days = historyDays(20);
  seedHistory(a.storage, days);
  a.store.writeJSON('daily-planner:settings', { startHour: 7 });
  await a.engine.sync(cloud.provider);
  await b.engine.sync(cloud.provider);
  const frozen = deepFreeze(a.ledger.read());
  deepFreeze(a.ledger.snapshot());
  await assert.doesNotReject(async () => {
    a.store.writeJSON(dayKey(days[0][0]), { ...days[0][1], focus: 'changed' });
    a.store.remove(dayKey(days[1][0]));
    deepFreeze(a.ledger.read());
    b.store.writeJSON(dayKey(days[2][0]), { ...days[2][1], focus: 'from B' });
    await b.engine.sync(cloud.provider);
    await a.engine.sync(cloud.provider);
    deepFreeze(a.ledger.read());
    a.ledger.restateBase('settings', { from: a.ledger.entry('settings').lastSyncedHash, to: 'restated' });
    a.ledger.forgetRecord(recordOf(days[3][0]));
    a.ledger.setCopy({ cloud: 'google', id: 'c1' });
    a.ledger.resetBases({ cloud: 'dropbox', id: '' });
    a.ledger.deferMarks(() => a.store.writeJSON(dayKey(days[4][0]), { focus: 'deferred' }));
  });
  assert.equal(frozen.records[recordOf(days[0][0])].dirtyAt, undefined, 'the first parse, as it was');
  assert.equal(a.ledger.entry('settings').lastSyncedHash, undefined, 'and the ledger moved on');
});

test('a change marked while a sync runs is kept: its marks are written over the ledger as it is by then', async () => {
  const cloud = plainCloud();
  const a = device();
  a.store.writeJSON(dayKey('2026-11-01'), { focus: 'first' });
  // Typing in the planner (another day) while the copy is being written.
  cloud.during = async () => { a.store.writeJSON(dayKey('2026-11-02'), { focus: 'typed during the sync' }); };
  const result = await a.engine.sync(cloud.provider);
  assert.deepEqual(result.pushed, [recordOf('2026-11-01')]);
  assert.equal(a.ledger.entry(recordOf('2026-11-01')).dirtyAt, null, 'what was sent, agreed on');
  assert.ok(a.ledger.entry(recordOf('2026-11-02')).dirtyAt, 'what was typed meanwhile still waits');
  assert.equal(a.ledger.hasDirty(), true);
  assert.deepEqual((await a.engine.sync(cloud.provider)).pushed, [recordOf('2026-11-02')]);
  // A write of the copy refused (another device wrote meanwhile): what was pulled is agreed on all the same.
  const b = device();
  await b.engine.sync(cloud.provider);
  a.store.writeJSON(dayKey('2026-11-03'), { focus: 'from A' });
  await a.engine.sync(cloud.provider);
  b.store.writeJSON(dayKey('2026-11-04'), { focus: 'from B' });
  const failing = { read: cloud.provider.read, write: async () => { throw Object.assign(new Error('changed'), { code: 'remote-changed' }); } };
  await assert.rejects(() => b.engine.sync(failing), error => error.pulled?.includes(recordOf('2026-11-03')));
  assert.ok(b.ledger.entry(recordOf('2026-11-03')).lastSyncedHash, 'the pull is agreed on');
  assert.ok(b.ledger.entry(recordOf('2026-11-04')).dirtyAt, 'what was not sent still waits');
  assert.deepEqual((await b.engine.sync(cloud.provider)).pushed, [recordOf('2026-11-04')]);
});

test('an import’s marks are written once (deferMarks), and held when the browser refuses them', () => {
  const storage = new QuotaStorage();
  const d = device({ storage });
  const days = historyDays(200);
  const results = [];
  const store = createLocalStore(storage, { onMutation: mutation => results.push(d.ledger.recordMutation(mutation)) });
  const { value, marked } = d.ledger.deferMarks(() => { days.forEach(([key, day]) => store.writeJSON(dayKey(key), day)); return 'done'; });
  assert.deepEqual([value, marked], ['done', true]);
  assert.equal(d.ledgerWrites(), 1, 'one write for 200 days');
  assert.ok(results.every(result => result === null), 'each write: no mark of its own to report');
  assert.equal(d.ledger.dirtyEntries().length, 200);
  // Nested, and nothing marked: no write.
  assert.deepEqual(d.ledger.deferMarks(() => d.ledger.deferMarks(() => 1).value), { value: 1, marked: null });
  assert.equal(d.ledgerWrites(), 0);
  // Refused: held, seen as waiting, and written with the next mark that fits.
  const more = historyDays(5, { today: '2023-01-01' });
  storage.quota = storage.used() + 10;
  const refused = d.ledger.deferMarks(() => more.forEach(([key]) => d.ledger.recordMutation({ type: 'set', key: dayKey(key) })));
  assert.equal(refused.marked, false);
  assert.equal(d.ledger.dirtyEntries().length, 205, 'held marks count as waiting');
  storage.quota = Infinity;
  assert.equal(d.ledger.recordMutation({ type: 'set', key: dayKey(days[0][0]) }), true);
  assert.equal(Object.keys(JSON.parse(storage.getItem(LEDGER_KEY)).records).length, 205, 'written with the next one');
  // `fn` throws: what it wrote before is still marked.
  assert.throws(() => d.ledger.deferMarks(() => { d.ledger.recordMutation({ type: 'set', key: dayKey('2020-01-01') }); throw new Error('boom'); }), /boom/);
  assert.ok(JSON.parse(storage.getItem(LEDGER_KEY)).records['day:2020-01-01']?.dirtyAt);
});

/** Two devices over `cloud`, 3,000 typical days on A: every step timed, the ledger read at most twice per sync. */
async function twoDevices3000(t, { connect, label }) {
  const days = historyDays(3000);
  const a = device();
  const b = device();
  seedHistory(a.storage, days);
  const sync = await connect(a, b);
  const timings = [];
  const step = async (d, what, expect) => {
    const start = performance.now();
    const run = await counted(d, () => sync(d));
    timings.push(`${what} ${Math.round(performance.now() - start)} ms`);
    assert.equal(run.value.status, 'ok', what);
    assert.deepEqual([run.value.pushed.length, run.value.pulled.length], expect, what);
    assert.ok(run.reads <= 2, `${what}: ledger read ${run.reads}×`);
    return run;
  };
  await step(a, 'first sync (3,000 sent)', [3000, 0]);
  await step(b, 'other device (3,000 fetched)', [0, 3000]);
  for (const [key, day] of [days[0], days[1500], days[2999]]) assert.deepEqual(b.store.readJSON(dayKey(key)), day);
  await step(a, 'no changes', [0, 0]);
  b.store.writeJSON(dayKey(days[42][0]), { ...days[42][1], focus: 'Edited on B' });
  b.store.remove(dayKey(days[43][0]));
  await step(b, 'B sends an edit and a deletion', [2, 0]);
  await step(a, 'A fetches them', [0, 2]);
  assert.equal(a.store.readJSON(dayKey(days[42][0])).focus, 'Edited on B');
  assert.equal(a.store.get(dayKey(days[43][0])), null);
  a.store.writeJSON(dayKey(days[100][0]), { ...days[100][1], focus: 'One change on A' });
  await step(a, 'one change', [1, 0]);
  await step(b, 'fetched', [0, 1]);
  await step(b, 'no changes', [0, 0]);
  assert.equal(a.ledger.hasDirty() || b.ledger.hasDirty(), false);
  t.diagnostic(`${label}, 3,000 records: ${timings.join(' · ')}`);
}

test('two devices, plain copy, 3,000 records: every sync agrees and reads the ledger at most twice (timings reported)', async t => {
  const cloud = plainCloud();
  await twoDevices3000(t, { label: 'plain', connect: async () => d => d.engine.sync(cloud.provider) });
});

test('two devices, sealed copy, 3,000 records: the same through the seal (timings reported)', async t => {
  const cloud = sealedCloud();
  const seal = await createSeal('quiet harbour lantern', { iterations: MIN_ITERATIONS });
  await twoDevices3000(t, {
    label: 'sealed',
    connect: async (...devices) => {
      for (const d of devices) {
        d.protection = createSyncProtection({ storage: d.storage, keyStore: createMemoryKeyStore(), now: () => new Date(CLOCK) });
        await d.protection.adopt(seal);
        d.transport = createSealedTransport({ provider: cloud.raw, protection: d.protection });
      }
      return d => d.engine.sync(d.transport);
    }
  });
  assert.ok(!cloud.file.text.includes('Edited on B'), 'the copy stayed sealed');
});
