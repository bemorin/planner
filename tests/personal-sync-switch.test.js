import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument } from './support/fake-dom.js';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { SyncRemoteChangedError } from '../src/sync/cloud.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { PROTECTION_KEY, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, createSeal, openEnvelope, readEnvelope } from '../src/sync/seal.js';

// Personal sync, wired, with the real seal, engine and ledger and pretend clouds (1.38): Switch to Dropbox
// keeps Google Drive until Dropbox has synced, the marker in the Drive copy, site data blocked, Google's sign-in
// loaded on intent, the stale-revision retry, and Disconnect with no cloud left.

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

const FAST = { iterations: MIN_ITERATIONS };
const NAMES = ['lead', 'choice', 'choice-connect', 'choice-note', 'card', 'mark', 'dot', 'status', 'detail', 'primary', 'disconnect', 'access', 'access-text', 'meter',
  'folder', 'folder-text', 'trade', 'switch', 'switch-open', 'switch-confirm', 'switch-cancel', 'switch-go', 'moved', 'moved-go', 'blocked', 'panel', 'seal',
  'recovery', 'conflict-actions', 'conflict-copy', 'keep-local', 'use-remote'];

/** A fresh stand-in DOM for one device (the feature finds its elements in the document current when it starts). */
function dom() {
  const doc = fakeDocument();
  const el = { root: doc.make('[data-personal-sync]') };
  for (const name of NAMES) el[name] = doc.make(`[data-personal-sync-${name}]`);
  el.help = doc.make('[data-storage-sync-line]');
  const modal = doc.make('[data-settings-modal]');
  modal.className = 'modal';
  modal.hidden = true;
  el.root.parent = modal;
  el.radios = {};
  for (const value of ['dropbox', 'google']) {
    const radio = doc.createElement('input');
    radio.name = '[data-personal-sync-cloud]';
    radio.value = value;
    el.choice.append(radio);
    el.radios[value] = radio;
  }
  globalThis.document = doc;
  return { doc, el, modal };
}

/** One file in a cloud, shared by the devices that sync with it. */
const cloudFile = () => ({ text: null, writes: 0, refuseNextWrite: null });
const read = file => (file.text == null ? { exists: false, fileId: '', version: '', text: '' } : { exists: true, fileId: 'the-file', version: `v${file.writes}`, text: file.text });
async function write(file, text) {
  if (file.refuseNextWrite) {
    const meanwhile = file.refuseNextWrite;
    file.refuseNextWrite = null;
    await meanwhile();
    throw new SyncRemoteChangedError();
  }
  file.text = text;
  file.writes += 1;
  return { id: 'the-file', version: `v${file.writes}` };
}

function googleCloud(file, calls) {
  return {
    id: 'google', name: 'Google Drive', signIn: 'popup', configured: true, token: true, prepareFails: false,
    hasUsableToken() { return this.token; },
    accessEndsAt() { return 0; },
    prepare() { calls.push('google.prepare'); return this.prepareFails ? Promise.reject(new Error('offline')) : Promise.resolve(); },
    authorizeInteractive() { calls.push('google.authorize'); this.token = true; return Promise.resolve(true); },
    rememberAccount: async () => '',
    clearToken() { calls.push('google.clearToken'); this.token = false; },
    readText: async () => { calls.push('google.read'); return read(file); },
    writeText: async text => { calls.push('google.write'); return write(file, text); }
  };
}

function dropboxCloud(file, calls) {
  return {
    id: 'dropbox', name: 'Dropbox', signIn: 'redirect', configured: true, signedIn: false, waiting: '',
    hasUsableToken() { return this.signedIn; },
    async beginAuthorization() { calls.push('dropbox.begin'); this.waiting = 'state-1'; return 'https://www.dropbox.com/oauth2/authorize?state=state-1'; },
    ownsReturn(answer) { return !!this.waiting && answer.state === this.waiting; },
    async completeAuthorization(answer) {
      const ours = !!this.waiting && answer.state === this.waiting;
      this.waiting = '';
      if (!ours) return { ok: false, reason: 'stale' };
      if (answer.error) return { ok: false, reason: answer.error === 'access_denied' ? 'denied' : 'failed' };
      this.signedIn = true;
      return { ok: true };
    },
    clearToken() { calls.push('dropbox.clearToken'); this.signedIn = false; },
    readText: async () => { calls.push('dropbox.read'); return read(file); },
    writeText: async text => { calls.push('dropbox.write'); return write(file, text); }
  };
}

