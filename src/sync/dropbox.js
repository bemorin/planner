import { SYNC_FILE_NAME, SyncAuthRequiredError, SyncRemoteChangedError, createPkcePair, randomToken } from './cloud.js';

/**
 * Dropbox, as Personal sync uses it (1.38): the planner's app folder (in the
 * Apps folder of the person's Dropbox, named after the App Console's app), the
 * only folder its access reaches, and one file in it. Sign-in: OAuth 2 with PKCE, no secret, as a
 * top-level visit to Dropbox's page that comes back to the planner with
 * ?code=…&state=… (src/features/personal-sync.js reads and removes them). It
 * asks for offline access: a short-lived token (about four hours) and the
 * refresh token that renews it, both kept on this device
 * (localStorage daily-planner-sync:dropbox-auth) until Disconnect, or until
 * the access is removed in Dropbox. Sync then runs by itself, without a tap.
 */

export const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
export const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
export const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
export const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';
export const DROPBOX_AUTH_KEY = 'daily-planner-sync:dropbox-auth';
/** An App Console app key: lowercase letters and digits (15 today). */
export const DROPBOX_APP_KEY_RE = /^[a-z0-9]{10,32}$/;
/** Exactly what the planner asks Dropbox for: its own folder's files, read and written. No account details. */
export const DROPBOX_SCOPES = Object.freeze(['files.metadata.read', 'files.content.read', 'files.content.write']);
/** A sign-in started here is finished within this long, or started again. */
export const PENDING_MS = 15 * 60_000;
/** A token is put aside a minute before it runs out, so no request is cut off by its end. */
const MARGIN_MS = 60_000;
const SYNC_PATH = `/${SYNC_FILE_NAME}`;

