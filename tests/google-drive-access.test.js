import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_ACCESS_KEY, GOOGLE_ACCOUNT_KEY, GOOGLE_MARGIN_MS, GoogleAuthRequiredError, createGoogleDriveProvider } from '../src/sync/google-drive.js';
import { createLocalStore } from '../src/state/local-store.js';
import { buildPlannerBackup } from '../src/state/planner-backup.js';
import { plannerRecordIds } from '../src/sync/records.js';

// Google's access kept on the device until it runs out, and the account for login_hint (1.38).

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

class RefusingStorage {
  getItem() { throw new Error('SecurityError'); }
  setItem() { throw new Error('QuotaExceededError'); }
  removeItem() { throw new Error('SecurityError'); }
}

/** Google Identity Services, as the provider uses it: what each request asked for, and the answer it gets. */
function fakeGis({ answer = () => ({ access_token: 'token-from-gis', expires_in: 3600 }) } = {}) {
  const requests = [];
  let callback = null;
  return {
    requests,
    initTokenClient(config) {
      callback = config.callback;
      return { requestAccessToken(options) { requests.push(options); queueMicrotask(() => callback(answer())); } };
    }
  };
}

const clock = (start = Date.parse('2026-11-10T14:00:00.000Z')) => {
  let at = start;
  return { now: () => at, advance: ms => { at += ms; } };
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a token Google gives is kept on the device as { value, expiresAt }', async () => {
  const storage = new MemoryStorage();
  const time = clock();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage, now: time.now });
  await provider.authorizeInteractive();
  assert.deepEqual(JSON.parse(storage.getItem(GOOGLE_ACCESS_KEY)), { value: 'token-from-gis', expiresAt: time.now() + 3_600_000 });
  assert.equal(provider.hasUsableToken(), true);
  assert.equal(provider.accessEndsAt(), time.now() + 3_600_000 - GOOGLE_MARGIN_MS, 'a tap is needed a minute before it runs out');
});

test('opened again within the hour: the kept token is restored and used, with no sign-in', async () => {
  const storage = new MemoryStorage();
  const time = clock();
  storage.setItem(GOOGLE_ACCESS_KEY, JSON.stringify({ value: 'kept-token', expiresAt: time.now() + 20 * 60_000 }));
  const gis = fakeGis();
  const seen = [];
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: gis, storage, now: time.now, fetchImpl: async (url, options) => { seen.push(options.headers.Authorization); return json(200, { files: [] }); } });
  assert.equal(provider.hasUsableToken(), true, 'hasUsableToken() reflects the restored token: startup sync runs by itself');
  assert.deepEqual(await provider.readText(), { exists: false, fileId: '', version: '', text: '' });
  assert.deepEqual(seen, ['Bearer kept-token']);
  await provider.authorizeInteractive();
  assert.equal(gis.requests.length, 0, 'a usable token: Reconnect opens nothing');
  assert.equal(provider.interactiveAuthCalls, 0);
});

test('a kept token with a minute or less left is not restored, and goes', () => {
  const storage = new MemoryStorage();
  const time = clock();
  storage.setItem(GOOGLE_ACCESS_KEY, JSON.stringify({ value: 'almost-gone', expiresAt: time.now() + GOOGLE_MARGIN_MS }));
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage, now: time.now });
  assert.equal(provider.hasUsableToken(), false);
  assert.equal(storage.getItem(GOOGLE_ACCESS_KEY), null);
  storage.setItem(GOOGLE_ACCESS_KEY, '{broken');
  assert.equal(createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', storage, now: time.now }).hasUsableToken(), false, 'unreadable: not used');
  assert.equal(storage.getItem(GOOGLE_ACCESS_KEY), null);
});

