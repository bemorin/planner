import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BLOCKED_NOTICE, createMemoryStorage, ensureStorage, readableStorage } from '../src/state/browser-storage.js';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const denied = () => { throw new Error('SecurityError: Failed to read the \'localStorage\' property from \'Window\': Access is denied for this document.'); };

/** A window whose storages throw when read, as with cookies and site data blocked. */
function blockedWindow() {
  const win = {};
  Object.defineProperty(win, 'localStorage', { configurable: true, get: denied });
  Object.defineProperty(win, 'sessionStorage', { configurable: true, get: denied });
  return win;
}

test('the memory storage behaves like localStorage', () => {
  const storage = createMemoryStorage();
  assert.equal(storage.length, 0);
  assert.equal(storage.getItem('daily-planner:settings'), null);
  storage.setItem('daily-planner:settings', { toString: () => '{"a":1}' });
  storage.setItem(42, 7);
  assert.equal(storage.getItem('daily-planner:settings'), '{"a":1}');
  assert.equal(storage.getItem('42'), '7', 'keys and values are strings');
  assert.equal(storage.length, 2);
  assert.deepEqual([storage.key(0), storage.key(1), storage.key(2)], ['daily-planner:settings', '42', null]);
  storage.removeItem('42');
  assert.equal(storage.length, 1);
  storage.clear();
  assert.equal(storage.length, 0);
});

test('blocked storage is replaced by memory for the page, and said so', () => {
  const win = blockedWindow();
  assert.equal(readableStorage(win, 'localStorage'), null);
  const { localStorage, blocked } = ensureStorage(win);
  assert.equal(blocked, true);
  assert.equal(win.localStorage, localStorage, 'every module reading globalThis.localStorage gets it');
  assert.doesNotThrow(() => win.sessionStorage.getItem('daily-planner-ui:entrance-seen'));
  assert.notEqual(win.sessionStorage, win.localStorage);
  // The planner's own stores work on it for the session.
  const store = createLocalStore(localStorage);
  const ledger = createSyncLedger(localStorage);
  assert.equal(store.writeJSON('daily-planner:2026-10-21', { focus: 'Ship 1.30' }), true);
  assert.deepEqual(store.readJSON('daily-planner:2026-10-21'), { focus: 'Ship 1.30' });
  assert.equal(store.canWrite(), true);
  assert.doesNotThrow(() => ledger.recordMutation({ type: 'set', key: 'daily-planner:2026-10-21' }));
  // Nothing is lost if it runs again: the memory storage is readable, so it stays.
  assert.equal(ensureStorage(win).localStorage, localStorage);
});

test('storage switched off (null, as Firefox has it) is replaced too', () => {
  const win = { localStorage: null, sessionStorage: null };
  const { localStorage, blocked } = ensureStorage(win);
  assert.equal(blocked, true);
  assert.equal(typeof localStorage.setItem, 'function');
  assert.equal(win.localStorage, localStorage);
});

test('working storage is left as it is, even one that is full', () => {
  const real = createMemoryStorage();
  const session = createMemoryStorage();
  const win = { localStorage: real, sessionStorage: session };
  assert.deepEqual(ensureStorage(win), { localStorage: real, blocked: false });
  assert.equal(win.localStorage, real);
  assert.equal(win.sessionStorage, session);
  // A full storage reads fine but refuses writes: not “blocked”, the usual warning says it (store.canWrite).
  const full = { ...createMemoryStorage(), getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.deepEqual(ensureStorage({ localStorage: full, sessionStorage: session }), { localStorage: full, blocked: false });
  assert.equal(createLocalStore(full).canWrite(), false);
});

test('a storage that throws on use, not on access, counts as blocked', () => {
  const win = { localStorage: { getItem: denied, setItem: denied }, sessionStorage: createMemoryStorage() };
  const { localStorage, blocked } = ensureStorage(win);
  assert.equal(blocked, true);
  assert.doesNotThrow(() => localStorage.getItem('x'));
});

test('the planner boots on it, and the one notice says plans won’t be kept', () => {
  const app = read('app.js');
  const iife = app.indexOf('(() => {');
  const ensure = app.indexOf('ensureStorage(window)');
  assert.ok(iife > 0 && ensure > iife && ensure < app.indexOf('createSyncLedger('), 'before anything reads storage');
  assert.match(app, /createSyncLedger\(browserStorage\)/);
  assert.match(app, /createLocalStore\(browserStorage, \{/);
  assert.doesNotMatch(app, /window\.localStorage/, 'app.js never reads the browser’s storage directly');
  assert.match(app, /const available = !storageBlocked && store\.canWrite\('daily-planner:'\);/);
  assert.match(app, /openModal\(warning, qs\('\[data-modal-close\]\.primary-button', warning\), \{ stack: true \}\)/, 'over first-run setup, focus on Continue');
  const html = read('index.html');
  assert.match(html, /<h2 id="storage-warning-title">[^<]+<\/h2>\s*<p data-storage-warning-text>/);
  assert.match(html, /data-storage-warning-modal[\s\S]*?<button class="primary-button" type="button" data-modal-close>Continue<\/button>/);
  // Calm, plain English, the codebase’s typography.
  assert.match(BLOCKED_NOTICE.title, /^This browser won’t keep your plans\.$/);
  assert.match(BLOCKED_NOTICE.text, /^Cookies and site data are blocked for this site/);
  assert.match(BLOCKED_NOTICE.text, /closed or reloaded/);
  assert.match(BLOCKED_NOTICE.text, /export a backup/);
  assert.doesNotMatch(`${BLOCKED_NOTICE.title} ${BLOCKED_NOTICE.text}`, /['"!]/, 'curly apostrophes, no exclamation');
  assert.ok(read('sw.js').includes("'./src/state/browser-storage.js'"), 'offline too');
});
