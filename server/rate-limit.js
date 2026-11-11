// Durable abuse limits, kept in D1 (table rate_limits, migrations/schema.sql)
// so they hold across Cloudflare's worker isolates, unlike the per-isolate
// limits of server/admin-limits.js, which stay as a first layer.
//
// Privacy: requests are counted per connection under a scrambled form of the
// IP address Cloudflare gives (CF-Connecting-IP; an IPv6 address by its /64):
// an HMAC-SHA256 keyed by the day's salt (random, one per UTC day, table
// rate_limit_salts) together with a secret of this server (ADMIN_TOKEN; a
// random key per isolate when it isn't set). The first request of a UTC day
// makes that day's salt and deletes the earlier ones, so from then on no hash of an earlier
// day can be linked back to an address, even before its row is deleted. The
// address itself is never stored, logged or answered.
// Each row counts one bucket over one period of at most 24 hours (fixed
// windows within the UTC day: the hour, the day, 15 minutes) and stops
// counting at its end; rows past it are deleted a batch at a time
// (PRUNE_BATCH) after the request that notices them, outside its answer
// (ctx.waitUntil), at most once a minute per isolate, and when the owner's
// dashboard loads. Pages Functions have no scheduled jobs: a row outlives its
// 24 hours only while nobody calls the API, and by then its day's salt is gone
// at the first request. The same pass deletes the security headers' report
// counts after CSP_REPORTS_KEPT_DAYS.
//
// Without CF-Connecting-IP (local development, tests) nothing is counted here.
// While the tables are missing, or when D1 fails, a request is never
// refused because of this module: it counts nothing and lets it through.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Requests per connection: each bucket's rules, all of which must hold. A
 * connection is often shared (an office, a school, a carrier's NAT, iCloud
 * Private Relay), so what many people do one at a time stays well inside
 * the limits: anonymous counts are cheap and checked, and allow thousands a
 * day; forms allow a busy office's worth; questions (each emails the owner)
 * stay few.
 */
export const RATE_LIMITS = Object.freeze({
  // Questions from the Contact page: each one emails the owner.
  contact: Object.freeze([Object.freeze({ limit: 5, windowMs: HOUR }), Object.freeze({ limit: 20, windowMs: DAY })]),
  waitlist: Object.freeze([Object.freeze({ limit: 10, windowMs: HOUR })]),
  'waitlist-remove': Object.freeze([Object.freeze({ limit: 10, windowMs: HOUR })]),
  // Feedback and reviews (a review comes as feedback).
  feedback: Object.freeze([Object.freeze({ limit: 20, windowMs: HOUR })]),
  // Quotable reviews: a few a day per connection; more are kept as feedback only.
  review: Object.freeze([Object.freeze({ limit: 3, windowMs: DAY })]),
  // Anonymous usage counts: a few per person a day, validated and cheap, so a whole office's.
  events: Object.freeze([Object.freeze({ limit: 5000, windowMs: DAY })]),
  // Owner notifications of questions: the first ones of the day per connection are emailed, the rest only listed.
  notify: Object.freeze([Object.freeze({ limit: 3, windowMs: DAY })]),
  // Reports of the security headers, sent by the browser when the policy blocked something (a page can send a few).
  'csp-report': Object.freeze([Object.freeze({ limit: 100, windowMs: DAY })])
});

/** The owner's sign-in: `failures` wrong tries in a window of `windowMs` lock that connection out for `lockMs`. */
export const SIGN_IN_LIMIT = Object.freeze({ failures: 10, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE });
/** Expired rows are deleted at most this often per isolate. */
export const PRUNE_EVERY_MS = MINUTE;
/** Rows deleted per statement, and statements per pass at most: never a long delete in one go. */
export const PRUNE_BATCH = 500;
export const PRUNE_BATCHES = 4;
/** The security headers' report counts (the Configuration page reads the last 7 days). */
export const CSP_REPORTS_KEPT_DAYS = 90;
/** No row counts, or is kept, longer than this. */
export const RATE_LIMIT_KEPT_MS = DAY;