test('the token goes when it runs out, and the next sync needs a tap', async () => {
  const storage = new MemoryStorage();
  const time = clock();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage, now: time.now, fetchImpl: async () => json(200, { files: [] }) });
  await provider.authorizeInteractive();
  time.advance(3_600_000 - GOOGLE_MARGIN_MS - 1000);
  assert.equal(provider.hasUsableToken(), true);
  time.advance(1000);
  assert.equal(provider.hasUsableToken(), false);
  assert.equal(provider.accessEndsAt(), 0);
  assert.equal(storage.getItem(GOOGLE_ACCESS_KEY), null, 'run out: forgotten on the device');
  await assert.rejects(() => provider.readText(), error => error instanceof GoogleAuthRequiredError);
});

test('a 401 from Drive forgets the token at once; the account stays for Reconnect', async () => {
  const storage = new MemoryStorage();
  const time = clock();
  storage.setItem(GOOGLE_ACCESS_KEY, JSON.stringify({ value: 'revoked-elsewhere', expiresAt: time.now() + 30 * 60_000 }));
  storage.setItem(GOOGLE_ACCOUNT_KEY, 'user@example.com');
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage, now: time.now, fetchImpl: async () => json(401, { error: { message: 'Invalid Credentials' } }) });
  await assert.rejects(() => provider.readText(), error => error instanceof GoogleAuthRequiredError && error.code === 'auth-required');
  assert.equal(provider.hasUsableToken(), false);
  assert.equal(storage.getItem(GOOGLE_ACCESS_KEY), null);
  assert.equal(storage.getItem(GOOGLE_ACCOUNT_KEY), 'user@example.com');
  await assert.rejects(() => provider.writeText('x', { fileId: 'file_1' }), error => error instanceof GoogleAuthRequiredError);
});

test('Disconnect (clearToken) forgets the token and the account', async () => {
  const storage = new MemoryStorage();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage });
  await provider.authorizeInteractive();
  storage.setItem(GOOGLE_ACCOUNT_KEY, 'user@example.com');
  provider.clearToken();
  assert.equal(provider.hasUsableToken(), false);
  assert.equal(storage.getItem(GOOGLE_ACCESS_KEY), null);
  assert.equal(storage.getItem(GOOGLE_ACCOUNT_KEY), null);
  assert.equal(provider.account(), '');
});

test('storage that refuses: the token and the account live in memory, for the open page', async () => {
  const time = clock();
  const provider = createGoogleDriveProvider({
    clientId: 'client.apps.googleusercontent.com',
    oauth2: fakeGis(),
    storage: new RefusingStorage(),
    now: time.now,
    fetchImpl: async url => (url.includes('/about') ? json(200, { user: { emailAddress: 'user@example.com' } }) : json(200, { files: [] }))
  });
  assert.equal(provider.hasUsableToken(), false);
  await provider.authorizeInteractive();
  assert.equal(provider.hasUsableToken(), true, 'kept in memory');
  assert.equal(await provider.rememberAccount(), 'user@example.com');
  assert.equal(provider.account(), 'user@example.com');
  time.advance(3_600_000);
  assert.equal(provider.hasUsableToken(), false, 'and it runs out there too');
  provider.clearToken();
  assert.equal(provider.account(), '');
});

test('a token another tab kept is used here too', () => {
  const storage = new MemoryStorage();
  const time = clock();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', storage, now: time.now });
  assert.equal(provider.hasUsableToken(), false);
  storage.setItem(GOOGLE_ACCESS_KEY, JSON.stringify({ value: 'other-tab', expiresAt: time.now() + 50 * 60_000 }));
  assert.equal(provider.hasUsableToken(), true);
});

