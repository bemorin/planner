import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument } from './support/fake-dom.js';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';

// Settings → Personal sync, wired (1.38): the choice, Google's access, the switch to Dropbox, and the small API
// the header alert reads. The DOM is a stand-in (tests/support/fake-dom.js); the clouds are fakes.

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
  '[data-personal-sync-primary]', '[data-personal-sync-disconnect]', '[data-personal-sync-access]', '[data-personal-sync-access-text]', '[data-personal-sync-meter]',
  '[data-personal-sync-folder]', '[data-personal-sync-folder-text]', '[data-personal-sync-trade]', '[data-personal-sync-switch]', '[data-personal-sync-switch-open]',
  '[data-personal-sync-switch-confirm]', '[data-personal-sync-switch-cancel]', '[data-personal-sync-switch-go]', '[data-personal-sync-panel]', '[data-personal-sync-seal]',
  '[data-personal-sync-recovery]', '[data-personal-sync-conflict-actions]', '[data-personal-sync-conflict-copy]', '[data-personal-sync-keep-local]', '[data-personal-sync-use-remote]'
];

const doc = fakeDocument();
const el = {};
for (const selector of SELECTORS) el[selector === '[data-personal-sync]' ? 'root' : selector.slice(20, -1)] = doc.make(selector);
const settingsModal = doc.make('[data-settings-modal]');
settingsModal.className = 'modal';
settingsModal.hidden = true;
el.root.parent = settingsModal;
for (const value of ['dropbox', 'google']) {
  const radio = doc.createElement('input');
  radio.name = '[data-personal-sync-cloud]';
  radio.value = value;
  el.choice.append(radio);
}
globalThis.document = doc;

const { createPersonalSyncFeature } = await import('../src/features/personal-sync.js');

function clouds(calls) {
  const google = {
    id: 'google', name: 'Google Drive', signIn: 'popup', configured: true, token: false, until: 0,
    hasUsableToken() { return this.token; },
    accessEndsAt() { return this.token ? this.until : 0; },
    prepare: async () => { calls.push('google.prepare'); },
    authorizeInteractive() { calls.push('google.authorize'); return new Promise(() => {}); },
    rememberAccount: async () => '',
    clearToken() { calls.push('google.clearToken'); this.token = false; },
    readText: async () => { calls.push('google.read'); return { exists: false, fileId: '', version: '', text: '' }; },
    writeText: async () => { calls.push('google.write'); return { id: 'f', version: '' }; }
  };
  const dropbox = {
    id: 'dropbox', name: 'Dropbox', signIn: 'redirect', configured: true,
    hasUsableToken: () => false,
    beginAuthorization: async () => { calls.push('dropbox.begin'); return 'https://www.dropbox.com/oauth2/authorize?client_id=abc'; },
    ownsReturn: () => false,
    completeAuthorization: async () => ({ ok: false, reason: 'stale' }),
    clearToken: () => calls.push('dropbox.clearToken'),
    readText: async () => { calls.push('dropbox.read'); return { exists: false }; },
    writeText: async () => { calls.push('dropbox.write'); return { id: '/f', version: '' }; }
  };
  return { google, dropbox };
}

function setup({ connectedGoogle = false, dirty = false, lastSyncedAt = '2026-11-10T14:58:00.000Z', configured = ['google', 'dropbox'], clock = new Date('2026-11-10T16:20:00.000Z'), archive = null } = {}) {
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage, { now: () => new Date(clock) });
  // `archive`: the day store's ready() and status() (1.40), over the same local store.
  const store = { ...createLocalStore(storage, { onMutation: ledger.recordMutation }), ...(archive || {}) };
  if (connectedGoogle) storage.setItem('daily-planner-sync:google', JSON.stringify({ connected: true, fileId: 'f', lastSyncedAt, lastError: '' }));
  if (dirty) {
    store.writeJSON('daily-planner:2026-11-10', { focus: 'Waiting' });
    store.writeJSON('daily-planner:2026-11-09', { focus: 'Also waiting' });
  }
  const calls = [];
  const fakes = clouds(calls);
  const assigned = [];
  const intervals = [];
  const feature = createPersonalSyncFeature({
    store,
    ledger,
    googleClientId: 'client',
    dropboxAppKey: 'abcd1234efgh567',
    flushLocal: async () => { calls.push('flush'); },
    now: () => new Date(clock),
    providerFactories: { google: () => (configured.includes('google') ? fakes.google : { configured: false }), dropbox: () => (configured.includes('dropbox') ? fakes.dropbox : { configured: false }) },
    protection: { load: async () => null, current: () => ({ salt: 'kept-key' }), offerDismissed: () => false, keptInMemoryOnly: () => false, forget: async () => { calls.push('forget-key'); }, wasSealed: () => true },
    recoveryStore: { count: async () => 0, latest: async () => null },
    timers: { set: () => 1, clear: () => {}, every: (fn, ms) => { intervals.push({ fn, ms, on: true }); return intervals.length; }, stop: id => { intervals[id - 1].on = false; } },
    Observer: class { constructor(fn) { setup.observed = fn; } observe() {} disconnect() {} },
    documentRef: doc,
    windowRef: null,
    locationRef: { href: 'http://localhost:8640/', assign: url => assigned.push(url) },
    historyRef: null,
    whenShown: fn => fn()
  });
  feature.render();
  return { storage, ledger, store, feature, calls, fakes, assigned, intervals };
}

