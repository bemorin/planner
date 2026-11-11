import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { CLOUDS, SyncAuthRequiredError, SyncRemoteChangedError, base64url, createPkcePair, pkceChallenge, providerProblems, randomToken } from '../src/sync/cloud.js';
import { createGoogleDriveProvider } from '../src/sync/google-drive.js';
import { DROPBOX_APP_KEY_RE, DROPBOX_AUTH_KEY, DROPBOX_AUTHORIZE_URL, DROPBOX_SCOPES, DROPBOX_TOKEN_URL, PENDING_MS, createDropboxProvider, dropboxRedirectUri, headerArg, readOAuthReturn } from '../src/sync/dropbox.js';

class MemoryStorage {
  #data = new Map();
  getItem(key) { return this.#data.has(key) ? this.#data.get(key) : null; }
  setItem(key, value) { this.#data.set(key, String(value)); }
  removeItem(key) { this.#data.delete(key); }
}

const APP_KEY = 'abcd1234efgh567';
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** A pretend Dropbox: the token endpoint, the file download and upload, revocation. Every request is kept. */
function fakeDropbox({ file = null, expiresIn = 14_400, refuseRefresh = false } = {}) {
  const requests = [];
  let tokenCount = 0;
  let rev = 1;
  const state = { file, valid: new Set(), refreshFails: refuseRefresh };
  async function fetchImpl(url, init = {}) {
    const headers = init.headers || {};
    const request = { url, method: init.method, headers, body: init.body };
    requests.push(request);
    if (url === DROPBOX_TOKEN_URL) {
      const form = new URLSearchParams(init.body);
      request.form = Object.fromEntries(form);
      if (form.get('grant_type') === 'refresh_token' && (state.refreshFails || form.get('refresh_token') !== 'refresh-1')) return json({ error: 'invalid_grant' }, 400);
      if (form.get('grant_type') === 'authorization_code' && form.get('code') !== 'good-code') return json({ error: 'invalid_grant' }, 400);
      tokenCount += 1;
      const token = `access-${tokenCount}`;
      state.valid.add(token);
      return json({ access_token: token, expires_in: expiresIn, token_type: 'bearer', ...(form.get('grant_type') === 'authorization_code' ? { refresh_token: 'refresh-1', account_id: 'dbid:1' } : {}) });
    }
    const bearer = String(headers.Authorization || '').replace('Bearer ', '');
    if (!state.valid.has(bearer)) return json({ error_summary: 'expired_access_token/' }, 401);
    if (url.endsWith('/auth/token/revoke')) { state.valid.delete(bearer); return json(null); }
    const arg = JSON.parse(headers['Dropbox-API-Arg'] || '{}');
    if (url.endsWith('/files/download')) {
      if (!state.file) return json({ error_summary: 'path/not_found/..' }, 409);
      return new Response(state.file.text, { status: 200, headers: { 'Dropbox-API-Result': JSON.stringify({ rev: state.file.rev, path_lower: arg.path }) } });
    }
    if (url.endsWith('/files/upload')) {
      const mode = arg.mode?.['.tag'];
      if (mode === 'update' && state.file?.rev !== arg.mode.update) return json({ error_summary: 'path/conflict/file/..' }, 409);
      if (mode === 'add' && state.file) return json({ error_summary: 'path/conflict/file/..' }, 409);
      rev += 1;
      state.file = { text: String(init.body), rev: `rev${rev}` };
      return json({ rev: state.file.rev, path_lower: arg.path });
    }
    return json({ error_summary: 'unknown' }, 400);
  }
  return { fetchImpl, requests, state, get tokenCount() { return tokenCount; } };
}

function provider({ fake = fakeDropbox(), storage = new MemoryStorage(), clock = { t: Date.parse('2026-11-10T09:00:00Z') }, href = 'https://planner.bemorin.com/' } = {}) {
  const dropbox = createDropboxProvider({ appKey: APP_KEY, fetchImpl: fake.fetchImpl, storage, now: () => clock.t, href: () => href });
  return { dropbox, fake, storage, clock };
}

async function connected(options = {}) {
  const setup = provider(options);
  const url = new URL(await setup.dropbox.beginAuthorization());
  const result = await setup.dropbox.completeAuthorization({ code: 'good-code', state: url.searchParams.get('state') });
  assert.deepEqual(result, { ok: true });
  return { ...setup, url };
}

test('both clouds answer the same calls (the provider interface of src/sync/cloud.js)', () => {
  const google = createGoogleDriveProvider({ clientId: 'client.apps.googleusercontent.com', oauth2: {} });
  const { dropbox } = provider();
  assert.deepEqual(providerProblems(google), []);
  assert.deepEqual(providerProblems(dropbox), []);
  assert.equal(google.signIn, 'popup');
  assert.equal(dropbox.signIn, 'redirect');
  assert.deepEqual(Object.keys(CLOUDS), ['google', 'dropbox']);
  assert.equal(CLOUDS.dropbox.folder, 'your Dropbox’s Apps folder', 'the folder is named by the App Console, never spelled out');
  assert.deepEqual(providerProblems({ id: 'dropbox', configured: true, signIn: 'redirect', readText() {}, hasUsableToken() {}, clearToken() {} }), ['missing writeText()', 'missing beginAuthorization() or completeAuthorization()']);
  assert.deepEqual(providerProblems(null), ['not a provider']);
  assert.ok(providerProblems({ id: 'onedrive', configured: 'yes', signIn: 'tab', readText() {}, writeText() {}, hasUsableToken() {}, clearToken() {} }).length === 3);
});

test('PKCE: S256 as another implementation computes it, a verifier of 64 URL-safe characters, never the same twice', async () => {
  const verifier = 'dBjftJeZ4CVP-mJ92K9KC33tFh1Z4dMFm2IyhkBkVlE';
  assert.equal(await pkceChallenge(verifier), createHash('sha256').update(verifier).digest('base64url'));
  const pair = await createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(pair.method, 'S256');
  assert.equal(pair.challenge, await pkceChallenge(pair.verifier));
  assert.notEqual((await createPkcePair()).verifier, pair.verifier);
  assert.equal(base64url(new Uint8Array([251, 255, 254])), '-__-', 'no + / or padding');
  assert.match(randomToken(24), /^[A-Za-z0-9_-]{32}$/);
});

test('Connect Dropbox: its page with PKCE, offline access, exactly the three file permissions, back to the planner’s root', async () => {
  const { dropbox, storage } = provider({ href: 'https://planner.bemorin.com/index.html?view=week#today' });
  const url = new URL(await dropbox.beginAuthorization());
  assert.equal(`${url.origin}${url.pathname}`, DROPBOX_AUTHORIZE_URL);
  const query = Object.fromEntries(url.searchParams);
  assert.deepEqual(Object.keys(query).sort(), ['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'response_type', 'scope', 'state', 'token_access_type']);
  assert.equal(query.client_id, APP_KEY);
  assert.equal(query.response_type, 'code');
  assert.equal(query.redirect_uri, 'https://planner.bemorin.com/');
  assert.equal(query.code_challenge_method, 'S256');
  assert.equal(query.token_access_type, 'offline');
  assert.equal(query.scope, 'files.metadata.read files.content.read files.content.write');
  assert.deepEqual([...DROPBOX_SCOPES], ['files.metadata.read', 'files.content.read', 'files.content.write']);
  const pending = JSON.parse(storage.getItem(DROPBOX_AUTH_KEY)).pending;
  assert.equal(pending.state, query.state);
  assert.equal(await pkceChallenge(pending.verifier), query.code_challenge, 'the verifier stays here; only its challenge goes');
  assert.ok(!url.href.includes(pending.verifier));
  assert.equal(dropbox.hasUsableToken(), false, 'nothing usable until Dropbox answers');
});

test('the redirect URI is the origin plus /: production, and localhost on any port', () => {
  assert.equal(dropboxRedirectUri('https://planner.bemorin.com/'), 'https://planner.bemorin.com/');
  assert.equal(dropboxRedirectUri('https://planner.bemorin.com/index.html?license=x#week'), 'https://planner.bemorin.com/');
  assert.equal(dropboxRedirectUri('http://localhost:8600/?start'), 'http://localhost:8600/');
  assert.equal(dropboxRedirectUri('not a url'), '');
  assert.deepEqual(readOAuthReturn('https://planner.bemorin.com/?code=abc&state=xyz'), { code: 'abc', state: 'xyz', error: '' });
  assert.deepEqual(readOAuthReturn('https://planner.bemorin.com/?error=access_denied&state=xyz'), { code: '', state: 'xyz', error: 'access_denied' });
  assert.equal(readOAuthReturn('https://planner.bemorin.com/?code=abc'), null, 'no state: not an answer');
  assert.equal(readOAuthReturn('https://planner.bemorin.com/?license=DP1.x'), null);
});

test('back from Dropbox: the code is traded once, with the verifier, for tokens kept on this device', async () => {
  const { dropbox, fake, storage, url } = await connected();
  const exchange = fake.requests.find(request => request.url === DROPBOX_TOKEN_URL);
  assert.equal(exchange.method, 'POST');
  assert.equal(exchange.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(exchange.form.grant_type, 'authorization_code');
  assert.equal(exchange.form.code, 'good-code');
  assert.equal(exchange.form.client_id, APP_KEY);
  assert.equal(exchange.form.redirect_uri, 'https://planner.bemorin.com/');
  assert.equal(await pkceChallenge(exchange.form.code_verifier), url.searchParams.get('code_challenge'));
  assert.ok(!('client_secret' in exchange.form), 'no secret: PKCE');
  const auth = JSON.parse(storage.getItem(DROPBOX_AUTH_KEY));
  assert.equal(auth.refreshToken, 'refresh-1');
  assert.equal(auth.accessToken, 'access-1');
  assert.equal(auth.pending, undefined, 'the verifier is gone once used');
  assert.equal(dropbox.hasUsableToken(), true);
  // The same answer again (a reload, Back): not this device's sign-in any more.
  assert.deepEqual(await dropbox.completeAuthorization({ code: 'good-code', state: url.searchParams.get('state') }), { ok: false, reason: 'stale' });
});

test('an answer that isn’t this sign-in, too old, or refused never connects', async () => {
  const { dropbox, clock } = provider();
  const url = new URL(await dropbox.beginAuthorization());
  const state = url.searchParams.get('state');
  assert.equal(dropbox.ownsReturn({ state: 'someone-else' }), false);
  assert.equal(dropbox.ownsReturn({ state }), true);
  assert.deepEqual(await dropbox.completeAuthorization({ code: 'good-code', state: 'someone-else' }), { ok: false, reason: 'stale' });
  clock.t += PENDING_MS + 1;
  assert.deepEqual(await dropbox.completeAuthorization({ code: 'good-code', state }), { ok: false, reason: 'stale' });
  assert.equal(dropbox.hasUsableToken(), false);

  const denied = provider();
  const deniedState = new URL(await denied.dropbox.beginAuthorization()).searchParams.get('state');
  assert.deepEqual(await denied.dropbox.completeAuthorization({ error: 'access_denied', state: deniedState }), { ok: false, reason: 'denied' });
  const bad = provider();
  const badState = new URL(await bad.dropbox.beginAuthorization()).searchParams.get('state');
  assert.deepEqual(await bad.dropbox.completeAuthorization({ code: 'wrong-code', state: badState }), { ok: false, reason: 'failed' });
  assert.equal(bad.dropbox.hasUsableToken(), false);
});

test('token refresh: an expired token is renewed once for concurrent calls, then used', async () => {
  const { dropbox, fake, clock } = await connected({ fake: fakeDropbox({ file: { text: 'hello', rev: 'rev1' } }) });
  clock.t += 4 * 3_600_000; // the four hours are over
  assert.equal(dropbox.hasUsableToken(), true, 'the refresh token still lets sync run without a tap');
  const [a, b] = await Promise.all([dropbox.readText(), dropbox.readText()]);
  assert.equal(a.text, 'hello');
  assert.equal(b.version, 'rev1');
  const refreshes = fake.requests.filter(request => request.form?.grant_type === 'refresh_token');
  assert.equal(refreshes.length, 1, 'single flight');
  assert.equal(refreshes[0].form.refresh_token, 'refresh-1');
  assert.equal(refreshes[0].form.client_id, APP_KEY);
  assert.ok(fake.requests.filter(request => request.url.endsWith('/files/download')).every(request => request.headers.Authorization === 'Bearer access-2'));
});

test('a token refused before its end is renewed once, and the call made again', async () => {
  const { dropbox, fake } = await connected({ fake: fakeDropbox({ file: { text: 'x', rev: 'rev1' } }) });
  fake.state.valid.clear(); // Dropbox forgot the token early
  const read = await dropbox.readText();
  assert.equal(read.text, 'x');
  assert.equal(fake.requests.filter(request => request.form?.grant_type === 'refresh_token').length, 1);
});

test('a refused refresh token (access removed in Dropbox) forgets the tokens and asks for Reconnect', async () => {
  const { dropbox, fake, clock, storage } = await connected();
  fake.state.refreshFails = true;
  clock.t += 5 * 3_600_000;
  await assert.rejects(() => dropbox.readText(), error => error instanceof SyncAuthRequiredError && error.code === 'auth-required');
  assert.equal(dropbox.hasUsableToken(), false);
  const auth = JSON.parse(storage.getItem(DROPBOX_AUTH_KEY) || '{}');
  assert.equal(auth.refreshToken, undefined);
  assert.equal(auth.accessToken, undefined);
});

test('offline: the refresh fails without losing the tokens', async () => {
  const { dropbox, clock, storage } = await connected();
  const offline = createDropboxProvider({ appKey: APP_KEY, fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, storage, now: () => clock.t + 5 * 3_600_000 });
  await assert.rejects(() => offline.readText(), /No connection to Dropbox/);
  assert.equal(JSON.parse(storage.getItem(DROPBOX_AUTH_KEY)).refreshToken, 'refresh-1');
  assert.equal(dropbox.hasUsableToken(), true);
});

test('the one file: none yet, read with its revision, written over that revision only', async () => {
  const { dropbox, fake } = await connected();
  assert.deepEqual(await dropbox.readText(), { exists: false, fileId: '', version: '', text: '' });
  const created = await dropbox.writeText('first', { exists: false });
  const upload = fake.requests.at(-1);
  assert.equal(upload.url, 'https://content.dropboxapi.com/2/files/upload');
  assert.deepEqual(JSON.parse(upload.headers['Dropbox-API-Arg']), { path: '/daily-planner-sync.json', mode: { '.tag': 'add' }, autorename: false, mute: true });
  const read = await dropbox.readText();
  assert.deepEqual(read, { exists: true, fileId: '/daily-planner-sync.json', version: created.version, text: 'first' });
  await dropbox.writeText('second', { version: read.version });
  assert.deepEqual(JSON.parse(fake.requests.at(-1).headers['Dropbox-API-Arg']).mode, { '.tag': 'update', update: read.version });
  // Another device wrote meanwhile: the stale revision is refused.
  await assert.rejects(() => dropbox.writeText('third', { version: read.version }), error => error instanceof SyncRemoteChangedError);
  await assert.rejects(() => dropbox.writeText('again', { exists: false }), error => error instanceof SyncRemoteChangedError);
  assert.equal(fake.state.file.text, 'second');
});

test('Disconnect gives the access back to Dropbox and forgets it here', async () => {
  const { dropbox, fake, storage } = await connected();
  dropbox.clearToken();
  assert.equal(storage.getItem(DROPBOX_AUTH_KEY), null);
  assert.equal(dropbox.hasUsableToken(), false);
  await new Promise(resolve => setTimeout(resolve, 0));
  const revoke = fake.requests.find(request => request.url === 'https://api.dropboxapi.com/2/auth/token/revoke');
  assert.equal(revoke?.headers.Authorization, 'Bearer access-1');
  await assert.rejects(() => dropbox.readText(), error => error.code === 'auth-required');
});

test('the app key: only its form is used; anything else hides Dropbox', () => {
  assert.ok(DROPBOX_APP_KEY_RE.test('abcd1234efgh567'));
  for (const bad of ['', ' ', 'ABCD1234EFGH567', 'abcd-1234', 'short', 'a'.repeat(40)]) {
    const dropbox = createDropboxProvider({ appKey: bad, storage: new MemoryStorage(), fetchImpl: async () => { throw new Error('no request'); } });
    assert.equal(dropbox.configured, false, bad);
    assert.equal(dropbox.hasUsableToken(), false);
  }
  assert.equal(headerArg({ path: '/café.json' }), '{"path":"/caf\\u00e9.json"}', 'Dropbox-API-Arg stays ASCII');
});

test('a token just renewed and refused again (401): the refresh token goes too, so Reconnect takes the person to Dropbox', async () => {
  const { dropbox, fake, storage } = await connected({ fake: fakeDropbox({ file: { text: 'x', rev: 'rev1' } }) });
  // Dropbox now refuses every token it gives (the app's access was cut short on its side).
  fake.state.valid = { has: () => false, add() {}, delete() {}, clear() {} };
  await assert.rejects(() => dropbox.readText(), error => error instanceof SyncAuthRequiredError);
  assert.equal(fake.requests.filter(request => request.form?.grant_type === 'refresh_token').length, 1, 'renewed once, not in a loop');
  assert.equal(dropbox.hasUsableToken(), false, 'Reconnect goes to Dropbox’s page');
  const auth = JSON.parse(storage.getItem(DROPBOX_AUTH_KEY) || '{}');
  assert.equal(auth.refreshToken, undefined);
  assert.equal(auth.accessToken, undefined);
  await assert.rejects(() => dropbox.readText(), error => error instanceof SyncAuthRequiredError);
  assert.equal(fake.requests.filter(request => request.form?.grant_type === 'refresh_token').length, 1, 'and never again');
});

test('the account id Dropbox sends with the tokens is not kept: nothing uses it', async () => {
  const { storage } = await connected();
  const auth = JSON.parse(storage.getItem(DROPBOX_AUTH_KEY));
  assert.equal('accountId' in auth, false);
  assert.ok(!JSON.stringify(auth).includes('dbid:'));
});
