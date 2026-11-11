import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// config.js reads the runtime configuration when it loads: switch the owner
// API on (the feedback form only shows with it) and stub the browser pieces
// the feedback dialog and its counts touch before importing.
globalThis.__DAILY_PLANNER_CONFIG__ = { PLANNER_API_URL: '/api/' };
const stored = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: key => (stored.has(key) ? stored.get(key) : null), setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) },
  configurable: true,
  writable: true
});
const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, body: JSON.parse(options.body || '{}') });
  return { ok: true, json: async () => ({ ok: true }) };
};
globalThis.window = { matchMedia: () => ({ matches: false }) };

const { APP_VERSION } = await import('../src/config.js');
const { createFeedbackFeature, featureVersion } = await import('../src/features/feedback.js');
const { sendFeedback } = await import('../src/lib/planner-api.js');

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('styles/core.css');
const app = read('app.js');

const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `found ${start}`);
  return text.slice(from, text.indexOf(end, from));
};
const moreMenu = between(html, '<div class="app-menu mobile-more-menu" data-mobile-more-menu hidden>', '\n    </header>');
const exportMenu = between(html, '<div class="export-menu app-menu" data-export-menu hidden>', '\n          </div>');
const header = between(html, '<div class="actions" aria-label="Planner actions">', '<div class="action-popover-wrap mobile-more-wrap">');
// The data-* hooks of the menu's choices, in the order they are read.
const choices = markup => [...markup.matchAll(/<(?:button|a)\b[^>]*?\s(data-[a-z-]+)/g)].map(match => match[1]);
const rule = selector => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `styles/core.css has a rule for ${selector}`);
  return css.slice(at, css.indexOf('}', at) + 1);
};

test('More lists what the header hides, grouped: review, output, the planner, help', () => {
  assert.deepEqual(choices(moreMenu), [
    'data-mobile-workspace-toggle',
    'data-mobile-stats',
    'data-mobile-print', 'data-mobile-export-toggle', 'data-mobile-export-md', 'data-mobile-export-json', 'data-mobile-export-backup', 'data-mobile-import',
    'data-mobile-settings', 'data-sync-guide-open', 'data-install-open',
    'data-mobile-help', 'data-tour-open', 'data-feedback-open', 'data-mobile-github'
  ]);
  const groups = moreMenu.split('<div class="mobile-more-group').slice(1).map(choices);
  assert.deepEqual(groups.map(group => group[0]), ['data-mobile-stats', 'data-mobile-print', 'data-mobile-settings', 'data-mobile-help'], 'four groups');
  assert.match(moreMenu, /<div class="mobile-more-group mobile-more-review">\s*<button type="button" data-mobile-stats>/, 'Time stats has a group of its own');
  assert.match(rule('.mobile-more-group:not(:last-child)'), /border-bottom: 1px solid var\(--line\);/, 'a rule under each group but the last: a hidden group leaves none behind');
});

test('nothing in More is also a visible header icon at the same width', () => {
  // More shows from 1080px down, where the header lets its secondary buttons go.
  assert.match(css, /@media \(max-width: 1080px\) \{[^}]*\.header-secondary \{ display: none; \}\s*\.mobile-more-wrap \{ display: flex; \}/);
  const lines = header.split('\n');
  for (const hook of ['data-print', 'data-export', 'data-settings-open', 'data-help-open', 'data-github-link']) {
    const at = lines.findIndex(line => new RegExp(`<(?:button|a)\\b[^>]*\\s${hook}[\\s>]`).test(line));
    assert.ok(at > 0, hook);
    // The button itself, or the wrap it opens a menu from.
    assert.match(lines[at].includes('header-secondary') ? lines[at] : lines[at - 1], /class="[^"]*\bheader-secondary\b/, `${hook} is hidden wherever More shows`);
  }
  // Time stats stays in the header down to 340px; only below that does More list it.
  assert.match(rule('.mobile-more-menu .mobile-more-review'), /display: none;/);
  assert.match(css, /@media \(max-width: 339px\) \{\n {2}\.topbar \.actions > \[data-stats-open\] \{ display: none; \}\n {2}\.mobile-more-menu \.mobile-more-review \{ display: grid; \}\n\}/);
  assert.doesNotMatch(css, /\.mobile-stats-action/, 'the old rule lost to `.mobile-more-menu button` and showed Time stats twice');
  // Search, Journal, Unresolved, Horizon and the floating window never move into More.
  for (const hook of ['data-search-open', 'data-journal-open', 'data-open-work-open', 'data-stats-open', 'data-pip', 'data-horizon', 'data-view-option']) {
    assert.ok(!choices(moreMenu).some(choice => choice === hook || choice.startsWith(`${hook}-`)), `${hook} is not in More`);
  }
  // Wider than a phone, the header has its own workspace switcher.
  assert.match(css, /@media \(min-width: 791px\) \{\n {2}\.mobile-more-menu \.mobile-workspace \{ display: none; \}\n\}/);
});

