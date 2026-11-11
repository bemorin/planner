import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contactEmail, createMemoryStore, createPlannerApi, DEFAULT_EMAIL_DAILY_LIMIT, EMAIL_SENDS_EVENT, parseDailyLimit } from '../server/planner-api.js';
import { createD1Store } from '../server/d1-store.js';
import { waitlistRemoveToken } from '../server/admin-auth.js';
import { announcementEmail, buildResendMessages, createResendMailer, EMAILS_PER_SEND, escapeHtml, formatAddress, MAX_BATCHES_PER_SEND, ONE_EMAIL_FOOTER, ownerTestEmail, parseAddress, RESEND_BATCH_URL, RESEND_EMAILS_URL, RESEND_MAX_BATCH, textToHtml } from '../server/email.js';
import { ADMIN_LIMITS, createAdminLimits } from '../server/admin-limits.js';

const START = Date.parse('2026-10-09T08:00:00Z');
const post = (path, body, token) => new Request(`https://planner.test/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (path, token) => new Request(`https://planner.test/api/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const question = (overrides = {}) => ({ email: 'ada@example.com', name: 'Ada', message: 'Can I move my plans to a new laptop?', version: '1.39.0', locale: 'fr-FR', source: 'contact', ...overrides });
const EMAIL = { resendApiKey: 're_test_key', emailFrom: 'Ben Morin <hello@example.com>', ownerEmail: 'owner@example.com', emailIntervalMs: 0 };
const announcement = { subject: 'Account sync is ready', text: 'Hi,\n\nIt is ready.\nOpen the planner.' };

/** Stand-in for Resend: records every request; `fail(callNumber, body)` returns an error status. */
function fakeResend({ fail = () => 0, gate = null } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body, signal: init.signal, at: Date.now() });
    if (gate) await gate;
    const status = fail(calls.length, body);
    if (status) return new Response(JSON.stringify({ statusCode: status, name: 'error', message: `Refused (${status})` }), { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
    const answer = Array.isArray(body) ? { data: body.map((_, index) => ({ id: `id-${index}` })) } : { id: 'id-0' };
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const messages = () => calls.flatMap(call => (Array.isArray(call.body) ? call.body : [call.body]));
  return { fetch, calls, messages, recipients: () => messages().flatMap(message => message.to) };
}

function setup({ store = createMemoryStore(), resend = fakeResend(), clock = { now: START }, ...options } = {}) {
  const warnings = [];
  const api = createPlannerApi({ store, adminToken: 'secret', now: () => new Date(clock.now), authFailureDelayMs: 0, ...EMAIL, emailFetch: resend.fetch, warn: message => warnings.push(message), ...options });
  return { api, store, resend, clock, warnings };
}

async function join(api, count, clock) {
  for (let index = 0; index < count; index += 1) {
    clock.now += 1000;
    const response = await api(post('waitlist', { email: `person${index}@example.com`, consent: true, version: '1.19.0' }));
    assert.equal(response.status, 201);
  }
}

async function openSqlite(t) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite is not available in this Node version'); return null; }
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/schema.sql', import.meta.url), 'utf8'));
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

test('Resend messages: the documented fields, one recipient each', () => {
  const recipients = [{ email: 'a@example.com', id: 1 }, { email: 'b@example.com', id: 2 }];
  const messages = buildResendMessages({ from: { email: 'hello@example.com', name: 'Ben Morin' }, subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', recipients });
  assert.deepEqual(messages, [
    { from: 'Ben Morin <hello@example.com>', to: ['a@example.com'], subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' },
    { from: 'Ben Morin <hello@example.com>', to: ['b@example.com'], subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' }
  ]);
  assert.deepEqual(Object.keys(messages[0]), ['from', 'to', 'subject', 'text', 'html']);
  const [withReply] = buildResendMessages({ from: 'a@example.com', subject: 's', text: 't', replyTo: { email: 'r@example.com', name: 'R' }, recipients: [{ email: 'x@example.org' }] });
  assert.deepEqual(withReply, { from: 'a@example.com', to: ['x@example.org'], subject: 's', text: 't', reply_to: 'r@example.com' });
  assert.equal(formatAddress({ email: 'a@example.com', name: 'Morin, Ben' }), '"Morin, Ben" <a@example.com>');
  assert.equal(formatAddress({ email: 'a@example.com', name: 'Ben "B" Morin' }), 'Ben B Morin <a@example.com>');
  assert.equal(formatAddress({ email: 'a@example.com' }), 'a@example.com');
});

test('email HTML escapes everything and keeps the one-email footer', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a> {{ params.x }}`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt; &#123;&#123; params.x &#125;&#125;');
  assert.equal(textToHtml('One\nline two\n\n\n<b>Two</b>\r\n\r\nThree'), '<p>One<br>\nline two</p>\n<p>&lt;b&gt;Two&lt;/b&gt;</p>\n<p>Three</p>');
  const email = announcementEmail({ subject: '  Ready  ', text: 'Hello <script>alert(1)</script>\n\nBye' });
  assert.equal(email.subject, 'Ready');
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes('<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>'));
  assert.ok(email.html.includes(ONE_EMAIL_FOOTER));
  assert.ok(email.text.startsWith('Hello <script>alert(1)</script>\n\nBye\n\n'));
  assert.ok(email.text.trimEnd().endsWith(ONE_EMAIL_FOOTER));
  assert.equal(ONE_EMAIL_FOOTER, 'This is the one email you asked for. Your address has now been deleted from our list.');
});

test('sender addresses are parsed from EMAIL_FROM and the daily limit defaults to Resend’s free plan', () => {
  assert.deepEqual(parseAddress('Ben Morin <hello@example.com>'), { email: 'hello@example.com', name: 'Ben Morin' });
  assert.deepEqual(parseAddress('"Ben Morin" <hello@example.com>'), { email: 'hello@example.com', name: 'Ben Morin' });
  assert.deepEqual(parseAddress(' hello@example.com '), { email: 'hello@example.com' });
  for (const bad of ['', 'Ben Morin', 'hello@', '<>', 'a b@example.org', null]) assert.equal(parseAddress(bad), null, String(bad));
  assert.equal(createResendMailer({ apiKey: 'k', from: 'nope', fetch: () => {} }).configured, false);
  assert.equal(createResendMailer({ apiKey: '', from: 'a@example.com', fetch: () => {} }).configured, false);
  assert.equal(createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: () => {} }).configured, true);
  assert.equal(DEFAULT_EMAIL_DAILY_LIMIT, 100);
  assert.equal(parseDailyLimit(''), 100);
  assert.equal(parseDailyLimit(undefined), 100);
  assert.equal(parseDailyLimit('1000'), 1000);
  assert.equal(parseDailyLimit('0'), 0);
  assert.equal(parseDailyLimit('lots'), 100);
  assert.equal(parseDailyLimit(-5), 100);
});

test('the mailer posts to Resend with a Bearer key, /emails for one and /emails/batch for many', async () => {
  const resend = fakeResend();
  const mailer = createResendMailer({ apiKey: 're_test_key', from: 'Ben <hello@example.com>', fetch: resend.fetch, minIntervalMs: 0 });
  assert.deepEqual(await mailer.send({ subject: 's', html: '<p>h</p>', text: 'h', recipients: [{ email: 'a@example.com' }] }), { sent: 1 });
  assert.equal(RESEND_EMAILS_URL, 'https://api.resend.com/emails');
  assert.equal(RESEND_BATCH_URL, 'https://api.resend.com/emails/batch');
  assert.equal(resend.calls[0].url, RESEND_EMAILS_URL);
  assert.deepEqual(resend.calls[0].headers, { authorization: 'Bearer re_test_key', 'content-type': 'application/json', accept: 'application/json' });
  assert.deepEqual(resend.calls[0].body, { from: 'Ben <hello@example.com>', to: ['a@example.com'], subject: 's', text: 'h', html: '<p>h</p>' });

  const recipients = Array.from({ length: 250 }, (_, index) => ({ email: `p${index}@example.com` }));
  const batches = [];
  assert.deepEqual(await mailer.send({ subject: 's', text: 't', recipients }, { onBatch: batch => { batches.push(batch.length); } }), { sent: 250 });
  assert.equal(RESEND_MAX_BATCH, 100);
  assert.deepEqual(resend.calls.slice(1).map(call => [call.url, call.body.length]), [[RESEND_BATCH_URL, 100], [RESEND_BATCH_URL, 100], [RESEND_BATCH_URL, 50]]);
  assert.deepEqual(batches, [100, 100, 50]);
  assert.deepEqual(resend.calls[3].body.at(-1), { from: 'Ben <hello@example.com>', to: ['p249@example.com'], subject: 's', text: 't' });
  assert.equal(new Set(resend.recipients()).size, 251);

  const hanging = createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: () => new Promise(() => {}) });
  const started = Date.now();
  await assert.rejects(hanging.send({ subject: 's', html: 'h', recipients: [{ email: 'x@example.org' }] }, { timeoutMs: 40 }), /did not answer/);
  assert.ok(Date.now() - started < 1000);
  // After a 401 or a 403, Resend's own words are left out (they may repeat the key); otherwise they are scrubbed of it.
  const refused = createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: fakeResend({ fail: () => 401 }).fetch });
  await assert.rejects(refused.send({ subject: 's', html: 'h', recipients: [{ email: 'x@example.org' }] }), error => error.message === 'Resend refused RESEND_API_KEY (HTTP 401)');
  const forbidden = createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: fakeResend({ fail: () => 403 }).fetch });
  await assert.rejects(forbidden.send({ subject: 's', text: 't', recipients: [{ email: 'x@example.org' }] }), error => /^Resend refused to send \(HTTP 403\): check that the domain of EMAIL_FROM is verified/.test(error.message) && !error.message.includes('Refused (403)'));
  const key = 're_Zyxwvutsrqponmlkjihgfedcba12';
  const echoing = createResendMailer({ apiKey: key, from: 'a@example.com', fetch: async () => new Response(JSON.stringify({ name: 'validation_error', message: `Invalid key ${key.slice(0, 8)}****${key.slice(-6)} (ending in ${key.slice(-4)})` }), { status: 422 }) });
  await assert.rejects(echoing.send({ subject: 's', text: 't', recipients: [{ email: 'x@example.org' }] }), error => {
    assert.match(error.message, /^Resend answered HTTP 422: Invalid key \[hidden\] \(ending in \[hidden\]\)$/);
    for (let start = 3; start + 4 <= key.length; start += 1) assert.ok(!error.message.includes(key.slice(start, start + 4)), key.slice(start, start + 4));
    return true;
  });
  const offline = createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.send({ subject: 's', text: 't', recipients: [{ email: 'x@example.org' }] }), /^Error: Resend couldn’t be reached$/);
});

test('requests are spaced out for Resend’s rate limit, and a 429 is retried once', async () => {
  const resend = fakeResend();
  const mailer = createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: resend.fetch, minIntervalMs: 60 });
  await mailer.send({ subject: 's', text: 't', recipients: Array.from({ length: 300 }, (_, index) => ({ email: `p${index}@example.com` })) });
  const gaps = resend.calls.slice(1).map((call, index) => call.at - resend.calls[index].at);
  assert.equal(gaps.length, 2);
  gaps.forEach(gap => assert.ok(gap >= 50, `gap ${gap} ms`));

  const pauses = [];
  const busy = fakeResend({ fail: call => (call === 1 ? 429 : 0) });
  const retrying = createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: busy.fetch, minIntervalMs: 0, sleep: async ms => { pauses.push(ms); } });
  assert.deepEqual(await retrying.send({ subject: 's', text: 't', recipients: [{ email: 'x@example.org' }] }), { sent: 1 });
  assert.equal(busy.calls.length, 2);
  assert.equal(pauses.length, 1);
  const stubborn = fakeResend({ fail: () => 429 });
  const giving = createResendMailer({ apiKey: 'k', from: 'a@example.com', fetch: stubborn.fetch, minIntervalMs: 0, sleep: async () => {} });
  await assert.rejects(giving.send({ subject: 's', text: 't', recipients: [{ email: 'x@example.org' }] }), /HTTP 429/);
  assert.equal(stubborn.calls.length, 2, 'retried once only');
});

test('the owner is emailed about a question through defer, without delaying the 201', async () => {
  let release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  const deferred = [];
  const { api, store, resend } = setup({ resend: fakeResend({ gate }), defer: promise => deferred.push(promise) });
  const response = await api(post('contact', question({ name: 'Ada <b>&</b>', message: 'Hello\n\n<script>x</script>' })));
  // Answered while Resend has not replied yet.
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(deferred.length, 1);
  assert.equal(resend.calls.length, 1);
  release();
  await deferred[0];
  const { url, body } = resend.calls[0];
  assert.equal(url, RESEND_EMAILS_URL);
  assert.equal(body.from, 'Ben Morin <hello@example.com>');
  assert.deepEqual(body.to, ['owner@example.com']);
  assert.equal(body.reply_to, 'ada@example.com');
  assert.equal(body.subject, 'Question from Ada <b>&</b>');
  for (const part of ['Ada &lt;b&gt;&amp;&lt;/b&gt;', 'ada@example.com', 'contact', 'fr-FR', '&lt;script&gt;x&lt;/script&gt;', 'https://planner.test/admin/']) assert.ok(body.html.includes(part), part);
  assert.ok(!body.html.includes('<script>'));
  assert.ok(body.text.includes('Question:\nHello\n\n<script>x</script>'));
  assert.equal(await store.emailSendsOn('2026-10-09', EMAIL_SENDS_EVENT), 1);
  // The internal send count never shows up as an anonymous event.
  const summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.deepEqual(summary.eventTotals, []);
  assert.deepEqual(summary.eventDaily, []);
  assert.equal(summary.emailsSentToday, 1);
  assert.equal((await api(post('events', { name: EMAIL_SENDS_EVENT, version: '1.19.0' }))).status, 400);
});

test('email problems never fail or hold the question', async () => {
  const deferred = [];
  const hanging = setup({ resend: { fetch: () => new Promise(() => {}) }, notifyTimeoutMs: 30, defer: promise => deferred.push(promise) });
  assert.equal((await hanging.api(post('contact', question()))).status, 201);
  await deferred[0];
  assert.match(hanging.warnings[0], /did not answer/);
  assert.equal(hanging.store.data.questions.length, 1);

  const refused = setup({ resend: fakeResend({ fail: () => 401 }), defer: promise => deferred.push(promise) });
  assert.equal((await refused.api(post('contact', question()))).status, 201);
  await deferred.at(-1);
  assert.match(refused.warnings[0], /401/);
  assert.equal(await refused.store.emailSendsOn('2026-10-09', EMAIL_SENDS_EVENT), 0);

  const throwing = setup({ resend: { fetch: () => { throw new Error('network down'); } } });
  assert.equal((await throwing.api(post('contact', question()))).status, 201, 'works without defer too');

  for (const options of [{ ownerEmail: '' }, { resendApiKey: '' }]) {
    const quiet = setup({ ...options, defer: () => assert.fail('nothing to defer') });
    assert.equal((await quiet.api(post('contact', question()))).status, 201);
    assert.equal(quiet.resend.calls.length, 0);
  }
  // Spam, invalid questions and the team orders the former address refuses never email anyone.
  const strict = setup();
  await strict.api(post('contact', question({ website: 'bot' })));
  await strict.api(post('contact', question({ message: '' })));
  assert.equal((await strict.api(post('teams', question({ kind: 'invoice', company: 'Acme', teamSize: 25 })))).status, 410);
  assert.equal(strict.resend.calls.length, 0);
});

test('a question’s notification says who asked and the question, escaped, and nothing about a team', () => {
  const entry = { email: 'ann@example.com', name: 'Ann <b>', message: 'Can I move\nmy plans?', locale: 'fr-FR', source: 'contact' };
  const email = contactEmail(entry, 'https://planner.test/admin/');
  assert.equal(email.subject, 'Question from Ann <b>');
  assert.deepEqual(email.replyTo, { email: 'ann@example.com' });
  assert.ok(email.text.startsWith('Someone asked a question.\n\nName: Ann <b>\nEmail: ann@example.com\nSource: contact\nLocale: fr-FR\n\nQuestion:\nCan I move\nmy plans?\n'), email.text);
  assert.ok(email.text.includes('All questions: https://planner.test/admin/'));
  for (const line of ['Company', 'People', 'Plan', 'Currency', 'Timing', 'Request', 'team kit']) {
    assert.ok(!email.text.includes(line), `no ${line} line`);
    assert.ok(!email.html.includes(`>${line}<`), `no ${line} row`);
  }
  assert.ok(email.html.includes('Ann &lt;b&gt;'), 'escaped');
  assert.ok(!email.html.includes('Ann <b>'));
  // Without a name, the subject names the address; a line break never reaches the subject.
  assert.equal(contactEmail({ ...entry, name: '' }).subject, 'Question from ann@example.com');
  assert.equal(contactEmail({ ...entry, name: 'Ann\r\nBcc: x@example.com' }).subject, 'Question from Ann Bcc: x@example.com');
  assert.ok(!contactEmail(entry).text.includes('All questions'), 'no dashboard link without its address');
});

test('a question sent to the former address is emailed to the owner too', async () => {
  const deferred = [];
  const { api, resend } = setup({ defer: promise => deferred.push(promise) });
  assert.equal((await api(post('teams', { email: 'ann@example.com', name: 'Ann', message: 'Does it work offline?', consent: true, kind: 'question', source: 'teams' }))).status, 201);
  assert.equal((await api(post('contact', question()))).status, 201);
  await Promise.all(deferred);
  assert.deepEqual(resend.calls.map(call => call.body.subject), ['Question from Ann', 'Question from Ada']);
  assert.deepEqual(resend.calls.map(call => call.body.reply_to), ['ann@example.com', 'ada@example.com']);
  assert.ok(resend.calls[0].body.text.includes('Question:\nDoes it work offline?'));
});

test('announcements are refused clearly when email is not configured', async () => {
  const { api, store, resend } = setup({ resendApiKey: '' });
  await join(api, 2, { now: START });
  const summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.equal(summary.emailConfigured, false);
  assert.equal(summary.emailTestAvailable, false);
  assert.equal(summary.setup.email.configured, false);
  assert.equal(summary.setup.email.apiKeySet, false);
  for (const test of [true, false]) {
    const response = await api(post('admin/waitlist/announce', { ...announcement, test }, 'secret'));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /RESEND_API_KEY/);
  }
  assert.equal(store.data.waitlist.length, 2);
  assert.equal(resend.calls.length, 0);
  // Configured without an owner address: everything but the test works.
  const noOwner = setup({ ownerEmail: '' });
  assert.equal((await (await noOwner.api(get('admin/summary', 'secret'))).json()).emailTestAvailable, false);
  const refused = await noOwner.api(post('admin/waitlist/announce', { ...announcement, test: true }, 'secret'));
  assert.equal(refused.status, 503);
  assert.match((await refused.json()).error, /OWNER_EMAIL/);
});

test('announcements are owner-only and validated', async () => {
  const { api, resend } = setup();
  assert.equal((await api(post('admin/waitlist/announce', announcement))).status, 401);
  assert.equal((await api(post('admin/waitlist/announce', announcement, 'wrong'))).status, 401);
  assert.equal((await api(get('admin/waitlist/announce', 'secret'))).status, 405);
  assert.equal((await api(post('admin/waitlist/announce', { ...announcement, subject: '  ' }, 'secret'))).status, 400);
  assert.equal((await api(post('admin/waitlist/announce', { ...announcement, subject: 's'.repeat(151) }, 'secret'))).status, 400);
  assert.equal((await api(post('admin/waitlist/announce', { ...announcement, text: '' }, 'secret'))).status, 400);
  assert.equal((await api(post('admin/waitlist/announce', { ...announcement, text: 't'.repeat(8001) }, 'secret'))).status, 400);
  assert.equal(resend.calls.length, 0);
});

test('the configuration page’s test email: its own short email, to OWNER_EMAIL only, owner-only and POST only', async () => {
  const { api, store, resend, clock } = setup({ adminLimits: createAdminLimits() });
  await join(api, 2, clock);
  assert.equal((await api(post('admin/email/test', {}))).status, 401);
  assert.equal((await api(post('admin/email/test', {}, 'wrong'))).status, 401);
  assert.equal((await api(get('admin/email/test', 'secret'))).status, 405);
  assert.equal(resend.calls.length, 0);
  const response = await api(post('admin/email/test', {}, 'secret'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: 1 });
  assert.deepEqual(resend.recipients(), ['owner@example.com']);
  const [message] = resend.messages();
  assert.equal(message.subject, 'Daily Planner: test email');
  assert.match(message.text, /^This test email was sent from the configuration page of Daily Planner at 2026-10-09 08:00 UTC\./);
  assert.ok(!message.text.includes(ONE_EMAIL_FOOTER) && !/list/i.test(message.text), 'nothing about the waitlist');
  assert.equal(store.data.waitlist.length, 2, 'nobody is removed from the waitlist');
  assert.equal(await store.emailSendsOn('2026-10-09', EMAIL_SENDS_EVENT), 1, 'counted with the day’s emails, as Resend counts it');
  assert.deepEqual(ownerTestEmail({ sentAt: new Date('2026-10-21T15:32:10Z') }).text.split('\n')[0], 'This test email was sent from the configuration page of Daily Planner at 2026-10-21 15:32 UTC.');

  const unconfigured = setup({ resendApiKey: '', adminLimits: createAdminLimits() });
  const off = await unconfigured.api(post('admin/email/test', {}, 'secret'));
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /RESEND_API_KEY/);
  const noOwner = setup({ ownerEmail: '', adminLimits: createAdminLimits() });
  assert.match((await (await noOwner.api(post('admin/email/test', {}, 'secret'))).json()).error, /OWNER_EMAIL/);
});

test('the test email is rate-limited per worker isolate, and Resend’s failure never shows a part of a secret', async () => {
  const clock = { now: START };
  const { api } = setup({ clock, adminLimits: createAdminLimits({ now: () => clock.now }) });
  for (let index = 0; index < ADMIN_LIMITS.testEmail.limit; index += 1) assert.equal((await api(post('admin/email/test', {}, 'secret'))).status, 200);
  const limited = await api(post('admin/email/test', {}, 'secret'));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.match((await limited.json()).error, /^Too many test emails in a short time\. Try again in 10 minutes\.$/);
  clock.now += ADMIN_LIMITS.testEmail.windowMs + 1;
  assert.equal((await api(post('admin/email/test', {}, 'secret'))).status, 200);

  // The isolate's own limits are shared by every API it builds (the Pages Function builds one per request).
  const statuses = [];
  for (let index = 0; index <= ADMIN_LIMITS.testEmail.limit; index += 1) statuses.push((await setup().api(post('admin/email/test', {}, 'secret'))).status);
  assert.deepEqual(statuses, [...Array(ADMIN_LIMITS.testEmail.limit).fill(200), 429]);

  const key = 're_Zyxwvutsrqponmlkjihgfedcba12';
  const answer = (status, message) => async () => new Response(JSON.stringify({ statusCode: status, name: 'error', message }), { status, headers: { 'content-type': 'application/json' } });
  const cases = [
    [401, `API key ending in ${key.slice(-4)} is invalid`],
    [403, `Invalid key ${key.slice(0, 8)}****${key.slice(-6)}`],
    [422, `API key ending in ${key.slice(-4)} is invalid`],
    [422, `Invalid key ${key.slice(0, 8)}****${key.slice(-6)}`],
    [422, `Invalid key ${key.slice(0, 12)}`],
    [422, `bad key fragment ${key.slice(6, 20)}`],
    [422, `key=${encodeURIComponent(key).replace(/[A-Za-z0-9]/g, character => `%${character.charCodeAt(0).toString(16)}`)}`],
    [422, `key ${[...key].map(character => `\\u00${character.charCodeAt(0).toString(16)}`).join('')}`]
  ];
  for (const [status, message] of cases) {
    const { api: failing } = setup({ resendApiKey: key, emailFetch: answer(status, message), adminLimits: createAdminLimits() });
    const response = await failing(post('admin/email/test', {}, 'secret'));
    assert.equal(response.status, 502);
    const { error } = await response.json();
    assert.match(error, /^The test email wasn’t sent\. Resend (?:refused|answered HTTP)/, error);
    for (let start = 3; start + 4 <= key.length; start += 1) assert.ok(!error.includes(key.slice(start, start + 4)), `${status} “${message}”: ${error}`);
    if (status === 401 || status === 403) assert.ok(!error.includes('Invalid') && !error.includes('ending in'), 'nothing of Resend’s own text after a 401 or a 403');
  }
});

test('a test announcement goes only to the owner and deletes nobody', async () => {
  const { api, store, resend, clock } = setup();
  await join(api, 3, clock);
  const response = await api(post('admin/waitlist/announce', { ...announcement, test: true }, 'secret'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: 1, remaining: 3, limitReached: false, dailyLimit: 100, test: true });
  assert.deepEqual(resend.recipients(), ['owner@example.com']);
  assert.equal(resend.calls[0].url, RESEND_EMAILS_URL);
  assert.equal(resend.calls[0].body.subject, '[Test] Account sync is ready');
  assert.ok(resend.calls[0].body.html.includes(ONE_EMAIL_FOOTER));
  assert.equal(store.data.waitlist.length, 3);
  assert.equal(await store.emailSendsOn('2026-10-09', EMAIL_SENDS_EVENT), 1);
  // `test` must be exactly true; anything else is a real send.
  const real = await (await api(post('admin/waitlist/announce', { ...announcement, test: 'yes' }, 'secret'))).json();
  assert.equal(real.sent, 3);
  assert.equal(resend.calls[1].url, RESEND_BATCH_URL);
});

test('announcements go oldest first, respect the daily limit and delete each address sent', async () => {
  const { api, store, resend, clock } = setup({ emailDailyLimit: '4' });
  await join(api, 6, clock);
  // The test email counts toward the day's limit too (Resend counts every email).
  assert.equal((await api(post('admin/waitlist/announce', { ...announcement, test: true }, 'secret'))).status, 200);
  const first = await api(post('admin/waitlist/announce', announcement, 'secret'));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { sent: 3, remaining: 3, limitReached: true, dailyLimit: 4 });
  assert.deepEqual(resend.recipients().slice(1), ['person0@example.com', 'person1@example.com', 'person2@example.com']);
  assert.deepEqual(store.data.waitlist.map(row => row.email), ['person3@example.com', 'person4@example.com', 'person5@example.com']);
  const [message] = resend.calls[1].body;
  assert.equal(message.subject, 'Account sync is ready');
  assert.ok(message.html.includes('<p>It is ready.<br>\nOpen the planner.</p>'));
  assert.ok(message.html.includes(ONE_EMAIL_FOOTER));
  assert.ok(message.text.includes(ONE_EMAIL_FOOTER));
  // Each batch carries an idempotency key, so a repeated batch is never sent twice by Resend.
  assert.match(resend.calls[1].headers['idempotency-key'], /^[0-9a-f]{64}$/);
  assert.equal(resend.calls[0].headers['idempotency-key'], undefined);
  let summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.equal(summary.emailsSentToday, 4);
  assert.equal(summary.emailDailyLimit, 4);
  assert.equal(summary.emailsPerSend, EMAILS_PER_SEND);
  assert.equal(summary.waitlist.length, 3);

  // Same day: nothing more goes out.
  const blocked = await api(post('admin/waitlist/announce', announcement, 'secret'));
  assert.deepEqual(await blocked.json(), { sent: 0, remaining: 3, limitReached: true, dailyLimit: 4 });
  assert.equal(resend.calls.length, 2);

  // Next UTC day: the rest.
  clock.now = Date.parse('2026-10-10T00:00:05Z');
  const next = await api(post('admin/waitlist/announce', announcement, 'secret'));
  assert.deepEqual(await next.json(), { sent: 3, remaining: 0, limitReached: false, dailyLimit: 4 });
  assert.equal(store.data.waitlist.length, 0);
  summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.equal(summary.emailsSentToday, 3);
  assert.deepEqual(summary.eventTotals, []);
  // An empty list sends nothing.
  assert.deepEqual(await (await api(post('admin/waitlist/announce', announcement, 'secret'))).json(), { sent: 0, remaining: 0, limitReached: false, dailyLimit: 4 });
  assert.equal(resend.calls.length, 3);
});

test('a large announcement goes 100 per request, at most 10 requests per call, deleted batch by batch (memory and D1)', async t => {
  const d1 = await openSqlite(t);
  if (!d1) return;
  assert.equal(MAX_BATCHES_PER_SEND, 10);
  assert.equal(EMAILS_PER_SEND, 1000);
  for (const [label, store] of [['memory', createMemoryStore()], ['D1', createD1Store(d1)]]) {
    const { api, resend, clock } = setup({ store, emailDailyLimit: 5000 });
    await join(api, 2150, clock);
    const first = await api(post('admin/waitlist/announce', announcement, 'secret'));
    // Cloudflare's subrequest limit: one call stops after 1,000; the owner sends again.
    assert.deepEqual(await first.json(), { sent: 1000, remaining: 1150, limitReached: false, dailyLimit: 5000 }, label);
    assert.equal(resend.calls.length, 10, label);
    assert.ok(resend.calls.every(call => call.url === RESEND_BATCH_URL && call.body.length === 100), label);
    await api(post('admin/waitlist/announce', announcement, 'secret'));
    const last = await api(post('admin/waitlist/announce', announcement, 'secret'));
    assert.deepEqual(await last.json(), { sent: 150, remaining: 0, limitReached: false, dailyLimit: 5000 }, label);
    assert.deepEqual(resend.calls.slice(20).map(call => call.body.length), [100, 50], label);
    assert.equal(new Set(resend.recipients()).size, 2150, label);
    assert.equal(await store.countWaitlist(), 0, label);
    assert.equal(await store.emailSendsOn('2026-10-09', EMAIL_SENDS_EVENT), 2150, label);
  }
});

test('a refused batch deletes nobody in it; earlier accepted batches stay deleted', async () => {
  const none = setup({ resend: fakeResend({ fail: () => 422 }) });
  await join(none.api, 5, none.clock);
  const refused = await none.api(post('admin/waitlist/announce', announcement, 'secret'));
  assert.equal(refused.status, 502);
  const body = await refused.json();
  assert.equal(body.sent, 0);
  assert.equal(body.remaining, 5);
  assert.match(body.error, /Nothing was sent.*422/);
  assert.equal(none.store.data.waitlist.length, 5);
  assert.equal(await none.store.emailSendsOn('2026-10-09', EMAIL_SENDS_EVENT), 0);

  const partial = setup({ resend: fakeResend({ fail: call => (call === 2 ? 500 : 0) }), emailDailyLimit: 3000 });
  await join(partial.api, 120, partial.clock);
  const response = await partial.api(post('admin/waitlist/announce', announcement, 'secret'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.sent, 100);
  assert.equal(result.remaining, 20);
  assert.match(result.error, /Stopped after 100/);
  assert.equal(partial.store.data.waitlist[0].email, 'person100@example.com');
});

test('the waitlist answer carries a deterministic removal token', async () => {
  const { api } = setup();
  const answers = [];
  for (const body of [{ email: 'ben@example.com' }, { email: ' BEN@Example.com ' }, { email: 'ben@example.com', website: 'bot' }]) {
    const response = await api(post('waitlist', { ...body, consent: true, version: '1.19.0' }));
    assert.equal(response.status, 201);
    answers.push(await response.json());
  }
  // New, repeated and honeypot sign-ups are indistinguishable.
  answers.forEach(answer => assert.deepEqual(answer, answers[0]));
  assert.match(answers[0].removeToken, /^[0-9a-f]{64}$/);
  assert.equal(answers[0].removeToken, await waitlistRemoveToken('secret', 'ben@example.com'));
  assert.notEqual(answers[0].removeToken, await waitlistRemoveToken('secret', 'other@example.com'));
  assert.notEqual(answers[0].removeToken, await waitlistRemoveToken('rotated', 'ben@example.com'));
  assert.equal(await waitlistRemoveToken('', 'ben@example.com'), '');
});

test('people can leave the waitlist with their token (memory and D1)', async t => {
  const d1 = await openSqlite(t);
  if (!d1) return;
  for (const [label, store] of [['memory', createMemoryStore()], ['D1', createD1Store(d1)]]) {
    const { api } = setup({ store });
    const { removeToken } = await (await api(post('waitlist', { email: 'Ben@Example.com', consent: true }))).json();
    await api(post('waitlist', { email: 'ada@example.com', consent: true }));
    const otherToken = await waitlistRemoveToken('secret', 'ada@example.com');
    for (const body of [{ email: 'ben@example.com', token: otherToken }, { email: 'ben@example.com', token: removeToken.slice(0, -1) }, { email: 'ben@example.com' }, { email: 'nope', token: removeToken }, { email: 'ben@example.com', token: 42 }]) {
      assert.equal((await api(post('waitlist/remove', body))).status, 400, `${label} ${JSON.stringify(body)}`);
    }
    assert.equal(await store.countWaitlist(), 2, label);
    const removed = await api(post('waitlist/remove', { email: ' BEN@example.com', token: removeToken }));
    assert.equal(removed.status, 200, label);
    assert.deepEqual(await removed.json(), { ok: true });
    assert.deepEqual((await store.listWaitlist()).map(row => row.email), ['ada@example.com'], label);
    // Already gone: same answer.
    assert.equal((await api(post('waitlist/remove', { email: 'ben@example.com', token: removeToken }))).status, 200, label);
  }
});

test('without ADMIN_TOKEN the token is blank and removal is unavailable', async () => {
  const { api } = setup({ adminToken: '' });
  const joined = await api(post('waitlist', { email: 'ben@example.com', consent: true }));
  assert.deepEqual(await joined.json(), { ok: true, removeToken: '' });
  const response = await api(post('waitlist/remove', { email: 'ben@example.com', token: '' }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /ADMIN_TOKEN/);
});
