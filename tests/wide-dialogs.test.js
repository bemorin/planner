import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Dialogs on a wide screen (1.38): the content-heavy ones take the width (columns, a wider panel) instead of a
   narrow column to scroll; below 1000px they are as before. Their collapsibles open and close smoothly. */

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const guidesCss = read('styles/guides.css');
const settingsCss = read('styles/settings.css');
const insightsCss = read('styles/insights.css');

/** The bodies of every `@media …` block whose condition matches `condition`. */
function mediaBlocks(css, condition) {
  const blocks = [];
  let at = css.indexOf('@media');
  while (at !== -1) {
    const open = css.indexOf('{', at);
    const query = css.slice(at, open);
    let depth = 1;
    let end = open + 1;
    while (depth && end < css.length) {
      if (css[end] === '{') depth += 1;
      if (css[end] === '}') depth -= 1;
      end += 1;
    }
    if (condition.test(query)) blocks.push(css.slice(open + 1, end - 1));
    at = css.indexOf('@media', end);
  }
  return blocks.join('\n');
}

const wide = css => mediaBlocks(css, /min-width:\s*1[01]00px/);

/** The stylesheet without any of its `@media` blocks: what applies at every width. */
function withoutMedia(css) {
  let out = '';
  let from = 0;
  let at = css.indexOf('@media');
  while (at !== -1) {
    out += css.slice(from, at);
    let depth = 0;
    let end = css.indexOf('{', at);
    do {
      if (css[end] === '{') depth += 1;
      if (css[end] === '}') depth -= 1;
      end += 1;
    } while (depth && end < css.length);
    from = end;
    at = css.indexOf('@media', end);
  }
  return out + css.slice(from);
}

