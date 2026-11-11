import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryStore, createPlannerApi, EMAIL_SENDS_EVENT, NOTIFY_EMAIL_SHARE, NOTIFY_SENDS_EVENT } from '../server/planner-api.js';
import { createD1Store } from '../server/d1-store.js';
import { totp } from '../server/admin-auth.js';
import { bucketName, clientAddress, createDurableLimits, PRUNE_EVERY_MS, RATE_LIMIT_KEPT_MS, RATE_LIMITS, rateLimitKey, SIGN_IN_LIMIT } from '../server/rate-limit.js';

/* Abuse limits: per connection, in D1 (tables rate_limits
   and rate_limit_salts, migrations/schema.sql), under a salted hash of
   CF-Connecting-IP — never the address — for at most 24 hours. */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = Date.parse('2026-10-27T08:10:00Z');
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.20';
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const from = (ip, extra = {}) => ({ 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}), ...extra });
const post = (path, body, ip = IP, extra = {}) => new Request(`https://planner.test/api/${path}`, { method: 'POST', headers: from(ip, extra), body: JSON.stringify(body) });
const asJson = async response => ({ status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() });

function fakeResend() {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return jsonResponse(200, { id: 'x' }); } };
}

function setup({ store = createMemoryStore(), clock = { now: START }, ...options } = {}) {
  const deferred = [];
  const warnings = [];
  const resend = fakeResend();
  const api = createPlannerApi({
    store, adminToken: 'owner-token-for-tests', now: () => new Date(clock.now), authFailureDelayMs: 0,
    resendApiKey: 're_test_key', emailFrom: 'Daily Planner <hello@planner.example>', ownerEmail: 'owner@planner.example', emailFetch: resend.fetch, emailIntervalMs: 0,
    defer: promise => deferred.push(promise), warn: message => warnings.push(message),
    durableLimits: createDurableLimits({ store, secret: 'owner-token-for-tests', now: () => clock.now, pruneState: { at: 0 } }),
    ...options
  });
  return { api, store, clock, resend, warnings, settle: () => Promise.all(deferred.splice(0)) };
}

/** An in-memory SQLite with migrations/schema.sql, less the tables named in `without` (a database not set up yet). */
async function openSqlite(t, { without = [] } = {}) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite is not available in this Node version'); return null; }
  const sqlite = new DatabaseSync(':memory:');
  const statements = readFileSync(new URL('../migrations/schema.sql', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(text => text.trim()).filter(Boolean);
  for (const statement of statements) if (!without.some(table => new RegExp(`\\b${table}\\b`).test(statement))) sqlite.exec(`${statement};`);
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let params = [];
      const api = {
        bind(...values) { params = values; return api; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
        async all() { return { results: statement.all(...params) }; }
      };
      return api;
    }
  };
}

async function bothStores(t, body) {
  await body('memory', createMemoryStore());
  const d1 = await openSqlite(t);
  if (d1) await body('D1', createD1Store(d1), d1);
}

const question = index => ({ email: `ann${index}@example.com`, name: 'Ann', message: `Question ${index}`, source: 'contact' });