test('Export reads like the other menus: icons, the same type, rounded rows on a well, a visible keyboard ring', () => {
  assert.deepEqual(choices(exportMenu), ['data-export-md', 'data-export-json', 'data-export-backup', 'data-import-menu']);
  for (const option of exportMenu.split('\n').filter(line => line.includes('<button'))) assert.match(option, /<svg viewBox="0 0 24 24" aria-hidden="true">.*<\/svg><span>[^<]+<\/span><\/button>/, 'an icon and a label');
  assert.equal(exportMenu.split('<span class="app-menu__rule" aria-hidden="true"></span>').length, 2, 'this day · all data');
  const exportList = between(moreMenu, '<div class="mobile-export-list">', '</div>');
  assert.deepEqual(choices(exportList), ['data-mobile-export-md', 'data-mobile-export-json', 'data-mobile-export-backup', 'data-mobile-import']);
  // Print has its own button wherever Export shows (both header-secondary on a desktop; their own rows in More): never a second Print inside Export.
  for (const menu of [exportMenu, exportList]) assert.doesNotMatch(menu, /Print|data-[a-z-]*(?:print|pdf)/);
  for (const option of exportList.split('\n').filter(line => line.includes('<button'))) assert.match(option, /<svg viewBox="0 0 24 24" aria-hidden="true">.*<\/svg><span>[^<]+<\/span><\/button>/);

  const size = selector => /font-size: ([^;]+);/.exec(rule(selector))?.[1];
  assert.equal(size('.mobile-more-menu a'), '.78rem');
  assert.equal(size('.export-menu button'), '.78rem', 'the desktop Export menu matches More');
  assert.equal(size('.mobile-export-list button'), undefined, 'Export’s options in More are as large as the rest');
  assert.ok(!/\.mobile-export[^{]*\{[^}]*font-size/.test(css), 'no smaller type anywhere in Export’s options');
  assert.match(rule('.mobile-export-disclosure.is-open'), /background: var\(--menu-well\);/);
  assert.match(rule('.mobile-export-disclosure'), /border-radius: 10px;/);
  assert.match(rule('.export-menu,\n.mobile-more-menu'), /border-radius: 12px; box-shadow:/);
  assert.match(rule('.app-menu :is(button, a):focus-visible'), /box-shadow: inset 0 0 0 2px color-mix\(in srgb, var\(--accent\) 60%, transparent\);/);
  // Closed, its options are out of the Tab order, not just out of sight.
  assert.match(rule('.mobile-export-options'), /visibility: hidden;/);
  assert.match(rule('.mobile-export-disclosure.is-open .mobile-export-options'), /visibility: visible;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.mobile-export-options,\n {2}\.mobile-more-menu \.disclosure-chevron \{ transition: none; \}\n\}/);
});

test('the header menus close on a choice, a click outside or Escape, and give focus back', () => {
  assert.match(app, /const closeHeaderMenus = \(\) => \[\['\[data-export-menu\]', '\[data-export\]'\], \['\[data-mobile-more-menu\]', '\[data-mobile-more\]'\]\]/);
  assert.match(app, /\[\['\[data-export-menu\]', '\[data-export\]'\], \['\[data-mobile-export-options\]', '\[data-mobile-more\]'\]\]\.forEach/);
  assert.match(app, /if \(!e\.target\.closest\('\.action-popover-wrap'\)\) closeHeaderMenus\(\);/);
  assert.match(app, /if \(openMenu\) \{ closeHeaderMenus\(\); qs\(openMenu\[1\]\)\.focus\(\); return; \}/);
  assert.match(app, /const fromMenu = action => \(\) => \{ closeHeaderMenus\(\); action\(\); \};/, 'More’s button is never left expanded');
  assert.doesNotMatch(app, /qs\('\[data-mobile-more-menu\]'\)\.hidden = true/);
});

test('people see the feature release; feedback still sends, and says, the exact version', async () => {
  const release = featureVersion(APP_VERSION);
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.notEqual(release, APP_VERSION);
  assert.match(app, /qsa\('\[data-app-version\]'\)\.forEach\(node => \{ node\.textContent = featureVersion\(APP_VERSION\); \}\);/, 'Help: “Version 1.33 · What’s new…”');
  assert.match(html, /<strong>Version <span data-app-version><\/span><\/strong><span>See what changed, and tell us what to keep, change or fix\.<\/span><\/span>\n\s*<button class="secondary-button" type="button" data-feedback-open>What’s new<\/button>/);

  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const modal = {};
  globalThis.document = { querySelector: selector => ({ '[data-feedback-modal]': modal, '[data-feedback]': root })[selector] || null, querySelectorAll: () => [] };
  const opened = [];
  createFeedbackFeature({ openModal: dialog => opened.push(dialog), closeModal: () => {} }).open();
  assert.deepEqual(opened, [modal]);
  assert.ok(root.innerHTML.includes(`<p class="modal__eyebrow">Daily Planner ${release}</p>`), 'the dialog’s eyebrow');
  assert.ok(!root.innerHTML.includes(`<p class="modal__eyebrow">Daily Planner ${APP_VERSION}</p>`));
  assert.ok(root.innerHTML.includes(`Sent with: Daily Planner ${APP_VERSION} · `), 'what is sent is said as it is');

  requests.length = 0;
  await sendFeedback({ rating: 5, kind: 'idea', message: 'Calm and clear.' });
  const sent = requests.find(request => request.url === '/api/feedback');
  assert.equal(sent?.body.version, APP_VERSION, 'the exact version goes with the feedback');
});