/** A device: its storage, planner, ledger and seal; start() opens the planner (again) on `href`. */
function device({ drive, box, seal = null, clouds = ['google', 'dropbox'], storageKept = true, clock = '2026-11-10T10:00:00.000Z' } = {}) {
  const storage = new MemoryStorage();
  const now = () => new Date(clock);
  const ledger = createSyncLedger(storage, { now });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const keyStore = createMemoryKeyStore();
  const protection = createSyncProtection({ storage, keyStore, now });
  const calls = [];
  const google = googleCloud(drive || cloudFile(), calls);
  const dropbox = dropboxCloud(box || cloudFile(), calls);
  const windowEvents = {};
  const assigned = [];
  const reloads = [];
  const opened = [];
  let current = null;
  const d = {
    storage, ledger, store, protection, keyStore, calls, google, dropbox, assigned, reloads, opened, windowEvents,
    get feature() { return current?.feature; },
    get el() { return current?.el; },
    async start(href = 'http://localhost:8670/') {
      current?.feature.destroy();
      if (seal && !protection.current()) await protection.adopt(seal);
      const view = dom();
      const { createPersonalSyncFeature } = await import('../src/features/personal-sync.js');
      const feature = createPersonalSyncFeature({
        store,
        ledger,
        googleClientId: 'client',
        dropboxAppKey: 'abcd1234efgh567',
        storageKept,
        flushLocal: async () => {},
        reloadFromStorage: async () => { reloads.push('reload'); },
        openSettings: () => { opened.push('settings'); },
        now,
        providerFactories: { google: () => (clouds.includes('google') ? google : { configured: false }), dropbox: () => (clouds.includes('dropbox') ? dropbox : { configured: false }) },
        protection,
        recoveryStore: { count: async () => 0, latest: async () => null, save: async () => null },
        timers: { set: () => 1, clear: () => {}, every: () => 1, stop: () => {} },
        Observer: class { constructor(fn) { view.observe = fn; } observe() {} disconnect() {} },
        addEventListener: (target, type, handler) => { if (target === d.windowRef) (windowEvents[type] ||= []).push(handler); },
        documentRef: view.doc,
        windowRef: d.windowRef,
        locationRef: { href, assign: url => assigned.push(url) },
        historyRef: { state: null, replaceState: (state, title, url) => { d.address = url; } },
        whenShown: fn => fn()
      });
      current = { feature, el: view.el, view };
      await feature.load();
      return feature;
    },
    windowRef: { name: 'window' },
    online() { (windowEvents.online || []).forEach(handler => handler()); },
    openSettings() { current.view.modal.hidden = false; current.view.observe(); },
    connectedTo(cloud) {
      ledger.setCloud(cloud);
      ledger.saveProvider({ connected: true, lastError: '' }, cloud);
    }
  };
  return d;
}