test('after Connect, the account is read from Drive once and kept; Reconnect passes it as login_hint', async () => {
  const storage = new MemoryStorage();
  const gis = fakeGis();
  const urls = [];
  const time = clock();
  const provider = createGoogleDriveProvider({
    clientId: 'client.apps.googleusercontent.com',
    oauth2: gis,
    storage,
    now: time.now,
    fetchImpl: async url => { urls.push(url); return json(200, { user: { emailAddress: 'user@example.com' } }); }
  });
  await provider.authorizeInteractive();
  assert.deepEqual(gis.requests[0], { prompt: '' }, 'no account known yet: Google asks which one');
  assert.equal(await provider.rememberAccount(), 'user@example.com');
  assert.deepEqual(urls, ['https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)'], 'Drive’s about, for the address only');
  assert.equal(storage.getItem(GOOGLE_ACCOUNT_KEY), 'user@example.com');
  assert.equal(await provider.rememberAccount(), 'user@example.com');
  assert.equal(urls.length, 1, 'read once');
  time.advance(3_600_000);
  await provider.authorizeInteractive();
  assert.deepEqual(gis.requests[1], { prompt: '', login_hint: 'user@example.com' }, 'Reconnect: Google’s window picks the account by itself');
});

test('an account Drive refuses to tell is skipped, quietly', async () => {
  const storage = new MemoryStorage();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage, fetchImpl: async () => json(403, { error: { message: 'Insufficient Permission' } }) });
  await provider.authorizeInteractive();
  assert.equal(await provider.rememberAccount(), '');
  assert.equal(storage.getItem(GOOGLE_ACCOUNT_KEY), null);
  assert.equal(provider.hasUsableToken(), true, 'a refusal of the address is no reason to drop the access');
  const odd = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage, fetchImpl: async () => json(200, { user: { emailAddress: 'not an address' } }) });
  await odd.authorizeInteractive();
  assert.equal(await odd.rememberAccount(), '');
  assert.equal(storage.getItem(GOOGLE_ACCOUNT_KEY), null);
});

test('prepared ahead, the tap reaches requestAccessToken at once, before anything is awaited', async () => {
  const gis = fakeGis();
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: gis, storage: new MemoryStorage() });
  await provider.prepare();
  const flight = provider.authorizeInteractive();
  assert.equal(gis.requests.length, 1, 'called synchronously within the tap: the browser keeps the window');
  await flight;
  assert.equal(provider.hasUsableToken(), true);
});

test('Google’s window closed or refused: no token is kept, and the reason is said', async () => {
  const storage = new MemoryStorage();
  const refused = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis({ answer: () => ({ error: 'access_denied' }) }), storage });
  await assert.rejects(() => refused.authorizeInteractive(), /access wasn’t given/);
  assert.equal(storage.getItem(GOOGLE_ACCESS_KEY), null);
  const unticked = createGoogleDriveProvider({
    clientId: 'client.apps.googleusercontent.com',
    oauth2: { ...fakeGis(), hasGrantedAllScopes: () => false, initTokenClient: fakeGis().initTokenClient },
    storage
  });
  await assert.rejects(() => unticked.authorizeInteractive(), /hidden folder in your Drive/);
  assert.equal(storage.getItem(GOOGLE_ACCESS_KEY), null, 'without the folder’s permission: nothing kept');
});

test('neither key goes into a backup, the synced records or an export', () => {
  const storage = new MemoryStorage();
  const store = createLocalStore(storage);
  store.writeJSON('daily-planner:settings', { startHour: 8 });
  store.writeJSON('daily-planner:2026-11-10', { focus: 'Ship' });
  storage.setItem(GOOGLE_ACCESS_KEY, JSON.stringify({ value: 'secret-token', expiresAt: Date.now() + 3_600_000 }));
  storage.setItem(GOOGLE_ACCOUNT_KEY, 'user@example.com');
  const backup = JSON.stringify(buildPlannerBackup(store));
  assert.doesNotMatch(backup, /secret-token|user@example\.com|google-access|google-account/);
  assert.deepEqual(plannerRecordIds(store), ['day:2026-11-10', 'settings'], 'the sync carries planner records only');
  assert.ok(!GOOGLE_ACCESS_KEY.startsWith('daily-planner:') && !GOOGLE_ACCOUNT_KEY.startsWith('daily-planner:'), 'not planner keys: Reset, backups and exports leave them out');
});

