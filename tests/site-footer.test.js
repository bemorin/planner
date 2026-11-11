import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// The public pages, each with its folder (for relative links) and what its footer holds besides the brand.
const PAGES = [
  { file: 'welcome/index.html', folder: 'welcome/', root: '../', counts: /<button class="foot__counts" type="button" data-privacy-open hidden>/ },
  { file: 'contact/index.html', folder: 'contact/', root: '../', counts: /<a class="foot__counts" href="\.\.\/welcome\/#privacy" data-counts-link hidden>/ }
];

// A site path with its #part: ../welcome/#open from contact/ is welcome/#open.
const resolveHref = (folder, href) => {
  const [path, hash = ''] = href.split('#');
  return `${posix.normalize(posix.join(folder, path || './'))}${hash ? `#${hash}` : ''}`;
};
const linksOf = html => [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(match => ({ href: /href="([^"]+)"/.exec(match[1])?.[1] || '', text: match[2].replace(/<[^>]+>/g, '').trim() }));

test('every footer repeats nothing its top bar has (1.32)', () => {
  for (const { file, folder } of PAGES) {
    const page = read(file);
    const top = /<header class="top"[\s\S]*?<\/header>/.exec(page)[0];
    const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(page)[0];
    // The brand leads home in both: any other destination the top bar has, the footer doesn't.
    const inTop = new Set(linksOf(top).filter(link => !link.text.includes('Daily Planner')).map(link => resolveHref(folder, link.href)));
    for (const link of linksOf(foot)) {
      if (/^https:/.test(link.href)) continue;
      assert.ok(!inTop.has(resolveHref(folder, link.href)), `${file}: “${link.text}” is already in the top bar`);
    }
  }
});

test('every footer is built the same: the brand, its social links, the legal pages and Contact, what the page counts', () => {
  for (const { file, root, counts } of PAGES) {
    const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(read(file))[0];
    assert.match(foot, /<div class="foot__brand">[\s\S]*?<span><b>Daily Planner<\/b> By <a href="https:\/\/bemorin\.com\/" rel="noopener">Ben Morin<\/a><\/span>/, file);
    // Across from the brand: the social links once set (their group waits hidden).
    assert.match(foot, /<nav class="foot__links" aria-label="Social links" hidden>\s*<span class="foot__social" data-social hidden><\/span>\s*<\/nav>/, file);
    // Below: the legal pages, then Contact, as in the planner's own footer; what this page counts across from them.
    const base = /<div class="wrap foot__base">([\s\S]*?)\n {4}<\/div>/.exec(foot)?.[1] || '';
    assert.deepEqual(linksOf(base).filter(link => link.text !== 'What this page counts').map(link => [link.href, link.text]), [
      [`${root}legal/privacy/`, 'Privacy'], [`${root}legal/terms/`, 'Terms'], [`${root}legal/cookies/`, 'Cookies'], [`${root}legal/`, 'Legal notice'],
      [file === 'contact/index.html' ? './' : `${root}contact/`, 'Contact']
    ], file);
    assert.match(base, /^\s*<div class="foot__links">\s*<nav class="foot__legal" aria-label="Legal">[\s\S]*?<\/nav>\s*<a [^>]*>Contact<\/a>\s*<\/div>/, `${file}: Contact beside the legal pages, outside their nav`);
    assert.match(base, counts, file);
    assert.doesNotMatch(foot, /data-support|foot__support|Support:|mailto:/, `${file}: no support address`);
    for (const word of ['Plus', 'Pricing', 'Partners', 'Team gift', 'Ask a question']) assert.ok(!linksOf(foot).some(link => link.text === word), `${file}: no ${word}`);
  }
  assert.match(read('contact/index.html'), /<a href="\.\/" aria-current="page">Contact<\/a>/, 'the Contact page marks itself');
  for (const { file } of PAGES) assert.match(read(file), /<symbol id="i-stats" viewBox="0 0 24 24">/, `${file}: the stats icon of “What this page counts”`);
});

test('every page’s script fills in the social links, and shows what it counts only when it counts', () => {
  for (const [file, call] of [['contact/contact.js', /^renderFooter\(\);$/m], ['welcome/landing.js', /^ {2}renderFooter\(\);$/m]]) {
    assert.match(read(file), call, file);
  }
  assert.match(read('contact/contact.js'), /qsa\('\[data-counts-link\]'\)\.forEach\(link => \{ link\.hidden = !apiOn; \}\);/);
  const kit = read('welcome/page-kit.js');
  assert.match(kit, /export function renderFooter\(\) \{/);
  assert.match(kit, /social\.hidden = false;\n[\s\S]*?const group = social\.closest\('\.foot__links'\);\n {4}if \(group\) group\.hidden = false;/, 'the group shows once it has a link');
  assert.doesNotMatch(kit, /data-support|Support: /);
});

test('the social links are small buttons that say where they lead, open a new tab and draw no brand logo (1.33.2)', async () => {
  const { socialLinks } = await import('../welcome/page-kit.js');
  const set = { SOCIAL_X_URL: 'https://x.com/example', SOCIAL_LINKEDIN_URL: ' https://www.linkedin.com/in/example/ ', PROJECT_GITHUB_URL: 'https://github.com/example/daily-planner' };
  // X first (never “X” alone), then LinkedIn, then the project; each name starts with what it shows (voice control).
  assert.deepEqual(socialLinks(key => set[key] || ''), [
    { href: 'https://x.com/example', label: 'Follow on X', name: 'Follow on X (Ben Morin, opens in a new tab)', rel: 'me noopener' },
    { href: 'https://www.linkedin.com/in/example/', label: 'LinkedIn', name: 'LinkedIn (Ben Morin, opens in a new tab)', rel: 'me noopener' },
    { href: 'https://github.com/example/daily-planner', label: 'GitHub', name: 'GitHub (Daily Planner, opens in a new tab)', rel: 'noopener' }
  ]);
  // Only what is set, and only https.
  assert.deepEqual(socialLinks(key => (key === 'SOCIAL_LINKEDIN_URL' ? set[key] : '')).map(link => link.label), ['LinkedIn']);
  assert.deepEqual(socialLinks(key => ({ SOCIAL_X_URL: 'http://x.com/example', SOCIAL_LINKEDIN_URL: 'javascript:alert(1)', PROJECT_GITHUB_URL: 'https://github.com/a b' })[key]), []);
  assert.deepEqual(socialLinks(() => ''), []);

  const kit = read('welcome/page-kit.js');
  assert.match(kit, /el\('a', \{ class: 'foot__btn', href, rel, target: '_blank', 'aria-label': name \}, label\)/);
  // The arrow every page's sprite has, turned to ↗ by the stylesheet: no logo, no new symbol.
  assert.match(kit, /const OUT_ICON = '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-arrow"\/><\/svg>';/);
  for (const { file } of PAGES) assert.match(read(file), /<symbol id="i-arrow" viewBox="0 0 24 24">/, `${file}: the arrow is in its sprite`);
  const css = read('welcome/landing.css');
  assert.match(css, /\.foot__social a\.foot__btn \{ display: inline-flex;[^}]*border-radius: 999px;[^}]*\}/);
  assert.match(css, /\.foot__social a\.foot__btn:focus-visible \{ outline-offset: 2px; border-radius: 999px; \}/);
  assert.match(css, /\.foot__btn svg\.i \{[^}]*transform: rotate\(-45deg\); \}/);
  // Its transitions and the arrow's nudge only when motion is welcome.
  const motion = /@media \(prefers-reduced-motion: no-preference\) \{\n {2}\.foot__btn \{ transition:[\s\S]*?\n\}/.exec(css)?.[0] || '';
  assert.match(motion, /\.foot__btn:hover svg\.i \{ transform: translate\(1\.5px, -1\.5px\) rotate\(-45deg\); \}/);
  assert.doesNotMatch(css.replace(motion, ''), /\.foot__btn[^{]*\{[^}]*transition/);
});
