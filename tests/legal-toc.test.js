import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activeSectionIndex, readingLine } from '../legal/legal.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('“On this page” marks the last section whose top has reached the reading line', () => {
  const tops = [-900, -200, 120, 640, 1400];
  assert.equal(activeSectionIndex(tops, 260), 2);
  assert.equal(activeSectionIndex(tops, 100), 1, 'a section below the line is not read yet');
  assert.equal(activeSectionIndex([300, 900], 260), -1, 'above the first section: nothing');
  assert.equal(activeSectionIndex([260, 900], 260), 0, 'exactly on the line counts');
  assert.equal(activeSectionIndex(tops, 260, true), 4, 'at the end of the page: the last one, however short');
  assert.equal(activeSectionIndex([], 260, true), -1);
  assert.equal(activeSectionIndex(undefined, 260), -1);
  assert.equal(activeSectionIndex([NaN, 10], 260), 1, 'a missing position is skipped');
});

test('the reading line sits a quarter of the way down, under the sticky header', () => {
  assert.equal(readingLine(64, 900), 273);
  assert.equal(readingLine(60, 844), 256);
  assert.equal(readingLine(64, 200), 112, 'never closer than 48 px to the header');
  assert.equal(readingLine(undefined, 800), 200);
});

test('the active link takes the hover colour, and every legal page has the contents it follows', async () => {
  const css = await readFile(join(root, 'legal/legal.css'), 'utf8');
  assert.match(css, /\.lg-toc a:hover,\n\.lg-toc a\[aria-current="true"\] \{ color: var\(--ink\); \}/);
  for (const page of ['legal/index.html', 'legal/privacy/index.html', 'legal/terms/index.html', 'legal/cookies/index.html']) {
    const html = await readFile(join(root, page), 'utf8');
    const toc = html.slice(html.indexOf('class="lg-toc"'), html.indexOf('</nav>', html.indexOf('class="lg-toc"')));
    const ids = [...toc.matchAll(/href="#([a-z0-9-]+)"/g)].map(match => match[1]);
    assert.ok(ids.length > 1, page);
    ids.forEach(id => assert.match(html, new RegExp(`<section id="${id}"`), `${page}: #${id}`));
  }
});
