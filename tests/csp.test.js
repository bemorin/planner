import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

import { cspProblems, inlineHandlers, inlineScripts, pageAddress, scriptHash, sitePolicy } from '../scripts/csp.mjs';
import { headersFor, parseCsp, parseHeaders } from '../scripts/headers.mjs';
import { PUBLISHED_FILES, PUBLISHED_FOLDERS } from '../scripts/published.mjs';
import { sameSiteHref } from '../welcome/contact-model.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const rules = parseHeaders(read('_headers'));

function walk(dir) {
  return readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]));
}
// Every page the build publishes (scripts/published.mjs).
const pages = [...PUBLISHED_FILES.filter(file => file.endsWith('.html')), ...PUBLISHED_FOLDERS.flatMap(folder => walk(`${folder}/`)).filter(file => file.endsWith('.html'))]
  .map(file => ({ file, html: read(file) }));

test('_headers is read as Pages reads it: splats, placeholders, joined values, the path only', () => {
  const sample = parseHeaders('# a comment\n/*\n  X-One: a\n/admin/*\n  X-One: b\n  X-Two: c\n/teams/:page\n  X-Three: d\n');
  assert.deepEqual(headersFor(sample, '/admin/configuration/').headers, { 'x-one': 'a, b', 'x-two': 'c' });
  assert.deepEqual(headersFor(sample, '/').headers, { 'x-one': 'a' });
  assert.equal(headersFor(sample, '/teams/x').headers['x-three'], 'd');
  assert.equal(headersFor(sample, '/teams/x/y').headers['x-three'], undefined, 'a placeholder is one segment');
  assert.throws(() => parseHeaders('  X-Orphan: 1\n'), /outside a rule/);
  assert.deepEqual([...parseCsp("default-src 'self'; img-src 'self' data:;").entries()], [['default-src', ["'self'"]], ['img-src', ["'self'", 'data:']]]);
});

test('the inline scripts that run are found and hashed as the browser hashes them; data blocks and comments are not', () => {
  const body = "(function () { document.documentElement.classList.add('x'); })();";
  const html = `<!doctype html><head><!-- <script>not this</script> --><script>${body}</script>
<script type="application/ld+json">{"@type": "Thing"}</script><script src="./a.js"></script><script type="module" src="./b.js"></script>
<script type="module">import './c.js';</script><script data-src="x">1</script></head>`;
  const found = inlineScripts(html);
  assert.deepEqual(found.map(script => script.hash), [scriptHash(body), scriptHash("import './c.js';"), scriptHash('1')]);
  assert.equal(scriptHash(body), `sha256-${createHash('sha256').update(body).digest('base64')}`);
  assert.equal(found[0].line, 1);
  assert.equal(found[1].line, 3);
  assert.deepEqual(inlineHandlers('<button onclick="go()">Go</button><a href="javascript:void(0)">x</a><p>one = two</p><script>a.onclick=1</script>').map(found_ => found_.tag.slice(0, 7)), ['<button', '<a href']);
  assert.equal(pageAddress('index.html'), '/');
  assert.equal(pageAddress('admin/configuration/index.html'), '/admin/configuration/');
});

test('the CSP lists exactly the hashes of the published pages’ inline scripts: a changed or new script is caught', () => {
  // The planner, the landing and Contact pages, the four legal pages and the two admin pages (1.39: no Teams, partners or gift page).
  assert.ok(pages.length >= 9, `${pages.length} pages`);
  assert.deepEqual(cspProblems(pages, rules), []);
  const { hashes } = sitePolicy(rules);
  const scripts = new Set(pages.flatMap(page => inlineScripts(page.html).map(script => script.hash)));
  assert.deepEqual([...hashes].sort(), [...scripts].sort());
  // The planner, welcome and Contact pages and the two admin pages (one script, one hash).
  assert.equal(hashes.length, 4);
  const changed = pages.map(page => (page.file === 'welcome/index.html' ? { ...page, html: page.html.replace("root.classList.add('js-anim');", "root.classList.add('js-anim'); ") } : page));
  const problems = cspProblems(changed, rules);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /script-src is missing 'sha256-[^']+' for the inline script at welcome\/index\.html:\d+/);
  assert.match(problems[1], /lists 'sha256-[^']+', which no inline script of the site has any more/);
  const handler = pages.map(page => (page.file === 'contact/index.html' ? { ...page, html: page.html.replace('<body', '<body onload="x()"') } : page));
  assert.match(cspProblems(handler, rules).join('\n'), /contact\/index\.html:\d+: inline event handler/);
  assert.deepEqual(cspProblems(pages, parseHeaders('/*\n  X-Frame-Options: DENY\n')), ['_headers: no Content-Security-Policy on the /* rule']);
});