test('not connected, both clouds: the choice, Dropbox first unless the device named Google Drive', () => {
  const fresh = setup();
  assert.equal(el.choice.hidden, false);
  assert.equal(el.card.hidden, true, 'the cards stand in for the card');
  assert.deepEqual(el.choice.children.map(radio => [radio.value, radio.checked]), [['dropbox', true], ['google', false]]);
  assert.equal(el['choice-connect'].textContent, 'Connect Dropbox');
  assert.equal(el['choice-note'].textContent, 'Both are free and carry the same sealed copy. You can switch later.');
  assert.equal(el.lead.textContent.startsWith('Keep your devices in step through your own cloud.'), true);
  assert.equal(fresh.calls.includes('google.prepare'), false, 'nothing reaches Google before its first Connect');
  fresh.feature.destroy();
});

test('a device that synced with Google Drive before keeps it chosen', () => {
  const storage = new MemoryStorage();
  storage.setItem('daily-planner-sync:google', JSON.stringify({ connected: false, fileId: 'f', lastSyncedAt: '2026-10-01T08:00:00.000Z', lastError: '' }));
  const ledger = createSyncLedger(storage);
  assert.equal(ledger.chosenCloud(), 'google');
  assert.equal(createSyncLedger(new MemoryStorage()).chosenCloud(), '', 'nothing named: Dropbox comes first');
  storage.setItem('daily-planner-sync:cloud', 'dropbox');
  assert.equal(ledger.chosenCloud(), 'dropbox');
});

test('one cloud only: no cards, its own card, with Google’s trade-off in one line', () => {
  const only = setup({ configured: ['google'] });
  assert.equal(el.choice.hidden, true);
  assert.equal(el.card.hidden, false);
  assert.equal(el.trade.hidden, false, 'Google alone says the hour');
  assert.equal(el.primary.innerHTML, '<span>Connect Google Drive</span>');
  only.feature.destroy();
  const dropbox = setup({ configured: ['dropbox'] });
  assert.equal(el.trade.hidden, true);
  dropbox.feature.destroy();
});

test('Google’s token kept from within the hour: startup syncs by itself, without any sign-in', async () => {
  const h = setup({ connectedGoogle: true, dirty: true });
  h.fakes.google.token = true;
  h.fakes.google.until = Date.parse('2026-11-10T16:55:00.000Z');
  await h.feature.load();
  assert.ok(h.calls.includes('google.read'), 'the sync ran');
  assert.ok(!h.calls.includes('google.authorize'), 'no window was asked for');
  assert.ok(h.calls.includes('google.prepare'), 'Google’s sign-in loaded ahead, for a later Reconnect');
  h.feature.destroy();
});

test('getState() and subscribe(): what the header alert reads', async () => {
  const h = setup({ connectedGoogle: true, dirty: true });
  const seen = [];
  const stop = h.feature.subscribe(state => seen.push(state));
  await h.feature.load();
  const state = h.feature.getState();
  assert.deepEqual(
    [state.configured, state.cloud, state.connected, state.reconnect, state.dirty, state.dirtyCount, state.lastSyncedAt, state.need, state.conflicts],
    [true, 'google', true, true, true, 2, '2026-11-10T14:58:00.000Z', '', 0]
  );
  assert.ok(seen.length > 0, 'told at each change');
  stop();
  const count = seen.length;
  h.feature.render();
  assert.equal(seen.length, count, 'unsubscribed');
  assert.equal(el.card.dataset.tone, 'wait');
  assert.match(el.status.textContent, /^Not saved to Google Drive since /);
  assert.match(el.detail.textContent, /^2 changes made since then are safe on this device\. Google ended access after an hour; one tap sends them\.$/);
  assert.match(el.primary.innerHTML, /^<svg[^]*<span>Reconnect and save<\/span>$/);
  assert.equal(el.primary.classList.contains('primary-button'), true);
  assert.equal(el.dot.dataset.tone, 'wait');
  h.feature.destroy();
});