/** What a sealed file holds, opened with the seal's key. */
async function opened(file, seal) {
  const { envelope } = readEnvelope(file.text);
  return JSON.parse(await openEnvelope(envelope, seal.key));
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('Switch to Dropbox: Google Drive stays until Dropbox has synced, then the Drive copy gets the marker with this device’s changes, and Google goes', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const drive = cloudFile();
  const box = cloudFile();
  const laptop = device({ drive, box, seal });
  laptop.store.writeJSON('daily-planner:2026-11-09', { focus: 'Agreed on' });
  laptop.connectedTo('google');
  await laptop.start();
  assert.equal(laptop.ledger.provider('google').lastError, '', 'the Drive copy is made');
  const phone = device({ drive, box, seal, clock: '2026-11-10T10:05:00.000Z' });
  phone.connectedTo('google');
  await phone.start();
  assert.deepEqual(phone.store.readJSON('daily-planner:2026-11-09'), { focus: 'Agreed on' });

  // The laptop's hour ends with a change waiting: Switch to Dropbox, confirmed inline.
  await laptop.start();
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Written before the switch' });
  laptop.google.token = false;
  laptop.feature.render();
  assert.equal(laptop.el.switch.hidden, false);
  await laptop.el['switch-open'].click();
  await laptop.el['switch-go'].click();
  assert.deepEqual(laptop.calls.filter(call => /^(google\.authorize|dropbox\.begin)$/.test(call)), ['google.authorize', 'dropbox.begin'], 'Google’s access is renewed inside the tap, then Dropbox’s page');
  assert.deepEqual(laptop.assigned, ['https://www.dropbox.com/oauth2/authorize?state=state-1']);
  assert.ok(!laptop.calls.includes('google.clearToken'), 'Google is kept while Dropbox’s page is open');
  assert.equal(laptop.ledger.provider('google').connected, true);

  // Back from Dropbox, Google's access renewed in the Switch tap is still usable: the marker can be written.
  assert.equal(laptop.google.token, true);
  laptop.calls.length = 0;
  await laptop.start('http://localhost:8670/?code=good&state=state-1');
  assert.equal(laptop.address, '/', 'the code never stays in the address');
  assert.deepEqual(laptop.opened, ['settings']);
  const order = laptop.calls.filter(call => /^(dropbox\.write|google\.write|google\.clearToken)$/.test(call));
  assert.deepEqual(order, ['dropbox.write', 'google.write', 'google.clearToken'], 'Dropbox synced first, then the marker in Drive, then Google goes');
  assert.equal(laptop.feature.cloud, 'dropbox');
  assert.equal(laptop.ledger.provider('google').connected, false);
  assert.equal(laptop.ledger.provider('dropbox').switchingFrom, '');
  const inDrive = await opened(drive, seal);
  assert.equal(inDrive.movedTo, 'dropbox', 'the marker, sealed');
  assert.deepEqual(inDrive.records['day:2026-11-10'].value, { focus: 'Written before the switch' }, 'with the final data');
  const inDropbox = await opened(box, seal);
  assert.deepEqual(inDropbox.records['day:2026-11-10'].value, { focus: 'Written before the switch' }, 'the same passphrase opens the Dropbox copy');
  assert.match(laptop.el.detail.textContent, /Your other devices offer to switch at their next sync with Google Drive\./);

  // The phone, still on Drive: its own change goes first, as usual, then the calm note with Switch.
  phone.store.writeJSON('daily-planner:2026-11-11', { focus: 'Phone, after the move' });
  await phone.start();
  assert.deepEqual(phone.store.readJSON('daily-planner:2026-11-10'), { focus: 'Written before the switch' }, 'the laptop’s last change came through Drive');
  assert.deepEqual((await opened(drive, seal)).records['day:2026-11-11'].value, { focus: 'Phone, after the move' }, 'pushed as usual');
  assert.equal((await opened(drive, seal)).movedTo, 'dropbox', 'the marker stays when the phone writes');
  assert.equal(phone.el.moved.hidden, false, 'Your planner moved to Dropbox. Switch this device too.');
  assert.equal(phone.el.switch.hidden, true, 'one offer at a time');
  assert.equal(phone.feature.getState().moved, 'dropbox');
  await phone.el['moved-go'].click();
  assert.deepEqual(phone.assigned, ['https://www.dropbox.com/oauth2/authorize?state=state-1'], 'Switch: Dropbox’s page; the key stays');
  assert.ok(phone.protection.current(), 'same passphrase: the key is kept');
});

