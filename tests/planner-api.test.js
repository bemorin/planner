import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerApi, createMemoryStore, CONTACT_SOURCES, EVENT_NAMES, TEAMS_ALIAS_GONE, validateContact, validateFeedback, validateWaitlist, toCsv } from '../server/planner-api.js';
import { createD1Store } from '../server/d1-store.js';
import { signSession, totp } from '../server/admin-auth.js';
import { readdirSync, readFileSync } from 'node:fs';

const fixedNow = () => new Date('2026-10-09T08:00:00Z');
const post = (path, body, headers = {}) => new Request(`https://planner.test/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path, token) => new Request(`https://planner.test/api/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const del = (path, token) => new Request(`https://planner.test/api/${path}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const question = (overrides = {}) => ({ email: 'Ada@Example.com', name: 'Ada', message: 'Can I move my plans to a new laptop?', website: '', version: '1.39.0', locale: 'fr-FR', source: 'contact', ...overrides });

const SCHEMA = readFileSync(new URL('../migrations/schema.sql', import.meta.url), 'utf8');
/** schema.sql's statements, one by one, without its comment. */
const schemaStatements = () => SCHEMA.replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(text => text.trim()).filter(Boolean).map(text => `${text};`);

// The questions table as a database made before 1.39 has it (it also took team orders then): schema.sql must leave
// it as it is and the API must work on it. Kept here, not read from the earlier migration files, which leave the
// repository.
const TEAM_REQUESTS_BEFORE_139 = `CREATE TABLE team_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', company TEXT NOT NULL,
  team_size INTEGER NOT NULL, timing TEXT NOT NULL, plan TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'quote', message TEXT NOT NULL DEFAULT '', locale TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'landing', created_at TEXT NOT NULL
);`;

/**
 * An in-memory SQLite behind a minimal D1 facade (prepare().bind().run()/all()). `without`: tables of schema.sql
 * left out (a database not set up yet); `before`: SQL run first (a database made by an earlier release).
 */
async function openSqlite(t, { without = [], before = '' } = {}) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite is not available in this Node version'); return null; }
  const sqlite = new DatabaseSync(':memory:');
  if (before) sqlite.exec(before);
  for (const statement of schemaStatements()) if (!without.some(table => new RegExp(`\\b${table}\\b`).test(statement))) sqlite.exec(statement);
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let params = [];
      const api = {
        bind(...values) { params = values; return api; },
        async run() { const result = statement.run(...params); return { meta: { changes: Number(result.changes) } }; },
        async all() { return { results: statement.all(...params) }; }
      };
      return api;
    }
  };
}

test('waitlist validation requires a real email and explicit consent', () => {
  assert.ok(validateWaitlist({ email: 'nope', consent: true }).error);
  assert.ok(validateWaitlist({ email: 'ben@example.com' }).error);
  const { entry } = validateWaitlist({ email: ' Ben@Example.com ', consent: true, devices: ['iphone', 'toaster', 'mac'], version: '1.18.0', driveSeen: true });
  assert.equal(entry.email, 'ben@example.com');
  assert.equal(entry.devices, 'iphone,mac');
  assert.equal(entry.driveSeen, 1);
  assert.equal(validateWaitlist({ website: 'spam', email: 'x@example.net', consent: true }).spam, true);
});

test('feedback validation needs a version and a rating or a message', () => {
  assert.ok(validateFeedback({ rating: 5 }).error, 'version is required');
  assert.ok(validateFeedback({ version: '1.18.0' }).error, 'empty feedback is rejected');
  assert.ok(validateFeedback({ version: '1.18.0', rating: 7 }).error);
  const { entry } = validateFeedback({ version: '1.18.0', rating: 4, kind: 'idea', message: '  More themes  ' });
  assert.equal(entry.rating, 4);
  assert.equal(entry.message, 'More themes');
});

test('the router counts only allow-listed events and keeps no identifiers', async () => {
  const store = createMemoryStore();
  const api = createPlannerApi({ store, adminToken: 'secret', now: fixedNow });
  assert.equal((await api(post('events', { name: 'sync_guide_opened', version: '1.18.0' }))).status, 204);
  assert.equal((await api(post('events', { name: 'sync_guide_opened', version: '1.18.0' }))).status, 204);
  assert.equal((await api(post('events', { name: 'anything_else', version: '1.18.0' }))).status, 400);
  assert.deepEqual(store.data.events, [{ day: '2026-10-09', name: 'sync_guide_opened', appVersion: '1.18.0', count: 2 }]);
});

