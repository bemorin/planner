import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://planner.bemorin.com/';

/** sw.js in a sandbox: offline (every fetch fails), with `cached` as its cache. */
function worker({ cached = {}, scope = SCOPE } = {}) {
  const listeners = {};
  const store = new Map(Object.entries(cached).map(([path, body]) => [new URL(path, scope).href, new Response(body, { headers: { 'content-type': 'text/html' } })]));
  const key = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const context = {
    self: { addEventListener: (type, listener) => { listeners[type] = listener; }, location: new URL('sw.js', scope), registration: { scope } },
    caches: { match: async request => store.get(key(request))?.clone(), open: async () => ({ put: async () => {} }) },
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    Response,
    URL
  };
  vm.runInNewContext(source, context);
  /** What the worker answers a request for `path` (a navigation unless `mode` says otherwise), or undefined when it lets it through. */
  const answer = async (path, { mode = 'navigate', method = 'GET' } = {}) => {
    let responded;
    listeners.fetch({ request: { url: new URL(path, scope).href, mode, method }, respondWith: promise => { responded = promise; } });
    return responded;
  };
  return { context, answer };
}

test('offline, only the planner’s own address opens the planner', () => {
  const { context } = worker();
  for (const path of ['/', '/index.html', '/?license=abc', '/?gift=ABCD-EFGH-JKMN', '/index.html?ref=REFEXAMPLE#today']) {
    assert.equal(context.opensPlanner(new URL(path, SCOPE), SCOPE), true, path);
  }
  for (const path of ['/welcome/', '/teams/', '/partners/', '/legal/', '/legal/privacy/', '/welcome/teams/?ask=question', '/teams/index.html', '/index.htm', '/indexhtml', '/admin']) {
    assert.equal(context.opensPlanner(new URL(path, SCOPE), SCOPE), false, path);
  }
  // A planner installed under a folder: its scope is the root.
  assert.equal(context.opensPlanner(new URL('https://example.org/planner/?license=x'), 'https://example.org/planner/'), true);
  assert.equal(context.opensPlanner(new URL('https://example.org/'), 'https://example.org/planner/'), false);
});

test('offline, an unvisited page of the site gets a small offline page, not an unstyled planner', async () => {
  const { answer } = worker({ cached: { './index.html': '<title>Daily Planner by Ben Morin</title>' } });
  for (const path of ['/teams/', '/partners/', '/welcome/', '/legal/terms/', '/welcome/teams/?ask=question']) {
    const response = await answer(path);
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    const html = await response.text();
    assert.match(html, /<title>You’re offline · Daily Planner<\/title>/, path);
    assert.doesNotMatch(html, /Daily Planner by Ben Morin/, `${path}: never the planner’s index.html`);
    assert.match(html, /<a class="primary" href="https:\/\/planner\.bemorin\.com\/">Open your planner<\/a>/);
    assert.match(html, /<a href="">Try again<\/a>/);
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.match(html, /@media \(prefers-color-scheme: dark\) \{ :root \{ --paper: #151412;/, 'the planner’s paper, dark too');
    assert.match(html, /<html lang="en">/);
    assert.doesNotMatch(html, /<script|\son[a-z]+=/i, 'no script in it');
  }
});

test('offline, the planner itself and the pages already opened still come from the cache', async () => {
  const { answer } = worker({ cached: { './index.html': 'planner', '/teams/': 'teams page' } });
  for (const path of ['/', '/index.html', '/?license=abc']) assert.equal(await (await answer(path)).text(), 'planner', path);
  assert.equal(await (await answer('/teams/')).text(), 'teams page');
  // Without the planner's offline copy (not installed yet), its address gets the offline page too.
  const empty = worker();
  assert.equal((await empty.answer('/?license=abc')).status, 503);
  // A file that isn't cached still fails as a file, and the API and the dashboard are never touched.
  await assert.rejects(answer('/welcome/landing.css', { mode: 'no-cors' }), /Offline and not cached/);
  assert.equal(await answer('/api/plus/check'), undefined);
  assert.equal(await answer('/admin/'), undefined);
  assert.equal(await answer('/', { method: 'POST' }), undefined);
});

test('online, a page is kept for offline use (cloned before the page reads it); keyed and private addresses never are', async () => {
  const listeners = {};
  const put = [];
  const context = {
    self: { addEventListener: (type, listener) => { listeners[type] = listener; }, location: new URL('sw.js', SCOPE), registration: { scope: SCOPE } },
    caches: { match: async () => undefined, open: async () => ({ put: async (request, response) => { put.push([new URL(request.url).pathname + new URL(request.url).search, await response.text()]); } }) },
    fetch: async request => new Response(`page ${new URL(request.url).pathname}`, { status: 200, headers: { 'content-type': 'text/html' } }),
    Response,
    URL
  };
  vm.runInNewContext(source, context);
  const visit = async path => {
    let responded;
    listeners.fetch({ request: { url: new URL(path, SCOPE).href, mode: 'navigate', method: 'GET' }, respondWith: promise => { responded = promise; } });
    if (!responded) return undefined;
    // The page reads the body at once, as a browser does: a copy made after this would find it used.
    return (await responded).text();
  };
  assert.equal(await visit('/contact/'), 'page /contact/');
  for (const path of ['/?license=eyJhbGciOi', '/?gift=ABCD-EFGH-JKMN', '/?checkout_id=ch_123', '/welcome/?ref=REFEXAMPLE', '/contact/?topic=partners']) assert.equal(await visit(path), `page ${new URL(path, SCOPE).pathname}`, `${path}: still served`);
  for (const path of ['/admin/', '/admin/configuration/', '/api/health']) assert.equal(await visit(path), undefined, `${path}: never touched`);
  await new Promise(resolveWait => { setTimeout(resolveWait, 20); });
  assert.deepEqual(put, [['/contact/', 'page /contact/']], 'only the page without a query, and its copy is whole');
  assert.ok(context.keepable(new URL('/legal/privacy/', SCOPE)));
  assert.equal(context.keepable(new URL('/admin/', SCOPE)), false);
  // 1.38.1: no partner statement is served while sales are paused, so the worker no longer names its address.
});