// ---- A plain copy sealed into a new file (1.38): its plain text leaves Drive's revision history ----

/** A pretend Drive appDataFolder: list, create, download, upload and delete, every request kept in order. */
function fakeDrive(files = []) {
  const state = { files: files.map((file, index) => ({ modifiedTime: `2026-11-10T08:00:0${index}.000Z`, ...file })), requests: [], made: 0, garble: false, refuseDelete: false };
  const find = id => state.files.find(file => file.id === id);
  async function fetchImpl(url, init = {}) {
    const address = new URL(url);
    const method = init.method || 'GET';
    state.requests.push(`${method} ${address.pathname}`);
    if (address.pathname === '/drive/v3/files' && method === 'GET') {
      assert.match(address.searchParams.get('q'), /^name='daily-planner-sync\.json'/);
      return json(200, { files: state.files.map(({ id, modifiedTime }) => ({ id, name: 'daily-planner-sync.json', modifiedTime })) });
    }
    if (address.pathname === '/drive/v3/files' && method === 'POST') {
      state.made += 1;
      const id = `sealed_${state.made}`;
      state.files.push({ id, text: '', modifiedTime: '2026-11-10T09:00:00.000Z' });
      return json(200, { id });
    }
    const file = address.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
    if (file && method === 'GET') return find(file) ? new Response(state.garble && file.startsWith('sealed_') ? 'cut sho' : find(file).text, { status: 200 }) : json(404, {});
    if (file && method === 'DELETE') {
      if (state.refuseDelete) return json(500, { error: { message: 'Backend error' } });
      state.files = state.files.filter(item => item.id !== file);
      return new Response(null, { status: 204 });
    }
    const upload = address.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)?.[1];
    if (upload && method === 'PATCH') {
      const target = find(upload);
      target.text = String(init.body);
      target.modifiedTime = '2026-11-10T09:00:01.000Z';
      return json(200, { id: upload, modifiedTime: target.modifiedTime });
    }
    return json(404, {});
  }
  return { state, fetchImpl };
}

const PLAIN = JSON.stringify({ app: 'Daily Planner', kind: 'personal-sync', version: 1, updatedAt: '2026-10-01T08:00:00.000Z', records: { 'day:2026-10-01': { hash: 'h', updatedAt: '', deletedAt: null, value: { focus: 'In the clear' } } } });

async function sealingDevice(drive) {
  const { createSyncLedger } = await import('../src/sync/ledger.js');
  const { createSyncEngine } = await import('../src/sync/engine.js');
  const { createMemoryKeyStore } = await import('../src/sync/key-store.js');
  const { createSealedTransport, createSyncProtection } = await import('../src/sync/protection.js');
  const { MIN_ITERATIONS, createSeal } = await import('../src/sync/seal.js');
  const storage = new MemoryStorage();
  const google = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage, fetchImpl: drive.fetchImpl });
  google.setAccessTokenForTests('token');
  const ledger = createSyncLedger(storage);
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const protection = createSyncProtection({ storage, keyStore: createMemoryKeyStore() });
  await protection.adopt(await createSeal('quiet harbour lantern', { iterations: MIN_ITERATIONS }));
  const transport = createSealedTransport({ provider: google, protection });
  return { google, store, sync: () => createSyncEngine({ store, ledger }).sync(transport) };
}

