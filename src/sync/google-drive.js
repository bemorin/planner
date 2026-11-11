import { SYNC_FILE_NAME, SyncAuthRequiredError } from './cloud.js';
import { SEAL_MAGIC } from './seal.js';

/**
 * Google Drive, as Personal sync uses it: one hidden file in the planner's own
 * appDataFolder (scope drive.appdata), which no other app and no other file
 * can reach. Sign-in is Google Identity Services' token model: a short-lived
 * token (an hour), asked for from a tap, since Google opens a window for it
 * and gives a browser app no way to renew it without one.
 *
 * Kept on this device until it runs out (1.38): the token, as
 * { value, expiresAt } in localStorage `daily-planner-sync:google-access`, so
 * the planner opened again within the hour syncs by itself, as it does while
 * open. It is restored only while more than a minute remains, and goes as soon
 * as it is no use: run out, refused by Drive (401), or Disconnect. With the
 * account's address (`daily-planner-sync:google-account`, read from Drive once
 * connected) as login_hint, Google's window on Reconnect opens and closes by
 * itself. Both stay on this device: never in a backup, an export or the synced
 * copy (their keys aren't `daily-planner:` ones), never sent anywhere but to
 * Google. Storage that refuses them keeps them in memory, for the open page.
 *
 * Google's sign-in script loads once the person shows intent (src/features/personal-sync.js: Google Drive
 * chosen, its Connect button pointed at or focused, or Settings opened while connected), so the tap itself can
 * open Google's window. Tapped before it has loaded, the window is asked for as soon as it has; a browser may
 * block that one, and the planner then asks for one more tap, which opens it at once.
 *
 * Sealing a copy from before 1.38 (plain JSON) writes a new file, checks it, and only then deletes the plain one:
 * Drive keeps a file's earlier revisions, so writing over it would leave the plain text in its history. Two files
 * found (a device stopped between the two steps): the sealed one is used, and the other deleted.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export const GOOGLE_ACCESS_KEY = 'daily-planner-sync:google-access';
export const GOOGLE_ACCOUNT_KEY = 'daily-planner-sync:google-account';
/** A token is put aside a minute before it runs out, so no request is cut off by its end. */
export const GOOGLE_MARGIN_MS = 60_000;
/** What Google gives: an hour. The access meter shows the share of it that remains. */
export const GOOGLE_ACCESS_MS = 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

let gisPromise = null;

function loadGoogleIdentityScript(documentRef = typeof document !== 'undefined' ? document : null) {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!documentRef?.head) return Promise.reject(new Error('Google Identity Services require a document.'));
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const failed = script => {
      // Offline, say: the next tap tries again with a fresh script.
      gisPromise = null;
      script?.remove?.();
      reject(new Error('Google’s sign-in couldn’t load. Check the connection, then try again.'));
    };
    const existing = documentRef.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => failed(existing), { once: true });
      return;
    }
    const script = documentRef.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => failed(script), { once: true });
    documentRef.head.append(script);
  });
  return gisPromise;
}