test('the connection is the address Cloudflare gives, an IPv6 one by its /64; anything else is none', () => {
  const at = value => clientAddress(new Request('https://planner.test/', { headers: value === undefined ? {} : { 'cf-connecting-ip': value } }));
  assert.equal(at(IP), IP);
  assert.equal(at(' 203.0.113.7 '), IP);
  assert.equal(at('2001:db8:85a3:12:8a2e:370:7334:1'), '2001:db8:85a3:12::/64');
  assert.equal(at('2001:DB8:85A3:0012::1'), '2001:db8:85a3:12::/64', 'the same home, another device');
  assert.equal(at('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(at('::1'), '0:0:0:0::/64');
  assert.equal(at('::ffff:198.51.100.20'), OTHER_IP, 'an IPv4 address in IPv6 form');
  for (const bad of [undefined, '', 'localhost', '256.1.1.1', '1.2.3', '2001:db8:::1', '1:2:3:4:5:6:7:8:9', 'g::1', 'x'.repeat(80), '1.2.3.4, 5.6.7.8']) assert.equal(at(bad), '', String(bad));
});

test('a connection is counted under a salted hash: 128 bits, the same for one secret, never the address', async () => {
  const key = await rateLimitKey(IP, 'secret-one');
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(await rateLimitKey(IP, 'secret-one'), key);
  assert.notEqual(await rateLimitKey(IP, 'secret-two'), key, 'another secret, another key');
  assert.notEqual(await rateLimitKey(OTHER_IP, 'secret-one'), key);
  assert.ok(!key.includes('203') || !key.includes('113'), 'nothing of the address');
  assert.equal(await rateLimitKey('', 'secret-one'), '', 'no address, no key');
  // Without any secret, a random key per isolate: still hashed, and stable within it.
  const isolate = await rateLimitKey(IP, '');
  assert.match(isolate, /^[0-9a-f]{32}$/);
  assert.equal(await rateLimitKey(IP, ''), isolate);
  assert.deepEqual([bucketName('contact', HOUR), bucketName('contact', DAY), bucketName('signin-fail', 15 * MINUTE)], ['contact:60m', 'contact:1440m', 'signin-fail:15m']);
});

test('the limits, as promised: questions 5 an hour and 20 a day, other forms a busy office’s worth, counts 5,000 a day, sign-in 10 tries in 15 minutes', () => {
  const rules = Object.fromEntries(Object.entries(RATE_LIMITS).map(([name, list]) => [name, list.map(rule => `${rule.limit}/${rule.windowMs / MINUTE}m`)]));
  // A connection is often shared (an office, a carrier's NAT, iCloud Private Relay): the limits leave room for that.
  assert.deepEqual(rules, { contact: ['5/60m', '20/1440m'], waitlist: ['10/60m'], 'waitlist-remove': ['10/60m'], feedback: ['20/60m'], review: ['3/1440m'], events: ['5000/1440m'], notify: ['3/1440m'], 'csp-report': ['100/1440m'] });
  assert.deepEqual(SIGN_IN_LIMIT, { failures: 10, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE });
  for (const list of Object.values(RATE_LIMITS)) for (const rule of list) assert.ok(rule.windowMs <= RATE_LIMIT_KEPT_MS, 'no row counts longer than 24 hours');
  assert.equal(RATE_LIMIT_KEPT_MS, DAY);
});

test('questions: 5 an hour and 20 a day per connection, then a calm 429 with Retry-After; others are not held up (memory and D1)', async t => {
  await bothStores(t, async (label, store) => {
    const { api, clock } = setup({ store });
    for (let index = 0; index < 5; index += 1) assert.equal((await api(post('contact', question(index)))).status, 201, `${label} ${index}`);
    // The former address of the form (POST teams, for one release) counts under the same limit.
    const refused = await asJson(await api(post('teams', { ...question(5), kind: 'question' })));
    assert.equal(refused.status, 429, label);
    assert.equal(refused.body.error, 'You’ve sent several requests in a short time. Please try again in 50 minutes.', label);
    assert.deepEqual([refused.body.retryAfter, refused.headers.get('retry-after')], [3000, '3000'], `${label}: the end of the hour`);
    assert.equal((await store.listQuestions()).length, 5, `${label}: the refused one is not stored`);
    assert.equal((await api(post('contact', question(6), OTHER_IP))).status, 201, `${label}: another connection`);
    assert.equal((await api(post('contact', question(7), ''))).status, 201, `${label}: without an address (local), nothing is counted`);
    // Each hour 5 more, until 20 that day; the next day it starts again.
    let accepted = 5;
    for (let hour = 1; hour < 6; hour += 1) {
      clock.now = START + hour * HOUR;
      for (let index = 0; index < 5; index += 1) if ((await api(post('contact', question(hour * 10 + index)))).status === 201) accepted += 1;
    }
    assert.equal(accepted, 20, `${label}: 20 a day`);
    const day = await asJson(await api(post('contact', question(99))));
    assert.equal(day.status, 429, label);
    assert.match(day.body.error, /try again in \d+ (?:minutes|hours?)/i, label);
    clock.now = Date.parse('2026-10-28T00:05:00Z');
    assert.equal((await api(post('contact', question(100)))).status, 201, `${label}: a new day`);
  });
});

test('the waitlist, feedback, reviews and counts each have their limit per connection', async () => {
  const clock = { now: START };
  const { api, store } = setup({ clock });
  const statuses = async (count, request) => { const seen = []; for (let index = 0; index < count; index += 1) seen.push((await api(request(index))).status); return seen; };
  const joined = await statuses(11, index => post('waitlist', { email: `w${index}@example.com`, consent: true }));
  assert.deepEqual([joined.slice(0, 10).every(status => status === 201), joined[10]], [true, 429], 'waitlist');
  assert.equal((await api(post('waitlist', { email: 'spam@example.com', consent: true, website: 'http://spam' }))).status, 201, 'the honeypot answers as before, without counting');
  assert.deepEqual(await statuses(11, () => post('waitlist/remove', { email: 'w0@example.com', token: '0'.repeat(64) })), [...Array(10).fill(400), 429]);
  // Feedback: 20 an hour; a quotable review 3 a day, the next ones kept as feedback only.
  const sent = await statuses(21, index => post('feedback', { version: '1.35.0', rating: 5, message: `Calm ${index}`, quote: true, name: `R${index}` }));
  assert.deepEqual([sent.slice(0, 20).every(status => status === 201), sent[20]], [true, 429], 'feedback');
  assert.deepEqual([(await store.listFeedback()).length, (await store.listReviews()).length], [20, 3]);
  // Anonymous counts: 5,000 a day (a 300-person office sending a handful each is counted in full).
  const counts = await statuses(5001, () => post('events', { name: 'landing_viewed', version: '1.35.0' }));
  assert.deepEqual([counts.slice(0, 5000).every(status => status === 204), counts[5000]], [true, 429], 'counts');
  assert.equal(store.data.events.find(row => row.name === 'landing_viewed').count, 5000);
});

test('the owner’s sign-in: 10 wrong tries in 15 minutes lock that connection out for 15 minutes; the right credentials still get in (memory and D1)', async t => {
  await bothStores(t, async (label, store) => {
    const { api, clock } = setup({ store });
    const signIn = (token, ip = IP) => api(post('admin/session', { token }, ip));
    // Nine wrong tries, then the right token: signed in, and the tries are forgotten.
    for (let index = 0; index < 9; index += 1) assert.equal((await signIn(`guess${index}`)).status, 401, label);
    assert.equal((await signIn('owner-token-for-tests')).status, 200, label);
    for (let index = 0; index < 9; index += 1) assert.equal((await signIn(`again${index}`)).status, 401, `${label}: counted from 0 again`);
    // The tenth wrong try locks the connection out: every wrong try now answers 429 …
    assert.equal((await signIn('again9')).status, 401, label);
    const locked = await asJson(await signIn('again10'));
    assert.equal(locked.status, 429, label);
    assert.equal(locked.body.error, 'Too many wrong sign-ins from this connection. Try again in 15 minutes.', label);
    assert.equal(locked.headers.get('retry-after'), '900', label);
    assert.equal((await signIn('again11')).status, 429, `${label}: still locked`);
    // … and the right token still signs in (the lockout stops guessing, never the owner), which ends it.
    assert.equal((await signIn('owner-token-for-tests')).status, 200, `${label}: the owner gets in`);
    assert.equal((await signIn('after')).status, 401, `${label}: unlocked by the owner’s sign-in`);
    assert.equal((await signIn('owner-token-for-tests', OTHER_IP)).status, 200, `${label}: another connection signs in`);
    // Wrong raw tokens as a Bearer count as wrong sign-ins (without two-factor sign-in, the token alone opens the API).
    const bearer = token => api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': IP } }));
    for (let index = 0; index < 9; index += 1) assert.equal((await bearer(`wrong${index}`)).status, 401, label);
    assert.equal((await bearer('wrong9')).status, 429, `${label}: locked by Bearer guesses`);
    assert.equal((await signIn('again12')).status, 429, label);
    // The right raw token still opens the API (a script after the owner mistyped), and ends the lockout too.
    assert.equal((await bearer('owner-token-for-tests')).status, 200, label);
    assert.equal((await signIn('again13')).status, 401, label);
    // Locked out again, it ends by itself 15 minutes later.
    for (let index = 0; index < 9; index += 1) await signIn(`later${index}`);
    assert.equal((await signIn('later9')).status, 429, label);
    clock.now += 15 * MINUTE + 1000;
    assert.equal((await signIn('later10')).status, 401, `${label}: unlocked`);
  });
});

test('with two-factor sign-in, a locked-out connection still gets in with the right token and code; a wrong code is refused', async () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const { api, clock } = setup({ adminTotpSecret: secret });
  const signIn = (token, code) => api(post('admin/session', { token, code }));
  for (let index = 0; index < 10; index += 1) assert.equal((await signIn('owner-token-for-tests', '000000')).status, 401);
  assert.equal((await signIn('owner-token-for-tests', '000000')).status, 429, 'a wrong code while locked out');
  assert.equal((await signIn('guess', await totp(secret, clock.now))).status, 429, 'a wrong token with the right code');
  assert.equal((await signIn('owner-token-for-tests', await totp(secret, clock.now))).status, 200, 'the owner gets in');
});

test('a session is never counted as a wrong try, and with two-factor sign-in the raw token is never tried', async () => {
  const { api } = setup({ adminTotpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' });
  const bearer = token => api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': IP } }));
  for (let index = 0; index < 12; index += 1) assert.equal((await bearer(index % 2 ? 'owner-token-for-tests' : `v1.1.${'0'.repeat(64)}`)).status, 401);
  // Still not locked out: sign-in answers 401 (the code is missing), not 429.
  assert.equal((await api(post('admin/session', { token: 'owner-token-for-tests' }))).status, 401);
});

test('one connection can’t fill the owner’s inbox or use up the day’s emails: 3 notifications a day each, and half the day’s emails at most', async () => {
  const { api, resend, settle, store } = setup({ emailDailyLimit: 6 });
  for (let index = 0; index < 5; index += 1) assert.equal((await api(post('contact', question(index)))).status, 201);
  await settle();
  assert.equal(resend.calls.length, 3, 'the first three of the day from this connection');
  assert.equal((await store.listQuestions()).length, 5, 'every question is still listed');
  // Other connections: notifications stop at half of EMAIL_DAILY_LIMIT, so the announcement and test emails still have room.
  assert.equal(NOTIFY_EMAIL_SHARE, 0.5);
  for (const ip of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) await api(post('contact', question(9), ip));
  await settle();
  assert.equal(resend.calls.length, 3);
  assert.equal(await store.emailSendsOn('2026-10-27', EMAIL_SENDS_EVENT), 3);
  assert.equal(await store.emailSendsOn('2026-10-27', NOTIFY_SENDS_EVENT), 3);
});

test('notifications have their own share of the day: an announcement that used the day’s emails doesn’t silence them', async () => {
  const { api, resend, settle, store } = setup({ emailDailyLimit: 6 });
  // An announcement used every email of the day.
  await store.addEmailSends('2026-10-27', EMAIL_SENDS_EVENT, 6);
  assert.equal((await api(post('contact', question(1)))).status, 201);
  await settle();
  assert.equal(resend.calls.length, 1, 'the owner still hears of the question');
  assert.deepEqual([await store.emailSendsOn('2026-10-27', NOTIFY_SENDS_EVENT), await store.emailSendsOn('2026-10-27', EMAIL_SENDS_EVENT)], [1, 7]);
});

test('rows never hold the address, count for at most 24 hours, and are deleted once they stop counting (memory and D1)', async t => {
  await bothStores(t, async (label, store, d1) => {
    const { api, clock } = setup({ store });
    await api(post('contact', question(1)));
    await api(post('admin/session', { token: 'wrong' }));
    await api(post('events', { name: 'landing_viewed', version: '1.35.0' }));
    const rows = d1 ? d1.sqlite.prepare('SELECT client_key AS key, bucket, window_start AS windowStart, expires_at AS expiresAt, count FROM rate_limits').all() : store.data.rateLimits;
    assert.ok(rows.length >= 4, label);
    const dump = JSON.stringify(rows) + JSON.stringify(d1 ? [] : store.data);
    assert.ok(!dump.includes(IP) && !dump.includes('203.0.113'), `${label}: never the address`);
    for (const row of rows) {
      assert.match(row.key, /^[0-9a-f]{32}$/, label);
      assert.ok(row.expiresAt - row.windowStart <= DAY, `${label}: ${row.bucket}`);
      assert.ok(row.expiresAt - START <= DAY, `${label}: ${row.bucket} stops counting within 24 hours`);
    }
    // A day later, the owner's dashboard (or the next request) deletes them.
    clock.now = START + DAY;
    const summary = await api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: 'Bearer owner-token-for-tests' } }));
    assert.equal(summary.status, 200, label);
    const left = d1 ? d1.sqlite.prepare('SELECT COUNT(*) AS n FROM rate_limits').get().n : store.data.rateLimits.length;
    assert.equal(left, 0, label);
  });
});

