import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../src/state/local-store.js';
import { createDayStore } from '../src/state/day-store.js';
import { createMemoryArchive } from '../src/state/day-archive.js';
import { MANIFEST_KEY, encodeManifest } from '../src/state/day-placement.js';
import { createBlankDay } from '../src/state/day-state.js';
import { QuotaStorage, historyDay } from './support/history.js';

// The day store (1.40, src/state/day-store.js): local-store's calls, over two homes. Here, its read path, its gate and
// its rules; the moves are in tests/day-store-pass.test.js.

const OLD = 'daily-planner:2024-03-04';
const OLDER = 'daily-planner:2024-03-01';
const RECENT = 'daily-planner:2026-11-10';
const json = key => JSON.stringify(historyDay(key.slice(14)));

/** A browser where OLD and OLDER moved to the archive: the manifest says so, localStorage no longer has them. */
function moved({ storage = new QuotaStorage(), archive = createMemoryArchive({ days: [OLDER, OLD].map(key => ({ day: key.slice(14), json: json(key) })) }), ...options } = {}) {
  storage.setItem(MANIFEST_KEY, encodeManifest({ before: '2024-03-05', days: 2, chars: 0 }));
  storage.setItem(RECENT, json(RECENT));
  storage.setItem('daily-planner:settings', '{"startHour":7}');
  const events = [];
  const writes = [];
  const store = createDayStore(storage, { archive, onMutation: event => events.push(event), onWrite: result => writes.push(result), ...options });
  return { storage, archive, store, events, writes };
}

/** The same calls on local-store and on the day store give the same results and the same events. */
function parity(run) {
  const results = [];
  for (const create of [createLocalStore, createDayStore]) {
    const events = [];
    const writes = [];
    const storage = new QuotaStorage(4000);
    const store = create(storage, { onMutation: event => events.push(event), onWrite: ({ key, ok, tracked }) => writes.push({ key, ok, tracked }) });
    const values = run(store, storage);
    results.push({ values, events, writes, data: [...storage.data] });
  }
  return results;
}

test('with nothing archived, it is local-store: the same results, the same events, and IndexedDB never opened', async () => {
  const [plain, store] = parity((s, storage) => [
    s.writeJSON('x', { ok: true }), s.readJSON('x'), s.set('daily-planner:a', '1'), s.set('daily-planner:2026-11-11', '{"focus":"a"}'), s.get('daily-planner:2026-11-11'),
    s.keys('daily-planner:').sort(), s.withoutMutationTracking(() => s.writeJSON('daily-planner:2026-11-12', { focus: 'pulled' })),
    s.set('daily-planner:2026-11-13', 'y'.repeat(5000)), s.readJSON('missing', 'fallback'), s.remove('daily-planner:2026-11-11'), s.remove('never-there'),
    s.removePrefix('daily-planner:'), s.keys(''), s.canWrite(), storage.length
  ]);
  assert.deepEqual(store, plain);
  let opened = 0;
  const day = createDayStore(new QuotaStorage(), { archive: () => { opened += 1; return createMemoryArchive(); } });
  assert.equal(day.status(), 'none');
  assert.equal(day.isReady(), true);
  assert.equal(await day.ready(), 'none', 'ready at once');
  assert.equal(day.pending(RECENT), false);
  assert.equal(opened, 0, 'no IndexedDB at boot, nor ever, with nothing archived');
});

test('the local-store cases hold for the day store', () => {
  const store = createDayStore(new QuotaStorage());
  assert.equal(store.writeJSON('x', { ok: true }), true);
  assert.deepEqual(store.readJSON('x'), { ok: true });
  store.set('daily-planner:a', '1');
  store.set('daily-planner:b', '2');
  store.set('other', '3');
  assert.deepEqual(store.keys('daily-planner:').sort(), ['daily-planner:a', 'daily-planner:b']);
  assert.equal(store.removePrefix('daily-planner:'), 2);
  assert.equal(store.get('other'), '3');
  const mutations = [];
  const tracked = createDayStore(new QuotaStorage(), { onMutation: mutation => mutations.push(mutation) });
  tracked.writeJSON('daily-planner:2026-08-16', { focus: 'Local' });
  tracked.withoutMutationTracking(() => tracked.writeJSON('daily-planner:2026-08-16', { focus: 'Remote' }));
  tracked.remove('daily-planner:2026-08-16');
  assert.deepEqual(mutations.map(item => item.type), ['set', 'remove']);
  // A refused write is false, reported, and never throws (the sync engine's `refused` and day-move.js rely on it).
  const writes = [];
  const full = createDayStore(new QuotaStorage(60), { onWrite: result => writes.push(result) });
  assert.equal(full.set(RECENT, 'z'.repeat(100)), false);
  assert.deepEqual(writes.map(({ key, ok }) => [key, ok]), [[RECENT, false]]);
});

test('a day that may be archived and isn’t loaded yet is read-only: writes refused, reads null, nothing reported', async () => {
  const { store, writes, events, storage } = moved();
  assert.equal(store.status(), 'loading', 'a manifest: the archive is to be read');
  assert.equal(store.isReady(), false);
  assert.equal(store.pending(OLD), true);
  assert.equal(store.get(OLD), null);
  assert.equal(store.set(OLD, JSON.stringify(createBlankDay())), false, 'a blank read never saved over the real day');
  assert.equal(store.writeJSON(OLD, { focus: 'typed while it loads' }), false);
  assert.deepEqual([writes.length, events.length], [0, 0], 'not a refused save: nothing to tell, the view is inert meanwhile');
  assert.equal(storage.getItem(OLD), null);
  // Not pending: a recent day, a day after `before`, a day in localStorage, a key that isn't a day.
  for (const key of [RECENT, 'daily-planner:2024-03-05', 'daily-planner:settings', 'daily-planner-ui:tips']) assert.equal(store.pending(key), false, key);
  assert.equal(store.set(RECENT, '{"focus":"fine"}'), true);
});

