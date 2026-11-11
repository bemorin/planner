import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { posix } from 'node:path';

import { parseRedirects, redirectFor } from '../scripts/redirects.mjs';
import { askHref } from '../legal/legal-details.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const rules = parseRedirects(read('_redirects'));
const SITE = 'https://planner.bemorin.com';

/** What Pages answers for an address: { status, location } or null. */
const answer = address => {
  const url = new URL(address, SITE);
  return redirectFor(rules, url.pathname, url.search);
};

/** Where the browser ends up after one redirect: the Location, with the address's #hash when it has none (RFC 9110). */
function follow(address) {
  const from = new URL(address, SITE);
  const found = answer(address);
  if (!found) return null;
  const to = new URL(found.location, from);
  if (!to.hash) to.hash = from.hash;
  return { status: found.status, address: `${to.pathname}${to.search}${to.hash}` };
}

test('since 1.39 the Teams and partners pages are gone: their addresses, their old ones and the former gift page go to the landing page for good (301), query and hash kept', () => {
  const cases = [
    ['/teams/', '/welcome/'],
    ['/teams', '/welcome/'],
    ['/teams/?ask=question#request', '/welcome/?ask=question#request'],
    ['/teams/#team-prices', '/welcome/#team-prices'],
    ['/teams/teams.js', '/welcome/'],
    ['/partners/', '/welcome/'],
    ['/partners/statement/#code=REFEXAMPLE&key=abc', '/welcome/#code=REFEXAMPLE&key=abc'],
    ['/welcome/teams/', '/welcome/'],
    ['/welcome/teams', '/welcome/'],
    ['/welcome/teams/?ask=question&topic=partners#request', '/welcome/?ask=question&topic=partners#request'],
    ['/welcome/teams/index.html', '/welcome/'],
    ['/welcome/partners/', '/welcome/'],
    ['/welcome/partners?ref=CODE', '/welcome/?ref=CODE'],
    ['/welcome/partners/partners.css', '/welcome/'],
    ['/welcome/thanks/', '/welcome/'],
    ['/welcome/thanks', '/welcome/'],
    ['/welcome/thanks/?checkout_id=ch_1#manage', '/welcome/?checkout_id=ch_1#manage'],
    ['/welcome/thanks/thanks.js', '/welcome/']
  ];
  // 301: the pages are not coming back.
  for (const [from, to] of cases) assert.deepEqual(follow(from), { status: 301, address: to }, from);
  // The rest of /welcome/ and the site are pages, not redirects (a question asked of /welcome/ goes on to /contact/
  // in the page itself) — and never a loop: /welcome/ itself redirects nowhere.
  for (const path of ['/contact/', '/contact/?topic=partners', '/welcome/', '/welcome/?ask=question', '/welcome/?ask=invoice#request', '/welcome/teams-model.js', '/welcome/landing.css', '/welcome/thanksgiving/', '/', '/legal/']) {
    assert.equal(answer(path), null, path);
  }
});

test('the legal short links still work, and keep a query too', () => {
  for (const page of ['privacy', 'terms', 'cookies']) {
    assert.deepEqual(follow(`/${page}`), { status: 301, address: `/legal/${page}/` });
    assert.deepEqual(follow(`/${page}/?from=mail#rights`), { status: 301, address: `/legal/${page}/?from=mail#rights` });
  }
});

test('redirects follow Cloudflare Pages: first line wins, a destination’s own query stays, splats and placeholders, same site only', () => {
  const own = parseRedirects([
    '# a comment',
    '/a /b/?x=1 301',
    '/a /c/ 302',
    '/old/* /new/:splat 308',
    '/blog/:year/:slug /posts/:slug?year=:year',
    '/far https://example.com/ 301',
    '/twice //example.com/ 301',
    'nonsense'
  ].join('\n'));
  assert.deepEqual(redirectFor(own, '/a', '?y=2'), { status: 301, location: '/b/?x=1' }, 'the destination’s own query, not the address’s');
  assert.deepEqual(redirectFor(own, '/old/', ''), { status: 308, location: '/new/' }, 'an empty splat');
  assert.deepEqual(redirectFor(own, '/old/a/b.js', '?v=3'), { status: 308, location: '/new/a/b.js?v=3' });
  assert.deepEqual(redirectFor(own, '/blog/2026/hello', ''), { status: 302, location: '/posts/hello?year=2026' }, 'no status: 302');
  assert.equal(redirectFor(own, '/far', ''), null, 'another site is not read here');
  assert.equal(redirectFor(own, '/twice', ''), null, '“//host” would be another site');
  assert.equal(redirectFor(own, '/old', ''), null);
  assert.deepEqual(redirectFor(parseRedirects('/x/* /y/:splat 301'), '/x//evil.example/', ''), { status: 301, location: '/y//evil.example/' }, 'stays on this site');
  assert.deepEqual(parseRedirects(''), []);
});

