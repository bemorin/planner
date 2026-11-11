import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createMemoryStore, createPlannerApi } from '../server/planner-api.js';
import { createD1Store } from '../server/d1-store.js';
import { createDurableLimits } from '../server/rate-limit.js';
import { blockedSource, cspReportType, readCspReports, reportDirective, reportPage } from '../server/csp-reports.js';

/* Reports of the security headers (1.35): the browser posts what the
   Content-Security-Policy blocked to /api/csp-report; the API keeps daily
   counts only — no address, nothing about the visitor. */

const START = Date.parse('2026-10-27T08:00:00Z');
const IP = '203.0.113.9';
const legacy = (report = {}) => JSON.stringify({ 'csp-report': { 'document-uri': 'https://planner.bemorin.com/welcome/?ref=REFEXAMPLE#faq', referrer: '', 'violated-directive': 'script-src-elem', 'effective-directive': 'script-src-elem', 'original-policy': "default-src 'self'", disposition: 'enforce', 'blocked-uri': 'https://ajax.cloudflare.com/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js', 'status-code': 200, ...report } });
const modern = entries => JSON.stringify(entries.map(body => ({ type: 'csp-violation', age: 10, url: 'https://planner.bemorin.com/', user_agent: 'Mozilla/5.0', body: { documentURL: 'https://planner.bemorin.com/', effectiveDirective: 'script-src-elem', blockedURL: 'inline', disposition: 'enforce', ...body } })));

test('a report reads as a directive, an origin or keyword (never the full address) and a path (never its query)', () => {
  assert.equal(cspReportType('application/csp-report'), 'application/csp-report');
  assert.equal(cspReportType('application/reports+json; charset=utf-8'), 'application/reports+json');
  for (const other of ['application/json', 'text/plain', '', 'application/csp-report-x']) assert.equal(cspReportType(other), '', other);
  assert.deepEqual(readCspReports('application/csp-report', legacy()), [{ directive: 'script-src-elem', blocked: 'https://ajax.cloudflare.com', page: '/welcome/' }]);
  assert.deepEqual(readCspReports('application/reports+json', modern([{}, { effectiveDirective: 'connect-src', blockedURL: 'https://evil.example/collect?id=42', documentURL: 'https://planner.bemorin.com/admin/?token=x' }])), [
    { directive: 'script-src-elem', blocked: 'inline', page: '/' },
    { directive: 'connect-src', blocked: 'https://evil.example', page: '/admin/' }
  ]);
  assert.equal(blockedSource('eval'), 'eval');
  assert.equal(blockedSource('data:'), 'data');
  assert.equal(blockedSource(''), 'inline');
  assert.equal(blockedSource('javascript:alert(1)'), 'other');
  assert.equal(blockedSource('chrome-extension://abcdef/inject.js'), null, 'a browser extension’s own script is not the site’s');
  assert.equal(reportDirective('script-src https://x'), 'script-src');
  assert.equal(reportDirective('<b>'), '');
  assert.equal(reportPage('https://planner.bemorin.com/legal/privacy/?x=1'), '/legal/privacy/');
  assert.equal(reportPage('not a url'), '');
  // Extensions, malformed bodies and other report types count for nothing; at most 10 from one request.
  assert.deepEqual(readCspReports('application/csp-report', legacy({ 'blocked-uri': 'moz-extension://x/y.js' })), []);
  assert.deepEqual(readCspReports('application/csp-report', legacy({ 'source-file': 'chrome-extension://abc/content.js', 'blocked-uri': 'inline' })), []);
  assert.deepEqual(readCspReports('application/csp-report', '{nope'), []);
  assert.deepEqual(readCspReports('application/reports+json', JSON.stringify([{ type: 'deprecation', body: {} }])), []);
  assert.equal(readCspReports('application/reports+json', modern(Array(25).fill({}))).length, 10);
});

async function openSqlite(t) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite is not available in this Node version'); return null; }
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
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

function setup(store = createMemoryStore()) {
  const clock = { now: START };
  const api = createPlannerApi({
    store, adminToken: 'owner-token', now: () => new Date(clock.now), authFailureDelayMs: 0, warn: () => {},
    durableLimits: createDurableLimits({ store, secret: 'owner-token', now: () => clock.now, pruneState: { at: 0 }, saltState: { day: '', salt: '' } })
  });
  const report = (body, { type = 'application/csp-report', origin = '', ip = IP } = {}) => api(new Request('https://planner.bemorin.com/api/csp-report', { method: 'POST', headers: { 'content-type': type, ...(origin ? { origin } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}) }, body }));
  return { api, store, clock, report };
}

