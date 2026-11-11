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
  // The other blocks in four columns, or side by side, fill row by row too: the shortcuts, the cards.
  assert.doesNotMatch(guidesCss + read('styles/core.css'), /\.(?:help-start|help-cards|shortcut-grid)[^{]*\{[^}]*grid-auto-flow: column/);
});

test('How it works on a wide screen (1.39.2): Get started and About this planner are lists of rows, each across the full width', () => {
  const rules = wide(guidesCss);
  // One column: Get started, then About this planner under it, each as wide as the dialog.
  assert.match(rules, /\.help-start \{ grid-template-columns: minmax\(0, 1fr\); gap: 20px; margin-bottom: 26px; \}/);
  // Never two groups side by side again (Get started took the left half, About the full width under it).
  assert.doesNotMatch(rules, /\.help-start \{[^}]*repeat\(2/);
  assert.doesNotMatch(guidesCss, /\.help-start[^{]*>\s*\.help-group[^{]*\{[^}]*grid-column/);
  // In the page, Get started comes first, then About: the order you see is the order you read and Tab in.
  const top = /<div class="help-start">([\s\S]*?)\n {8}<\/div>\n\n {8}<div class="help-content">/.exec(html)?.[1] || '';
  assert.deepEqual([...top.matchAll(/<h3 class="help-group__title">([^<]+)<\/h3>/g)].map(match => match[1]), ['Get started', 'About this planner']);
  assert.doesNotMatch(top, /help-cards/, 'no small cards here: every group is a list of rows');
  // Every row's action at the right, at one width: Take the tour as wide as What’s new and Read the notice.
  assert.match(guidesCss, /\.help-row,\n\.help-card \{ display: grid; grid-template-columns: 32px minmax\(0, 1fr\) auto;/);
  assert.match(guidesCss, /\.help-row > :is\(button, a\) \{ min-width: 8\.5rem; white-space: nowrap; \}/);
  assert.match(guidesCss, /\.help-row > \.help-switch \{ justify-self: end; \}/);
  // Small sibling cards may still sit side by side, stacked on a phone.
  assert.match(guidesCss, /\.help-cards \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 15rem\), 1fr\)\);/);
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

test('Settings (1.39.1): three columns in the order they read, the same order in one flow on a phone', () => {
  const scroll = /<div class="modal" data-settings-modal hidden>[\s\S]*?<div class="modal__scroll">([\s\S]*?)\n {6}<\/div>\n {4}<\/section>/.exec(html)?.[1] || '';
  // DOM order = visual order = Tab order: column by column, top to bottom, left then right; Privacy after the columns.
  const parts = scroll.split(/<div class="settings-column settings-column--(\w+)">/).slice(1);
  const columns = [];
  for (let i = 0; i < parts.length; i += 2) columns.push([parts[i], [...parts[i + 1].matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1])]);
  assert.deepEqual(columns.map(([name]) => name), ['schedule', 'categories', 'devices']);
  assert.deepEqual(columns[0][1], ['Appearance', 'Displayed hours', 'Planning week']);
  assert.deepEqual(columns[1][1], ['Categories & projects']);
  assert.deepEqual(columns[2][1].slice(0, 2), ['Your devices', 'Personal sync'], 'Personal sync directly under Your devices');
  assert.equal(columns[2][1].at(-1), 'Privacy', 'Privacy comes after the last column');
  assert.match(scroll, /<\/section>\n {8}<\/div>\n\n {8}<section class="settings-group settings-group--privacy" data-privacy-entry hidden>/, 'Privacy is outside the columns');
  assert.ok(scroll.indexOf('Week starts on') > scroll.indexOf('<h3>Planning week</h3>') && scroll.indexOf('Week starts on') < scroll.indexOf('<h3>Categories & projects</h3>'));
  // The header says what the dialog is.
  assert.match(scroll, /<h2 id="settings-title">Settings<\/h2>\n {10}<p>Changes are saved as you make them\.<\/p>/);
  assert.doesNotMatch(scroll, /Schedule & categories|Planner settings/);
  assert.match(scroll, /<p>Name what your time goes to\. Colours help you scan the day; archive a category to keep its history without offering it for new plans\.<\/p>/);
  // Personal sync keeps the data attributes its code finds it by.
  assert.match(scroll, /<section class="settings-group" data-personal-sync hidden>/);

  // One flow until the screen is wide; the line between sections stays where a wrapper ends.
  assert.match(settingsCss, /^\.settings-column \{ display: contents; \}/m);
  assert.match(settingsCss, /^\.settings-column \+ \.settings-column > \.settings-group:first-child,\n\.settings-column \+ \.settings-group--privacy \{\n {2}margin-top: 1\.15rem;\n {2}padding-top: 1rem;\n {2}border-top: 1px solid var\(--line\);/m);
  const rules = wide(settingsCss);
  assert.match(rules, /\[data-settings-modal\] \.modal__panel \{ width: min\(100%, clamp\(640px, calc\(640px \+ \(100vw - 1000px\) \* 2\), 1200px\)\); max-height: calc\(100dvh - 2rem\);/);
  assert.match(rules, /\[data-settings-modal\] \.modal__scroll \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); align-content: start; align-items: start;/, 'each column as tall as its content');
  assert.match(rules, /\.settings-column \{ display: block;/);
  assert.match(rules, /\.settings-group--privacy \{ grid-column: 1 \/ -1; display: grid;/);
  // Three columns from 1220px; between 1100 and 1220, your devices go across the width under the other two.
  const three = mediaBlocks(settingsCss, /min-width:\s*1220px/);
  assert.match(three, /\[data-settings-modal\] \.modal__scroll \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1\.16fr\);/);
  assert.match(three, /\.settings-column--devices \{ grid-column: auto;/);
  // Never one column scrolling on its own.
  assert.doesNotMatch(settingsCss, /\.settings-column[^{]*\{[^}]*overflow/);
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
