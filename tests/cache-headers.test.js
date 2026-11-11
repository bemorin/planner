import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { headersFor, parseHeaders } from '../scripts/headers.mjs';
import { PUBLISHED_FILES, PUBLISHED_FOLDERS } from '../scripts/published.mjs';
import { parseRedirects, redirectFor } from '../scripts/redirects.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

// The security headers (1.35) come from one rule for every address, /*; their values are checked in tests/csp.test.js.
const SECURITY = ['content-security-policy', 'reporting-endpoints', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy'];
/** The rules that give a path its Cache-Control. */
const cacheRules = matched => matched.filter(rule => rule.headers.some(([name]) => name === 'cache-control'));

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) files.push(...walk(`${path}/`));
    else files.push(path);
  }
  return files;
}

const rules = parseHeaders(read('_headers'));
// What the build publishes (scripts/published.mjs): the root files, the files it writes, and its folders.
const published = [...PUBLISHED_FILES, 'runtime-config.js', 'styles.css', ...PUBLISHED_FOLDERS.map(folder => `${folder}/`).flatMap(walk)];

test('_headers is valid: the security headers on /*, one Cache-Control per other rule, within Pages limits', () => {
  assert.ok(rules.length > 0 && rules.length <= 100, 'Pages reads at most 100 rules');
  assert.equal(rules[0].pattern, '/*', 'the security rule comes first');
  for (const rule of rules) {
    assert.match(rule.pattern, /^\//, `${rule.pattern} is a path`);
    assert.ok((rule.pattern.match(/\*/g) || []).length <= 1, `${rule.pattern}: one splat at most`);
    if (rule.pattern === '/*') {
      assert.deepEqual(rule.headers.map(([name]) => name), SECURITY, 'the security headers, each once, and no Cache-Control for every file');
      continue;
    }
    assert.deepEqual(rule.headers, [['cache-control', 'no-cache']], rule.pattern);
  }
  // Nothing else sets a security header, so none is ever joined with a second value.
  for (const name of SECURITY) assert.equal(rules.filter(rule => rule.headers.some(([header]) => header === name)).length, 1, name);
  // 1.39: no rule for the retired pages' addresses, and no Clear-Site-Data any more.
  assert.deepEqual(rules.filter(rule => /teams|partners|thanks/.test(rule.pattern)), []);
  assert.doesNotMatch(read('_headers').replace(/^#.*$/gm, ''), /clear-site-data|no-store/i);
  for (const line of read('_headers').split('\n')) assert.ok(line.length <= 2000, 'Pages reads lines of 2,000 characters at most');
});

test('every page, script and stylesheet revalidates on each visit, matched by exactly one Cache-Control rule', () => {
  const pages = published.filter(path => path.endsWith('index.html')).map(path => `/${path.slice(0, -'index.html'.length)}`);
  assert.ok(['/', '/admin/', '/welcome/', '/contact/', '/legal/privacy/'].every(page => pages.includes(page)), pages.join(' '));
  // 1.39: the Teams, partners and gift pages are gone.
  assert.ok(!pages.some(page => /^\/(?:welcome\/)?(?:teams|partners|thanks)\//.test(page)), pages.join(' '));
  // The owner's configuration page (1.31) is covered before it lands, so the two can ship in either order.
  assert.equal(headersFor(rules, '/admin/configuration/').headers['cache-control'], 'no-cache');
  const files = published.filter(path => /\.(?:html|m?js|css)$/.test(path)).map(path => `/${path}`);
  assert.ok(files.includes('/admin/admin.js') && files.includes('/admin/admin.css') && files.includes('/src/features/year-plan.js'));
  assert.ok(files.includes('/src/vendor/motion.js'), 'the vendored module too');
  for (const path of [...pages, ...files]) {
    const { matched, headers } = headersFor(rules, path);
    assert.equal(cacheRules(matched).length, 1, `${path} takes Cache-Control from ${cacheRules(matched).map(rule => rule.pattern).join(', ') || 'no rule'}`);
    assert.equal(headers['cache-control'], 'no-cache', path);
    assert.ok(SECURITY.every(name => headers[name]), `${path}: the security headers`);
  }
});

test('a browser that kept 1.28’s permanent /teams → /welcome/teams/ redirect is not caught in a loop', () => {
  const redirects = parseRedirects(read('_redirects'));
  // What such a browser keeps: 1.28's short links went to exactly these two addresses (and kept a query string).
  const kept = { '/teams/': '/welcome/teams/', '/teams': '/welcome/teams/', '/partners/': '/welcome/partners/', '/partners': '/welcome/partners/' };
  const hop = (path, search) => {
    if (kept[path]) return { path: kept[path], search };
    const found = redirectFor(redirects, path, search);
    if (!found) return null;
    const to = new URL(found.location, 'https://planner.example');
    return { path: to.pathname, search: to.search };
  };
  for (const [start, search] of [['/teams/', ''], ['/teams/', '?ask=question'], ['/partners/', ''], ['/teams', ''], ['/welcome/thanks/', '']]) {
    let at = { path: start, search };
    const seen = [];
    for (let next = hop(at.path, at.search); next; next = hop(at.path, at.search)) {
      seen.push(`${at.path}${at.search}`);
      assert.ok(seen.length < 4, `${start}: ${seen.join(' → ')}`);
      at = next;
    }
    assert.deepEqual(at, { path: '/welcome/', search }, `${start} ends on the welcome page, query kept`);
    // Nothing in the way: no cache rule for an old address, so the browser may keep the 301.
    assert.equal(headersFor(rules, start).headers['cache-control'], undefined, start);
    assert.equal(headersFor(rules, start).headers['clear-site-data'], undefined, start);
  }
});

test('the API, images and icons keep their own caching: only the security headers match', () => {
  // (Pages never applies _headers to the API's Functions anyway.)
  for (const path of ['/api/admin/summary', '/api/contact', '/api/teams', '/api/', '/favicon.svg', '/pwa-512.png', '/welcome/og.png', '/manifest.webmanifest', '/THIRD_PARTY_NOTICES.md']) {
    assert.deepEqual(headersFor(rules, path).matched.map(rule => rule.pattern), ['/*'], path);
  }
});

test('the build copies _headers next to _redirects', () => {
  const build = read('scripts/build.mjs');
  assert.match(build, /await copyFile\('_headers'\);/);
  assert.match(build, /await copyFile\('_redirects'\);/);
});

test('the service worker keeps its own network-first copy, so no-cache does not break offline use', () => {
  const sw = read('sw.js');
  assert.match(sw, /fetch\(request\)\.then/, 'network first');
  assert.match(sw, /caches\.match\(request, \{ ignoreSearch: request\.mode === 'navigate' \}\)/, 'then its own cache');
  assert.match(sw, /const UNTOUCHED = \['\/api\/', '\/admin\/'\];/, 'never the API or the dashboard');
  assert.match(sw, /if \(UNTOUCHED\.some\(path => url\.pathname\.includes\(path\)\)\) return;/);
});