test('back from Dropbox without access during a switch: still on Google Drive, with why', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const laptop = device({ seal });
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Waiting' });
  laptop.connectedTo('google');
  await laptop.start();
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Waiting more' });
  laptop.google.token = false;
  laptop.google.authorizeInteractive = () => Promise.reject(new Error('The Google window was closed.'));
  laptop.feature.render();
  await laptop.el['switch-open'].click();
  await laptop.el['switch-go'].click();
  await laptop.start('http://localhost:8670/?error=access_denied&state=state-1');
  assert.equal(laptop.feature.cloud, 'google');
  assert.equal(laptop.ledger.provider('google').connected, true);
  assert.equal(laptop.ledger.provider('dropbox').connected, false);
  assert.equal(laptop.ledger.provider('dropbox').switchingFrom, '');
  assert.match(laptop.el.detail.textContent, /Dropbox wasn’t connected: access wasn’t allowed\. You’re still syncing with Google Drive\.$/);
  assert.equal(laptop.el.switch.hidden, false, 'the switch can be tried again');
});

test('a switch whose Google window is closed: no marker in Drive, Google goes, and the warning stands', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const drive = cloudFile();
  const laptop = device({ drive, seal });
  laptop.connectedTo('google');
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'x' });
  await laptop.start();
  const before = drive.text;
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'y' });
  laptop.google.token = false;
  laptop.google.authorizeInteractive = () => Promise.reject(new Error('The Google window was closed.'));
  laptop.feature.render();
  await laptop.el['switch-open'].click();
  await laptop.el['switch-go'].click();
  assert.deepEqual(laptop.assigned, ['https://www.dropbox.com/oauth2/authorize?state=state-1'], 'the switch goes on');
  await laptop.start('http://localhost:8670/?code=good&state=state-1');
  assert.equal(drive.text, before, 'Drive untouched');
  assert.equal(laptop.ledger.provider('google').connected, false);
  assert.equal(laptop.feature.cloud, 'dropbox');
  assert.match(laptop.el.detail.textContent, /Your other devices keep using Google Drive until you switch them too\./);
});

test('a first Dropbox sync that asks for a passphrase keeps Google Drive connected until it has run', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const other = await createSeal('another passphrase here', FAST);
  const box = cloudFile();
  // Dropbox holds a copy sealed with another passphrase already.
  const elsewhere = device({ box, seal: other });
  elsewhere.connectedTo('dropbox');
  elsewhere.dropbox.signedIn = true;
  elsewhere.store.writeJSON('daily-planner:2026-11-01', { focus: 'Elsewhere' });
  await elsewhere.start();
  const laptop = device({ box, seal });
  laptop.connectedTo('google');
  await laptop.start();
  laptop.google.token = false;
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Waiting' });
  laptop.feature.render();
  await laptop.el['switch-open'].click();
  await laptop.el['switch-go'].click();
  await laptop.start('http://localhost:8670/?code=good&state=state-1');
  assert.equal(laptop.feature.need?.reason, 'changed');
  assert.equal(laptop.ledger.provider('google').connected, true, 'kept until Dropbox has synced');
  assert.equal(laptop.ledger.provider('dropbox').switchingFrom, 'google');
});

test('site data blocked: Dropbox isn’t offered; one line says why', async () => {
  const both = device({ storageKept: false });
  await both.start();
  assert.equal(both.el.choice.hidden, true, 'one cloud left: no choice');
  assert.equal(both.el.card.hidden, false);
  assert.equal(both.el.primary.innerHTML, '<span>Connect Google Drive</span>');
  assert.equal(both.el.blocked.hidden, false);
  assert.equal(both.el.blocked.textContent, 'Dropbox needs this browser to keep site data.');
  assert.deepEqual(both.feature.clouds, ['google']);
  assert.equal(both.el.help.textContent.includes('Dropbox'), true, 'Help still names what the planner offers');

  const only = device({ storageKept: false, clouds: ['dropbox'] });
  await only.start('http://localhost:8670/?code=x&state=y');
  assert.equal(only.el.root.hidden, false, 'the section says why');
  assert.equal(only.el.blocked.hidden, false);
  assert.equal(only.el.card.hidden, true);
  assert.equal(only.el.choice.hidden, true);
  assert.equal(only.address, '/', 'a return is still taken out of the address');
  assert.ok(!only.calls.includes('dropbox.begin'));

  const kept = device();
  await kept.start();
  assert.equal(kept.el.blocked.hidden, true);
});