const safeParse = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** Dropbox-API-Arg carries JSON in a header: anything beyond ASCII escaped. */
export const headerArg = value => JSON.stringify(value).replace(/[\u007f-￿]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * Where Dropbox sends the browser back: the planner's root on this origin,
 * `origin + '/'` (https://planner.bemorin.com/ in production,
 * http://localhost:<port>/ in development), with ?code=…&state=… added. It
 * must be one of the Redirect URIs of the App Console, exactly
 * (docs/configuration.md).
 */
export function dropboxRedirectUri(href = globalThis.location?.href || '') {
  try {
    return `${new URL(href).origin}/`;
  } catch {
    return '';
  }
}

/** Dropbox's answer in an address: { code, state, error } when it carries one, else null. */
export function readOAuthReturn(href = globalThis.location?.href || '') {
  try {
    const params = new URL(href).searchParams;
    const state = params.get('state');
    const code = params.get('code');
    const error = params.get('error');
    if (!state || (!code && !error)) return null;
    return { state, code: code || '', error: error || '' };
  } catch {
    return null;
  }
}

class DropboxError extends Error {
  constructor(status, summary, message) {
    super(message);
    this.name = 'DropboxError';
    this.status = status;
    this.summary = summary;
  }
}

function friendlyMessage(status, summary) {
  if (summary.includes('insufficient_space')) return 'Your Dropbox is full. Make some room there, then sync again.';
  if (status === 429) return 'Dropbox asked the planner to slow down. Sync will try again in a moment.';
  return `Dropbox could not finish that (${status}).`;
}

export function createDropboxProvider({
  appKey,
  fetchImpl = (...args) => fetch(...args),
  storage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })(),
  now = () => Date.now(),
  href = () => globalThis.location?.href || '',
  random
} = {}) {
  const key = String(appKey || '').trim();
  const configured = DROPBOX_APP_KEY_RE.test(key);
  let memory = {};
  let refreshing = null;

  const readAuth = () => {
    if (!storage) return memory;
    try { return safeParse(storage.getItem(DROPBOX_AUTH_KEY)) || {}; } catch { return memory; }
  };
  const writeAuth = patch => {
    const next = Object.fromEntries(Object.entries({ ...readAuth(), ...patch }).filter(([, value]) => value != null && value !== ''));
    memory = next;
    try {
      if (Object.keys(next).length) storage?.setItem(DROPBOX_AUTH_KEY, JSON.stringify(next));
      else storage?.removeItem(DROPBOX_AUTH_KEY);
    } catch {}
    return next;
  };
  const accessValid = auth => typeof auth.accessToken === 'string' && !!auth.accessToken && now() < Number(auth.expiresAt || 0) - MARGIN_MS;
  const authRequired = () => new SyncAuthRequiredError('Reconnect Dropbox to continue syncing.');

  /** A token now, or a refresh token to get one: sync can run without a tap. */
  const hasUsableToken = () => {
    if (!configured) return false;
    const auth = readAuth();
    return accessValid(auth) || typeof auth.refreshToken === 'string' && !!auth.refreshToken;
  };

  async function tokenRequest(fields) {
    let response;
    try {
      response = await fetchImpl(DROPBOX_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...fields, client_id: key }).toString() });
    } catch {
      throw new Error('No connection to Dropbox. Your planner keeps working here.');
    }
    const body = await response.json().catch(() => null);
    return { response, body };
  }

  /** The address of Dropbox's page for this sign-in; its state and verifier wait on this device. */
  async function beginAuthorization() {
    if (!configured) throw new Error('Dropbox sync is not configured for this deployment.');
    const { verifier, challenge } = await createPkcePair(random);
    const state = randomToken(24, random);
    const redirectUri = dropboxRedirectUri(href());
    writeAuth({ pending: { state, verifier, redirectUri, createdAt: now() } });
    const query = new URLSearchParams({
      client_id: key,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      scope: DROPBOX_SCOPES.join(' ')
    });
    return `${DROPBOX_AUTHORIZE_URL}?${query}`;
  }

  /** Whether an answer in the address belongs to the sign-in started on this device. */
  function ownsReturn(answer) {
    const pending = readAuth().pending;
    return !!answer && !!pending && pending.state === answer.state;
  }

  /**
   * Back from Dropbox: the code traded for tokens. { ok: true }, or { ok: false, reason }:
   * 'stale' (not this device's sign-in, or too old), 'denied' (access was not given), 'failed'.
   */
  async function completeAuthorization({ code = '', state = '', error = '' } = {}) {
    const pending = readAuth().pending;
    if (!pending || pending.state !== state) return { ok: false, reason: 'stale' };
    writeAuth({ pending: null });
    if (now() - Number(pending.createdAt || 0) > PENDING_MS) return { ok: false, reason: 'stale' };
    if (error) return { ok: false, reason: error === 'access_denied' ? 'denied' : 'failed' };
    if (!code) return { ok: false, reason: 'failed' };
    const { response, body } = await tokenRequest({ code, grant_type: 'authorization_code', code_verifier: pending.verifier, redirect_uri: pending.redirectUri });
    if (!response.ok || typeof body?.access_token !== 'string' || !body.access_token) return { ok: false, reason: 'failed' };
    // Only what sync uses: the account id Dropbox also sends is not kept.
    writeAuth({
      accessToken: body.access_token,
      expiresAt: now() + Math.max(0, Number(body.expires_in) || 14_400) * 1000,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      accountId: null
    });
    return { ok: true };
  }

  /** A new short-lived token from the refresh token, once at a time. Refused: the access was removed; a gesture is needed. */
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const refreshToken = readAuth().refreshToken;
      if (!refreshToken) throw authRequired();
      const { response, body } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      if (response.status === 400 || response.status === 401) {
        writeAuth({ accessToken: null, expiresAt: null, refreshToken: null });
        throw authRequired();
      }
      if (!response.ok || typeof body?.access_token !== 'string' || !body.access_token) throw new Error('Dropbox could not renew the connection. Sync will try again.');
      writeAuth({ accessToken: body.access_token, expiresAt: now() + Math.max(0, Number(body.expires_in) || 14_400) * 1000 });
      return body.access_token;
    })();
    return refreshing.finally(() => { refreshing = null; });
  }

  async function bearer() {
    const auth = readAuth();
    if (accessValid(auth)) return auth.accessToken;
    return refresh();
  }

  async function call(url, init, again = true) {
    if (!configured) throw new Error('Dropbox sync is not configured for this deployment.');
    const token = await bearer();
    let response;
    try {
      response = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch {
      throw new Error('No connection to Dropbox. Your planner keeps working here.');
    }
    if (response.status === 401) {
      // Refused before its end: a new token, once, if there is a way to get one.
      if (again && readAuth().refreshToken) {
        writeAuth({ accessToken: null, expiresAt: null });
        return call(url, init, false);
      }
      // Refused again, with a token just renewed (or no way to renew it): the access is gone. The refresh token goes
      // too, so Reconnect takes the person to Dropbox instead of renewing a token Dropbox refuses, over and over.
      writeAuth({ accessToken: null, expiresAt: null, refreshToken: null });
      throw authRequired();
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const summary = String(body?.error_summary || '');
      if (summary.includes('/conflict')) throw new SyncRemoteChangedError();
      throw new DropboxError(summary.includes('not_found') ? 404 : response.status, summary, friendlyMessage(response.status, summary));
    }
    return response;
  }

  /** The sync file: its text and revision, or { exists: false } when the folder has none (never made, or deleted there). */
  async function readText() {
    let response;
    try {
      response = await call(`${DROPBOX_CONTENT_URL}/files/download`, { method: 'POST', headers: { 'Dropbox-API-Arg': headerArg({ path: SYNC_PATH }) } });
    } catch (error) {
      if (error instanceof DropboxError && error.status === 404) return { exists: false, fileId: '', version: '', text: '' };
      throw error;
    }
    const meta = safeParse(response.headers?.get?.('Dropbox-API-Result'));
    return { exists: true, fileId: SYNC_PATH, version: typeof meta?.rev === 'string' ? meta.rev : '', text: await response.text() };
  }

  /**
   * Writes the sync file. With the revision read, Dropbox refuses a file another device changed
   * meanwhile (SyncRemoteChangedError), as it does a new file when one appeared.
   */
  async function writeText(text, { version = '', exists = true } = {}) {
    const mode = version ? { '.tag': 'update', update: version } : exists ? { '.tag': 'overwrite' } : { '.tag': 'add' };
    const response = await call(`${DROPBOX_CONTENT_URL}/files/upload`, {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': headerArg({ path: SYNC_PATH, mode, autorename: false, mute: true }), 'Content-Type': 'application/octet-stream' },
      body: text
    });
    const meta = await response.json().catch(() => ({}));
    return { id: SYNC_PATH, version: typeof meta?.rev === 'string' ? meta.rev : '' };
  }

  /** Disconnect: the access is given back to Dropbox (best effort) and forgotten here at once. */
  function clearToken() {
    const auth = readAuth();
    writeAuth({ accessToken: null, expiresAt: null, refreshToken: null, accountId: null, pending: null });
    if (!configured || (!auth.accessToken && !auth.refreshToken)) return;
    // Revoking a token Dropbox made from a refresh token revokes the refresh token too.
    (async () => {
      let token = accessValid(auth) ? auth.accessToken : '';
      if (!token && auth.refreshToken) {
        const { response, body } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
        if (response.ok && typeof body?.access_token === 'string') token = body.access_token;
      }
      if (token) await fetchImpl(`${DROPBOX_API_URL}/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    })().catch(() => {});
  }

  return {
    id: 'dropbox',
    name: 'Dropbox',
    signIn: 'redirect',
    configured,
    hasUsableToken,
    beginAuthorization,
    completeAuthorization,
    ownsReturn,
    readText,
    writeText,
    clearToken,
    refresh
  };
}
