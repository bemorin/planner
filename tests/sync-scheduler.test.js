import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncScheduler } from '../src/sync/scheduler.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncEngine } from '../src/sync/engine.js';

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

function fakeClock(start = 0) {
  let now = start;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
      let guard = 0;
      while (guard++ < 100) {
        const due = [...timers.entries()].filter(([, timer]) => timer.due <= now);
        if (!due.length) break;
        for (const [id, timer] of due) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    pending() { return timers.size; }
  };
}

test('many rapid local edits arm one idle sync instead of one Drive write per edit', async () => {
  const clock = fakeClock();
  let syncCalls = 0;
  let dirty = true;
  const scheduler = createSyncScheduler({
    idleMs: 50_000,
    maxWaitMs: 120_000,
    isEnabled: () => true,
    isBusy: () => false,
    hasDirty: () => dirty,
    sync: async () => { syncCalls += 1; dirty = false; return { status: 'ok' }; },
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout
  });

  for (let i = 0; i < 12; i += 1) {
    scheduler.noteLocalChange();
    clock.advance(2_000);
  }
  assert.equal(syncCalls, 0, 'edits alone must not sync');
  clock.advance(50_000);
  await Promise.resolve();
  assert.equal(syncCalls, 1, 'one idle sync after the pause');
});

test('dirty state eventually syncs through the max-wait bound while editing continues', async () => {
  const clock = fakeClock();
  let syncCalls = 0;
  let dirty = true;
  const scheduler = createSyncScheduler({
    idleMs: 50_000,
    maxWaitMs: 120_000,
    isEnabled: () => true,
    isBusy: () => false,
    hasDirty: () => dirty,
    sync: async () => { syncCalls += 1; dirty = false; return { status: 'ok' }; },
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout
  });

  scheduler.noteLocalChange();
  for (let i = 0; i < 5; i += 1) {
    clock.advance(20_000);
    scheduler.noteLocalChange();
  }
  assert.equal(syncCalls, 0);
  clock.advance(20_000);
  await Promise.resolve();
  assert.equal(syncCalls, 1, 'max-wait forces a sync before two minutes of continuous edits leave Drive stale');
});

test('returning to the app and reconnecting trigger opportunistic sync attempts', async () => {
  const clock = fakeClock();
  const reasons = [];
  const scheduler = createSyncScheduler({
    idleMs: 50_000,
    maxWaitMs: 120_000,
    isEnabled: () => true,
    isBusy: () => false,
    hasDirty: () => false,
    sync: async ({ reason }) => { reasons.push(reason); return { status: 'ok' }; },
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout
  });

  await scheduler.attempt('visible');
  await scheduler.attempt('focus');
  await scheduler.attempt('online');
  assert.deepEqual(reasons, ['visible', 'focus', 'online']);
});

test('offline local editing continues and auth failure leaves dirty state usable', async () => {
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-08-18T10:00:00.000Z') });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  store.writeJSON('daily-planner:2026-08-18', { focus: 'Local only' });
  assert.equal(ledger.hasDirty(), true);

  const clock = fakeClock();
  let syncCalls = 0;
  const scheduler = createSyncScheduler({
    idleMs: 50_000,
    maxWaitMs: 120_000,
    isEnabled: () => true,
    isBusy: () => false,
    hasDirty: () => ledger.hasDirty(),
    sync: async () => {
      syncCalls += 1;
      throw new Error('silent auth unavailable');
    },
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout
  });

  scheduler.noteLocalChange();
  clock.advance(50_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(syncCalls, 1);
  assert.equal(ledger.hasDirty(), true);
  assert.equal(store.readJSON('daily-planner:2026-08-18').focus, 'Local only');
  store.writeJSON('daily-planner:2026-08-18', { focus: 'Still local' });
  assert.equal(store.readJSON('daily-planner:2026-08-18').focus, 'Still local');
  scheduler.clearTimers();
});

test('manual sync still works and conflicts remain non-destructive', async () => {
  const remote = (() => {
    let document = null;
    return {
      async read() { return { exists: !!document, fileId: document ? 'file_1' : '', document }; },
      async write(next) { document = structuredClone(next); return { id: 'file_1' }; }
    };
  })();

  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-08-18T10:00:00.000Z') });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const engine = createSyncEngine({ store, ledger, now: () => new Date('2026-08-18T10:00:00.000Z') });

  store.writeJSON('daily-planner:2026-08-18', { focus: 'Base' });
  assert.equal((await engine.sync(remote)).status, 'ok');

  const phoneStorage = new MemoryStorage();
  const phoneLedger = createSyncLedger(phoneStorage, { now: () => new Date('2026-08-18T10:05:00.000Z') });
  const phoneStore = createLocalStore(phoneStorage, { onMutation: phoneLedger.recordMutation });
  const phoneEngine = createSyncEngine({
    store: phoneStore,
    ledger: phoneLedger,
    now: () => new Date('2026-08-18T10:05:00.000Z')
  });
  assert.equal((await phoneEngine.sync(remote)).status, 'ok');

  store.writeJSON('daily-planner:2026-08-18', { focus: 'Desktop' });
  phoneStore.writeJSON('daily-planner:2026-08-18', { focus: 'Phone' });
  assert.equal((await engine.sync(remote)).status, 'ok');

  const conflict = await phoneEngine.sync(remote);
  assert.equal(conflict.status, 'conflict');
  assert.equal(phoneStore.readJSON('daily-planner:2026-08-18').focus, 'Phone');

  const resolved = await phoneEngine.sync(remote, { conflictResolution: 'local' });
  assert.equal(resolved.status, 'ok');
  assert.equal(phoneLedger.hasDirty(), false);
});

test('ledger exposes dirty helpers used by sync status UX', () => {
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-08-18T10:00:00.000Z') });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  assert.equal(ledger.hasDirty(), false);
  store.writeJSON('daily-planner:settings', { startHour: 7 });
  assert.equal(ledger.hasDirty(), true);
  assert.equal(ledger.oldestDirtyAt(), '2026-08-18T10:00:00.000Z');
  assert.equal(ledger.dirtyEntries().length, 1);
});
