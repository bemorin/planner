// Owner sign-in helpers for the planner API: RFC 6238 authenticator codes
// (TOTP, HMAC-SHA1, 6 digits, 30-second steps) and stateless signed sessions.
//
// Only WebCrypto (globalThis.crypto.subtle) is used, so the same code runs on
// Cloudflare Workers / Pages Functions and on Node 20 or newer.
//
// Session format: v1.<expiryMs>.<hex HMAC-SHA256(key = ADMIN_TOKEN, 'session:v1:' + expiryMs)>
// Nothing is stored on the server; rotating ADMIN_TOKEN signs everyone out.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SESSION_RE = /^v1\.(\d{1,16})\.([0-9a-f]{64})$/;
const encoder = new TextEncoder();

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
/** RFC 4226 asks for at least 128 bits; 80-bit (16-character) keys are still common. */
export const TOTP_MIN_SECRET_BYTES = 10;

const subtle = () => {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('WebCrypto (crypto.subtle) is not available.');
  return api;
};

/** Constant-time string comparison (length differences are folded into the result). */
export function timingSafeEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  let diff = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

/**
 * Decode RFC 4648 base32. Spaces, dashes, lowercase and "=" padding are
 * tolerated. Returns a Uint8Array, or null for empty or invalid input.
 */
export function base32Decode(input) {
  const clean = String(input ?? '').replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const character of clean) {
    value = ((value << 5) | BASE32_ALPHABET.indexOf(character)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** Encode bytes as unpadded RFC 4648 base32 (the form authenticator apps expect). */
export function base32Encode(bytes) {
  let output = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

const toHex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');

const importHmacKey = (bytes, hash) => subtle().importKey('raw', bytes, { name: 'HMAC', hash }, false, ['sign']);

const secretBytes = secret => (typeof secret === 'string' ? base32Decode(secret) : secret);

async function hotpWithKey(key, counter, digits) {
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter % 0x100000000);
  const mac = new Uint8Array(await subtle().sign('HMAC', key, message));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = (mac[offset] & 0x7f) * 0x1000000 + (mac[offset + 1] << 16) + (mac[offset + 2] << 8) + mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** RFC 4226 HOTP value for a counter. `secret` is base32 text or raw bytes. */
export async function hotp(secret, counter, digits = TOTP_DIGITS) {
  const bytes = secretBytes(secret);
  if (!bytes?.length) throw new Error('Invalid HOTP secret.');
  return hotpWithKey(await importHmacKey(bytes, 'SHA-1'), counter, digits);
}

/** RFC 6238 TOTP code at `timeMs` (milliseconds since the epoch). */
export function totp(secret, timeMs = Date.now(), { digits = TOTP_DIGITS, step = TOTP_STEP_SECONDS } = {}) {
  return hotp(secret, Math.floor(timeMs / 1000 / step), digits);
}

/** Seconds until the code shown at `timeMs` changes. */
export const totpSecondsLeft = (timeMs = Date.now(), step = TOTP_STEP_SECONDS) => step - (Math.floor(timeMs / 1000) % step);

/**
 * Check a code typed by the owner. Accepts the current step and `window`
 * steps either side (±30 s by default) to absorb clock drift. Spaces in the
 * code are ignored. Every candidate is compared, so timing does not reveal
 * which step matched.
 */
export async function verifyTotp(secret, code, timeMs = Date.now(), { window = 1, digits = TOTP_DIGITS, step = TOTP_STEP_SECONDS } = {}) {
  const bytes = secretBytes(secret);
  const clean = String(code ?? '').replace(/\s+/g, '');
  if (!bytes?.length || clean.length !== digits || !/^\d+$/.test(clean)) return false;
  const key = await importHmacKey(bytes, 'SHA-1');
  const counter = Math.floor(timeMs / 1000 / step);
  let matched = false;
  for (let delta = -window; delta <= window; delta += 1) {
    if (counter + delta < 0) continue;
    const candidate = await hotpWithKey(key, counter + delta, digits);
    matched = timingSafeEqual(candidate, clean) || matched;
  }
  return matched;
}

const hmacSha256 = async (keyBytes, message) => new Uint8Array(await subtle().sign('HMAC', await importHmacKey(keyBytes, 'SHA-256'), encoder.encode(message)));

/**
 * Token that lets the device that joined the waitlist remove that email later
 * without asking the owner:
 * hex HMAC-SHA256(key = HMAC-SHA256(ADMIN_TOKEN, 'waitlist-remove-key'), 'remove:' + email).
 * Deterministic, so a repeat sign-up gets the same token and the answer reveals
 * nothing about whether the email was already listed. Rotating ADMIN_TOKEN
 * invalidates every token. Returns '' without an ADMIN_TOKEN.
 */
export async function waitlistRemoveToken(adminToken, email) {
  if (!adminToken) return '';
  const key = await hmacSha256(encoder.encode(String(adminToken)), 'waitlist-remove-key');
  return toHex(await hmacSha256(key, `remove:${String(email ?? '').trim().toLowerCase()}`));
}

/** Constant-time check of a waitlist removal token. */
export async function verifyWaitlistRemoveToken(adminToken, email, token) {
  if (!adminToken || typeof token !== 'string' || !token) return false;
  return timingSafeEqual(await waitlistRemoveToken(adminToken, email), token);
}

/** Sign a session that expires at `expiresAtMs`. */
export async function signSession(adminToken, expiresAtMs) {
  if (!adminToken) throw new Error('ADMIN_TOKEN is required to sign a session.');
  const expiry = Math.floor(Number(expiresAtMs));
  const key = await importHmacKey(encoder.encode(String(adminToken)), 'SHA-256');
  const mac = await subtle().sign('HMAC', key, encoder.encode(`session:v1:${expiry}`));
  return `v1.${expiry}.${toHex(mac)}`;
}

/** Issue a new session valid for `ttlMs` (8 hours by default). */
export async function issueSession(adminToken, nowMs = Date.now(), ttlMs = SESSION_TTL_MS) {
  const expiresAt = Math.floor(nowMs) + ttlMs;
  return { session: await signSession(adminToken, expiresAt), expiresAt };
}

/** True when `value` has the session shape (it may still be invalid). */
export const looksLikeSession = value => SESSION_RE.test(String(value ?? ''));

/**
 * Verify a session's signature (constant time) and expiry. Sessions that
 * claim to live longer than `ttlMs` (+1 min clock slack) are refused too.
 */
export async function verifySession(adminToken, value, nowMs = Date.now(), ttlMs = SESSION_TTL_MS) {
  const text = String(value ?? '');
  const match = SESSION_RE.exec(text);
  if (!adminToken || !match) return false;
  const expiresAt = Number(match[1]);
  const expected = await signSession(adminToken, expiresAt);
  const authentic = timingSafeEqual(expected, text);
  return authentic && expiresAt > nowMs && expiresAt <= nowMs + ttlMs + 60000;
}