test('requests delete expired rows as they come, at most once a minute per isolate', async () => {
  const store = createMemoryStore();
  const clock = { now: START };
  const prune = { at: 0 };
  const limits = createDurableLimits({ store, secret: 's', now: () => clock.now, pruneState: prune });
  const request = new Request('https://planner.test/', { headers: { 'cf-connecting-ip': IP } });
  await limits.hit(request, 'feedback');
  assert.equal(store.data.rateLimits.length, 1);
  clock.now = START + 2 * HOUR;
  await limits.hit(request, 'feedback');
  assert.equal(store.data.rateLimits.length, 1, 'the expired hour went, the new one came');
  clock.now += 10 * 1000;
  store.data.rateLimits.push({ key: 'x', bucket: 'feedback:60m', windowStart: 0, count: 1, expiresAt: 1 });
  await limits.hit(request, 'feedback');
  assert.equal(store.data.rateLimits.length, 2, 'not again within the minute');
  clock.now += MINUTE;
  await limits.hit(request, 'feedback');
  assert.equal(store.data.rateLimits.length, 1);
});

test('without the rate-limit tables, or when D1 fails, nothing is refused because of the limits', async t => {
  const d1 = await openSqlite(t, { without: ['rate_limits', 'rate_limit_salts', 'csp_reports'] });
  if (!d1) return;
  const warnings = [];
  const store = createD1Store(d1);
  const { api } = setup({ store, warn: message => warnings.push(message), durableLimits: createDurableLimits({ store, secret: 's', warn: message => warnings.push(message), pruneState: { at: 0 } }) });
  for (let index = 0; index < 8; index += 1) assert.equal((await api(post('contact', question(index)))).status, 201);
  for (let index = 0; index < 12; index += 1) assert.equal((await api(post('admin/session', { token: 'wrong' }))).status, 401);
  assert.equal((await api(post('admin/session', { token: 'owner-token-for-tests' }))).status, 200);
  assert.ok(!warnings.some(line => /Rate limit/.test(line)), 'a missing table is expected before the schema is applied: no noise');
  // A store that fails another way: let through, and said in the log (never the address).
  const failing = { ...createMemoryStore(), rateLimitHit: async () => { throw new Error('D1 is down'); }, rateLimitCount: async () => { throw new Error('D1 is down'); }, pruneRateLimits: async () => 0, rateLimitClear: async () => 0 };
  const logged = [];
  const limits = createDurableLimits({ store: failing, secret: 's', warn: message => logged.push(message), pruneState: { at: 0 } });
  const request = new Request('https://planner.test/', { headers: { 'cf-connecting-ip': IP } });
  assert.equal(await limits.hit(request, 'contact'), 0);
  assert.equal(await limits.signIn.wait(request), 0);
  assert.equal(await limits.wait(request, 'contact'), 0);
  assert.ok(logged.length >= 3 && logged.every(line => /Rate limit not applied: D1 is down/.test(line) && !line.includes(IP)));
});

