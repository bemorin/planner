import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument } from './support/fake-dom.js';
import { createDayStore } from '../src/state/day-store.js';
import { createMemoryArchive } from '../src/state/day-archive.js';
import { GENERATION_KEY, createSyncLedger } from '../src/sync/ledger.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { createSealedTransport, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, createSeal } from '../src/sync/seal.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { resetLocalData } from '../src/features/reset-local.js';
import * as ledger139 from './support/sync-1.39.3/ledger.js';

// Reset local data while a sync is under way (the 1.40.1 review, F1 and F4; scratchpad review-1.40.1 inflight.test.js,
// ported): the real Personal sync feature, a real day store, a real seal, a Drive client held at its read or its write.
// Whatever began before the Reset, in this tab or another, writes nothing into the browser afterwards. These failed on
// d1d70f9 (there, after a 15 s wait).

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

const SELECTORS = [
  '[data-personal-sync]', '[data-personal-sync-lead]', '[data-personal-sync-choice]', '[data-personal-sync-choice-connect]', '[data-personal-sync-choice-note]',
  '[data-personal-sync-card]', '[data-personal-sync-mark]', '[data-personal-sync-dot]', '[data-personal-sync-status]', '[data-personal-sync-detail]',
  '[data-personal-sync-primary]', '[data-personal-sync-disconnect]', '[data-personal-sync-panel]', '[data-personal-sync-seal]', '[data-personal-sync-recovery]',
  '[data-personal-sync-conflict-actions]', '[data-personal-sync-conflict-copy]', '[data-personal-sync-keep-local]', '[data-personal-sync-use-remote]'
];
const doc = fakeDocument();
const el = {};
for (const selector of SELECTORS) el[selector.slice(20, -1) || 'root'] = doc.make(selector);
doc.make('[data-settings-modal]').hidden = true;
globalThis.document = doc;
const { createPersonalSyncFeature } = await import('../src/features/personal-sync.js');

const NOW = () => new Date('2026-11-12T10:00:00.000Z');
// The seal's crypto doesn't keep node's event loop alive on its own.
const keepAlive = setInterval(() => {}, 1000);
test.after(() => clearInterval(keepAlive));
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
const SETTINGS = { startHour: 7, categories: [{ id: 'deep-work', name: 'Deep work', color: '#5f7084' }], horizon: { years: { 2026: { goals: ['Write the book'] } } } };
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

const dropboxFake = () => ({ id: 'dropbox', name: 'Dropbox', signIn: 'redirect', configured: true, hasUsableToken: () => false, beginAuthorization: async () => '', ownsReturn: () => false, completeAuthorization: async () => ({ ok: false }), clearToken() {}, readText: async () => ({ exists: false }), writeText: async () => ({}) });

/** A tab's Personal sync over `storage` (a browser's localStorage), with its own Drive client, store and ledger. */
function tabOver(storage, { google, protection, windowRef = null }) {
  const ledger = createSyncLedger(storage, { now: NOW });
  const store = createDayStore(storage, { archive: createMemoryArchive(), onMutation: ledger.recordMutation, ledgerDays: () => ledger.dayMarks(), forgetDays: days => ledger.forgetDays(days) });
  const feature = createPersonalSyncFeature({
    store, ledger, googleClientId: 'client', dropboxAppKey: 'abcd1234efgh567', flushLocal: async () => {}, now: NOW,
    providerFactories: { google: () => google, dropbox: dropboxFake }, protection,
    recoveryStore: { count: async () => 0, latest: async () => null },
    timers: { set: () => 1, clear: () => {}, every: () => 1, stop: () => {} },
    Observer: class { observe() {} disconnect() {} }, documentRef: doc, windowRef,
    locationRef: { href: 'http://localhost:8800/', assign: () => {} }, historyRef: null, whenShown: fn => fn()
  });
  return { storage, ledger, store, feature };
}

