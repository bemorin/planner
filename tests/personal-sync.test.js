import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

function device(clock = '2026-08-16T12:00:00.000Z') {
  const storage = new MemoryStorage();
  const now = () => new Date(clock);
  const ledger = createSyncLedger(storage, { now });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const engine = createSyncEngine({ store, ledger, now });
  return { storage, ledger, store, engine };
}

function remoteProvider() {
  let document = null;
  return {
    async read() { return { exists: !!document, fileId: document ? 'file_1' : '', document }; },
    async write(next) { document = structuredClone(next); return { id: 'file_1' }; },
    value() { return structuredClone(document); }
  };
}

test('first sync uploads existing planner records and a fresh device can pull them', async () => {
  const remote = remoteProvider();
  const laptop = device();
  laptop.store.writeJSON('daily-planner:settings', { startHour: 8 });
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'Ship' });

  const first = await laptop.engine.sync(remote);
  assert.equal(first.status, 'ok');
  assert.deepEqual(first.pushed, ['day:2026-08-16', 'settings']);

  const phone = device('2026-08-16T12:05:00.000Z');
  const second = await phone.engine.sync(remote);
  assert.equal(second.status, 'ok');
  assert.deepEqual(second.pulled, ['day:2026-08-16', 'settings']);
  assert.deepEqual(phone.store.readJSON('daily-planner:2026-08-16'), { focus: 'Ship' });
});

test('a changed record is pulled when the local copy still matches the last synced hash', async () => {
  const remote = remoteProvider();
  const laptop = device();
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'A' });
  await laptop.engine.sync(remote);

  const phone = device('2026-08-16T12:05:00.000Z');
  await phone.engine.sync(remote);
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'B' });
  await laptop.engine.sync(remote);

  const result = await phone.engine.sync(remote);
  assert.deepEqual(result.pulled, ['day:2026-08-16']);
  assert.equal(phone.store.readJSON('daily-planner:2026-08-16').focus, 'B');
});

test('concurrent edits stop with a conflict instead of silently picking a winner', async () => {
  const remote = remoteProvider();
  const laptop = device();
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'Base' });
  await laptop.engine.sync(remote);

  const phone = device('2026-08-16T12:05:00.000Z');
  await phone.engine.sync(remote);
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'Laptop' });
  phone.store.writeJSON('daily-planner:2026-08-16', { focus: 'Phone' });
  await laptop.engine.sync(remote);

  const result = await phone.engine.sync(remote);
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.conflicts, ['day:2026-08-16']);
  assert.equal(phone.store.readJSON('daily-planner:2026-08-16').focus, 'Phone');
});

test('deletions are represented as tombstones and propagate to another device', async () => {
  const remote = remoteProvider();
  const laptop = device();
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'Delete me' });
  await laptop.engine.sync(remote);

  const phone = device('2026-08-16T12:05:00.000Z');
  await phone.engine.sync(remote);
  laptop.store.remove('daily-planner:2026-08-16');
  await laptop.engine.sync(remote);
  assert.ok(remote.value().records['day:2026-08-16'].deletedAt);

  await phone.engine.sync(remote);
  assert.equal(phone.store.get('daily-planner:2026-08-16'), null);
});

test('a record saved again unchanged is settled at the next sync, not left waiting', async () => {
  const remote = remoteProvider();
  const laptop = device();
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'Same' });
  await laptop.engine.sync(remote);
  laptop.store.writeJSON('daily-planner:2026-08-16', { focus: 'Same' });
  assert.equal(laptop.ledger.hasDirty(), true);
  const result = await laptop.engine.sync(remote);
  assert.deepEqual([result.pushed, result.pulled], [[], []]);
  assert.equal(laptop.ledger.hasDirty(), false);
});
