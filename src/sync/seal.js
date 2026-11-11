import { stableStringify } from './hash.js';

/**
 * The sealed copy (1.38): what Personal sync keeps in the person's cloud,
 * encrypted on this device with a key made from a passphrase only they know.
 *
 * - Key: PBKDF2 with SHA-256, SEAL_ITERATIONS rounds and a random 16-byte salt,
 *   to a 256-bit AES-GCM key (WebCrypto, never extractable).
 * - Each write: AES-GCM with a fresh random 12-byte IV. The header (version,
 *   cipher, KDF and its parameters) is bound to the ciphertext as additional
 *   data, so changing any of it makes the copy fail to open.
 * - A check: a fixed text sealed once with the same key (its own IV), kept in
 *   the header. It tells a wrong passphrase (the check fails) from a damaged
 *   or altered copy (the check opens, the data does not).
 *
 * The file is text: a first line `daily-planner-sealed/1`, then the envelope
 * as JSON. Planners before 1.38 read the sync file as JSON, so they stop at
 * that first line with an error and write nothing: a sealed copy can't be
 * replaced by an older device's plain one.
 */

export const SEAL_MAGIC = 'daily-planner-sealed';
export const SEAL_VERSION = 1;
/** OWASP's figure for PBKDF2-HMAC-SHA256 (2023); a second or less on a phone, once per device. */
export const SEAL_ITERATIONS = 600_000;
/** What a copy may ask for: below, too weak to trust; above, an altered header trying to stall this device. */
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 5_000_000;
export const PASSPHRASE_MIN_LENGTH = 10;
export const SEAL_CIPHER = 'AES-256-GCM';
const CHECK_TEXT = 'Daily Planner sealed copy';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Why a sealed copy did not open: 'wrong-passphrase', 'damaged' (altered or cut short) or 'unsupported' (a newer version). */
export class SealError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SealError';
    this.code = code;
  }
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(String(text));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const bytesOf = text => { try { return fromBase64(text); } catch { return null; } };
const randomBytes = size => crypto.getRandomValues(new Uint8Array(size));

/** The part of the envelope bound to every ciphertext: version, cipher, KDF and its parameters. */
export function sealHeader({ salt, iterations }) {
  return { v: SEAL_VERSION, cipher: SEAL_CIPHER, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt } };
}

const additionalData = (header, part) => encoder.encode(`${SEAL_MAGIC}/${header.v}|${part}|${stableStringify(header)}`);

/** The AES-GCM key a passphrase makes with this salt and count. Unicode is normalised (NFC): the same passphrase typed on any device. */
export async function deriveSealKey(passphrase, { salt, iterations }) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptPart(key, header, part, bytes) {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(header, part) }, key, bytes);
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

async function decryptPart(key, header, part, sealed) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv), additionalData: additionalData(header, part) }, key, fromBase64(sealed.data)));
}

/**
 * A new seal from a passphrase: a random salt, the key, and the check. What a
 * device keeps of it (./key-store.js): the salt, the count, the check and the
 * key, never the passphrase.
 */
export async function createSeal(passphrase, { iterations = SEAL_ITERATIONS } = {}) {
  const salt = toBase64(randomBytes(16));
  const key = await deriveSealKey(passphrase, { salt, iterations });
  const check = await encryptPart(key, sealHeader({ salt, iterations }), 'check', encoder.encode(CHECK_TEXT));
  return { salt, iterations, check, key };
}

/** The sealed file for this text: the first line, then the envelope. */
export async function sealText(text, seal) {
  const header = sealHeader(seal);
  const sealed = await encryptPart(seal.key, header, 'data', encoder.encode(String(text)));
  return `${SEAL_MAGIC}/${SEAL_VERSION}\n${JSON.stringify({ ...header, check: seal.check, iv: sealed.iv, data: sealed.data })}\n`;
}

function validSealed(part, ivBytes = 12) {
  if (!part || typeof part.iv !== 'string' || typeof part.data !== 'string') return false;
  const iv = bytesOf(part.iv);
  const data = bytesOf(part.data);
  return !!iv && iv.length === ivBytes && !!data && data.length >= 16;
}

/**
 * What the sync file holds: { format: 'none' } (empty), 'plain' (a copy from
 * before 1.38, with its document), 'sealed' (with its envelope, or
 * `problem`: 'unsupported' or 'damaged') or 'unknown'.
 */