async function parseJson(response) {
  if (!response.ok) {
    let message = `Google Drive request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body?.error?.message || message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export class GoogleAuthRequiredError extends SyncAuthRequiredError {
  constructor(message = 'Google Drive authorization is required.') {
    super(message);
    this.name = 'GoogleAuthRequiredError';
  }
}

const safeLocalStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function createGoogleDriveProvider({
  clientId,
  fetchImpl = (...args) => fetch(...args),
  documentRef = typeof document !== 'undefined' ? document : null,
  oauth2 = null,
  storage = safeLocalStorage(),
  now = () => Date.now()
} = {}) {
  const cleanClientId = String(clientId || '').trim();
  // The token and the account in memory: what storage holds, or all there is when it refuses them.
  let token = null;
  let memoryAccount = '';
  let client = null;
  let preparing = null;
  let pending = null;
  let authFlight = null;
  let interactiveAuthCalls = 0;
  // The window was asked for once Google's script had loaded, after the tap, not within it.
  let askedLate = false;

  const usable = value => !!value && typeof value.value === 'string' && !!value.value && Number.isFinite(value.expiresAt) && now() < value.expiresAt - GOOGLE_MARGIN_MS;

  /** The token kept on this device (another tab's, or an earlier visit's), while it lasts; one that ran out goes. */
  function kept() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(GOOGLE_ACCESS_KEY);
      if (!raw) return null;
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      const candidate = parsed && { value: parsed.value, expiresAt: Number(parsed.expiresAt) };
      if (usable(candidate)) return candidate;
      storage.removeItem(GOOGLE_ACCESS_KEY);
    } catch {}
    return null;
  }

  /** Keeps the token on this device, or, with null, forgets it. */
  function keep(next) {
    token = next;
    try {
      if (next) storage?.setItem(GOOGLE_ACCESS_KEY, JSON.stringify({ value: next.value, expiresAt: next.expiresAt }));
      else storage?.removeItem(GOOGLE_ACCESS_KEY);
    } catch {
      // Kept in memory only, this time.
    }
  }

  /** The token at hand: the one in memory while it lasts, else one kept on the device (kept() lets a run-out one go). */
  function current() {
    if (usable(token)) return token;
    token = kept();
    return token;
  }

  // Opened again within the hour: the token an earlier visit kept, if more than a minute of it remains.
  current();

  const hasUsableToken = () => !!current();
  const tokenExpiresAt = () => current()?.expiresAt || 0;
  /** When a tap is needed again: a minute before the token runs out, when it stops being used (0: no access now). */
  const accessEndsAt = () => (current() ? current().expiresAt - GOOGLE_MARGIN_MS : 0);

  function account() {
    if (storage) {
      try {
        const stored = storage.getItem(GOOGLE_ACCOUNT_KEY);
        if (stored && EMAIL_RE.test(stored)) return stored;
      } catch {}
    }
    return memoryAccount;
  }

  function keepAccount(address) {
    memoryAccount = address || '';
    try {
      if (address) storage?.setItem(GOOGLE_ACCOUNT_KEY, address);
      else storage?.removeItem(GOOGLE_ACCOUNT_KEY);
    } catch {
      // Kept in memory only, this time.
    }
  }

  function getOauth2() {
    return oauth2 || globalThis.google?.accounts?.oauth2 || null;
  }

  function onToken(response) {
    const waiting = pending;
    pending = null;
    if (response?.error || !response?.access_token) {
      waiting?.reject(new Error(response?.error === 'access_denied' ? 'Google Drive access wasn’t given.' : response?.error_description || response?.error || 'Google authorization was not completed.'));
      return;
    }
    const api = getOauth2();
    if (typeof api?.hasGrantedAllScopes === 'function' && !api.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
      waiting?.reject(new Error('The planner needs its own hidden folder in your Drive to sync. Tick it when Google asks.'));
      return;
    }
    keep({ value: response.access_token, expiresAt: now() + (Number(response.expires_in) || 3600) * 1000 });
    waiting?.resolve();
  }

  function onError(event) {
    const waiting = pending;
    pending = null;
    const type = event?.type || '';
    const blocked = askedLate ? 'Google’s window didn’t open this time. Tap again: it opens straight away now.' : 'Your browser blocked Google’s window. Allow pop-ups for the planner, then try again.';
    waiting?.reject(new Error(type === 'popup_closed' ? 'The Google window was closed before it finished.' : type === 'popup_failed_to_open' ? blocked : 'Google authorization failed.'));
  }

  /**
   * Loads Google's sign-in ahead of the tap, so the tap can open its window at once:
   * a window opened after something was awaited is blocked.
   */
  function prepare() {
    if (client) return Promise.resolve();
    if (!cleanClientId) return Promise.reject(new Error('Google Drive sync is not configured for this deployment.'));
    if (!preparing) {
      preparing = (async () => {
        if (!getOauth2()) await loadGoogleIdentityScript(documentRef);
        const api = getOauth2();
        if (!api?.initTokenClient) throw new Error('Google Identity Services are unavailable.');
        client = api.initTokenClient({ client_id: cleanClientId, scope: DRIVE_SCOPE, callback: onToken, error_callback: onError });
      })().catch(error => {
        preparing = null;
        throw error;
      });
    }
    return preparing;
  }

  /**
   * Explicit user-gesture Connect / Reconnect only: automatic paths never call this, since GIS
   * requestAccessToken can open Google's window even with prompt ''. With the client prepared, the
   * window is asked for now, inside the tap, before anything is awaited. With the account known, it
   * goes as login_hint: Google's window then opens and closes by itself.
   */
  function authorizeInteractive() {
    if (current()) return Promise.resolve(true);
    if (!cleanClientId) return Promise.reject(new Error('Google Drive sync is not configured for this deployment.'));
    if (authFlight) return authFlight;
    const ask = late => new Promise((resolve, reject) => {
      interactiveAuthCalls += 1;
      askedLate = late;
      pending?.reject(new Error('Google authorization was not completed.'));
      pending = { resolve, reject };
      const hint = account();
      // Empty prompt is intentional for an explicit Connect / Reconnect gesture.
      client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: '' });
    });
    // Loaded ahead (the usual case): within the tap. Still loading: as soon as it has, which a browser may block.
    authFlight = (client ? ask(false) : prepare().then(() => ask(true)))
      .then(() => true)
      .finally(() => { authFlight = null; });
    return authFlight;
  }

  function requireUsableToken() {
    const live = current();
    if (live) return live.value;
    throw new GoogleAuthRequiredError('Reconnect Google Drive to continue syncing.');
  }

  /** A Drive request with the token; refused (401): the token goes, and a tap is needed. */
  async function authorizedFetch(url, options = {}) {
    const accessToken = requireUsableToken();
    const response = await fetchImpl(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 401) {
      keep(null);
      throw new GoogleAuthRequiredError('Reconnect Google Drive to continue syncing.');
    }
    return response;
  }

  async function listFiles() {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name='${SYNC_FILE_NAME}' and trashed=false`,
      fields: 'files(id,name,modifiedTime,size)',
      pageSize: '10'
    });
    const response = await authorizedFetch(`${DRIVE_FILES}?${params}`);
    const body = await parseJson(response);
    return (body.files || []).filter(file => file?.id);
  }

  async function download(id) {
    const response = await authorizedFetch(`${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media`);
    if (!response.ok) await parseJson(response);
    return response.text();
  }

  /** Deletes a file of the planner's own folder; best effort (a file already gone is fine). */
  async function removeFile(id) {
    try {
      const response = await authorizedFetch(`${DRIVE_FILES}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return response.ok || response.status === 404;
    } catch (error) {
      if (error instanceof GoogleAuthRequiredError) throw error;
      return false;
    }
  }

  /**
   * The one sync file, with its text. Two or more (a plain copy being sealed, stopped between writing the new
   * file and deleting the old one): the sealed one is kept, else the first with any text, and the others go.
   */
  async function findFile() {
    const files = await listFiles();
    if (files.length <= 1) return files[0] ? { file: files[0], text: null } : null;
    const read = await Promise.all(files.map(async file => ({ file, text: await download(file.id) })));
    const rank = ({ text }) => (text.startsWith(`${SEAL_MAGIC}/`) ? 2 : text.trim() ? 1 : 0);
    const kept = read.reduce((best, item) => (rank(item) > rank(best) ? item : best), read[0]);
    // Beside a sealed copy, a plain or empty file goes; beside a plain one, only an empty one. Two sealed or two plain copies stay.
    for (const item of read) if (rank(item) < rank(kept) && (rank(kept) === 2 || rank(item) === 0)) await removeFile(item.file.id);
    return kept;
  }

  /** The sync file as it is in Drive: its text (plain JSON before 1.38, or a sealed copy: ./seal.js). */
  async function readText() {
    const found = await findFile();
    if (!found?.file?.id) return { exists: false, fileId: '', version: '', text: '' };
    const { file } = found;
    const text = found.text ?? await download(file.id);
    return { exists: true, fileId: file.id, version: file.modifiedTime || '', text, modifiedTime: file.modifiedTime || '' };
  }

  async function createFile() {
    const response = await authorizedFetch(`${DRIVE_FILES}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SYNC_FILE_NAME, parents: ['appDataFolder'] })
    });
    const body = await parseJson(response);
    if (!body.id) throw new Error('Google Drive did not return a sync file id.');
    return body.id;
  }

  async function upload(id, text, contentType) {
    const response = await authorizedFetch(`${DRIVE_UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime,size`, {
      method: 'PATCH',
      headers: { 'Content-Type': contentType },
      body: text
    });
    const body = await parseJson(response);
    return { ...body, id: body.id || id, version: body.modifiedTime || '' };
  }

  /**
   * Writes the sync file. `supersede` (a plain copy sealed for the first time, ./protection.js): into a new file,
   * read back and compared, and only then is the plain file deleted, so its text leaves Drive's revision history
   * with it. A new file that can't be written or checked is deleted, and the plain one stays as it was.
   */
  async function writeText(text, { fileId = '', contentType = 'application/json; charset=UTF-8', supersede = false } = {}) {
    if (supersede && fileId) {
      const id = await createFile();
      let result;
      try {
        result = await upload(id, text, contentType);
        if (await download(id) !== String(text)) throw new Error('Google Drive didn’t keep the sealed copy as it was sent. Nothing was changed; sync again.');
      } catch (error) {
        await removeFile(id).catch(() => false);
        throw error;
      }
      // Not deleted now (offline, access ended)? The next read finds both files and deletes it then.
      await removeFile(fileId).catch(() => false);
      return result;
    }
    const id = fileId || (await findFile())?.file?.id || await createFile();
    return upload(id, text, contentType);
  }

  /**
   * After a Connect or Reconnect: the account's address, from Drive (allowed with drive.appdata),
   * kept on this device for login_hint. Refused or unreadable: nothing is kept, and Reconnect asks as before.
   */
  async function rememberAccount() {
    if (account()) return account();
    try {
      const response = await authorizedFetch(`${DRIVE_ABOUT}?fields=${encodeURIComponent('user(emailAddress)')}`);
      if (!response.ok) return '';
      const address = String((await response.json())?.user?.emailAddress || '').trim();
      if (!EMAIL_RE.test(address)) return '';
      keepAccount(address);
      return address;
    } catch {
      return '';
    }
  }

  /** Disconnect (or a switch to another cloud): the access and the account are forgotten on this device. */
  function clearToken() {
    keep(null);
    keepAccount('');
  }

  /** Test / diagnostics helpers. */
  function setAccessTokenForTests(accessToken, expiresInMs = GOOGLE_ACCESS_MS) {
    keep(accessToken ? { value: accessToken, expiresAt: now() + expiresInMs } : null);
  }

  return {
    id: 'google',
    name: 'Google Drive',
    signIn: 'popup',
    prepare,
    authorizeInteractive,
    rememberAccount,
    account,
    clearToken,
    hasUsableToken,
    tokenExpiresAt,
    accessEndsAt,
    readText,
    writeText,
    scope: DRIVE_SCOPE,
    configured: !!cleanClientId,
    get interactiveAuthCalls() { return interactiveAuthCalls; },
    setAccessTokenForTests
  };
}