test('waitlist sign-ups are unique and admin endpoints require the token', async () => {
  const store = createMemoryStore();
  const api = createPlannerApi({ store, adminToken: 'secret', now: fixedNow });
  const first = await api(post('waitlist', { email: 'a@example.com', consent: true, version: '1.18.0' }));
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.match(firstBody.removeToken, /^[0-9a-f]{64}$/);
  const again = await api(post('waitlist', { email: 'A@example.com', consent: true, version: '1.18.0' }));
  // A repeat sign-up looks exactly like a new one: no way to probe the list.
  assert.equal(again.status, 201);
  assert.deepEqual(await again.json(), firstBody);
  assert.equal((await api(get('admin/summary'))).status, 401);
  assert.equal((await api(get('admin/summary', 'wrong'))).status, 401);
  assert.equal((await api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: 'secret' } }))).status, 401);
  assert.equal((await api(get('admin/summary?days=abc', 'secret'))).status, 200);
  const summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.equal(summary.waitlist.length, 1);
  const id = summary.waitlist[0].id;
  const removal = await api(new Request(`https://planner.test/api/admin/waitlist/${id}`, { method: 'DELETE', headers: { authorization: 'Bearer secret' } }));
  assert.equal(removal.status, 200);
  assert.equal(store.data.waitlist.length, 0);
});

test('admin is disabled entirely without a configured token', async () => {
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: '' });
  assert.equal((await api(get('admin/summary', ''))).status, 503);
});

test('oversized and malformed bodies are rejected', async () => {
  const api = createPlannerApi({ store: createMemoryStore() });
  const headers = { 'content-type': 'application/json' };
  const big = new Request('https://planner.test/api/feedback', { method: 'POST', headers, body: JSON.stringify({ message: 'x'.repeat(20000) }) });
  assert.equal((await api(big)).status, 413);
  const bad = new Request('https://planner.test/api/feedback', { method: 'POST', headers, body: '{nope' });
  assert.equal((await api(bad)).status, 400);
  // No content-length: the body is still capped while it is read.
  const stream = new ReadableStream({ start(controller) { for (let index = 0; index < 40; index += 1) controller.enqueue(new TextEncoder().encode('x'.repeat(1024))); controller.close(); } });
  const streamed = new Request('https://planner.test/api/feedback', { method: 'POST', headers, body: stream, duplex: 'half' });
  assert.equal((await api(streamed)).status, 413);
  // A body that doesn't say it is JSON is refused before it is read (1.35).
  assert.equal((await api(new Request('https://planner.test/api/feedback', { method: 'POST', body: JSON.stringify({ message: 'x'.repeat(20000) }) }))).status, 415);
});

test('admin responses carry CORS headers for an allowed origin', async () => {
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', allowedOrigins: 'https://owner.example' });
  const response = await api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: 'Bearer secret', origin: 'https://owner.example' } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://owner.example');
  const other = await api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: 'Bearer secret', origin: 'https://evil.example' } }));
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('CSV export neutralises spreadsheet formulas', () => {
  const csv = toCsv([{ email: '=HYPERLINK("x")', note: 'a,b' }], ['email', 'note']);
  assert.equal(csv, 'email,note\n"\'=HYPERLINK(""x"")","a,b"\n');
});

