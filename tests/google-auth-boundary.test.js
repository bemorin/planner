import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleDriveProvider, GoogleAuthRequiredError } from '../src/sync/google-drive.js';
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
    clearTimeout(id) { timers.delete(id); }
  };
}

function mockOauth2({ onRequest } = {}) {
  let inFlight = 0;
  let peakInFlight = 0;
  let requestCount = 0;
  return {
    get requestCount() { return requestCount; },
    get peakInFlight() { return peakInFlight; },
    initTokenClient({ callback }) {
      return {
        requestAccessToken() {
          requestCount += 1;
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          onRequest?.();
          queueMicrotask(() => {
            inFlight -= 1;
            callback({ access_token: 'token-from-gis', expires_in: 3600 });
          });
        }
      };
    }
  };
}

test('automatic idle/focus/online triggers never call requestAccessToken without a usable token', async () => {
  const oauth2 = mockOauth2();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2 });
  assert.equal(provider.hasUsableToken(), false);

  const clock = fakeClock();
  let syncAttempts = 0;
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-08-18T12:00:00.000Z') });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  store.writeJSON('daily-planner:2026-08-18', { focus: 'Dirty' });

  const scheduler = createSyncScheduler({
    idleMs: 50_000,
    maxWaitMs: 120_000,
    isEnabled: () => true,
    isBusy: () => false,
    hasDirty: () => ledger.hasDirty(),
    sync: async ({ reason }) => {
      syncAttempts += 1;
      if (!provider.hasUsableToken()) return null;
      return { status: 'ok', reason };
    },
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout
  });

  scheduler.noteLocalChange();
  clock.advance(50_000);
  await Promise.resolve();
  await scheduler.attempt('focus');
  await scheduler.attempt('online');
  await scheduler.attempt('idle');

  assert.ok(syncAttempts >= 1);
  assert.equal(oauth2.requestCount, 0, 'automatic paths must never call GIS requestAccessToken');
  assert.equal(provider.interactiveAuthCalls, 0);
  assert.equal(ledger.hasDirty(), true);
});

test('automatic sync preserves dirty state when authorization is unavailable', async () => {
  const provider = createGoogleDriveProvider({
    clientId: 'client.apps.googleusercontent.com',
    oauth2: mockOauth2()
  });
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-08-18T12:00:00.000Z') });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  store.writeJSON('daily-planner:2026-08-18', { focus: 'Keep me' });
  ledger.saveProvider({ connected: true });

  assert.equal(provider.hasUsableToken(), false);
  assert.throws(() => {
    // Simulate Drive API boundary used by automatic sync.
    if (!provider.hasUsableToken()) throw new GoogleAuthRequiredError();
  }, err => err instanceof GoogleAuthRequiredError);

  assert.equal(ledger.hasDirty(), true);
  assert.equal(store.readJSON('daily-planner:2026-08-18').focus, 'Keep me');
  assert.equal(provider.interactiveAuthCalls, 0);
});

test('valid in-memory token allows automatic sync without GIS', async () => {
  const oauth2 = mockOauth2();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2 });
  provider.setAccessTokenForTests('cached-token', 3_600_000);

  let documents = null;
  const drive = {
    async read() {
      assert.equal(provider.hasUsableToken(), true);
      return { exists: !!documents, fileId: documents ? 'file_1' : '', document: documents };
    },
    async write(next) {
      documents = structuredClone(next);
      return { id: 'file_1' };
    }
  };

  // Use engine against a token-gated wrapper that mirrors provider.read/write contract.
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-08-18T12:00:00.000Z') });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const engine = createSyncEngine({ store, ledger, now: () => new Date('2026-08-18T12:00:00.000Z') });
  store.writeJSON('daily-planner:2026-08-18', { focus: 'Upload me' });

  const gated = {
    async read() {
      if (!provider.hasUsableToken()) throw new GoogleAuthRequiredError();
      return drive.read();
    },
    async write(doc, options) {
      if (!provider.hasUsableToken()) throw new GoogleAuthRequiredError();
      return drive.write(doc, options);
    }
  };

  const result = await engine.sync(gated);
  assert.equal(result.status, 'ok');
  assert.equal(oauth2.requestCount, 0);
  assert.equal(provider.interactiveAuthCalls, 0);
  assert.equal(ledger.hasDirty(), false);
});

test('explicit reconnect may request authorization once under single-flight', async () => {
  const oauth2 = mockOauth2();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2 });
  assert.equal(provider.hasUsableToken(), false);

  const first = provider.authorizeInteractive();
  const second = provider.authorizeInteractive();
  await Promise.all([first, second]);
  assert.equal(provider.hasUsableToken(), true);
  assert.equal(oauth2.requestCount, 1, 'concurrent reconnects share one GIS request');
  assert.equal(oauth2.peakInFlight, 1);
  assert.equal(provider.interactiveAuthCalls, 1);
});

test('Drive reads never call requestAccessToken when the token is missing', async () => {
  const oauth2 = mockOauth2();
  const provider = createGoogleDriveProvider({
    clientId: 'client.apps.googleusercontent.com',
    oauth2,
    fetchImpl: async () => new Response('{}', { status: 200 })
  });
  await assert.rejects(() => provider.readText(), err => err instanceof GoogleAuthRequiredError);
  assert.equal(oauth2.requestCount, 0);
  assert.equal(provider.interactiveAuthCalls, 0);
});

test('scheduler automatic reasons stay non-interactive end-to-end', async () => {
  const oauth2 = mockOauth2();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2 });
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-08-18T12:00:00.000Z') });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  store.writeJSON('daily-planner:2026-08-18', { focus: 'Pending' });
  ledger.saveProvider({ connected: true });

  const clock = fakeClock();
  const reasons = [];
  const scheduler = createSyncScheduler({
    idleMs: 50_000,
    maxWaitMs: 120_000,
    isEnabled: () => true,
    isBusy: () => false,
    hasDirty: () => ledger.hasDirty(),
    sync: async ({ interactive, reason }) => {
      reasons.push({ interactive, reason });
      assert.equal(interactive, false);
      if (!provider.hasUsableToken()) return null;
      return { status: 'ok' };
    },
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout
  });

  scheduler.noteLocalChange();
  clock.advance(50_000);
  await Promise.resolve();
  await scheduler.attempt('focus');
  await scheduler.attempt('online');
  await scheduler.attempt('visible');

  assert.ok(reasons.every(item => item.interactive === false));
  assert.equal(oauth2.requestCount, 0);
  assert.equal(ledger.hasDirty(), true);
});
