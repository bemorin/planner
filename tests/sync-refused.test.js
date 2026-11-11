import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { createSealedTransport, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, createSeal } from '../src/sync/seal.js';
import { alertView } from '../src/features/sync-status.js';
import { refusedNote } from '../src/features/personal-sync-view.js';

// A change from another device this browser refuses to store (its storage full, 1.39.3): the engine keeps it
// un-applied, says so in `refused`, and pulls it again next time; this device's older version is never sent over it.

/** localStorage with a quota in characters (keys and values, as browsers count them). */
class QuotaStorage {
  constructor() { this.quota = Infinity; this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.has(String(key)) ? this.data.get(String(key)) : null; }
  used() { let chars = 0; for (const [key, value] of this.data) chars += key.length + value.length; return chars; }
  setItem(key, value) {
    const name = String(key);
    const before = this.data.has(name) ? name.length + this.data.get(name).length : 0;
    if (this.used() - before + name.length + String(value).length > this.quota) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.data.set(name, String(value));
  }
  removeItem(key) { this.data.delete(String(key)); }
}

const DAY = 'daily-planner:2026-11-10';
const RECORD = 'day:2026-11-10';
const B_EDIT = { focus: 'v2 from B, much longer than v1: a real edit made on the other device', memory: 'B memory' };

/** A plain cloud copy (an object), as the engine's bare providers present it. */
function plainCloud() {
  const cloud = { document: null };
  cloud.provider = { read: async () => (cloud.document ? { exists: true, document: cloud.document } : { exists: false }), write: async document => { cloud.document = JSON.parse(JSON.stringify(document)); } };
  cloud.value = () => cloud.document.records[RECORD].value;
  return cloud;
}

/** A sealed cloud file (text), as Google Drive and Dropbox present it; each device sees it through its seal. */
function sealedCloud() {
  const file = { text: null, writes: 0 };
  return {
    file,
    raw: { id: 'google', configured: true, signIn: 'popup', hasUsableToken: () => true, clearToken() {}, async readText() { return file.text == null ? { exists: false, fileId: '', version: '', text: '' } : { exists: true, fileId: 'file_1', version: `v${file.writes}`, text: file.text }; }, async writeText(text) { file.text = text; file.writes += 1; return { id: 'file_1', version: `v${file.writes}` }; } }
  };
}

function device(name, { now = () => new Date('2026-11-10T09:00:00.000Z') } = {}) {
  const storage = new QuotaStorage();
  const ledger = createSyncLedger(storage, { now });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const engine = createSyncEngine({ store, ledger, now });
  return { name, storage, ledger, store, engine };
}

async function refusedThenRetried({ sync, a, b, current }) {
  a.store.writeJSON(DAY, { focus: 'v1', memory: '' });
  assert.equal((await sync(a)).status, 'ok');
  assert.equal((await sync(b)).status, 'ok');
  assert.equal(JSON.parse(b.storage.getItem(DAY)).focus, 'v1');
  b.store.writeJSON(DAY, B_EDIT);
  assert.deepEqual((await sync(b)).pushed, [RECORD]);
  const baseBefore = a.ledger.entry(RECORD).lastSyncedHash;

  // A's storage is full: B's longer edit can't be stored there.
  a.storage.quota = a.storage.used() + 5;
  const pull = await sync(a);
  assert.equal(pull.status, 'ok');
  assert.deepEqual(pull.refused, [RECORD], 'named as refused');
  assert.deepEqual(pull.pulled, [], 'not taken as applied');
  assert.equal(JSON.parse(a.storage.getItem(DAY)).focus, 'v1', 'A still holds its older version');
  assert.equal(a.ledger.entry(RECORD).lastSyncedHash, baseBefore, 'its base unchanged');
  assert.equal(await current(), B_EDIT.focus, 'the copy keeps B’s edit');

  // Still full: the next sync tries again, and still sends nothing over B's edit.
  const again = await sync(a);
  assert.deepEqual([again.refused, again.pushed], [[RECORD], []]);
  assert.equal(await current(), B_EDIT.focus);

  // Room again: the next sync fetches it.
  a.storage.quota = Infinity;
  const fetched = await sync(a);
  assert.deepEqual([fetched.refused, fetched.pulled, fetched.pushed], [[], [RECORD], []]);
  assert.equal(JSON.parse(a.storage.getItem(DAY)).focus, B_EDIT.focus);
  assert.equal(await current(), B_EDIT.focus, 'B’s edit never overwritten');
  // And from then on, the two agree.
  assert.deepEqual((await sync(a)).pushed, []);
}

test('plain copy: a pulled change the browser refuses stays un-applied, is named, and is fetched again', async () => {
  const cloud = plainCloud();
  const a = device('A');
  const b = device('B');
  await refusedThenRetried({ sync: d => d.engine.sync(cloud.provider), a, b, current: async () => cloud.value().focus });
});

test('sealed copy: the same, through the seal', async () => {
  const cloud = sealedCloud();
  const seal = await createSeal('quiet harbour lantern', { iterations: MIN_ITERATIONS });
  const a = device('A');
  const b = device('B');
  for (const d of [a, b]) {
    d.protection = createSyncProtection({ storage: d.storage, keyStore: createMemoryKeyStore(), now: () => new Date('2026-11-10T09:00:00.000Z') });
    await d.protection.adopt(seal);
    d.transport = createSealedTransport({ provider: cloud.raw, protection: d.protection });
  }
  const reader = device('reader');
  reader.protection = createSyncProtection({ storage: reader.storage, keyStore: createMemoryKeyStore(), now: () => new Date('2026-11-10T09:00:00.000Z') });
  await reader.protection.adopt(seal);
  const readerTransport = createSealedTransport({ provider: cloud.raw, protection: reader.protection });
  // What the copy holds, opened with the passphrase by a third device.
  const current = async () => {
    const payload = await readerTransport.read();
    const value = payload.document.records[RECORD].value;
    return (typeof value === 'string' ? JSON.parse(value) : value).focus;
  };
  await refusedThenRetried({ sync: d => d.engine.sync(d.transport), a, b, current });
  assert.ok(!cloud.file.text.includes('v2 from B'), 'the copy stayed sealed');
});

test('Personal sync says so: in the header alert and on its card', () => {
  const state = { configured: true, cloud: 'google', clouds: ['google'], connected: true, busy: false, reconnect: false, accessUntil: 0, dirty: false, dirtyCount: 0, lastSyncedAt: '2026-11-10T09:00:00.000Z', conflicts: 0, need: '', error: '', refused: 2 };
  const view = alertView(state, { now: new Date('2026-11-10T10:00:00.000Z') });
  assert.deepEqual([view.kind, view.pill, view.action], ['space', 'Sync needs space', 'settings']);
  assert.equal(view.title, 'Changes from your other devices couldn’t be stored here');
  assert.equal(view.body, 'They stay in your synced copy, and the next sync fetches them again once there is room.');
  assert.equal(alertView({ ...state, refused: 0 }, { now: new Date('2026-11-10T10:00:00.000Z') }), null);
  assert.equal(refusedNote(1), 'This browser is out of space for your planner: 1 change from your other devices couldn’t be stored here. It stays in your synced copy, and the next sync fetches it again.');
  assert.match(refusedNote(3), /: 3 changes from your other devices couldn’t be stored here\. They stay in your synced copy, and the next sync fetches them again\.$/);
});