test('POST /api/csp-report: counted per day, directive, origin and page, with no address; other types and sites refused (memory and D1)', async t => {
  const stores = [['memory', createMemoryStore(), null]];
  const d1 = await openSqlite(t);
  if (d1) stores.push(['D1', createD1Store(d1), d1]);
  for (const [label, store, db] of stores) {
    const { report } = setup(store);
    assert.equal((await report(legacy())).status, 204, label);
    assert.equal((await report(legacy(), { origin: 'https://planner.bemorin.com' })).status, 204, label);
    assert.equal((await report(modern([{}, {}]), { type: 'application/reports+json' })).status, 204, label);
    assert.deepEqual(await store.listCspReports({ fromDay: '2026-10-21' }), [
      { directive: 'script-src-elem', blocked: 'https://ajax.cloudflare.com', page: '/welcome/', count: 2, lastDay: '2026-10-27' },
      { directive: 'script-src-elem', blocked: 'inline', page: '/', count: 2, lastDay: '2026-10-27' }
    ], label);
    // A JSON body, a form or another site: refused before anything is read or counted.
    assert.equal((await report(legacy(), { type: 'application/json' })).status, 415, label);
    assert.equal((await report(legacy(), { type: 'text/plain' })).status, 415, label);
    assert.equal((await report(legacy(), { origin: 'https://evil.example' })).status, 403, label);
    assert.equal((await report('x'.repeat(20 * 1024))).status, 413, `${label}: the body cap`);
    const dump = db ? JSON.stringify(db.sqlite.prepare('SELECT * FROM csp_reports').all()) : JSON.stringify(store.data.cspReports);
    assert.ok(!dump.includes('203.0.113') && !dump.includes('REFEXAMPLE') && !dump.includes('rocket-loader'), `${label}: no address, query or full URL`);
  }
});

test('a connection sends at most 100 reports a day; before migration 0009 they are answered and not counted', async t => {
  const { report, store } = setup();
  const statuses = [];
  for (let index = 0; index < 101; index += 1) statuses.push((await report(legacy())).status);
  assert.deepEqual([statuses.slice(0, 100).every(status => status === 204), statuses[100]], [true, 429]);
  assert.equal(store.data.cspReports[0].count, 100);
  const d1 = await openSqlite(t);
  if (!d1) return;
  d1.sqlite.exec('DROP TABLE csp_reports');
  const without = setup(createD1Store(d1));
  assert.equal((await without.report(legacy())).status, 204, 'quietly: the table comes with the migration');
});

test('the Configuration page’s Security headers check reads the API’s counts of the last 7 days', async () => {
  const store = createMemoryStore();
  const clock = { now: START };
  const api = createPlannerApi({
    store, adminToken: 'owner-token', now: () => new Date(clock.now), authFailureDelayMs: 0, warn: () => {}, configEnv: {},
    configFetch: async () => new Response('', { status: 404 }),
    durableLimits: createDurableLimits({ store, secret: 'owner-token', now: () => clock.now, pruneState: { at: 0 }, saltState: { day: '', salt: '' } })
  });
  const item = async () => {
    const answer = await (await api(new Request('https://planner.bemorin.com/api/admin/config/check', { method: 'POST', headers: { authorization: 'Bearer owner-token' } }))).json();
    return answer.items.find(entry => entry.id === 'csp-reports');
  };
  assert.equal((await item()).state, 'ok');
  // Eight days ago: out of the window. Yesterday: listed.
  await store.addCspReport({ day: '2026-10-19', directive: 'img-src', blocked: 'https://old.example', page: '/' });
  assert.equal((await item()).state, 'ok');
  await store.addCspReport({ day: '2026-10-26', directive: 'script-src-elem', blocked: 'inline', page: '/welcome/' });
  const listed = await item();
  assert.deepEqual([listed.state, listed.warning], ['problem', true]);
  assert.match(listed.summary, /script-src-elem: inline on \/welcome\/ \(once\)/);
  assert.doesNotMatch(listed.summary, /old\.example/);
});