test('wait() says what hit() would, without counting: a limit of what fails, counted only when it does (memory and D1)', async t => {
  await bothStores(t, async (label, store) => {
    const clock = { now: START };
    // A limit of what fails, 10 a minute (as the sign-in's wrong tries are counted).
    const limits = createDurableLimits({ store, secret: 's', now: () => clock.now, pruneState: { at: 0 }, saltState: { day: '', salt: '' }, limits: { refused: [{ limit: 10, windowMs: MINUTE }] } });
    const request = (ip = IP) => new Request('https://planner.test/', { headers: { 'cf-connecting-ip': ip } });
    for (let index = 0; index < 20; index += 1) assert.equal(await limits.wait(request(), 'refused'), 0, `${label}: waiting counts nothing`);
    for (let index = 0; index < 9; index += 1) await limits.hit(request(), 'refused');
    assert.equal(await limits.wait(request(), 'refused'), 0, `${label}: 9 of 10`);
    await limits.hit(request(), 'refused');
    assert.equal(await limits.wait(request(), 'refused'), 60, `${label}: the 10th fills the minute (START is on a minute)`);
    assert.equal(await limits.wait(request(OTHER_IP), 'refused'), 0, `${label}: another connection`);
    assert.equal(await limits.wait(new Request('https://planner.test/'), 'refused'), 0, `${label}: no address, nothing counted`);
    assert.equal(await limits.wait(request(), 'nothing-like-it'), 0, `${label}: an unknown limit`);
    clock.now += 30 * 1000;
    assert.equal(await limits.wait(request(), 'refused'), 30, label);
    clock.now += 30 * 1000;
    assert.equal(await limits.wait(request(), 'refused'), 0, `${label}: the next minute`);
  });
});