test('a Dropbox answer with no sign-in waiting here says it expired, instead of nothing', async () => {
  const d = device();
  await d.start('http://localhost:8670/?code=abc&state=from-another-tab');
  assert.equal(d.address, '/');
  assert.equal(d.el['choice-note'].textContent, 'That Dropbox sign-in had expired. Connect again to finish.');
  assert.deepEqual(d.opened, ['settings']);
  assert.equal(d.ledger.provider('dropbox').connected, false);
});

test('Google’s sign-in loads on intent only: choosing Google Drive, or reaching for its Connect button; never before', async () => {
  const d = device();
  await d.start();
  d.openSettings();
  d.feature.focus();
  assert.ok(!d.calls.includes('google.prepare'), 'nothing reaches Google when Settings opens on the cards');
  await d.el['choice-connect'].dispatch('pointerdown');
  assert.ok(!d.calls.includes('google.prepare'), 'Dropbox chosen: nothing for Google');
  await d.el.choice.dispatch('change', { target: d.el.radios.google });
  assert.equal(d.calls.filter(call => call === 'google.prepare').length, 1, 'Google Drive chosen: its sign-in loads');

  const one = device({ clouds: ['google'] });
  await one.start();
  // Focus moved by the planner itself (Settings opening on the section) is not intent.
  one.el.primary.focus = function focus() { this.doc.activeElement = this; this.dispatch('focusin'); };
  one.openSettings();
  one.feature.focus();
  assert.ok(!one.calls.includes('google.prepare'));
  await one.el.primary.dispatch('focusin');
  assert.equal(one.calls.filter(call => call === 'google.prepare').length, 1, 'focus from the keyboard is');
  await one.el.primary.dispatch('pointerdown');
  assert.equal(one.calls.filter(call => call === 'google.prepare').length, 2, 'and a pointer pressed');
});

test('Google’s sign-in that failed to load (offline) isn’t asked for again until the browser is back online', async () => {
  const d = device({ clouds: ['google'] });
  d.connectedTo('google');
  d.google.token = false;
  d.google.prepareFails = true;
  await d.start();
  await tick();
  const count = () => d.calls.filter(call => call === 'google.prepare').length;
  assert.equal(count(), 1);
  d.feature.prepare();
  d.feature.render();
  d.feature.prepare();
  assert.equal(count(), 1, 'remembered: not requested on every render');
  d.google.prepareFails = false;
  d.online();
  d.feature.prepare();
  assert.equal(count(), 2, 'online again: loaded');
});

test('a stale revision: the retry draws the planner again for what the first attempt applied, and reports no false conflict', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const box = cloudFile();
  const phone = device({ box, seal, clouds: ['dropbox'] });
  phone.connectedTo('dropbox');
  phone.dropbox.signedIn = true;
  phone.store.writeJSON('daily-planner:2026-11-10', { focus: 'v0' });
  await phone.start();
  const laptop = device({ box, seal, clouds: ['dropbox'] });
  laptop.connectedTo('dropbox');
  laptop.dropbox.signedIn = true;
  await laptop.start();
  assert.deepEqual(laptop.store.readJSON('daily-planner:2026-11-10'), { focus: 'v0' });

  phone.store.writeJSON('daily-planner:2026-11-10', { focus: 'v1 from the phone' });
  await phone.feature.syncNow({ interactive: true });
  laptop.store.writeJSON('daily-planner:2026-11-12', { focus: 'Laptop only' });
  // The laptop's write is refused: the phone wrote the same day again meanwhile.
  box.refuseNextWrite = async () => {
    phone.store.writeJSON('daily-planner:2026-11-10', { focus: 'v2 from the phone' });
    await phone.feature.syncNow({ interactive: true });
  };
  laptop.reloads.length = 0;
  const result = await laptop.feature.syncNow({ interactive: true });
  assert.equal(result.status, 'ok', 'no false conflict');
  assert.deepEqual(result.pulled, ['day:2026-11-10']);
  assert.deepEqual(laptop.store.readJSON('daily-planner:2026-11-10'), { focus: 'v2 from the phone' });
  assert.deepEqual((await opened(box, seal)).records['day:2026-11-12'].value, { focus: 'Laptop only' });
  assert.deepEqual(laptop.reloads, ['reload'], 'drawn again once');
});