test('the D1 store SQL works against SQLite with migrations/schema.sql', async t => {
  const d1 = await openSqlite(t);
  if (!d1) return;
  const store = createD1Store(d1);
  const api = createPlannerApi({ store, adminToken: 'secret', now: fixedNow });
  await api(post('events', { name: 'waitlist_joined', version: '1.18.0' }));
  await api(post('events', { name: 'waitlist_joined', version: '1.18.0' }));
  assert.equal((await api(post('waitlist', { email: 'x@example.org', consent: true, version: '1.18.0', devices: ['mac'] }))).status, 201);
  assert.equal((await api(post('waitlist', { email: 'x@example.org', consent: true, version: '1.18.0' }))).status, 201);
  await api(post('feedback', { version: '1.18.0', rating: 5, message: 'Love Horizon' }));
  await api(post('feedback', { version: '1.18.0', rating: 3 }));
  await api(post('feedback', { version: '1.17.0', message: 'Bug in year map' }));
  const summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.deepEqual(summary.eventTotals, [{ name: 'waitlist_joined', appVersion: '1.18.0', count: 2 }]);
  assert.equal(summary.waitlist.length, 1);
  const latest = summary.feedbackByVersion.find(row => row.appVersion === '1.18.0');
  assert.equal(latest.count, 2);
  assert.equal(latest.avgRating, 4);
  assert.equal(summary.feedbackByVersion[0].appVersion, '1.18.0', 'newest version first');

  // Questions (POST contact).
  assert.equal(summary.questionsUnavailable, false);
  assert.equal(summary.questionCount, 0);
  assert.equal((await api(post('contact', question()))).status, 201);
  assert.equal((await api(post('contact', question({ name: '=cmd|calc', source: 'app', version: 'beta' })))).status, 201);
  assert.equal((await api(post('contact', question({ website: 'bot' })))).status, 201);
  assert.equal((await api(post('contact', question({ message: '' })))).status, 400);
  const asked = await (await api(get('admin/summary', 'secret'))).json();
  assert.equal(asked.questionCount, 2);
  assert.equal(asked.questions.length, 2);
  const [newest] = asked.questions;
  assert.deepEqual({ ...newest, id: 0 }, { id: 0, email: 'ada@example.com', name: '=cmd|calc', company: '', teamSize: 0, kind: 'question', message: 'Can I move my plans to a new laptop?', locale: 'fr-FR', appVersion: '', source: 'app', createdAt: '2026-10-09T08:00:00.000Z' });
  const csv = await (await api(get('admin/questions?format=csv', 'secret'))).text();
  assert.match(csv, /^id,createdAt,name,email,message,source,locale,appVersion,kind,company,teamSize\n/);
  assert.ok(csv.includes(",'=cmd|calc,"), 'formula neutralised in CSV');
  assert.equal((await api(del(`admin/questions/${newest.id}`, 'secret'))).status, 200);
  assert.equal((await api(del(`admin/questions/${newest.id}`, 'secret'))).status, 404);
  assert.equal((await (await api(get('admin/questions', 'secret'))).json()).rows.length, 1);
  // Bound parameters only: a hostile value is stored verbatim, not executed.
  await api(post('contact', question({ message: "x'); DROP TABLE team_requests; --" })));
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM team_requests').get().n, 2);
});

test('the summary survives a D1 database without the questions table, until schema.sql is applied', async t => {
  const d1 = await openSqlite(t, { without: ['team_requests'] });
  if (!d1) return;
  const api = createPlannerApi({ store: createD1Store(d1), adminToken: 'secret', now: fixedNow });
  const response = await api(get('admin/summary', 'secret'));
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.questionsUnavailable, true);
  assert.deepEqual(summary.questions, []);
  assert.equal(summary.questionCount, 0);
  // A question meanwhile says what to do, never a stack trace.
  const refused = await api(post('contact', question()));
  assert.equal(refused.status, 503);
  assert.match((await refused.json()).error, /migrations\/schema\.sql/);
  // Applying schema.sql later (or twice) is safe.
  for (let round = 0; round < 2; round += 1) for (const statement of schemaStatements()) d1.sqlite.exec(statement);
  assert.equal((await (await api(get('admin/summary', 'secret'))).json()).questionsUnavailable, false);
  assert.equal((await api(post('contact', question()))).status, 201);
});

test('a question is validated with human messages, and nothing but the question is kept', () => {
  const now = new Date('2026-10-09T08:00:00Z');
  const { entry } = validateContact(question({ email: ' Ada@Example.com ' }), now);
  assert.deepEqual(entry, { email: 'ada@example.com', name: 'Ada', message: 'Can I move my plans to a new laptop?', locale: 'fr-FR', appVersion: '1.39.0', source: 'contact', createdAt: '2026-10-09T08:00:00.000Z' });
  // What an older page also sent (a kind, a team, a plan, a partner code, the box it had to tick) is not kept.
  const older = question({ kind: 'invoice', company: 'Acme', teamSize: 25, timing: 'q1-2027', plan: 'up-to-50', currency: 'EUR', ref: 'COACH_ANNA', consent: true });
  assert.deepEqual(validateContact(older, now).entry, entry);
  for (const value of [undefined, false, 'yes', 'on']) assert.deepEqual(validateContact(question({ consent: value }), now).entry, entry, `consent: ${value}`);
  assert.equal(validateContact(question({ website: 'https://spam.example' })).spam, true);
  for (const [label, overrides, words] of [
    ['invalid email', { email: 'not-an-email' }, /valid email address/],
    ['no question', { message: '   ' }, /write your question/],
    ['question over 1000', { message: 'm'.repeat(1001) }, /1,000 characters/],
    ['name over 80', { name: 'n'.repeat(81) }, /80 characters/]
  ]) assert.match(validateContact(question(overrides), now).error || '', words, label);
  assert.ok(validateContact(question({ name: 'n'.repeat(80), message: 'm'.repeat(1000) })).entry);
  assert.equal(validateContact(question({ name: undefined })).entry.name, '', 'the name is optional');
  assert.doesNotMatch(validateContact(question({ email: 'nope' })).error, /work email/, 'any address, not a work one');
  assert.equal(validateContact(question({ version: '1.18' })).entry.appVersion, '', 'unknown version stored blank');
  assert.deepEqual([...CONTACT_SOURCES], ['contact', 'app', 'landing']);
  for (const source of CONTACT_SOURCES) assert.equal(validateContact(question({ source })).entry.source, source);
  for (const source of [undefined, 'teams', 'partner', 'Contact']) assert.equal(validateContact(question({ source })).entry.source, 'contact', String(source));
  assert.equal(validateContact(question({ locale: 'x'.repeat(50) })).entry.locale.length, 35);
});

