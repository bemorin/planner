import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../src/state/local-store.js';

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
  clear() { this.#data.clear(); }
}

test('local store reads and writes JSON safely', () => {
  const store = createLocalStore(new MemoryStorage());
  assert.equal(store.writeJSON('x', { ok: true }), true);
  assert.deepEqual(store.readJSON('x'), { ok: true });
});

test('local store enumerates and removes prefixes', () => {
  const storage = new MemoryStorage();
  const store = createLocalStore(storage);
  store.set('daily-planner:a', '1');
  store.set('daily-planner:b', '2');
  store.set('other', '3');
  assert.deepEqual(store.keys('daily-planner:').sort(), ['daily-planner:a', 'daily-planner:b']);
  assert.equal(store.removePrefix('daily-planner:'), 2);
  assert.equal(store.get('other'), '3');
});

test('local store reports write availability', () => {
  const store = createLocalStore(new MemoryStorage());
  assert.equal(store.canWrite(), true);
});


test('local store can track planner mutations and mute remote applications', () => {
  const mutations = [];
  const store = createLocalStore(new MemoryStorage(), { onMutation: mutation => mutations.push(mutation) });
  store.writeJSON('daily-planner:2026-08-16', { focus: 'Local' });
  store.withoutMutationTracking(() => store.writeJSON('daily-planner:2026-08-16', { focus: 'Remote' }));
  store.remove('daily-planner:2026-08-16');
  assert.deepEqual(mutations.map(item => item.type), ['set', 'remove']);
});