test('reconnect(): Google’s window is asked for within the call, before anything is awaited', async () => {
  const h = setup({ connectedGoogle: true, dirty: true });
  await h.feature.load();
  h.calls.length = 0;
  h.feature.reconnect();
  assert.deepEqual(h.calls, ['google.authorize'], 'requestAccessToken is reached synchronously; the flush comes after');
  h.feature.destroy();
});

test('Switch to Dropbox: confirmed inline, Dropbox’s sign-in started, Google Drive still connected until Dropbox has synced', async () => {
  const h = setup({ connectedGoogle: true, dirty: true });
  await h.feature.load();
  assert.equal(el.switch.hidden, false, 'offered while Google’s access ended with changes waiting');
  assert.equal(el['switch-confirm'].hidden, true);
  await el['switch-open'].click();
  assert.equal(el['switch-confirm'].hidden, false);
  assert.equal(el['switch-open'].getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement, el['switch-go']);
  await el['switch-cancel'].click();
  assert.equal(el['switch-confirm'].hidden, true, 'Cancel closes it');
  assert.equal(doc.activeElement, el['switch-open']);
  await el['switch-open'].click();
  h.calls.length = 0;
  // Google's window for the renewal, closed: the switch goes on (the marker is covered in personal-sync-switch.test.js).
  h.fakes.google.authorizeInteractive = () => { h.calls.push('google.authorize'); return Promise.reject(new Error('The Google window was closed.')); };
  await el['switch-go'].click();
  assert.deepEqual(h.calls.filter(call => call !== 'flush'), ['google.authorize', 'dropbox.begin'], 'Google’s access asked for inside the tap, then Dropbox’s page; nothing read or written in Drive');
  assert.deepEqual(h.assigned, ['https://www.dropbox.com/oauth2/authorize?client_id=abc']);
  assert.equal(h.ledger.provider('google').connected, true, 'still connected: Dropbox hasn’t signed in yet');
  assert.equal(h.ledger.provider('dropbox').switchingFrom, 'google', 'the switch waits for Dropbox’s answer');
  assert.equal(h.ledger.provider('google').lastSyncedAt, '2026-11-10T14:58:00.000Z', 'what it knew of the Drive copy stays');
  assert.deepEqual(h.store.readJSON('daily-planner:2026-11-10'), { focus: 'Waiting' }, 'the planner here is untouched');
  assert.equal(h.ledger.hasDirty(), true, 'the changes still wait, for Dropbox');
  assert.ok(!h.calls.includes('forget-key'), 'the key stays: the Dropbox copy is sealed with the same passphrase');
  h.feature.destroy();
});

test('no switch without Dropbox, and none while nothing waits', async () => {
  const google = setup({ connectedGoogle: true, dirty: true, configured: ['google'] });
  await google.feature.load();
  assert.equal(el.switch.hidden, true);
  google.feature.destroy();
  const clean = setup({ connectedGoogle: true });
  await clean.feature.load();
  assert.equal(el.switch.hidden, true);
  assert.equal(el.card.dataset.tone, 'neutral');
  assert.match(el.status.textContent, /^Up to date as of /);
  clean.feature.destroy();
});

test('while Settings is open, the card is drawn again every minute; closed, the timer stops', async () => {
  // The label is this device's clock: the times are built from local date parts, so any time zone reads 16:55.
  const h = setup({ connectedGoogle: true, clock: new Date(2026, 10, 10, 16, 20) });
  h.fakes.google.token = true;
  h.fakes.google.until = new Date(2026, 10, 10, 16, 55).getTime();
  await h.feature.load();
  assert.equal(el.access.hidden, false, 'Google’s access row shows');
  assert.match(el['access-text'].innerHTML, /^Google access until <strong>16:55<\/strong> · then a tap reconnects$/);
  assert.equal(el.meter.style.getPropertyValue('--share'), String(Math.round((35 / 60) * 1000) / 1000), 'the share of the hour left');
  settingsModal.hidden = false;
  setup.observed();
  assert.equal(h.intervals.length, 1);
  assert.deepEqual([h.intervals[0].ms, h.intervals[0].on], [60_000, true]);
  settingsModal.hidden = true;
  setup.observed();
  assert.equal(h.intervals[0].on, false);
  h.feature.destroy();
});