test('How it works: the guide reads row by row on a wide screen (1 2 / 3 4 / …), in the order of the page', () => {
  const content = /<div class="help-content">([\s\S]*?)\n {8}<\/div>\n/.exec(html)?.[1] || '';
  // One list, 1 to 12, straight in the page: the order of the page is the order you read and Tab in.
  const items = [...content.matchAll(/<details class="help-faq" open><summary><h3>(\d+)\. /g)].map(match => Number(match[1]));
  assert.deepEqual(items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.doesNotMatch(content, /help-column/, 'no column wrappers: they made the grid read 1 to 7 down, then 8 to 12');
  assert.doesNotMatch(guidesCss, /help-column/);
  // Data on this device and the shortcuts stay before the guide, across the width.
  assert.ok(content.indexOf('storage-card') < content.indexOf('<h3>1. '));
  assert.ok(content.indexOf('help-faq--shortcuts') < content.indexOf('<h3>1. '));
  const rules = wide(guidesCss);
  assert.match(rules, /\.modal__panel--help \{ width: min\(100%, clamp\(640px, [^;]+, 1040px\)\); \}/);
  // A grid that fills row by row (never grid-auto-flow: column or CSS columns), each item at its own height.
  assert.match(rules, /\.help-content \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); column-gap: 32px; align-items: start; \}/);
  assert.match(rules, /\.help-content > :is\(\.help-priority-card, \.help-faq--shortcuts\) \{ grid-column: 1 \/ -1; \}/);
  assert.doesNotMatch(rules, /\.help-content[^{]*\{[^}]*(?:grid-auto-flow: column|[{;]\s*columns:)/);
  assert.match(rules, /\.help-start \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  // The other blocks in two or four columns fill row by row too: Get started then About, the shortcuts, the cards.
  assert.doesNotMatch(guidesCss + read('styles/core.css'), /\.(?:help-start|help-cards|shortcut-grid)[^{]*\{[^}]*grid-auto-flow: column/);
});

test('How it works on a phone: each row’s action, and the main button of every card, take the full width', () => {
  const phone = mediaBlocks(guidesCss, /max-width: 560px\)\s*$/);
  assert.match(phone, /\.help-row > :is\(button, a\) \{ grid-column: 1 \/ -1; width: 100%; min-width: 0; min-height: 46px; \}/);
  assert.match(phone, /\.help-content \.github-support__actions a \{ width: 100%; min-height: 46px; \}/);
  assert.match(phone, /\.help-content \.storage-import-button \{ min-height: 46px; \}/);
  assert.match(phone, /\.help-faq \[data-install-open\] \{ width: 100%; min-height: 46px; \}/);
  // Take the tour is that row’s action.
  assert.match(html, /<li class="help-row help-tour">[\s\S]*?<button class="primary-button" type="button" data-tour-open>Take the tour<\/button>\s*<\/li>/);
});

test('Settings: two columns of sections in the dialog’s order, the line between them kept in one flow', () => {
  const scroll = /<div class="modal" data-settings-modal hidden>[\s\S]*?<div class="modal__scroll">([\s\S]*?)\n {6}<\/div>\n {4}<\/section>/.exec(html)?.[1] || '';
  const columns = scroll.split('<div class="settings-column">').slice(1).map(part => [...part.matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1]));
  assert.equal(columns.length, 2);
  assert.deepEqual(columns[0], ['Appearance', 'Your devices', 'Displayed hours'], '1.39: no Plus card');
  assert.deepEqual(columns[1].slice(0, 2), ['Planning week', 'Categories & projects']);
  assert.equal(columns[1].at(-1), 'Privacy');
  assert.match(settingsCss, /^\.settings-column \{ display: contents; \}/m);
  assert.match(settingsCss, /^\.settings-column \+ \.settings-column > \.settings-group:first-child \{\n {2}margin-top: 1\.15rem;\n {2}padding-top: 1rem;\n {2}border-top: 1px solid var\(--line\);/m);
  const rules = wide(settingsCss);
  assert.match(rules, /\[data-settings-modal\] \.modal__scroll \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(rules, /\.settings-column \{ display: block;/);
  // Two categories side by side only once a column has room for both names.
  assert.match(settingsCss, /@media screen and \(min-width: 1100px\) and \(max-width: 1259\.98px\) \{\n {2}\[data-settings-modal\] \.category-settings \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('Privacy, What’s new and Insights use the height the screen has; Insights stays inside a fitted window', () => {
  const privacy = mediaBlocks(guidesCss, /min-width:\s*1000px/);
  assert.match(privacy, /\.modal--privacy \.modal__panel:has\(\.privacy-sections > :nth-child\(3\)\) \.modal__scroll \{ flex: 1 1 auto; min-height: 0; max-height: none;/);
  assert.match(wide(guidesCss), /\.modal--feedback \.modal__scroll:has\(> \.whats-new \+ \.feedback-form\) \{ display: grid;/);
  assert.match(wide(insightsCss), /body\.app-expanded \[data-stats-modal\] \.modal__panel\.is-insights \{ max-height: min\(940px, var\(--modal-expanded-max-height/);
});

test('every wide layout waits for 1000px: nothing changes on a phone, a tablet or a small laptop', () => {
  for (const [name, css] of [['guides', guidesCss], ['settings', settingsCss], ['insights', insightsCss]]) {
    const outside = withoutMedia(css.replace(/\/\*[\s\S]*?\*\//g, ''));
    for (const selector of ['.help-content { grid-template-columns', '[data-settings-modal] .modal__scroll { display: grid', 'subgrid']) {
      assert.ok(!outside.includes(selector), `${name}: ${selector} only inside a wide media query`);
    }
  }
});

test('the Insights tables unfold by their height, keeping aria-expanded right', () => {
  const insights = read('src/features/insights.js');
  assert.match(insights, /toggle\.setAttribute\('aria-expanded', String\(opening\)\);/);
  assert.match(insights, /toggleHeight\(table, false, \(\) => \{ table\.hidden = true; delete table\.dataset\.folding; \}\);/);
  assert.match(insightsCss, /\.ins-table \{ margin-top: 10px; overflow-x: auto; overflow-y: hidden;/);
});