test('questions are stored, listed, exported and deletable', async () => {
  const store = createMemoryStore();
  const api = createPlannerApi({ store, adminToken: 'secret', now: fixedNow });
  const first = await api(post('contact', question()));
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { ok: true });
  // A repeat question is stored and answered exactly like a new one.
  const repeat = await api(post('contact', question({ name: '+Ada', message: 'line one\nline, two' })));
  assert.equal(repeat.status, 201);
  assert.deepEqual(await repeat.json(), { ok: true });
  const spam = await api(post('contact', question({ website: 'x' })));
  assert.equal(spam.status, 201);
  assert.deepEqual(await spam.json(), { ok: true });
  assert.equal(store.data.questions.length, 2, 'honeypot submissions are not stored');
  const invalid = await api(post('contact', question({ email: 'someone' })));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /email/);
  assert.equal(store.data.questions.length, 2);

  assert.equal((await api(get('admin/questions'))).status, 401);
  const summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.equal(summary.questions.length, 2);
  assert.equal(summary.questionCount, 2);
  assert.equal(summary.questionsUnavailable, false);
  for (const gone of ['teamRequests', 'teamRequestTotals', 'teamRequestsUnavailable', 'purchases', 'gifts', 'partners', 'refunds', 'sales']) assert.equal(gone in summary, false, gone);
  const { rows } = await (await api(get('admin/questions', 'secret'))).json();
  assert.equal(rows.length, 2);
  const csvResponse = await api(get('admin/questions?format=csv', 'secret'));
  assert.equal(csvResponse.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(csvResponse.headers.get('content-disposition'), /daily-planner-questions\.csv/);
  const csv = await csvResponse.text();
  assert.ok(csv.includes(`'+Ada`), 'formula-looking name neutralised');
  assert.ok(csv.includes('"line one\nline, two"'), 'multi-line message quoted');
  const id = rows.find(row => row.name === 'Ada').id;
  assert.equal((await api(del(`admin/questions/${id}`, 'secret'))).status, 200);
  assert.equal((await api(del(`admin/questions/${id}`, 'secret'))).status, 404);
  assert.equal(store.data.questions.length, 1);
  // The team orders' admin route went with them.
  assert.equal((await api(get('admin/teams', 'secret'))).status, 404);
});

test('POST teams stays an alias of POST contact for questions only, for one release', async () => {
  const store = createMemoryStore();
  const api = createPlannerApi({ store, adminToken: 'secret', now: fixedNow });
  // A Contact page cached from 1.38 sends its question here, with kind 'question' and source 'teams'.
  const cached = await api(post('teams', question({ kind: 'question', source: 'teams', consent: true })));
  assert.equal(cached.status, 201);
  assert.deepEqual(await cached.json(), { ok: true });
  assert.equal((await api(post('teams', question()))).status, 201, 'no kind: a question');
  assert.equal((await api(post('teams', question({ kind: 'question', message: '' })))).status, 400, 'checked like any question');
  // Team orders are gone: an invoice, a quote or a talk is refused, and nothing is stored.
  for (const kind of ['invoice', 'quote', 'talk', '', 'gift']) {
    const response = await api(post('teams', question({ kind, company: 'Acme', teamSize: 25, timing: 'q1-2027' })));
    assert.equal(response.status, 410, kind);
    assert.deepEqual(await response.json(), { error: TEAMS_ALIAS_GONE, gone: true }, kind);
  }
  assert.match(TEAMS_ALIAS_GONE, /Contact page/);
  const { rows } = await (await api(get('admin/questions', 'secret'))).json();
  assert.deepEqual(rows.map(row => [row.kind, row.source, row.company, row.teamSize]), [['question', 'contact', '', 0], ['question', 'contact', '', 0]]);
});