test('sync waits for the older days (1.40): it runs once they are read, and not at all while they can’t be', async () => {
  let open;
  const loading = new Promise(resolve => { open = resolve; });
  const h = setup({ connectedGoogle: true, dirty: true, archive: { ready: () => loading, status: () => 'loading' } });
  h.fakes.google.token = true;
  h.fakes.google.until = Date.parse('2026-11-10T16:55:00.000Z');
  const started = h.feature.load();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(!h.calls.includes('google.read'), 'nothing read from the copy while the older days load');
  assert.ok(!h.calls.includes('flush'));
  open('ready');
  await started;
  assert.ok(h.calls.includes('google.read'), 'then the sync runs');
  h.feature.destroy();
  // Unavailable: no sync at all, asked for or not. Lost: none by itself; one asked for brings back what is missing.
  for (const [status, interactive] of [['unavailable', true], ['unavailable', false], ['lost', false]]) {
    const waiting = setup({ connectedGoogle: true, dirty: true, archive: { ready: async () => status, status: () => status } });
    waiting.fakes.google.token = true;
    waiting.fakes.google.until = Date.parse('2026-11-10T16:55:00.000Z');
    assert.equal(await waiting.feature.syncNow({ interactive, reason: interactive ? 'manual' : 'idle' }), null, status);
    assert.ok(!waiting.calls.includes('google.read') && !waiting.calls.includes('google.write'), `${status}: the copy is left alone`);
    assert.match(el.detail.textContent, status === 'lost' ? /missing from this browser’s database, so sync waits/ : /isn’t answering right now, so sync waits/);
    waiting.feature.destroy();
  }
  let settled = 0;
  const lost = setup({ connectedGoogle: true, dirty: true, archive: { ready: async () => 'lost', status: () => 'lost', settle: () => { settled += 1; } } });
  lost.fakes.google.token = true;
  lost.fakes.google.until = Date.parse('2026-11-10T16:55:00.000Z');
  await lost.feature.syncNow({ interactive: true, reason: 'manual' });
  assert.ok(lost.calls.includes('google.read'), 'Sync now runs, to bring back what the copy has');
  lost.feature.destroy();
  // (The stand-in seal here can't finish a sync: what follows one is read in the source.)
  const source = (await import('node:fs')).readFileSync(new URL('../src/features/personal-sync.js', import.meta.url), 'utf8');
  assert.match(source, /const result = await runEngineSync\(conflictResolution, \{ restoreMissing: archive === 'lost' \}\);\n\s*if \(!live\(\)\) return null;\n\s*\/\/[^\n]*\n\s*if \(archive === 'lost' && result\?\.status === 'ok' && !result\.refused\?\.length\) await store\.settle\?\.\(\);/, 'then, all of it stored, what is still missing is no longer waited for');
  assert.equal(settled, 0);
});

test('Reset local data (1.40.1): forgetHere() turns sync off in this browser, as in a new one, and never touches the copy', async () => {
  const h = setup({ connectedGoogle: true, dirty: true });
  h.storage.setItem('daily-planner-sync:cloud', 'google');
  h.storage.setItem('daily-planner-sync:protection', JSON.stringify({ salt: 'abc', iterations: 1 }));
  assert.equal(h.feature.getState().connected, true);
  h.calls.length = 0;
  assert.equal(await h.feature.forgetHere(), 'Google Drive', 'the cloud it was connected to, for nothing else to say');
  assert.ok(h.calls.includes('google.clearToken') && h.calls.includes('dropbox.clearToken'), 'both clouds’ access forgotten');
  assert.ok(h.calls.includes('forget-key'), 'the seal’s key material forgotten');
  assert.deepEqual(h.calls.filter(call => /\.(read|write)$/.test(call)), [], 'the copy never read nor written');
  for (const name of ['daily-planner-sync:ledger', 'daily-planner-sync:google', 'daily-planner-sync:dropbox', 'daily-planner-sync:cloud']) assert.equal(h.storage.getItem(name), null, name);
  assert.equal(h.feature.getState().connected, false);
  assert.equal(h.feature.getState().dirtyCount, 0);
  assert.equal(await h.feature.syncNow({ interactive: true }), null, 'and no sync runs after it');
  assert.deepEqual(h.calls.filter(call => /\.(read|write)$/.test(call)), []);
  // Not connected: nothing to name.
  const idle = setup();
  assert.equal(await idle.feature.forgetHere(), '');
  idle.feature.destroy();
  h.feature.destroy();
  const source = (await import('node:fs')).readFileSync(new URL('../src/features/personal-sync.js', import.meta.url), 'utf8');
  assert.match(source, /if \(busy \|\| connecting \|\| resetting\) return null;/, 'none starts while it runs');
  // 1.40.1 fix pass: no wait; the ledger's new generation first, so whatever began before stops at its next step.
  // Pass 2 (N2): the keys before the generation, and the connection forgotten whatever happens.
  assert.match(source, /resetting = true;\n\s*try \{\n(?:\s*\/\/[^\n]*\n)*\s*try \{ ledger\.reset\(\); \} catch \(_\) \{\}\n\s*\} finally \{\n\s*await forgetConnection\(\);/);
});