const encoder = new TextEncoder();
const isMissingTable = error => /no such table/i.test(String(error?.message || ''));
const toHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** An IPv6 address cut to its /64 (one home or office), '' when it isn't one. ::ffff:1.2.3.4 is the IPv4 address. */
function ipv6Prefix(text) {
  const address = text.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1];
  const halves = address.split('::');
  if (halves.length > 2) return '';
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return '';
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return '';
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** The client's address as Cloudflare gives it (CF-Connecting-IP), an IPv6 one cut to its /64; '' without a usable one. */
export function clientAddress(request) {
  const raw = String(request?.headers?.get?.('cf-connecting-ip') || '').trim();
  if (!raw || raw.length > 64) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return raw.split('.').every(part => Number(part) <= 255) ? raw : '';
  return /^[0-9a-f:.]+$/i.test(raw) && raw.includes(':') ? ipv6Prefix(raw) : '';
}

const salts = new Map();
let isolateSecret = '';

/** The hashing key: an HMAC of a fixed label with the server's secret, so the secret itself never keys the hash. */
function saltFor(secret) {
  let text = String(secret ?? '');
  if (!text) {
    isolateSecret ||= toHex(crypto.getRandomValues(new Uint8Array(32)));
    text = isolateSecret;
  }
  if (!salts.has(text)) {
    if (salts.size > 8) salts.clear();
    salts.set(text, hmac(encoder.encode(text), 'daily-planner:rate-limit-salt:v1'));
  }
  return salts.get(text);
}

/** The key a connection is counted under: 32 hex characters (128 bits of an HMAC-SHA256), '' without an address. */
export async function rateLimitKey(address, secret) {
  if (!address) return '';
  return toHex(await hmac(await saltFor(secret), address)).slice(0, 32);
}

/** The UTC day of `at` (ms): '2026-10-27'. */
export const utcDay = at => new Date(at).toISOString().slice(0, 10);
const newSalt = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
/** The salt of the day each isolate read last: { day, salt }. Shared by the APIs an isolate builds (one per request). */
const sharedSalt = { day: '', salt: '' };

/**
 * The day's salt, made by the first request of the UTC day (INSERT OR
 * IGNORE: isolates that race agree on the one written first), which deletes
 * the salts of the days before. Answers '' while it can't be read (migration
 * missing, D1 failing): then nothing is counted.
 */
export async function daySalt(store, at, state = sharedSalt) {
  const day = utcDay(at);
  if (state.day === day && state.salt) return state.salt;
  let salt = await store.getRateLimitSalt(day);
  if (!salt) {
    await store.addRateLimitSalt({ day, salt: newSalt(), createdAt: new Date(at).toISOString() });
    salt = await store.getRateLimitSalt(day);
    // The day changed: yesterday's salt goes now, so its hashes can't be linked to an address any more.
    await store.deleteRateLimitSalts({ beforeDay: day });
  }
  if (salt) Object.assign(state, { day, salt });
  return salt || '';
}

/** The bucket of one rule, as stored: `contact:60m`, `contact:1440m`. */
export const bucketName = (name, windowMs) => `${name}:${Math.round(windowMs / MINUTE)}m`;

const sharedPrune = { at: 0 };

/**
 * The limits of one API: `hit(request, name)` counts a request in the buckets
 * of RATE_LIMITS[name] and answers 0 when it may go on, else the seconds to
 * wait; `wait(request, name)` answers the same without counting; `signIn`
 * handles the owner's sign-in lockout (`wait`, `failed`, `succeeded`);
 * `prune()` deletes the expired rows. `store` is the API's store
 * (rateLimitHit, rateLimitCount, rateLimitClear, pruneRateLimits).
 */
