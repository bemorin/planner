import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The anonymous usage counts on the owner dashboard (1.34.1): the owner's own
// browsers are kept out of them (admin/usage-counts.js, the planner's shared
// choice in src/lib/planner-api.js), and “Start fresh” deletes the
// counts recorded so far — and nothing else — after RESET typed in a dialog
// and sent to the server (GET admin/usage-counts, POST admin/usage-counts/reset).

// The API on, and the browser pieces the counts touch, before importing them.
globalThis.__DAILY_PLANNER_CONFIG__ = { PLANNER_API_URL: '/api/' };
const stored = new Map();
const storage = { getItem: key => (stored.has(key) ? stored.get(key) : null), setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) };
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
const sent = [];
globalThis.fetch = async (url, options = {}) => {
  sent.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

const client = await import('../src/lib/planner-api.js');
const {
  browserLine, countBrowser, dayRange, freshDialogHtml, freshDoneText, freshStartHtml, keepBrowserOut, OWNER_COUNTED_KEY, readCounts, RESET_WORD, resetMatches
} = await import('../admin/usage-counts.js');
const { createMemoryStore, createPlannerApi, EMAIL_SENDS_EVENT, USAGE_RESET_CONFIRM } = await import('../server/planner-api.js');
const { createD1Store } = await import('../server/d1-store.js');
const { ADMIN_LIMITS, createAdminLimits } = await import('../server/admin-limits.js');

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-23T08:00:00Z');
const at = (method, path, body, token) => new Request(`https://planner.test/api/${path}`, {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const get = (path, token) => at('GET', path, undefined, token);
const post = (path, body, token) => at('POST', path, body, token);
const asJson = async response => ({ status: response.status, body: await response.json() });

// ---- This browser ------------------------------------------------------------------

test('signing in keeps this browser out of the counts: no count, until the owner counts it again', () => {
  stored.clear();
  sent.length = 0;
  assert.equal(client.usageCountsEnabled(storage), true, 'on by default');
  // Signing in (and every load signed in) switches them off, in the key the planner and the public pages read.
  assert.equal(keepBrowserOut(storage), false);
  assert.equal(stored.get(client.USAGE_COUNTS_KEY), 'off');
  assert.equal(client.USAGE_COUNTS_KEY, 'daily-planner-ui:usage-counts');
  client.trackEvent('landing_viewed');
  client.trackOncePer('day', 'app_active_day', { storage });
  assert.deepEqual(sent, [], 'nothing counted from this browser: visits, planner use');
  // The owner counts this browser again: it stays counted on the next load.
  assert.equal(countBrowser(true, storage), true);
  assert.equal(stored.get(OWNER_COUNTED_KEY), 'on');
  assert.equal(keepBrowserOut(storage), true, 'the next load leaves it counted');
  client.trackEvent('landing_viewed');
  assert.deepEqual(sent.map(entry => entry.url), ['/api/events']);
  // …and out again: the next load keeps it out.
  assert.equal(countBrowser(false, storage), false);
  assert.equal(stored.has(OWNER_COUNTED_KEY), false);
  client.setUsageCountsEnabled(true, storage);
  assert.equal(keepBrowserOut(storage), false, 'switched on elsewhere (the planner’s privacy notice): off again on the next load');
  // A storage that refuses never breaks the dashboard.
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => keepBrowserOut(broken));
  assert.doesNotThrow(() => countBrowser(true, broken));
  // Site data blocked: reading localStorage throws; the dashboard still loads (and can't keep this browser out).
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.equal(keepBrowserOut(), true);
    assert.equal(countBrowser(false), true);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  }
});

test('the header line says whether this browser is counted', () => {
  assert.deepEqual(browserLine(false), { title: 'This browser isn’t counted', detail: 'Visits and planner use from here stay out of the figures.' });
  assert.equal(browserLine(true).title, 'This browser is counted');
  const page = read('admin/index.html');
  const head = page.slice(page.indexOf('<header class="owner-head">'), page.indexOf('</header>'));
  assert.match(head, /<div class="owner-browser" data-owner-browser hidden>/, 'in the header, shown once signed in');
  assert.match(head, /<b data-owner-browser-title>This browser isn’t counted<\/b>/);
  assert.match(head, /<label class="owner-browser__toggle"><input class="privacy-switch" type="checkbox" role="switch" data-owner-browser-count><span>Count this browser<\/span><\/label>/);
  const admin = read('admin/admin.js');
  assert.match(admin, /saveSession\(\{ session: body\.session, expiresAt \}\);\n {4}\/\/ [^\n]*\n {4}keepBrowserOut\(\);/, 'on sign-in');
  assert.match(admin, /renderBrowser\(keepBrowserOut\(\)\);/, 'and on every load signed in');
  assert.match(admin, /\$\('\[data-owner-browser-count\]'\)\.addEventListener\('change', event => renderBrowser\(countBrowser\(event\.target\.checked\)\)\);/);
  assert.match(admin, /\$\('\[data-owner-browser\]'\)\.hidden = view !== 'dashboard';/);
});

// ---- Start fresh: the words ----------------------------------------------------------

test('Start fresh asks for RESET, give or take case and spaces', () => {
  assert.equal(RESET_WORD, USAGE_RESET_CONFIRM, 'the word the server checks');
  for (const typed of ['RESET', 'reset', '  Reset ']) assert.equal(resetMatches(typed), true, typed);
  for (const typed of ['', 'RESETS', 'RE SET', 'yes', null]) assert.equal(resetMatches(typed), false, String(typed));
});

test('what is recorded, read defensively, and the days it covers', () => {
  assert.equal(readCounts(null), null);
  assert.deepEqual(readCounts({ rows: '210', count: 1234.7, firstDay: '2026-10-03', lastDay: '2026-10-23' }), { rows: 210, count: 1234, firstDay: '2026-10-03', lastDay: '2026-10-23' });
  assert.deepEqual(readCounts({ rows: -4, firstDay: 'soon', lastDay: '2026-10-23' }), { rows: 0, count: 0, firstDay: '', lastDay: '2026-10-23' });
  assert.deepEqual(readCounts({ rows: 1, count: 2, firstDay: '2026-10-23' }), { rows: 1, count: 2, firstDay: '2026-10-23', lastDay: '2026-10-23' });
  // UTC days, whatever the clock; spacing round the dash depends on the ICU data.
  const plain = text => text.replace(/\s/g, ' ');
  assert.match(plain(dayRange('2026-10-03', '2026-10-23', 'en-GB')), /^3 ?– ?23 Oct 2026$/);
  assert.equal(dayRange('2026-10-23', '2026-10-23', 'en-GB'), '23 Oct 2026');
  assert.match(plain(dayRange('2025-12-30', '2026-01-02', 'en-GB')), /^30 Dec 2025 ?– ?2 Jan 2026$/);
  assert.equal(dayRange('', ''), '');
});

test('the card says what Start fresh deletes, what it keeps, and what is recorded now', () => {
  const range = (from, to) => `${from} to ${to}`;
  const counts = readCounts({ rows: 210, count: 1234, firstDay: '2026-10-03', lastDay: '2026-10-23' });
  const html = freshStartHtml(counts, { number: String, range });
  assert.match(html, /<h2 id="owner-fresh-title">Start fresh<\/h2>/);
  assert.match(html, /Deletes the anonymous usage counts recorded so far, test runs included/);
  assert.match(html, /Questions, the waitlist, feedback and reviews stay as they are\./);
  assert.match(html, /Browsers where you signed in here are already left out\./);
  assert.match(html, /<b data-owner-fresh-now>1234 counts in 210 rows<\/b><small>2026-10-03 to 2026-10-23<\/small>/);
  assert.match(html, /<button class="secondary-button" type="button" data-owner-fresh-start>Start fresh…<\/button>/);
  assert.match(html, /data-owner-fresh-result role="status" aria-live="polite" tabindex="-1" hidden>/);
  const empty = freshStartHtml(readCounts({ rows: 0 }), { number: String, range });
  assert.match(empty, /<b data-owner-fresh-now>Nothing counted yet<\/b><\/p>/);
  assert.match(empty, /data-owner-fresh-start disabled>/, 'nothing to delete: the button can’t be used');
  assert.match(freshStartHtml(null, { number: String }), /The counts could not be read\.[\s\S]*data-owner-fresh-start disabled>/);
  assert.match(freshStartHtml(counts, { number: String, range, result: { text: 'Deleted <b>', error: true } }), /class="owner-result is-error"[^>]*>Deleted &lt;b&gt;<\/p>/, 'escaped');
});

test('the dialog names the rows, the counts and the days before anything is deleted', () => {
  const counts = readCounts({ rows: 210, count: 1234, firstDay: '2026-10-03', lastDay: '2026-10-23' });
  const html = freshDialogHtml(counts, { number: String, range: () => '3–23 Oct 2026' });
  assert.match(html, /<h2 id="owner-fresh-dialog-title">Start fresh\?<\/h2>/);
  assert.match(html, /This deletes the anonymous usage counts recorded so far: <b>1234 counts in 210 rows<\/b>, 3–23 Oct 2026\./);
  assert.match(html, /start again from zero\. Counting goes on from now\./);
  assert.match(html, /<li>Questions, the waitlist, feedback and reviews stay as they are\.<\/li>/);
  assert.match(html, /It can’t be undone\./);
  assert.match(html, /Type <b>RESET<\/b> to confirm<\/span><input name="confirm"/);
  assert.match(html, /<button class="primary-button owner-danger" type="submit" disabled>Delete 210 rows<\/button>/, 'disabled until RESET is typed');
  assert.match(freshDialogHtml(readCounts({ rows: 1, count: 1, firstDay: '2026-10-23' }), { number: String, range: () => '' }), /<b>1 count in 1 row<\/b>\.<\/p>[\s\S]*Delete 1 row</);
  assert.equal(freshDoneText({ deleted: { rows: 210, count: 1234, firstDay: '2026-10-03', lastDay: '2026-10-23' } }, { number: String, range: () => '3–23 Oct 2026' }), 'Started fresh: 1234 counts in 210 rows deleted (3–23 Oct 2026). Counting goes on from now.');
  assert.equal(freshDoneText({ deleted: { rows: 0 } }), 'Nothing to delete: no counts were recorded. Counting goes on from now.');
});

test('the dashboard holds the card at the end of Trends, reloads its module, and sends RESET to the server', () => {
  const page = read('admin/index.html');
  const trends = page.slice(page.indexOf('<section class="trends"'), page.indexOf('</section>', page.indexOf('<section class="trends"')));
  assert.ok(trends.indexOf('data-trends-body') < trends.indexOf('<div class="trends__fresh" data-owner-fresh></div>'), 'after the charts, in the Trends section');
  const admin = read('admin/admin.js');
  assert.match(admin, /from '\.\/usage-counts\.js';/);
  const files = JSON.parse(/const DASHBOARD_FILES = (\[[^\]]+\]);/.exec(admin)[1].replace(/'/g, '"'));
  // The module, and what it imports in turn (src/lib/planner-api.js → src/config.js → src/lib/text.js).
  for (const file of ['./usage-counts.js', '../src/lib/planner-api.js', '../src/config.js', '../src/lib/text.js']) assert.ok(files.includes(file), `${file} is fetched again by Reload`);
  assert.ok(!files.some(file => /pricing|plus|partners|creem|test-purchases|payout/.test(file)), 'nothing of the sales');
  assert.match(read('admin/usage-counts.js'), /from '\.\.\/src\/lib\/planner-api\.js';/);
  assert.match(read('src/lib/planner-api.js'), /^import \{ APP_VERSION, PLANNER_API_URL \} from '\.\.\/config\.js';$/m);
  assert.match(admin, /call\('admin\/usage-counts'\)/, 'the dialog reads what is recorded now');
  assert.match(admin, /sendJson\('admin\/usage-counts\/reset', 'POST', \{ confirm: RESET_WORD \}\)/, 'the confirmation is sent to the server too');
  assert.match(admin, /await load\(\{ series: true \}\);/, 'Trends are read again afterwards');
});

// ---- Start fresh: the server, with the memory store and D1 ----------------------------

async function openSqlite(t) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite is not available in this Node version'); return null; }
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(read('migrations/schema.sql'));
  const db = {
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
  return db;
}

async function bothStores(t, body) {
  await body('memory', createMemoryStore());
  const d1 = await openSqlite(t);
  if (d1) await body('D1', createD1Store(d1));
}

/** Everything that is not a usage count, in every table, so a reset can be seen to leave it. */
async function seed(store) {
  for (const [day, name, version] of [['2026-10-03', 'landing_viewed', '1.34.0'], ['2026-10-03', 'landing_viewed', '1.34.0'], ['2026-10-12', 'app_active_day', '1.34.0'], ['2026-10-23', 'year_plan_completed', '1.33.2']]) await store.countEvent(day, name, version);
  await store.addEmailSends('2026-10-23', EMAIL_SENDS_EVENT, 7);
  await store.addWaitlist({ email: 'a@example.com', devices: 'mac', note: '', locale: 'fr-FR', appVersion: '1.34.0', driveSeen: 0, createdAt: '2026-10-20T08:00:00.000Z' });
  await store.addFeedback({ appVersion: '1.34.0', rating: 5, kind: 'praise', message: 'Calm', email: '', platform: 'Mac · browser', createdAt: '2026-10-20T08:00:00.000Z' });
  await store.addReview({ appVersion: '1.34.0', rating: 5, text: 'Calm', name: 'Ada', createdAt: '2026-10-20T08:00:00.000Z' });
  await store.addQuestion({ email: 'ada@example.com', name: 'Ada', message: 'Does it work offline?', locale: 'fr-FR', appVersion: '1.34.0', source: 'contact', createdAt: '2026-10-20T08:00:00.000Z' });
}

/** What a reset must leave as it was. */
const kept = async store => ({
  emailsSent: await store.emailSendsOn('2026-10-23', EMAIL_SENDS_EVENT),
  waitlist: (await store.listWaitlist()).length,
  feedback: (await store.listFeedback()).length,
  reviews: (await store.listReviews()).length,
  questions: (await store.listQuestions()).length
});

test('the stores read and delete the usage counts alike, and nothing else (memory and D1)', async t => {
  await bothStores(t, async (label, store) => {
    assert.deepEqual(await store.eventsOverview(), { rows: 0, count: 0, firstDay: '', lastDay: '' }, label);
    await seed(store);
    // Three rows (two counts of one row on 3 October), the email tally left out.
    assert.deepEqual(await store.eventsOverview(), { rows: 3, count: 4, firstDay: '2026-10-03', lastDay: '2026-10-23' }, label);
    const before = await kept(store);
    assert.deepEqual(before, { emailsSent: 7, waitlist: 1, feedback: 1, reviews: 1, questions: 1 }, label);
    assert.equal(await store.deleteEvents(), 3, label);
    assert.deepEqual(await store.eventsOverview(), { rows: 0, count: 0, firstDay: '', lastDay: '' }, label);
    assert.deepEqual(await store.eventsSeries('2026-01-01', '2026-12-31'), [], label);
    assert.deepEqual(await kept(store), before, `${label}: questions, waitlist, feedback, reviews and the email tally stay`);
    // Counting goes on.
    await store.countEvent('2026-10-23', 'landing_viewed', '1.34.1');
    assert.deepEqual(await store.eventsOverview(), { rows: 1, count: 1, firstDay: '2026-10-23', lastDay: '2026-10-23' }, label);
    assert.equal(await store.deleteEvents(), 1, label);
    assert.equal(await store.deleteEvents(), 0, `${label}: again, nothing`);
  });
});

test('Start fresh on the API: the owner only, RESET checked by the server, rate-limited, and what it deleted (memory and D1)', async t => {
  await bothStores(t, async (label, store) => {
    const clock = { now: NOW };
    const api = createPlannerApi({ store, adminToken: 'secret', now: () => new Date(clock.now), authFailureDelayMs: 0, adminLimits: createAdminLimits({ now: () => clock.now }), warn: () => {} });
    await seed(store);
    const before = await kept(store);
    // What it would delete, before doing it: in the summary and on its own.
    assert.deepEqual((await asJson(await api(get('admin/summary', 'secret')))).body.usageCounts, { rows: 3, count: 4, firstDay: '2026-10-03', lastDay: '2026-10-23' }, label);
    assert.deepEqual(await asJson(await api(get('admin/usage-counts', 'secret'))), { status: 200, body: { counts: { rows: 3, count: 4, firstDay: '2026-10-03', lastDay: '2026-10-23' } } }, label);
    // The owner only.
    assert.equal((await api(get('admin/usage-counts'))).status, 401, label);
    assert.equal((await api(post('admin/usage-counts/reset', { confirm: 'RESET' }))).status, 401, label);
    assert.equal((await api(post('admin/usage-counts/reset', { confirm: 'RESET' }, 'wrong'))).status, 401, label);
    assert.equal((await api(get('admin/usage-counts/reset', 'secret'))).status, 405, label);
    assert.equal((await api(post('admin/usage-counts', { confirm: 'RESET' }, 'secret'))).status, 405, label);
    // RESET, exactly, from the dashboard's dialog.
    for (const body of [{}, { confirm: 'reset' }, { confirm: 'RESET ' }, { confirm: true }]) {
      assert.deepEqual(await asJson(await api(post('admin/usage-counts/reset', body, 'secret'))), { status: 400, body: { error: 'Type RESET to confirm.' } }, `${label} ${JSON.stringify(body)}`);
    }
    assert.equal((await store.eventsOverview()).rows, 3, `${label}: nothing deleted yet`);
    const done = await asJson(await api(post('admin/usage-counts/reset', { confirm: 'RESET' }, 'secret')));
    assert.deepEqual(done, { status: 200, body: { deleted: { rows: 3, count: 4, firstDay: '2026-10-03', lastDay: '2026-10-23' }, counts: { rows: 0, count: 0, firstDay: '', lastDay: '' } } }, label);
    assert.deepEqual(await kept(store), before, `${label}: nothing else touched`);
    const summary = (await asJson(await api(get('admin/summary', 'secret')))).body;
    assert.deepEqual([summary.eventTotals, summary.emailsSentToday, summary.usageCounts.rows], [[], 7, 0], `${label}: the counts are gone, the day’s email tally is not`);
    // Rate-limited: the four refusals and the reset used five of the window's tries.
    assert.equal(ADMIN_LIMITS.resetCounts.limit, 5);
    const limited = await api(post('admin/usage-counts/reset', { confirm: 'RESET' }, 'secret'));
    assert.equal(limited.status, 429, label);
    assert.match((await limited.json()).error, /^Too many tries in a short time\. Try again in \d+ minutes?\.$/, label);
    assert.ok(Number(limited.headers.get('retry-after')) > 0, label);
    clock.now += ADMIN_LIMITS.resetCounts.windowMs + 1;
    assert.deepEqual(await asJson(await api(post('admin/usage-counts/reset', { confirm: 'RESET' }, 'secret'))), { status: 200, body: { deleted: { rows: 0, count: 0, firstDay: '', lastDay: '' }, counts: { rows: 0, count: 0, firstDay: '', lastDay: '' } } }, `${label}: again later, nothing left`);
  });
});