/** A Drive client over `file`, which can be held at its next read or write (`gate`). */
function driveOver(file, gate = null) {
  return {
    id: 'google', name: 'Google Drive', signIn: 'popup', configured: true, token: true,
    hasUsableToken() { return this.token; }, accessEndsAt: () => Date.now() + 3600000, prepare: async () => {}, rememberAccount: async () => '',
    authorizeInteractive() { this.token = true; return Promise.resolve(); },
    clearToken() { this.token = false; },
    async readText() { if (gate?.on === 'read' && gate.armed) { gate.armed = false; gate.reached(); await gate.wait; } return file.text == null ? { exists: false, fileId: '', version: '', text: '' } : { exists: true, fileId: 'f', version: `v${file.writes}`, text: file.text }; },
    async writeText(text) { if (gate?.on === 'write' && gate.armed) { gate.armed = false; gate.reached(); await gate.wait; } file.text = text; file.writes += 1; return { id: 'f', version: `v${file.writes}` }; }
  };
}

/** A localStorage that refuses what passes `quota` characters, as browsers do. */
class FullStorage extends MemoryStorage {
  quota = Infinity;
  used() { let n = 0; for (let i = 0; i < this.length; i += 1) { const k = this.key(i); n += k.length + this.getItem(k).length; } return n; }
  setItem(key, value) {
    const before = this.getItem(key);
    if (this.used() - (before == null ? 0 : String(key).length + before.length) + String(key).length + String(value).length > this.quota) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    super.setItem(key, value);
  }
}

async function connectedBrowser(gate = null, storage = new MemoryStorage()) {
  const file = { text: null, writes: 0 };
  const google = driveOver(file, gate);
  const protection = createSyncProtection({ storage, keyStore: createMemoryKeyStore(), now: NOW });
  const seal = await createSeal('quiet harbour lantern', { iterations: MIN_ITERATIONS });
  await protection.adopt(seal);
  storage.setItem('daily-planner-sync:google', JSON.stringify({ connected: true, fileId: '', lastSyncedAt: '', lastError: '' }));
  storage.setItem('daily-planner-sync:cloud', 'google');
  const tab = tabOver(storage, { google, protection });
  for (const day of DAYS) tab.store.writeJSON(`daily-planner:${day}`, { focus: `Planned ${day}` });
  tab.store.writeJSON('daily-planner:settings', SETTINGS);
  tab.feature.render();
  assert.equal((await tab.feature.syncNow({ interactive: true }))?.status, 'ok', 'the first sync made the sealed copy');
  return { ...tab, google, file, protection, seal };
}

function makeGate(on) {
  const gate = { on, armed: false };
  gate.wait = new Promise(resolve => { gate.release = resolve; });
  gate.atGate = new Promise(resolve => { gate.reached = resolve; });
  return gate;
}

const summary = b => ({
  ledger: b.storage.getItem('daily-planner-sync:ledger'),
  provider: b.storage.getItem('daily-planner-sync:google'),
  connected: b.feature.getState().connected,
  need: b.feature.getState().need,
  days: DAYS.filter(day => b.store.get(`daily-planner:${day}`) != null).length
});

test('F1, same tab: a sync still uploading when Reset runs finishes after it, and writes nothing here: sync stays off, the ledger empty', async () => {
  const gate = makeGate('write');
  const b = await connectedBrowser(gate);
  b.store.writeJSON('daily-planner:settings', { ...SETTINGS, startHour: 8 }); // a change, so this sync uploads
  gate.armed = true;
  const syncing = b.feature.syncNow({ interactive: true });
  await gate.atGate;
  const started = Date.now();
  await resetLocalData({ store: b.store, ledger: b.ledger, sync: b.feature });
  assert.ok(Date.now() - started < 2000, 'Reset doesn’t wait for it');
  gate.release();
  assert.equal(await syncing, null, 'the sync stops, and says nothing');
  const after = summary(b);
  assert.equal(after.connected, false, 'Personal sync stays off in this browser');
  assert.equal(after.ledger, null, 'the ledger stays empty');
  assert.equal(after.provider, null, 'no cloud state written back');
  assert.ok(b.storage.getItem(GENERATION_KEY));
  b.feature.destroy();
});