test('the routes of the paid add-on answer 410 Gone with any method; unknown paths 404; 405 only for a known path (1.39)', async () => {
  const store = createMemoryStore();
  const api = createPlannerApi({ store, adminToken: 'secret', now: fixedNow });
  const send = (method, path, body) => new Request(`https://planner.test/api/${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  // A 1.38.1 planner still asks GET checkout, to learn whether sales are open.
  const checkout = await api(get('checkout'));
  assert.equal(checkout.status, 410);
  assert.deepEqual(await checkout.json(), { error: 'GONE' });
  for (const path of ['checkout', 'checkout/session', 'purchases', 'purchases/ch_example0001', 'plus', 'plus/verify', 'plus/status', 'gifts', 'gifts/redeem', 'partners', 'partners/apply', 'creem', 'creem/webhook', 'health/config']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD']) {
      const response = await api(send(method, path, ['GET', 'HEAD'].includes(method) ? undefined : { key: 'EXAMPLE' }));
      assert.equal(response.status, 410, `${method} ${path}`);
      if (method !== 'HEAD') assert.deepEqual(await response.json(), { error: 'GONE' }, `${method} ${path}`);
    }
  }
  const foreign = await api(new Request('https://planner.test/api/creem/webhook', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }));
  assert.equal(foreign.status, 410, 'gone before any other check: a webhook still configured somewhere learns it at once');

  for (const path of ['nothing-here', 'pluses', 'checkouts', 'healthz', 'health/other', 'events/extra', '']) {
    assert.equal((await api(get(path))).status, 404, `GET ${path || '(root)'}`);
    assert.equal((await api(post(path, {}))).status, 404, `POST ${path || '(root)'}`);
  }

  assert.equal((await api(get('health'))).status, 200);
  assert.equal((await api(post('health', {}))).status, 405, 'health takes a GET');
  for (const path of ['events', 'waitlist', 'waitlist/remove', 'feedback', 'contact', 'teams']) {
    assert.equal((await api(get(path))).status, 405, `GET ${path}`);
    assert.equal((await api(send('PUT', path, {}))).status, 405, `PUT ${path}`);
  }
  assert.equal((await api(get('csp-report'))).status, 405);
  assert.deepEqual(store.data.events, []);
});

test('landing events are allow-listed anonymous counts', async () => {
  const store = createMemoryStore();
  const api = createPlannerApi({ store, now: fixedNow });
  const names = ['landing_viewed', 'landing_cta_app', 'year_plan_completed', 'quarter_review_completed', 'year_review_opened', 'review_sent', 'share_image_created'];
  for (const name of names) {
    assert.ok(EVENT_NAMES.has(name), name);
    assert.equal((await api(post('events', { name, version: '1.39.0' }))).status, 204, name);
  }
  assert.deepEqual(store.data.events.map(row => row.name), names);
});

test('the events of sales, gifts, team orders and partners are refused (1.39)', async () => {
  const store = createMemoryStore();
  const api = createPlannerApi({ store, now: fixedNow });
  const gone = ['plus_modal_opened', 'plus_checkout_clicked', 'plus_unlocked', 'plus_viewed', 'gift_opened', 'gift_redeemed', 'gift_link_copied', 'pack_checkout_clicked', 'pricing_viewed', 'teams_viewed', 'team_form_opened', 'team_request_sent', 'manager_email_opened', 'partners_viewed', 'partner_cta_clicked'];
  for (const name of gone) {
    assert.equal(EVENT_NAMES.has(name), false, name);
    assert.equal((await api(post('events', { name, version: '1.38.1' }))).status, 400, name);
  }
  assert.deepEqual(store.data.events, []);
});

/** Event names of COUNTED_EVENTS and LANDING_EVENTS, read from the client source as text. */
function clientEventNames() {
  const source = readFileSync(new URL('../src/lib/planner-api.js', import.meta.url), 'utf8');
  const names = [];
  for (const [list, least] of [['COUNTED_EVENTS', 5], ['LANDING_EVENTS', 2]]) {
    const block = new RegExp(`export const ${list} = Object\\.freeze\\(\\[([\\s\\S]*?)\\n\\]\\);`).exec(source);
    assert.ok(block, `${list} found in src/lib/planner-api.js`);
    const found = [...block[1].matchAll(/^\s*\[\s*'([a-z0-9_]+)'\s*,/gm)].map(match => match[1]);
    assert.ok(found.length >= least, `${list} lists its events`);
    names.push(...found);
  }
  return new Set(names);
}

test('the server accepts exactly the events the planner and the landing page may count', async () => {
  const client = clientEventNames();
  assert.deepEqual([...EVENT_NAMES].filter(name => !client.has(name)).sort(), [], 'accepted by the server but never sent');
  assert.deepEqual([...client].filter(name => !EVENT_NAMES.has(name)).sort(), [], 'sent by a client but refused by the server');
  assert.ok(EVENT_NAMES.has('landing_viewed') && EVENT_NAMES.has('app_active_month') && EVENT_NAMES.has('review_sent'));
  const store = createMemoryStore();
  const api = createPlannerApi({ store, now: fixedNow });
  for (const name of client) assert.equal((await api(post('events', { name, version: '1.21.0' }))).status, 204, name);
  assert.equal(store.data.events.length, client.size);
  assert.equal((await api(post('events', { name: 'internal:email_sent', version: '1.21.0' }))).status, 400, 'internal rows can never be sent');
  assert.equal((await api(post('events', { name: 'plus_purchased_secretly', version: '1.20.0' }))).status, 400);
});

test('two-factor sign-in issues a signed 8-hour session', async () => {
  let clock = Date.parse('2026-10-09T08:00:00Z');
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', adminTotpSecret: TOTP_SECRET, now: () => new Date(clock), authFailureDelayMs: 0 });
  const code = await totp(TOTP_SECRET, clock);
  const response = await api(post('admin/session', { token: 'secret', code }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { session, expiresAt } = await response.json();
  assert.match(session, /^v1\.\d+\.[0-9a-f]{64}$/);
  assert.equal(expiresAt, '2026-10-09T16:00:00.000Z');
  assert.equal((await api(get('admin/summary', session))).status, 200);
  assert.equal((await api(get('admin/questions?format=csv', session))).status, 200);
  // With two-factor on, the raw token alone never opens the data.
  assert.equal((await api(get('admin/summary', 'secret'))).status, 401);
  // A code from the previous 30-second step is still accepted (clock drift).
  assert.equal((await api(post('admin/session', { token: 'secret', code: await totp(TOTP_SECRET, clock - 30000) }))).status, 200);
  assert.equal((await api(post('admin/session', { token: 'secret', code: await totp(TOTP_SECRET, clock - 60000) }))).status, 401);
  assert.equal((await api(new Request('https://planner.test/api/admin/session'))).status, 405);
  // Bearer prefix still required; a tampered session is refused.
  assert.equal((await api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: session } }))).status, 401);
  assert.equal((await api(get('admin/summary', session.replace(/.$/, session.endsWith('0') ? '1' : '0')))).status, 401);
  // Eight hours later the session has expired.
  clock += 8 * 3600 * 1000 - 1;
  assert.equal((await api(get('admin/summary', session))).status, 200);
  clock += 1;
  assert.equal((await api(get('admin/summary', session))).status, 401);
});

test('knowing ADMIN_TOKEN alone cannot mint a session once two-factor is on', async () => {
  const clock = Date.parse('2026-10-09T08:00:00Z');
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', adminTotpSecret: TOTP_SECRET, now: () => new Date(clock), authFailureDelayMs: 0 });
  const forged = await signSession('secret', clock + 3600000);
  assert.equal((await api(get('admin/summary', forged))).status, 401);
  // A session issued before two-factor was switched on stops working too.
  const before = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', now: () => new Date(clock), authFailureDelayMs: 0 });
  const { session } = await (await before(post('admin/session', { token: 'secret' }))).json();
  assert.equal((await before(get('admin/summary', session))).status, 200);
  assert.equal((await api(get('admin/summary', session))).status, 401);
});

test('emails that would add fields to a mailto: link are refused', () => {
  for (const email of ['someone@example.com?bcc=spy%40example.net', 'a@example.com&subject=x', 'a@exa%6dple.com', 'a?x=1@example.com', 'a@exam/ple.com']) {
    assert.ok(validateContact(question({ email })).error, email);
    assert.ok(validateWaitlist({ email, consent: true }).error, email);
  }
  for (const email of ['lea@example.org', 'tester+m@example.com', 'first.last@mail.example.org']) {
    assert.equal(validateContact(question({ email })).error, undefined, email);
  }
});

test('a failed sign-in looks the same whether the token or the code was wrong', async () => {
  const clock = Date.parse('2026-10-09T08:00:00Z');
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', adminTotpSecret: TOTP_SECRET, now: () => new Date(clock) });
  const code = await totp(TOTP_SECRET, clock);
  const wrongCode = code === '000000' ? '111111' : '000000';
  const attempts = [
    { token: 'wrong', code },
    { token: 'secret', code: wrongCode },
    { token: 'secret' },
    { token: 'secret', code: '' },
    {}
  ];
  const answers = [];
  for (const body of attempts) {
    const started = Date.now();
    const response = await api(post('admin/session', body));
    const elapsed = Date.now() - started;
    answers.push({ status: response.status, body: await response.text(), headers: [...response.headers.entries()] });
    assert.ok(elapsed >= 350, `failures are delayed (${elapsed} ms)`);
  }
  answers.forEach(answer => assert.deepEqual(answer, answers[0]));
  assert.equal(answers[0].status, 401);
  assert.equal(answers[0].body, JSON.stringify({ error: 'Unauthorized' }));
  const invalidJson = await api(new Request('https://planner.test/api/admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' }));
  assert.equal(invalidJson.status, 401);
  // Sign-in is JSON only (1.35): a cross-site form can't post to it.
  assert.equal((await api(new Request('https://planner.test/api/admin/session', { method: 'POST', body: '{"token":"secret"}' }))).status, 415);
});

test('without two-factor the raw token still works and sign-in needs only the token', async () => {
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', now: fixedNow, authFailureDelayMs: 0 });
  assert.equal((await api(get('admin/summary', 'secret'))).status, 200);
  const response = await api(post('admin/session', { token: 'secret', code: '' }));
  assert.equal(response.status, 200);
  const { session } = await response.json();
  assert.equal((await api(get('admin/summary', session))).status, 200);
  assert.equal((await api(post('admin/session', { token: 'secret', code: '123456' }))).status, 200, 'a code is ignored when 2FA is off');
  assert.equal((await api(post('admin/session', { token: 'nope' }))).status, 401);
  // A session signed with another ADMIN_TOKEN is refused.
  const other = createPlannerApi({ store: createMemoryStore(), adminToken: 'rotated', now: fixedNow, authFailureDelayMs: 0 });
  assert.equal((await other(get('admin/summary', session))).status, 401);
});

test('admin sign-in fails closed when the token or the TOTP secret is unusable', async () => {
  const noToken = createPlannerApi({ store: createMemoryStore(), adminToken: '', adminTotpSecret: TOTP_SECRET });
  const missing = await noToken(post('admin/session', { token: '', code: '' }));
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /ADMIN_TOKEN/);
  for (const secret of ['not base32!', 'ABCDEFGH']) {
    const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', adminTotpSecret: secret, authFailureDelayMs: 0 });
    const response = await api(post('admin/session', { token: 'secret', code: '123456' }));
    assert.equal(response.status, 503, secret);
    assert.match((await response.json()).error, /ADMIN_TOTP_SECRET/);
    assert.equal((await api(get('admin/summary', 'secret'))).status, 503, 'never falls back to token-only access');
  }
});

test('sign-in answers CORS headers for an allowed origin', async () => {
  const clock = Date.parse('2026-10-09T08:00:00Z');
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', adminTotpSecret: TOTP_SECRET, allowedOrigins: 'https://owner.example', now: () => new Date(clock), authFailureDelayMs: 0 });
  const origin = { origin: 'https://owner.example' };
  const preflight = await api(new Request('https://planner.test/api/admin/session', { method: 'OPTIONS', headers: origin }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://owner.example');
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  const ok = await api(post('admin/session', { token: 'secret', code: await totp(TOTP_SECRET, clock) }, origin));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://owner.example');
  const refused = await api(post('admin/session', { token: 'wrong', code: '000000' }, origin));
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get('access-control-allow-origin'), 'https://owner.example');
  const elsewhere = await api(post('admin/session', { token: 'secret', code: await totp(TOTP_SECRET, clock) }, { origin: 'https://evil.example' }));
  assert.equal(elsewhere.headers.get('access-control-allow-origin'), null);
});

test('schema.sql runs when the D1 console joins it into one line, and again on top', async t => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite is not available in this Node version'); return; }
  // A line comment would swallow every statement after it once lines are joined.
  assert.ok(!SCHEMA.includes('--'), 'schema.sql has no "--"');
  assert.equal((SCHEMA.match(/\/\*/g) || []).length, 1, 'schema.sql has one block comment');
  assert.doesNotMatch(SCHEMA, /\b(DROP|ALTER|DELETE|UPDATE|INSERT|REPLACE)\b/i, 'it only creates what is missing');
  assert.doesNotMatch(SCHEMA.replace(/\/\*[\s\S]*?\*\//g, ''), /CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/, 'every object only if it does not exist');
  const flat = SCHEMA.replace(/\r?\n/g, ' ');
  assert.ok(/;\s*$/.test(flat), 'schema.sql ends with ";"');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(flat);
  sqlite.exec(flat);
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables, ['csp_reports', 'events', 'feedback', 'rate_limit_salts', 'rate_limits', 'reviews', 'team_requests', 'waitlist']);
  const columns = sqlite.prepare('PRAGMA table_info(team_requests)').all();
  const column = name => columns.find(row => row.name === name);
  assert.deepEqual(['company', 'team_size', 'timing', 'kind', 'source'].map(name => [column(name)?.notnull, column(name)?.dflt_value]), [[1, "''"], [1, '0'], [1, "''"], [1, "'question'"], [1, "'contact'"]]);
  assert.equal(column('plan'), undefined, 'no plan or currency on a fresh install');
});

test('the migrations folder holds the fresh-install schema only, and the server reads no table of the sales', () => {
  const sql = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql'));
  assert.ok(sql.includes('schema.sql'));
  // The numbered files (0001 to 0010) built the production database release by release; they move to the owner's
  // private archive, and production keeps the tables they made (docs/configuration.md).
  for (const name of sql) assert.ok(name === 'schema.sql' || /^00(0[1-9]|10)_[a-z_]+\.sql$/.test(name), name);
  const tablesOfSales = ['purchases', 'gifts', 'revocations', 'held_payments', 'orders', 'payments', 'refunds', 'checkout_records', 'free_orders', 'team_request_partners', 'partner_[a-z_]+'];
  const code = ['server', 'functions/api'].flatMap(folder => readdirSync(new URL(`../${folder}/`, import.meta.url)).filter(name => name.endsWith('.js')).map(name => [`${folder}/${name}`, readFileSync(new URL(`../${folder}/${name}`, import.meta.url), 'utf8')]));
  assert.ok(code.some(([name]) => name === 'server/d1-store.js'));
  for (const [name, source] of code) {
    for (const table of tablesOfSales) assert.doesNotMatch(source, new RegExp(`\\b(FROM|INTO|JOIN|UPDATE|TABLE)\\s+${table}\\b`, 'i'), `${name} reads ${table}`);
  }
});

test('schema.sql leaves a database made before 1.39 as it is, and the API works on it', async t => {
  // A 1.38 production database: the questions table with its team columns and an earlier team request, and a
  // table of the sales that the free server never reads.
  const before = `${TEAM_REQUESTS_BEFORE_139}
    INSERT INTO team_requests (email, name, company, team_size, timing, plan, currency, kind, message, created_at) VALUES ('lead@example.com', 'Lea', 'Acme', 25, 'q1-2027', 'up-to-50', 'EUR', 'invoice', 'For January', '2026-09-01T08:00:00.000Z');
    CREATE TABLE purchases (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
    INSERT INTO purchases (email) VALUES ('buyer@example.com');`;
  const d1 = await openSqlite(t, { before });
  if (!d1) return;
  const columns = () => d1.sqlite.prepare('PRAGMA table_info(team_requests)').all().map(row => `${row.name}:${row.notnull}:${row.dflt_value}`);
  const kept = columns();
  for (const statement of schemaStatements()) d1.sqlite.exec(statement);
  assert.deepEqual(columns(), kept, 'the questions table keeps its columns and defaults');
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM purchases').get().n, 1, 'a table of the sales stays, untouched');
  const api = createPlannerApi({ store: createD1Store(d1), adminToken: 'secret', now: fixedNow });
  assert.equal((await api(post('contact', question()))).status, 201);
  const summary = await (await api(get('admin/summary', 'secret'))).json();
  assert.equal(summary.questionsUnavailable, false);
  assert.equal(summary.questionCount, 2);
  assert.deepEqual(summary.questions.map(row => [row.kind, row.company, row.teamSize, row.source]), [['question', '', 0, 'contact'], ['invoice', 'Acme', 25, 'landing']], 'an earlier team request still reads');
  // A question fills the columns a 1.38 table requires (NOT NULL without a default) and leaves plan and currency blank.
  assert.deepEqual({ ...d1.sqlite.prepare("SELECT company, team_size, timing, plan, currency, kind FROM team_requests WHERE kind = 'question'").get() }, { company: '', team_size: 0, timing: '', plan: '', currency: '', kind: 'question' });
  const earlier = summary.questions.find(row => row.kind === 'invoice');
  assert.equal((await api(del(`admin/questions/${earlier.id}`, 'secret'))).status, 200, 'an earlier request can be deleted');
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM purchases').get().n, 1);
});