test('the key is salted with the day’s random salt: made by the first request of the UTC day, which deletes the earlier ones (memory and D1)', async t => {
  await bothStores(t, async (label, store, d1) => {
    const clock = { now: START };
    const limits = createDurableLimits({ store, secret: 's', now: () => clock.now, pruneState: { at: 0 }, saltState: { day: '', salt: '' } });
    const request = (ip = IP) => new Request('https://planner.test/', { headers: { 'cf-connecting-ip': ip } });
    const salts = () => (d1 ? d1.sqlite.prepare('SELECT day, salt FROM rate_limit_salts ORDER BY day').all().map(row => ({ ...row })) : store.data.rateLimitSalts.map(({ day, salt }) => ({ day, salt })));
    const keys = () => (d1 ? d1.sqlite.prepare('SELECT DISTINCT client_key AS key FROM rate_limits').all().map(row => row.key) : [...new Set(store.data.rateLimits.map(row => row.key))]);
    await limits.hit(request(), 'contact');
    await limits.hit(request(), 'contact');
    const first = salts();
    assert.equal(first.length, 1, label);
    assert.equal(first[0].day, '2026-10-27', label);
    assert.match(first[0].salt, /^[0-9a-f]{64}$/, `${label}: random, 256 bits`);
    assert.equal(keys().length, 1, `${label}: one key for one connection within the day`);
    // Another isolate, the same day: the same salt (read from D1), so the same key.
    const other = createDurableLimits({ store, secret: 's', now: () => clock.now, pruneState: { at: 0 }, saltState: { day: '', salt: '' } });
    await other.hit(request(), 'contact');
    assert.equal(keys().length, 1, label);
    // The next UTC day: a new salt, yesterday's deleted at once; the same address gets another key.
    const [yesterday] = keys();
    clock.now = Date.parse('2026-10-28T00:00:05Z');
    await limits.hit(request(), 'contact');
    const second = salts();
    assert.deepEqual(second.map(row => row.day), ['2026-10-28'], `${label}: the earlier day’s salt is gone`);
    assert.notEqual(second[0].salt, first[0].salt, label);
    assert.ok(!JSON.stringify([salts(), keys()]).includes('203.0.113'), `${label}: never the address`);
    assert.equal(keys().length, 1, `${label}: yesterday’s rows stopped counting and went`);
    assert.notEqual(keys()[0], yesterday, `${label}: today’s key for the same address is another one`);
  });
});