test('ready() loads the archive once: every day reads back, keys list both homes once, the gate opens', async () => {
  let readies = 0;
  const { store, archive } = moved({ onReady: () => { readies += 1; } });
  const [a, b] = [store.ready(), store.ready()];
  assert.deepEqual(await Promise.all([a, b]), ['ready', 'ready']);
  assert.equal(archive.ops.all, 1, 'one load');
  assert.equal(readies, 1);
  assert.equal(store.isReady(), true);
  assert.equal(store.get(OLD), json(OLD), 'the identical string');
  assert.deepEqual(store.readJSON(OLDER), historyDay('2024-03-01'));
  assert.equal(store.pending(OLD), false);
  assert.deepEqual(store.keys('daily-planner:').sort(), ['daily-planner:2024-03-01', 'daily-planner:2024-03-04', 'daily-planner:2026-11-10', 'daily-planner:settings']);
  assert.deepEqual(store.keys('daily-planner:2024-'), ['daily-planner:2024-03-01', 'daily-planner:2024-03-04']);
  // A day before `before` in neither home is simply absent once the archive is loaded: it can be planned.
  assert.equal(store.pending('daily-planner:2024-03-02'), false);
  assert.equal(store.writeJSON('daily-planner:2024-03-02', { focus: 'new old day' }), true);
  assert.deepEqual(store.stats(), { days: 4, archived: 2, archivedChars: OLD.length + json(OLD).length + OLDER.length + json(OLDER).length, displaced: 0, lastAside: null, status: 'ready' });
});

test('localStorage wins: a day in both homes is the localStorage copy', async () => {
  const { store, storage } = moved();
  const edited = { ...historyDay('2024-03-04'), focus: 'edited in localStorage' };
  storage.setItem(OLD, JSON.stringify(edited));
  await store.ready();
  assert.deepEqual(store.readJSON(OLD), edited);
  assert.equal(store.keys('daily-planner:').filter(key => key === OLD).length, 1, 'listed once');
});

test('an archived day that is written moves back: hot again, its archived copy gone, the events as for any write', async () => {
  const { store, archive, storage, events } = moved();
  await store.ready();
  const day = store.readJSON(OLD);
  day.focus = 'An edit of an old day';
  assert.equal(store.writeJSON(OLD, day), true);
  assert.deepEqual(events, [{ type: 'set', key: OLD }]);
  assert.equal(storage.getItem(OLD), JSON.stringify(day), 'in localStorage, synchronously');
  await store.settled();
  assert.equal(archive.data.has('2024-03-04'), false, 'its archived copy gone');
  assert.deepEqual(store.readJSON(OLD), day);
  assert.equal(store.stats().archived, 1);
  assert.equal(JSON.parse(storage.getItem(MANIFEST_KEY)).days, 1, 'the manifest counts one day fewer');
  // Removed: from both homes, one event.
  assert.equal(store.remove(OLDER), true);
  assert.deepEqual(events.at(-1), { type: 'remove', key: OLDER });
  await store.settled();
  assert.equal(archive.data.size, 0);
  assert.equal(store.get(OLDER), null);
});

test('a refused write of an archived day keeps it archived', async () => {
  const storage = new QuotaStorage(6000);
  const { store, archive } = moved({ storage });
  await store.ready();
  assert.equal(store.set(OLD, 'w'.repeat(7000)), false, 'refused: false, as always');
  await store.settled();
  assert.equal(store.get(OLD), json(OLD));
  assert.ok(archive.data.has('2024-03-04'));
});

test('IndexedDB failing: older days stay read-only and nothing is taken for deleted; an empty database is “lost”', async () => {
  const failing = createMemoryArchive();
  failing.faults.open = new Error('IndexedDB unavailable');
  const { store } = moved({ archive: failing });
  assert.equal(await store.ready(), 'unavailable');
  assert.equal(store.isReady(), true, 'history goes on with what is here');
  assert.equal(store.pending(OLD), true, 'still read-only');
  assert.equal(store.set(OLD, '{"focus":"blind"}'), false);
  assert.deepEqual(store.keys('daily-planner:2024-'), []);
  const empty = moved({ archive: createMemoryArchive() });
  assert.equal(await empty.store.ready(), 'lost');
  assert.equal(empty.store.pending(OLD), true);
  assert.equal(empty.store.stats().archived, 0, 'what is there to read');
});

test('a blank day that wasn’t made from the archived one is never written over it', async () => {
  const { store } = moved();
  await store.ready();
  assert.equal(store.writeJSON(OLD, createBlankDay()), false);
  assert.equal(store.get(OLD), json(OLD));
  // Made from it (its items), a day emptied on purpose is an edit like any other.
  const emptied = store.readJSON(OLD);
  emptied.priorities.forEach(item => { item.text = ''; });
  emptied.tasks = [];
  emptied.blocks = [];
  Object.assign(emptied, { focus: '', notes: '', memory: '', lesson: '', endedAt: '', carriedForward: [], triaged: [] });
  assert.equal(store.writeJSON(OLD, emptied), true);
});
