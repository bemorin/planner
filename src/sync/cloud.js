/**
 * Personal sync's clouds (1.38). Google Drive (./google-drive.js) and Dropbox
 * (./dropbox.js) answer the same few calls, so the sync engine (./engine.js)
 * and the seal (./protection.js) never ask which one they talk to. A provider:
 *
 *   id, name, configured           which cloud, and whether this build can use it
 *   signIn                         'popup' (Google's window) or 'redirect' (Dropbox's page, then back here)
 *   hasUsableToken()               sync may run now without a gesture
 *   readText()                     → { exists, fileId, version, text } of the one sync file
 *   writeText(text, options)       options: { fileId, version, exists, contentType } → { id, version }
 *   clearToken()                   forgets the access on this device (Disconnect)
 *
 * Google: authorizeInteractive() opens its window from a tap. Dropbox:
 * beginAuthorization() gives the address to go to, completeAuthorization()
 * finishes when the browser comes back (src/features/personal-sync.js).
 */

export const SYNC_FILE_NAME = 'daily-planner-sync.json';

/**
 * What the copy says about each cloud. `folder`: where the person sees the
 * planner's folder ('' = hidden). Dropbox names it after the App Console's
 * app, so the copy never spells that name out.
 */
export const CLOUDS = Object.freeze({
  google: Object.freeze({ id: 'google', name: 'Google Drive', company: 'Google', folder: '' }),
  dropbox: Object.freeze({ id: 'dropbox', name: 'Dropbox', company: 'Dropbox', folder: 'your Dropbox’s Apps folder' })
});
export const CLOUD_IDS = Object.freeze(Object.keys(CLOUDS));
export const isCloudId = value => CLOUD_IDS.includes(value);

const PROVIDER_CALLS = ['hasUsableToken', 'readText', 'writeText', 'clearToken'];

/** The calls every provider answers, and its sign-in (unit-tested against both clouds). */
export function providerProblems(provider) {
  if (!provider || typeof provider !== 'object') return ['not a provider'];
  const problems = PROVIDER_CALLS.filter(name => typeof provider[name] !== 'function').map(name => `missing ${name}()`);
  if (!isCloudId(provider.id)) problems.push('unknown id');
  if (typeof provider.configured !== 'boolean') problems.push('configured must be true or false');
  if (provider.signIn === 'popup' && typeof provider.authorizeInteractive !== 'function') problems.push('missing authorizeInteractive()');
  if (provider.signIn === 'redirect' && (typeof provider.beginAuthorization !== 'function' || typeof provider.completeAuthorization !== 'function')) problems.push('missing beginAuthorization() or completeAuthorization()');
  if (provider.signIn !== 'popup' && provider.signIn !== 'redirect') problems.push('signIn must be popup or redirect');
  return problems;
}

/** The cloud wants a gesture (Connect, Reconnect) before it gives access again. */
export class SyncAuthRequiredError extends Error {
  constructor(message = 'Reconnect to continue syncing.') {
    super(message);
    this.name = 'SyncAuthRequiredError';
    this.code = 'auth-required';
  }
}

/** Another device wrote the sync file meanwhile: the sync starts again from what is there now. */
export class SyncRemoteChangedError extends Error {
  constructor(message = 'Another device was syncing at the same moment.') {
    super(message);
    this.name = 'SyncRemoteChangedError';
    this.code = 'remote-changed';
  }
}

// ---- OAuth with PKCE (RFC 7636): no secret in the browser ---------------------------------

/** Bytes as base64url, without padding. */
export function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random value for `state` or a verifier: `size` random bytes, base64url. */
export function randomToken(size = 32, random = bytes => crypto.getRandomValues(bytes)) {
  return base64url(random(new Uint8Array(size)));
}

/** The S256 challenge of a verifier: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** A verifier (64 characters from 48 random bytes, inside RFC 7636's 43 to 128) and its challenge. */
export async function createPkcePair(random) {
  const verifier = randomToken(48, random);
  return { verifier, challenge: await pkceChallenge(verifier), method: 'S256' };
}