export function readEnvelope(text) {
  const body = String(text ?? '');
  if (!body.trim()) return { format: 'none' };
  if (body.startsWith(`${SEAL_MAGIC}/`)) {
    const newline = body.indexOf('\n');
    const version = Number(body.slice(SEAL_MAGIC.length + 1, newline < 0 ? undefined : newline).trim());
    if (version !== SEAL_VERSION) return { format: 'sealed', problem: Number.isInteger(version) && version > SEAL_VERSION ? 'unsupported' : 'damaged' };
    let envelope = null;
    try { envelope = JSON.parse(body.slice(newline + 1)); } catch { return { format: 'sealed', problem: 'damaged' }; }
    const kdf = envelope?.kdf;
    const salt = bytesOf(kdf?.salt);
    const ok = envelope?.v === SEAL_VERSION && envelope.cipher === SEAL_CIPHER && kdf?.name === 'PBKDF2' && kdf.hash === 'SHA-256'
      && Number.isInteger(kdf.iterations) && kdf.iterations >= MIN_ITERATIONS && kdf.iterations <= MAX_ITERATIONS
      && !!salt && salt.length >= 16 && validSealed(envelope.check) && validSealed(envelope);
    if (!ok) return { format: 'sealed', problem: 'damaged' };
    return { format: 'sealed', envelope: { salt: kdf.salt, iterations: kdf.iterations, check: envelope.check, iv: envelope.iv, data: envelope.data } };
  }
  if (body.trimStart().startsWith('{')) {
    try {
      const document = JSON.parse(body);
      if (document?.app === 'Daily Planner') return { format: 'plain', document };
    } catch {}
  }
  return { format: 'unknown' };
}

/** Whether this key opens the envelope's check: the passphrase behind it is the right one. */
export async function keyOpensCheck(envelope, key) {
  try {
    return decoder.decode(await decryptPart(key, sealHeader(envelope), 'check', envelope.check)) === CHECK_TEXT;
  } catch {
    return false;
  }
}

/** The key a passphrase makes for this envelope, or null when it is not the passphrase it was sealed with. */
export async function unlockEnvelope(envelope, passphrase) {
  const key = await deriveSealKey(passphrase, envelope);
  return (await keyOpensCheck(envelope, key)) ? key : null;
}

/** The text inside. A key that doesn't open the check: SealError 'wrong-passphrase'; the check opens but not the data: 'damaged'. */
export async function openEnvelope(envelope, key) {
  if (!(await keyOpensCheck(envelope, key))) throw new SealError('wrong-passphrase', 'That passphrase does not open the synced copy.');
  try {
    return decoder.decode(await decryptPart(key, sealHeader(envelope), 'data', envelope));
  } catch {
    throw new SealError('damaged', 'The synced copy is damaged or was changed outside the planner.');
  }
}

const COMMON = /^(?:password|passphrase|motdepasse|azerty|qwerty|letmein|welcome|iloveyou|admin|dailyplanner|planner)/i;

/**
 * A rough strength for the hint under the field: 0 (too short) to 4. Long
 * beats clever: several unrelated words are the advice. `ok`: long enough
 * and not one of the obvious ones.
 */
export function passphraseStrength(value) {
  const text = String(value ?? '');
  const length = [...text].length;
  if (!length) return { score: 0, ok: false, label: '', hint: `At least ${PASSPHRASE_MIN_LENGTH} characters. A few unrelated words work well.` };
  // The same words until it is long enough: the hint is read out when it changes, not at each key.
  if (length < PASSPHRASE_MIN_LENGTH) return { score: 0, ok: false, label: 'Too short', hint: `At least ${PASSPHRASE_MIN_LENGTH} characters.` };
  const pool = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/, /\s/].reduce((sum, pattern, index) => sum + (pattern.test(text) ? [26, 26, 10, 32, 1][index] : 0), 0);
  const distinct = new Set(text.toLowerCase()).size;
  let bits = length * Math.log2(Math.max(pool, 2));
  if (distinct <= 3) bits = Math.min(bits, 20);
  else if (distinct < length / 3) bits *= 0.6;
  if (/(.)\1{3,}/.test(text) || /^(?:0123|1234|2345|abcd|qwer|azer)/i.test(text)) bits *= 0.6;
  if (COMMON.test(text.replace(/[\s\d!?.]+/g, ''))) bits = Math.min(bits, 28);
  const words = text.trim().split(/[\s\-_.]+/).filter(word => word.length >= 3).length;
  if (words >= 3) bits += 8;
  const score = bits < 36 ? 1 : bits < 52 ? 2 : bits < 72 ? 3 : 4;
  const label = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score];
  const hint = score === 1 ? 'Easy to guess. Try a few unrelated words.'
    : score === 2 ? 'Another word makes it much stronger.'
      : score === 3 ? 'Hard to guess.'
        : 'Very hard to guess.';
  return { score, ok: score >= 2, label, hint };
}