test('the site-wide policy: only this site’s scripts, Google’s sign-in and Cloudflare’s beacon, never inline code or eval', () => {
  const { directives } = sitePolicy(rules);
  const sources = name => directives.get(name);
  assert.deepEqual([...directives.keys()], ['default-src', 'base-uri', 'object-src', 'frame-ancestors', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src', 'manifest-src', 'worker-src', 'form-action', 'report-uri', 'report-to']);
  assert.deepEqual(sources('default-src'), ["'self'"]);
  assert.deepEqual(sources('base-uri'), ["'self'"]);
  assert.deepEqual(sources('object-src'), ["'none'"]);
  assert.deepEqual(sources('frame-ancestors'), ["'self'"]);
  const script = sources('script-src');
  assert.equal(script[0], "'self'");
  assert.deepEqual(script.filter(source => !source.startsWith("'sha256-")), ["'self'", 'https://accounts.google.com', 'https://static.cloudflareinsights.com']);
  assert.ok(!script.some(source => /unsafe|strict-dynamic|nonce|\*/.test(source)), 'no unsafe-inline, unsafe-eval, nonce or wildcard');
  // Google's sign-in brings its own stylesheet, so the style policy allows its origin.
  assert.deepEqual(sources('style-src'), ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style']);
  assert.deepEqual(sources('img-src'), ["'self'", 'data:', 'blob:']);
  assert.deepEqual(sources('font-src'), ["'self'"]);
  assert.deepEqual(sources('connect-src'), ["'self'", 'https://www.googleapis.com', 'https://accounts.google.com', 'https://api.dropboxapi.com', 'https://content.dropboxapi.com', 'https://cloudflareinsights.com']);
  // Frames: Google's sign-in only (1.39: no payment window), never a wildcard and never this site.
  assert.deepEqual(sources('frame-src'), ['https://accounts.google.com']);
  for (const name of ['manifest-src', 'worker-src', 'form-action']) assert.deepEqual(sources(name), ["'self'"], name);
  // What it blocks is reported to the API: report-uri, and report-to with its endpoint.
  assert.deepEqual([sources('report-uri'), sources('report-to')], [['/api/csp-report'], ['csp']]);
  // The Drive sync and the Google script the planner uses are allowed, by host.
  const drive = read('src/sync/google-drive.js');
  assert.match(drive, /const GIS_SRC = 'https:\/\/accounts\.google\.com\/gsi\/client';/);
  for (const [, url] of drive.matchAll(/'(https:\/\/www\.googleapis\.com\/(?:upload\/)?drive\/v3\/files)'/g)) assert.ok(sources('connect-src').includes(new URL(url).origin), url);
  // Dropbox (1.38): every API address the planner calls is allowed by exact origin; its sign-in page is a
  // navigation, which the policy doesn't restrict, so no frame-src or form-action for it.
  const dropbox = read('src/sync/dropbox.js');
  const calls = [...dropbox.matchAll(/export const DROPBOX_(?:TOKEN|API|CONTENT)_URL = '([^']+)'/g)].map(match => new URL(match[1]).origin);
  assert.deepEqual([...new Set(calls)], ['https://api.dropboxapi.com', 'https://content.dropboxapi.com']);
  for (const origin of calls) assert.ok(sources('connect-src').includes(origin), origin);
  assert.match(dropbox, /export const DROPBOX_AUTHORIZE_URL = 'https:\/\/www\.dropbox\.com\/oauth2\/authorize';/);
  assert.ok(!sources('connect-src').includes('https://www.dropbox.com') && !sources('frame-src').some(source => source.includes('dropbox')), 'the sign-in page is visited, never fetched or framed');
});

test('the other security headers, the same on every page, file and redirect', () => {
  const expected = {
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'reporting-endpoints': 'csp="/api/csp-report"'
  };
  const { policy } = sitePolicy(rules);
  for (const path of ['/', '/index.html', '/admin/', '/admin/configuration/', '/welcome/', '/contact/', '/teams/', '/partners/statement/', '/welcome/thanks/', '/legal/cookies/', '/sw.js', '/app.js', '/favicon.svg', '/welcome/teams/', '/privacy']) {
    const { headers } = headersFor(rules, path);
    for (const [name, value] of Object.entries(expected)) assert.equal(headers[name], value, `${path}: ${name}`);
    assert.equal(headers['content-security-policy'], policy, path);
  }
  assert.doesNotMatch(headersFor(rules, '/').headers['strict-transport-security'], /preload/i, 'not on the HSTS preload list');
  for (const line of read('_headers').split('\n')) assert.ok(line.length <= 1500, 'lines stay readable (Pages reads up to 2,000 characters)');
});

test('nothing may ask for payment (1.39): no page frames a checkout, and the dev server adds no frame source', () => {
  const { headers } = headersFor(rules, '/');
  const features = Object.fromEntries(headers['permissions-policy'].split(/,\s*(?=[a-z-]+=)/).map(part => part.split('=')));
  assert.deepEqual(features, { camera: '()', microphone: '()', geolocation: '()', payment: '()', usb: '()' });
  const serve = read('scripts/serve.mjs');
  assert.doesNotMatch(serve, /frame-src|devFrameSources|fake-?creem/i);
  assert.ok(!sitePolicy(rules).directives.get('frame-src').some(source => source === "'self'" || /localhost|127\.0\.0\.1/.test(source)), 'never this site');
});

test('the dev server sends the _headers rules too, and the build and the check use them', () => {
  const serve = read('scripts/serve.mjs');
  assert.match(serve, /import \{ headersFor, parseHeaders \} from '\.\/headers\.mjs';/);
  assert.match(serve, /const headerRules = parseHeaders\(await fs\.readFile\(join\(root, '_headers'\), 'utf8'\)/);
  assert.equal((serve.match(/\.\.\.siteHeaders\(url\.pathname\)/g) || []).length, 3, 'files, _redirects redirects and the folder redirect');
  assert.match(serve, /delete headers\['strict-transport-security'\];/);
  const check = read('scripts/check.mjs');
  assert.match(check, /cspProblems\(pages, parseHeaders\(await fs\.readFile\(resolve\(root, '_headers'\), 'utf8'\)\)\)/);
  assert.match(read('scripts/build.mjs'), /await copyFile\('_headers'\);/);
});

/** Runs a page's first inline <head> script at an address; returns the address it went to ('' when it stayed). */
function runHead(file, address) {
  const html = read(file);
  const code = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];
  // The address as a path on the site: //evil.example/welcome/ is a path here, as a browser that asked the site for it has it.
  const url = new URL(`https://planner.bemorin.com${address}`);
  assert.equal(url.origin, 'https://planner.bemorin.com');
  let target = '';
  const location = { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash, replace: to => { target = to; } };
  const documentElement = { classList: { add() {}, remove() {}, contains: () => false } };
  vm.runInNewContext(code, { window: { location, matchMedia: () => ({ matches: true }), IntersectionObserver: class {}, setTimeout: () => 0 }, location, document: { documentElement }, URL, URLSearchParams });
  return target;
}

test('the head scripts that send an old address on never leave the site', () => {
  const hostile = [
    ['welcome/index.html', '//evil.example/welcome/?ask=question'],
    ['welcome/index.html', '//evil.example/welcome/?ask=invoice#request'],
    ['welcome/index.html', '//evil.example/welcome/#teams'],
    ['welcome/index.html', '///evil.example/welcome/?ask=question'],
    ['welcome/index.html', '/\\evil.example/welcome/?ask=question'],
    ['admin/index.html', '//evil.example/admin'],
    ['admin/configuration/index.html', '//evil.example/admin/configuration']
  ];
  for (const [file, address] of hostile) {
    const target = runHead(file, address);
    assert.ok(!target || new URL(target).origin === 'https://planner.bemorin.com', `${file} at ${address} went to ${target}`);
  }
  // The real moves still happen, to a full address on the site.
  assert.equal(runHead('welcome/index.html', '/welcome/?ask=question&topic=partners'), 'https://planner.bemorin.com/contact/?topic=partners');
  // The team gift's old parts stay on the landing page (the Teams page is gone, and its addresses redirect there).
  assert.equal(runHead('welcome/index.html', '/welcome/#seats'), '');
  assert.equal(runHead('welcome/index.html', '/welcome/?ask=invoice#request'), '');
  assert.equal(runHead('admin/index.html', '/admin?x=1#y'), 'https://planner.bemorin.com/admin/?x=1#y');
  assert.equal(runHead('admin/configuration/index.html', '/admin/configuration'), 'https://planner.bemorin.com/admin/configuration/');
  assert.equal(runHead('admin/index.html', '/admin/'), '');
  assert.equal(runHead('admin/index.html', '/admin/index.html'), '');
});

test('the welcome page’s fallback follows an old address only on this site', () => {
  const here = 'https://planner.bemorin.com//evil.example/welcome/?ask=question';
  assert.equal(sameSiteHref('//evil.example/contact/', here), '');
  assert.equal(sameSiteHref('https://evil.example/', here), '');
  assert.equal(sameSiteHref('/\\evil.example/teams/', 'https://planner.bemorin.com/welcome/'), '');
  assert.equal(sameSiteHref('/contact/?topic=partners', 'https://planner.bemorin.com/welcome/?ask=question'), 'https://planner.bemorin.com/contact/?topic=partners');
  assert.equal(sameSiteHref('/teams/#seats', 'http://localhost:8080/welcome/#seats'), 'http://localhost:8080/teams/#seats');
  assert.equal(sameSiteHref('', 'https://planner.bemorin.com/welcome/'), '', 'nothing to follow');
  assert.equal(sameSiteHref('/teams/', 'not a url'), '');
  const landing = read('welcome/landing.js');
  assert.match(landing, /const movedTo = sameSiteHref\(movedAddress\(\{ path: location\.pathname, search: location\.search \}\), location\.href\);/);
});

test('the setup guides describe the security block of _headers and the hash check, next to its caching paragraph', () => {
  const guide = read('docs/FEEDBACK_AND_WAITLIST.md');
  const caching = guide.indexOf('Since 1.25, `_headers`');
  const security = guide.indexOf('Since 1.35, its security block (the `/*` rule at the top)');
  assert.ok(caching > 0 && security > caching && !guide.slice(caching, security).includes('\n#'), 'right after the Cache-Control paragraph, in the same section');
  assert.match(guide.slice(security), /^[^\n]*`npm run check` fails \(`scripts\/check\.mjs`, with `scripts\/csp\.mjs`\) and names the hash to put in `script-src`/);
  const configuration = read('docs/configuration.md');
  assert.match(configuration, /The policy is part of the security block at the top of `_headers` \(the `\/\*` rule[^\n]*`npm run check` fails, naming the hash, until those hashes match the published pages exactly/);
  // What the guides name is what _headers sets on /*.
  const names = Object.keys(headersFor(rules, '/').headers);
  for (const header of ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy']) assert.ok(names.includes(header), header);
});