test('F1 and F4, same tab: a sync still reading the copy when Reset runs pulls nothing back, and the card says not connected, not “enter your passphrase”', async () => {
  const gate = makeGate('read');
  const b = await connectedBrowser(gate);
  gate.armed = true;
  const syncing = b.feature.syncNow({ interactive: true });
  await gate.atGate;
  await resetLocalData({ store: b.store, ledger: b.ledger, sync: b.feature });
  gate.release();
  assert.equal(await syncing, null);
  const after = summary(b);
  assert.deepEqual([after.days, after.connected, after.need, after.provider, after.ledger], [0, false, '', null, null]);
  b.feature.render();
  assert.equal(el.root.dataset.syncState, 'disconnected', 'not connected, and no passphrase asked for');
  assert.equal(el.card.hidden, true, 'the card stands down: the clouds to choose from instead');
  assert.equal(el.choice.hidden, false);
  b.feature.destroy();
});

test('F1: after a late sync, the person reconnects (the passphrase again) once the planner is set up anew: the copy keeps its settings', async () => {
  const gate = makeGate('write');
  const b = await connectedBrowser(gate);
  b.store.writeJSON('daily-planner:settings', { ...SETTINGS, startHour: 8 });
  gate.armed = true;
  const syncing = b.feature.syncNow({ interactive: true });
  await gate.atGate;
  await resetLocalData({ store: b.store, ledger: b.ledger, sync: b.feature });
  gate.release();
  await syncing;
  // Onboarding saves the planner's settings again (the hours chosen), and today opens.
  b.store.writeJSON('daily-planner:settings', { startHour: 9, onboardingComplete: true });
  // Connect again: the copy's own seal (its passphrase entered), Google's access.
  await b.protection.adopt(b.seal);
  b.google.token = true;
  b.storage.setItem('daily-planner-sync:cloud', 'google');
  b.ledger.saveProvider({ connected: true }, 'google');
  const again = await b.feature.syncNow({ interactive: true, reason: 'connect' });
  assert.equal(again?.status, 'ok', 'no conflict to settle: nothing of this browser’s own');
  assert.ok(!again.pushed.includes('settings'), 'the reset browser never sends its new settings over the copy’s');
  assert.deepEqual(JSON.parse(b.store.get('daily-planner:settings')).horizon, SETTINGS.horizon, 'the copy’s settings come back');
  assert.equal(DAYS.filter(day => b.store.get(`daily-planner:${day}`) != null).length, DAYS.length, 'and every day');
  b.feature.destroy();
});

test('F1, another tab: its sync reading the copy while tab A resets stops, pulls nothing back, and that tab stands down as it hears the Reset', async () => {
  const a = await connectedBrowser(null);
  const gate = makeGate('read');
  const googleB = driveOver(a.file, gate);
  const protectionB = createSyncProtection({ storage: a.storage, keyStore: createMemoryKeyStore(), now: NOW });
  await protectionB.adopt(a.seal);
  const windowB = { listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, removeEventListener() {} };
  const b = tabOver(a.storage, { google: googleB, protection: protectionB, windowRef: windowB });
  gate.armed = true;
  const syncingB = b.feature.syncNow({ interactive: true });
  await gate.atGate;
  const before = a.storage.getItem(GENERATION_KEY);
  await resetLocalData({ store: a.store, ledger: a.ledger, sync: a.feature });
  // Tab B hears the Reset (the storage event of its new generation).
  for (const fn of windowB.listeners.storage || []) fn({ key: GENERATION_KEY, oldValue: before, newValue: a.storage.getItem(GENERATION_KEY) });
  await tick();
  assert.equal(googleB.token, false, 'tab B forgets the access');
  assert.equal(protectionB.current(), null, 'and the seal’s key');
  gate.release();
  assert.equal(await syncingB, null);
  await a.store.ready();
  const after = summary(a);
  assert.deepEqual([after.days, after.connected, after.ledger, after.provider], [0, false, null, null], 'no day back, sync off, nothing written');
  assert.equal(a.storage.getItem('daily-planner:settings'), null);
  assert.equal(b.feature.getState().connected, false);
  a.feature.destroy();
  b.feature.destroy();
});