test('the retry draws the planner again even when only the first attempt applied something', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const box = cloudFile();
  const phone = device({ box, seal, clouds: ['dropbox'] });
  phone.connectedTo('dropbox');
  phone.dropbox.signedIn = true;
  phone.store.writeJSON('daily-planner:2026-11-10', { focus: 'v0' });
  await phone.start();
  const laptop = device({ box, seal, clouds: ['dropbox'] });
  laptop.connectedTo('dropbox');
  laptop.dropbox.signedIn = true;
  await laptop.start();
  phone.store.writeJSON('daily-planner:2026-11-10', { focus: 'v1' });
  await phone.feature.syncNow({ interactive: true });
  laptop.store.writeJSON('daily-planner:2026-11-12', { focus: 'Laptop only' });
  // Meanwhile the phone writes what the laptop is about to send, word for word: the retry has nothing to pull.
  box.refuseNextWrite = async () => {
    phone.store.writeJSON('daily-planner:2026-11-12', { focus: 'Laptop only' });
    await phone.feature.syncNow({ interactive: true });
  };
  laptop.reloads.length = 0;
  const result = await laptop.feature.syncNow({ interactive: true });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.pulled, [], 'the retry itself applied nothing');
  assert.deepEqual(laptop.store.readJSON('daily-planner:2026-11-10'), { focus: 'v1' });
  assert.deepEqual(laptop.reloads, ['reload'], 'what the first attempt applied is drawn');
});

test('Disconnect with no cloud left: the key, its database and daily-planner-sync:protection go', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const d = device({ seal, clouds: ['google'] });
  d.connectedTo('google');
  d.store.writeJSON('daily-planner:2026-11-10', { focus: 'x' });
  await d.start();
  assert.ok(d.storage.getItem(PROTECTION_KEY));
  await d.el.disconnect.click();
  assert.equal(d.storage.getItem(PROTECTION_KEY), null);
  assert.equal(d.keyStore.destroyed, true, 'the IndexedDB database is deleted');
  assert.equal(d.protection.current(), null);
  assert.ok(d.calls.includes('google.clearToken'));
  assert.ok(d.storage.getItem('daily-planner-sync:ledger'), 'what changed since the last sync stays (documented on the cookies page)');
});

test('Disconnect in the middle of a switch leaves no cloud: the one being left goes too', async () => {
  const seal = await createSeal('quiet harbour lantern', FAST);
  const other = await createSeal('another passphrase here', FAST);
  const box = cloudFile();
  const elsewhere = device({ box, seal: other });
  elsewhere.connectedTo('dropbox');
  elsewhere.dropbox.signedIn = true;
  await elsewhere.start();
  const laptop = device({ box, seal });
  laptop.connectedTo('google');
  await laptop.start();
  laptop.google.token = false;
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Waiting' });
  laptop.feature.render();
  await laptop.el['switch-open'].click();
  await laptop.el['switch-go'].click();
  await laptop.start('http://localhost:8670/?code=good&state=state-1');
  assert.equal(laptop.ledger.provider('google').connected, true);
  await laptop.el.disconnect.click();
  assert.equal(laptop.ledger.provider('google').connected, false);
  assert.equal(laptop.ledger.provider('dropbox').connected, false);
  assert.equal(laptop.storage.getItem(PROTECTION_KEY), null);
});

test('Help → Data on this device names the clouds offered, set at runtime; hidden when none', async () => {
  const both = device();
  await both.start();
  assert.equal(both.el.help.hidden, false);
  assert.match(both.el.help.textContent, /your own Dropbox or Google Drive/);
  const google = device({ clouds: ['google'] });
  await google.start();
  assert.doesNotMatch(google.el.help.textContent, /Dropbox/);
  const none = device({ clouds: [] });
  await none.start();
  assert.equal(none.el.help.hidden, true);
  assert.equal(none.el.help.textContent, '');
  assert.equal(none.el.root.hidden, true);
});