export function createDurableLimits({ store, secret = '', now = () => Date.now(), warn = () => {}, defer = null, limits = RATE_LIMITS, signIn = SIGN_IN_LIMIT, pruneState = sharedPrune, pruneEveryMs = PRUNE_EVERY_MS, saltState = sharedSalt } = {}) {
  const tolerate = async (task, fallback) => {
    try { return await task(); } catch (error) {
      if (!isMissingTable(error)) warn(`Rate limit not applied: ${error?.message || error}`);
      return fallback;
    }
  };
  async function keyOf(request) {
    const address = clientAddress(request);
    if (!address) return '';
    const salt = await tolerate(() => daySalt(store, now(), saltState), '');
    return salt ? rateLimitKey(address, `${salt}:${secret}`) : '';
  }
  /** Deletes up to PRUNE_BATCHES batches of what `task(limit)` finds; answers how many rows went. */
  async function batches(task) {
    let total = 0;
    for (let round = 0; round < PRUNE_BATCHES; round += 1) {
      const gone = Number(await task(PRUNE_BATCH)) || 0;
      total += gone;
      if (gone < PRUNE_BATCH) break;
    }
    return total;
  }
  /**
   * The expired rows: rate limits and old report counts. At most once a
   * minute per isolate (`force`: now), and a bounded number of rows; answers
   * how many rate-limit rows went.
   */
  async function prune(force = false) {
    const at = now();
    if (!force && at - pruneState.at < pruneEveryMs) return 0;
    pruneState.at = at;
    const removed = await tolerate(() => batches(limit => store.pruneRateLimits({ now: at, limit })), 0);
    await tolerate(() => batches(limit => store.pruneCspReports({ beforeDay: utcDay(at - CSP_REPORTS_KEPT_DAYS * DAY), limit })), 0);
    return removed;
  }
  /** prune() after the answer when the platform can wait for it (ctx.waitUntil), else right away. */
  async function pruneSoon() {
    if (!defer) return prune();
    try { defer(prune()); } catch (_) { /* the platform refused it: the next request prunes */ }
    return 0;
  }
  async function count(key, name, windowMs, at) {
    const windowStart = Math.floor(at / windowMs) * windowMs;
    const counted = await store.rateLimitHit({ key, bucket: bucketName(name, windowMs), windowStart, expiresAt: windowStart + windowMs });
    return { counted, windowStart };
  }
  async function hit(request, name) {
    const rules = limits[name];
    if (!rules?.length) return 0;
    const key = await keyOf(request);
    if (!key) return 0;
    const at = now();
    await pruneSoon();
    // Rules in order, shortest window first: a request refused by one isn't counted in the next (a 429 within the
    // hour doesn't use up the day).
    return tolerate(async () => {
      for (const rule of rules) {
        const { counted, windowStart } = await count(key, name, rule.windowMs, at);
        if (counted > rule.limit) return Math.max(1, Math.ceil((windowStart + rule.windowMs - at) / 1000));
      }
      return 0;
    }, 0);
  }
  /**
   * Seconds this connection must wait under RATE_LIMITS[name], without counting this request (a limit
   * of what fails, counted by hit() only when it does): 0 when it may go on.
   */
  async function wait(request, name) {
    const rules = limits[name];
    if (!rules?.length) return 0;
    const key = await keyOf(request);
    if (!key) return 0;
    const at = now();
    return tolerate(async () => {
      for (const rule of rules) {
        const counted = await store.rateLimitCount({ key, bucket: bucketName(name, rule.windowMs), now: at });
        if (counted.count >= rule.limit) return Math.max(1, Math.ceil((counted.until - at) / 1000));
      }
      return 0;
    }, 0);
  }
  const lockBucket = bucketName('signin-lock', signIn.lockMs);
  const failBucket = bucketName('signin-fail', signIn.windowMs);
  return {
    hit,
    wait,
    prune,
    signIn: {
      /** Seconds this connection is locked out of signing in for, 0 when it may try. */
      async wait(request) {
        const key = await keyOf(request);
        if (!key) return 0;
        const at = now();
        return tolerate(async () => {
          const lock = await store.rateLimitCount({ key, bucket: lockBucket, now: at });
          return lock.count > 0 ? Math.max(1, Math.ceil((lock.until - at) / 1000)) : 0;
        }, 0);
      },
      /** One more wrong try; the one that reaches `failures` in the window locks the connection out for `lockMs`. */
      async failed(request) {
        const key = await keyOf(request);
        if (!key) return;
        const at = now();
        await pruneSoon();
        await tolerate(async () => {
          const { counted } = await count(key, 'signin-fail', signIn.windowMs, at);
          if (counted >= signIn.failures) await store.rateLimitHit({ key, bucket: lockBucket, windowStart: at, expiresAt: at + signIn.lockMs });
        }, undefined);
      },
      /** A sign-in that worked: this connection's wrong tries are forgotten. */
      async succeeded(request) {
        const key = await keyOf(request);
        if (!key) return;
        await tolerate(() => store.rateLimitClear({ key, buckets: [failBucket, lockBucket] }), 0);
      }
    }
  };
}