test('F1, a tab of 1.39 (its own code): what it commits after the Reset counts for nothing, is discarded at the next start, and never turns sync on nor deletes from the copy', async () => {
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: NOW });
  const store = createDayStore(storage, { archive: createMemoryArchive(), onMutation: ledger.recordMutation, ledgerDays: () => ledger.dayMarks(), forgetDays: days => ledger.forgetDays(days) });
  for (const day of DAYS) store.writeJSON(`daily-planner:${day}`, { focus: `Planned ${day}` });
  await resetLocalData({ store, ledger, sync: { forgetHere: async () => '' } });
  // The older tab's sync, begun before the Reset, finishes after it: its ledger (bases for every day, no tombstone),
  // its cloud marked connected, and its access, all with its own (1.39.3) code.
  const older = ledger139.createSyncLedger(storage, { now: NOW });
  for (const day of DAYS) older.markSynced(`day:${day}`, { hash: `h-${day}` });
  older.saveProvider({ connected: true, lastSyncedAt: NOW().toISOString(), lastError: '' }, 'google');
  storage.setItem('daily-planner-sync:google-access', JSON.stringify({ value: 'token-from-the-older-tab', expiresAt: Date.now() + 3600000 }));
  const fresh = createSyncLedger(storage, { now: NOW });
  assert.equal(fresh.provider('google').connected, false, 'not connected, whatever it wrote');
  assert.deepEqual(fresh.read().records, {}, 'no base');
  assert.equal(fresh.stale(), true);
  // The next start of 1.40.1: discarded, with that access.
  const google = driveOver({ text: null, writes: 0 });
  const tab = tabOver(storage, { google, protection: createSyncProtection({ storage, keyStore: createMemoryKeyStore(), now: NOW }) });
  await tab.feature.load();
  assert.equal(storage.getItem('daily-planner-sync:ledger'), null);
  assert.equal(storage.getItem('daily-planner-sync:google'), null);
  assert.equal(google.token, false, 'its access forgotten');
  assert.equal(tab.feature.getState().connected, false);
  assert.equal(await tab.feature.syncNow({ interactive: true }), null, 'no sync runs');
  tab.feature.destroy();
});

test('F1, engine: a sync begun before the Reset stops at its next step with code “reset”, and its ledger session never commits', async () => {
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: NOW });
  const store = createDayStore(storage, { archive: createMemoryArchive(), onMutation: ledger.recordMutation, ledgerDays: () => ledger.dayMarks(), forgetDays: days => ledger.forgetDays(days) });
  store.writeJSON('daily-planner:2026-11-10', { focus: 'one' });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const provider = { read: async () => { await held; return { exists: false }; }, write: async () => { throw new Error('never written'); } };
  const syncing = createSyncEngine({ store, ledger, now: NOW }).sync(provider);
  await tick();
  const session = ledger.session();
  session.markSynced('day:2026-11-10', { hash: 'h' });
  ledger.reset();
  release();
  await assert.rejects(syncing, error => error.code === 'reset');
  assert.equal(session.commit(), false, 'a session begun before the Reset writes nothing');
  assert.equal(storage.getItem('daily-planner-sync:ledger'), null);
});