test('sealing a plain copy writes a new file, reads it back, and only then deletes the plain one: the lookup finds one file', async () => {
  const drive = fakeDrive([{ id: 'plain_1', text: PLAIN }]);
  const laptop = await sealingDevice(drive);
  assert.equal((await laptop.sync()).status, 'ok');
  assert.deepEqual(drive.state.files.map(file => file.id), ['sealed_1'], 'exactly one file, the sealed one');
  assert.ok(drive.state.files[0].text.startsWith('daily-planner-sealed/1\n'));
  assert.ok(!drive.state.files[0].text.includes('In the clear'));
  const writes = drive.state.requests.filter(request => !request.startsWith('GET /drive/v3/files ') && request !== 'GET /drive/v3/files');
  assert.deepEqual(writes, [
    'GET /drive/v3/files/plain_1',
    'POST /drive/v3/files',
    'PATCH /upload/drive/v3/files/sealed_1',
    'GET /drive/v3/files/sealed_1',
    'DELETE /drive/v3/files/plain_1'
  ], 'read, a new file, written, checked, then the plain one deleted; the plain file is never written over');
  assert.equal(laptop.store.readJSON('daily-planner:2026-10-01').focus, 'In the clear', 'its days came along');
  const again = await laptop.google.readText();
  assert.equal(again.fileId, 'sealed_1');
  assert.equal((await laptop.sync()).status, 'ok', 'the next sync writes into the sealed file as usual');
});

test('a new file that doesn’t read back as written is deleted, and the plain copy stays as it was', async () => {
  const drive = fakeDrive([{ id: 'plain_1', text: PLAIN }]);
  drive.state.garble = true;
  const laptop = await sealingDevice(drive);
  await assert.rejects(() => laptop.sync(), /didn’t keep the sealed copy/);
  assert.deepEqual(drive.state.files.map(file => [file.id, file.text]), [['plain_1', PLAIN]]);
});

test('two files found (a sealing stopped halfway): the sealed one is used and the plain one deleted; two plain ones stay', async () => {
  const sealedText = 'daily-planner-sealed/1\n{}\n';
  const drive = fakeDrive([{ id: 'plain_1', text: PLAIN }, { id: 'sealed_9', text: sealedText }]);
  const provider = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage: new MemoryStorage(), fetchImpl: drive.fetchImpl });
  provider.setAccessTokenForTests('token');
  const found = await provider.readText();
  assert.deepEqual([found.fileId, found.text], ['sealed_9', sealedText]);
  assert.deepEqual(drive.state.files.map(file => file.id), ['sealed_9']);
  assert.equal((await provider.readText()).fileId, 'sealed_9', 'then exactly one');

  const plain = fakeDrive([{ id: 'plain_1', text: PLAIN }, { id: 'plain_2', text: PLAIN.replace('In the clear', 'Other') }, { id: 'empty_3', text: '' }]);
  const other = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: fakeGis(), storage: new MemoryStorage(), fetchImpl: plain.fetchImpl });
  other.setAccessTokenForTests('token');
  assert.equal((await other.readText()).fileId, 'plain_1');
  assert.deepEqual(plain.state.files.map(file => file.id), ['plain_1', 'plain_2'], 'only the empty file goes beside plain copies');
});

test('the plain file not deleted after the sealed one is written (Drive refused): the next read deletes it', async () => {
  const drive = fakeDrive([{ id: 'plain_1', text: PLAIN }]);
  drive.state.refuseDelete = true;
  const laptop = await sealingDevice(drive);
  assert.equal((await laptop.sync()).status, 'ok');
  assert.deepEqual(drive.state.files.map(file => file.id), ['plain_1', 'sealed_1']);
  drive.state.refuseDelete = false;
  assert.equal((await laptop.google.readText()).fileId, 'sealed_1');
  assert.deepEqual(drive.state.files.map(file => file.id), ['sealed_1']);
});

test('Google’s window blocked: asked for after a late load, a calm line asks for one more tap; asked for within the tap, the pop-up advice', async () => {
  const blocking = { initTokenClient(config) { return { requestAccessToken() { queueMicrotask(() => config.error_callback({ type: 'popup_failed_to_open' })); } }; } };
  const late = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: blocking, storage: new MemoryStorage() });
  await assert.rejects(() => late.authorizeInteractive(), /^Error: Google’s window didn’t open this time\. Tap again: it opens straight away now\.$/);
  await assert.rejects(() => late.authorizeInteractive(), /Your browser blocked Google’s window\. Allow pop-ups for the planner, then try again\./, 'loaded now: asked within the tap');
});