test('pruning is bounded and runs after the answer: a batch at a time, report counts after 90 days (memory and D1)', async t => {
  await bothStores(t, async (label, store, d1) => {
    const clock = { now: START };
    const deferred = [];
    const limits = createDurableLimits({ store, secret: 's', now: () => clock.now, pruneState: { at: 0 }, saltState: { day: '', salt: '' }, defer: promise => deferred.push(promise) });
    // 2,100 expired rows: one pass deletes 4 batches of 500, the next pass the rest.
    for (let index = 0; index < 2100; index += 1) await store.rateLimitHit({ key: `k${index}`, bucket: 'events:1440m', windowStart: 0, expiresAt: 1 });
    const count = () => (d1 ? d1.sqlite.prepare('SELECT COUNT(*) AS n FROM rate_limits').get().n : store.data.rateLimits.length);
    await store.addCspReport({ day: '2026-07-01', directive: 'script-src', blocked: 'inline', page: '/' });
    await store.addCspReport({ day: '2026-10-26', directive: 'script-src', blocked: 'inline', page: '/' });
    const request = new Request('https://planner.test/', { headers: { 'cf-connecting-ip': IP } });
    // A slow D1: the request is answered without waiting for the deletes.
    const pruneRows = store.pruneRateLimits;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    store.pruneRateLimits = async args => { await gate; return pruneRows.call(store, args); };
    assert.equal(await limits.hit(request, 'feedback'), 0, label);
    assert.equal(count(), 2101, `${label}: nothing deleted before the answer`);
    assert.equal(deferred.length, 1, `${label}: handed to ctx.waitUntil`);
    release();
    await Promise.all(deferred.splice(0));
    store.pruneRateLimits = pruneRows;
    assert.equal(count(), 101, `${label}: 2,000 at most per pass`);
    assert.deepEqual((await store.listCspReports({ fromDay: '2026-01-01' })).map(row => row.lastDay), ['2026-10-26'], label);
    clock.now += PRUNE_EVERY_MS;
    await limits.hit(request, 'feedback');
    await Promise.all(deferred.splice(0));
    assert.equal(count(), 1, `${label}: the rest at the next pass, today's row stays`);
  });
});