test('F2, the conflict card: it names the settings, and with no day of this browser’s own, keeping the copy is the main button', async () => {
  const a = await connectedBrowser(null);
  // Another browser, no day of its own, settings shaped by hand (so not fresh): its first connection stops on them.
  const storage = new MemoryStorage();
  const protection = createSyncProtection({ storage, keyStore: createMemoryKeyStore(), now: NOW });
  await protection.adopt(a.seal);
  storage.setItem('daily-planner-sync:google', JSON.stringify({ connected: true, fileId: '', lastSyncedAt: '', lastError: '' }));
  storage.setItem('daily-planner-sync:cloud', 'google');
  const c = tabOver(storage, { google: driveOver(a.file), protection });
  c.store.writeJSON('daily-planner:settings', { startHour: 6, closeDayCount: 3 });
  const result = await c.feature.syncNow({ interactive: true });
  assert.equal(result?.status, 'conflict');
  assert.deepEqual(c.feature.getState().conflicts, ['settings']);
  c.feature.render();
  assert.equal(el.detail.textContent, 'Your settings differ between this device and your copy.', 'the settings, named');
  assert.equal(el['use-remote'].className, 'primary-button', 'nothing of its own here: keeping the copy is the main choice');
  assert.equal(el['keep-local'].className, 'secondary-button');
  // A first connection with a day of its own too: both sides hold something real, so the two choices weigh the same,
  // and each says what it keeps and what it replaces (pass 2).
  c.store.writeJSON('daily-planner:2026-11-09', { focus: 'My own day' });
  c.feature.render();
  assert.deepEqual([el['use-remote'].className, el['keep-local'].className], ['secondary-button', 'secondary-button']);
  assert.match(el['use-remote'].innerHTML, /<span>Use Google Drive<\/span><small>Keeps what is in Google Drive, and replaces this device’s version<\/small>/);
  assert.match(el['keep-local'].innerHTML, /<span>Keep this device<\/span><small>Keeps this device’s version, and replaces the one in Google Drive and on your other devices<\/small>/);
  assert.equal(el['conflict-actions'].classList.contains('is-even'), true);
  c.feature.destroy();
  a.feature.destroy();
});

test('N2 (the second review’s full-reset proof): Reset in a browser full to its last character still forgets the cloud’s access and the seal, and names the cloud', async () => {
  const b = await connectedBrowser(null, new FullStorage());
  b.storage.quota = b.storage.used();
  const result = await resetLocalData({ store: b.store, ledger: b.ledger, sync: b.feature });
  assert.equal(result.cloud, 'Google Drive', 'Reset says which cloud it turned off');
  assert.equal(b.google.token, false, 'the cloud’s access forgotten');
  assert.equal(b.storage.getItem('daily-planner-sync:protection'), null, 'the seal forgotten');
  assert.equal(b.protection.current(), null);
  assert.equal(b.feature.getState().connected, false);
  assert.equal(b.storage.getItem('daily-planner-sync:ledger'), null);
  assert.ok(b.storage.getItem(GENERATION_KEY), 'and the generation written, once there was room');
  assert.equal(DAYS.filter(day => b.store.get(`daily-planner:${day}`) != null).length, 0);
  b.feature.destroy();
});

test('N2: the ledger removes its keys before it writes the generation, and with no room even then, it leaves none rather than an old one', () => {
  const storage = new FullStorage();
  const ledger = createSyncLedger(storage, { now: NOW });
  storage.setItem(GENERATION_KEY, 'before');
  ledger.saveProvider({ connected: true }, 'google');
  storage.quota = storage.used();
  ledger.reset();
  assert.ok(storage.getItem(GENERATION_KEY) && storage.getItem(GENERATION_KEY) !== 'before', 'the provider state’s room is enough for it');
  // Nothing at all to remove, and no room: no generation, so what was stamped with the old one counts for nothing.
  const tight = new FullStorage();
  const other = createSyncLedger(tight, { now: NOW });
  tight.setItem(GENERATION_KEY, 'x');
  tight.quota = tight.used();
  assert.throws(() => other.reset());
  assert.equal(tight.getItem(GENERATION_KEY), null);
});