test('the dev server and the build apply the same file', () => {
  const serve = read('scripts/serve.mjs');
  assert.match(serve, /import \{ parseRedirects, redirectFor \} from '\.\/redirects\.mjs';/);
  assert.match(serve, /const redirect = redirectFor\(redirects, url\.pathname, url\.search\);/);
  const build = read('scripts/build.mjs');
  assert.match(build, /for \(const folder of PUBLISHED_FOLDERS\.filter\(name => name !== 'src'\)\) await copyTree\(folder\);/);
  assert.match(build, /await copyFile\('_redirects'\);/);
});

// Every local link and file a page names exists: a folder needs its index.html.
const SKIP = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/|\$\{)/i;
function exists(path) {
  const clean = path.split(/[?#]/)[0];
  if (clean === '' || clean.endsWith('/')) return existsSync(new URL(`${clean}index.html`, root));
  return existsSync(new URL(clean, root)) && statSync(new URL(clean, root)).isFile();
}
/** A link of `file` as a path from the site root: 'teams/' (a folder), 'favicon.svg', '' (the root). */
function resolveFrom(file, href) {
  const path = href.split(/[?#]/)[0];
  const joined = posix.normalize(posix.join(posix.dirname(file), path || '.')).replace(/\/+$/, '');
  const folder = !path || path.endsWith('/') || /(?:^|\/)\.\.?$/.test(path);
  return joined === '.' ? '' : `${joined}${folder ? '/' : ''}`;
}
const localRefs = html => [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, '&')).filter(ref => !SKIP.test(ref));

test('every page around the move links only to files that exist', () => {
  const legal = ['legal/index.html', ...readdirSync(new URL('legal/', root), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `legal/${entry.name}/index.html`)];
  for (const file of ['welcome/index.html', 'contact/index.html', ...legal]) {
    const refs = localRefs(read(file));
    assert.ok(refs.length > 5, file);
    for (const ref of refs) {
      const path = resolveFrom(file, ref);
      assert.ok(!path.startsWith('..'), `${file}: ${ref} leaves the site`);
      assert.ok(exists(path), `${file}: ${ref} → ${path || '/'}`);
    }
  }
  // The planner has no link to the retired pages.
  const planner = [read('index.html'), read('src/features/share-dialog.js')].join('\n');
  assert.deepEqual([...planner.matchAll(/href="([^"]*(?:teams|partners|thanks)\/[^"]*)"/g)].map(match => match[1]), []);
  assert.doesNotMatch(planner, /welcome\/(?:teams|partners|thanks)/);
  // Links the scripts write: the legal pages’ question form.
  for (const [folder, href, page] of [['legal/', askHref('../'), 'contact/'], ['legal/terms/', askHref('../../'), 'contact/']]) {
    assert.equal(resolveFrom(`${folder}index.html`, href), page, href);
    assert.ok(exists(page), page);
  }
  // Every “Ask a question” link of these pages, and the footers' Contact (1.32), goes to the Contact page.
  for (const file of ['welcome/index.html', 'contact/index.html', ...legal]) {
    const html = read(file);
    const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(html)?.[0] || '';
    const asks = [...html.matchAll(/<a ([^>]*)>(?:Ask a question|ask a question|“Ask a question” form)<\/a>/g), ...foot.matchAll(/<a ([^>]*)>Contact<\/a>/g)].map(match => /href="([^"]+)"/.exec(match[1])[1].replace(/&amp;/g, '&'));
    assert.ok(asks.length > 0, file);
    for (const href of asks) assert.equal(resolveFrom(file, href), 'contact/', `${file}: ${href}`);
    assert.doesNotMatch(html, /href="[^"]*ask=question/, `${file}: no link to the old question form`);
  }
});

test('the Contact page’s script imports files that exist', () => {
  for (const file of ['contact/contact.js']) {
    const specifiers = [...read(file).matchAll(/^import [^;]*? from '([^']+)';/gm)].map(match => match[1]);
    assert.ok(specifiers.length > 0, file);
    for (const specifier of specifiers) assert.ok(exists(resolveFrom(file, specifier)), `${file}: ${specifier}`);
  }
});

test('no file of the site points at the old addresses any more (only _redirects and _headers name them)', () => {
  const files = ['index.html', 'src/features/share-dialog.js', 'src/config.js', 'admin/admin.js', 'legal/legal-details.js', 'welcome/landing-settings.js', 'welcome/index.html', 'contact/index.html'];
  for (const file of files) {
    const text = read(file).replace(/^#.*$/gm, '');
    assert.doesNotMatch(text, /welcome\/(?:teams|partners|thanks)\b/, file);
  }
});
