import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overflows, syncScrollRegion, watchScrollRegion } from '../src/lib/dom.js';

/* Accessibility leftovers (1.35): scroll areas keyboard users can scroll, the
   week view's controls side by side, headers that aren't a second banner. */

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** A stand-in for an element: its sizes, and its attributes in a Map. */
function box({ scrollHeight = 100, clientHeight = 100, scrollWidth = 300, clientWidth = 300, attributes = {} } = {}) {
  const attrs = new Map(Object.entries(attributes));
  return {
    scrollHeight, clientHeight, scrollWidth, clientWidth, children: [],
    getAttribute: name => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: name => attrs.delete(name),
    hasAttribute: name => attrs.has(name),
    attrs
  };
}

test('a scroll area takes focus as a named region only while it overflows, and gives back only what it set', () => {
  const area = box();
  assert.equal(overflows(area), false);
  assert.equal(syncScrollRegion(area, 'Your 2026 in review'), false);
  assert.deepEqual([...area.attrs], [], 'nothing while everything fits');
  area.scrollHeight = 900;
  assert.equal(syncScrollRegion(area, 'Your 2026 in review'), true);
  assert.deepEqual(Object.fromEntries(area.attrs), { tabindex: '0', role: 'region', 'aria-label': 'Your 2026 in review', 'data-scroll-region': '' });
  // A name that changes (the check-in's step) is read each time.
  let step = 1;
  syncScrollRegion(area, () => `Step ${step} of 4`);
  step = 2;
  syncScrollRegion(area, () => `Step ${step} of 4`);
  assert.equal(area.getAttribute('aria-label'), 'Step 2 of 4');
  area.scrollHeight = 100;
  syncScrollRegion(area, 'x');
  assert.deepEqual([...area.attrs], [], 'a plain box again');
  // Sideways too (a wide table on a phone); a tabindex someone else set is left alone.
  const table = box({ scrollWidth: 700, clientWidth: 350 });
  assert.equal(syncScrollRegion(table, 'Feedback by version table'), true);
  const own = box({ attributes: { tabindex: '-1' } });
  syncScrollRegion(own, 'x');
  assert.equal(own.getAttribute('tabindex'), '-1');
  assert.equal(overflows(null), false);
  assert.equal(syncScrollRegion(null, 'x'), false);
  // Without ResizeObserver (node), watching syncs once and stops cleanly.
  const watched = box({ scrollHeight: 500 });
  const stop = watchScrollRegion(watched, 'Check-in step');
  assert.equal(watched.getAttribute('role'), 'region');
  assert.equal(typeof stop, 'function');
  stop();
});

test('the year review, the quarter check-in and the dashboard’s wide tables use it; overlays have no second banner', () => {
  const review = read('src/features/year-review.js');
  assert.match(review, /watchScrollRegion\(el\.querySelector\('\[data-review-scroll\]'\)/);
  assert.match(review, /unwatchScroll\?\.\(\);/, 'and stop watching on close');
  const quarter = read('src/features/quarter-session.js');
  assert.match(quarter, /watchScrollRegion\(root\.querySelector\('\[data-quarter-scroll\]'\), stepRegionName\)/);
  assert.match(quarter, /unwatchScroll\?\.\(\);/);
  const admin = read('admin/admin.js');
  assert.match(admin, /document\.querySelectorAll\('\.owner-scroll'\)\.forEach/);
  assert.match(admin, /return `\$\{\[title, list\]\.filter\(Boolean\)\.join\(': '\) \|\| 'Wide'\} table`;/, 'never the card’s own name');
  assert.match(read('styles/year.css'), /\.yp-scroll\[data-scroll-region\]:focus-visible \{ outline: 2px solid/);
  assert.match(read('admin/admin.css'), /\.owner-scroll\[data-scroll-region\]:focus-visible \{ outline: 2px solid/);
  // Horizon's and the overlays' headers are no landmark: the page's own header is the only banner.
  assert.match(read('index.html'), /<div class="hz-head" data-horizon-nav>/);
  for (const file of ['src/features/year-plan.js', 'src/features/quarter-session.js', 'src/features/year-review.js']) assert.doesNotMatch(read(file), /<header class="yp-head/, file);
});

test('a week block: its open button and its checkbox are siblings, the checkbox a 24px target drawn at 20px', () => {
  const week = read('src/features/week.js');
  const block = /return `<div class="week-time-block[\s\S]*?<\/div><\/div>`;/.exec(week)?.[0] || '';
  assert.ok(block, 'the block’s markup');
  assert.doesNotMatch(block, /role="button"|tabindex="0"/, 'the block itself is no control');
  const open = block.indexOf('<button type="button" class="week-time-block__open" data-week-block-open aria-label="${ctx.escAttr(label)}"></button>');
  const check = block.indexOf('<input class="check week-time-block__check"');
  assert.ok(open > 0 && check > open, 'the open button, then the checkbox, both children of the block');
  assert.match(block, /<div class="week-time-block__copy" aria-hidden="true">/, 'the button says what the copy shows');
  assert.match(week, /addEventListener\('click', event => \{\n\s+if \(event\.detail === 0\) open\(event\);/, 'Enter, Space and screen readers; the pointer has its own path (drag)');
  const css = read('styles/week.css');
  assert.match(css, /\.week-time-block__check \{\n {2}position: absolute;\n {2}z-index: 3;\n {2}top: 4px;\n {2}right: 4px;\n {2}width: 24px;\n {2}height: 24px;/);
  assert.match(css, /\.week-time-block__check::before \{\n {2}content: "";\n {2}position: absolute;\n {2}inset: 2px;/);
  assert.match(css, /\.week-time-block:has\(> \.week-time-block__open:focus-visible\) \{/, 'the focus ring goes round the block, as before');
});
