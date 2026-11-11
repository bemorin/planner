import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIRST_SWATCH, SWATCHES, shownSwatch, swatchById, swatchStep, tourOrder } from '../welcome/palette-card.js';
import { DEFAULT_PAINT, PAINT_PALETTES } from '../src/features/paint-palettes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');

test('the landing’s palettes are the planner’s, in the same order, all of them for everyone', () => {
  assert.deepEqual(SWATCHES.map(swatch => [swatch.id, swatch.name]), PAINT_PALETTES.map(palette => [palette.id, palette.name]));
  assert.equal(FIRST_SWATCH, DEFAULT_PAINT, 'the card starts on the planner’s own default');
  SWATCHES.forEach(swatch => assert.deepEqual(Object.keys(swatch), ['id', 'name'], `${swatch.id}: no free or paid flag`));
  assert.equal(swatchById('plum').name, 'Plum');
  assert.equal(swatchById('nope').id, FIRST_SWATCH, 'an unknown id falls back to the first palette');
});

test('swatches: arrows step and wrap, Home and End jump, other keys are left alone', () => {
  assert.equal(swatchStep('ArrowRight', 0, 6), 1);
  assert.equal(swatchStep('ArrowDown', 5, 6), 0, 'wraps forward');
  assert.equal(swatchStep('ArrowLeft', 0, 6), 5, 'wraps back');
  assert.equal(swatchStep('ArrowUp', 3, 6), 2);
  assert.equal(swatchStep('Home', 4, 6), 0);
  assert.equal(swatchStep('End', 1, 6), 5);
  assert.equal(swatchStep('Enter', 1, 6), -1);
  assert.equal(swatchStep('Tab', 1, 6), -1);
  assert.equal(swatchStep('ArrowRight', 0, 0), -1, 'nothing to move to');
  assert.equal(swatchStep('ArrowRight', 9, 6), 0, 'an index out of range is clamped first');
});

test('the painted year shows the swatch under the pointer, else the focused one, else the pressed one', () => {
  assert.equal(shownSwatch({ hover: 'ocean', focus: 'plum', chosen: 'forest' }), 'ocean');
  assert.equal(shownSwatch({ focus: 'plum', chosen: 'forest' }), 'plum');
  assert.equal(shownSwatch({ chosen: 'forest' }), 'forest');
  assert.equal(shownSwatch({}), FIRST_SWATCH);
  assert.equal(shownSwatch({ hover: 'nope' }), FIRST_SWATCH);
});

test('the tour shows every other palette once and ends where it started', () => {
  assert.deepEqual(tourOrder(), ['ocean', 'forest', 'plum', 'graphite', 'sunset', 'terracotta']);
  assert.deepEqual(tourOrder('graphite'), ['sunset', 'terracotta', 'ocean', 'forest', 'plum', 'graphite']);
  assert.deepEqual(tourOrder('nope'), tourOrder(FIRST_SWATCH));
});

test('the card: one toggle button per palette, each with its colours, none marked Free or Plus', async () => {
  const page = await read('welcome/index.html');
  const css = await read('welcome/landing.css');
  const card = page.slice(page.indexOf('data-palette-card'), page.indexOf('</article>', page.indexOf('data-palette-card')));
  const buttons = [...card.matchAll(/<button class="pal-sw pal-sw--([a-z]+)" type="button" data-swatch="([a-z]+)" aria-pressed="(true|false)">([\s\S]*?)<\/button>/g)];
  assert.deepEqual(buttons.map(match => match[2]), SWATCHES.map(swatch => swatch.id));
  buttons.forEach(([, cls, id, pressed, inner]) => {
    const swatch = swatchById(id);
    assert.equal(cls, id);
    assert.equal(pressed, String(id === FIRST_SWATCH), `${id}: only the first palette starts pressed`);
    assert.match(inner, new RegExp(`>${swatch.name}<`), `${id}: visible name`);
    assert.doesNotMatch(inner, />(?:Free|Plus)</, `${id}: no Free or Plus tag`);
    assert.ok(css.includes(`.yearly-card--paint[data-palette="${id}"]`), `${id}: the painted year can take its colours`);
    assert.ok(css.includes(`.pal-sw--${id}`), `${id}: its swatch has its colours`);
  });
  assert.doesNotMatch(card, /data-palette-tag|pal-sw__tag|pal-year__tag|Terracotta stays free/, 'nothing says which palettes are free');
  assert.match(card, /Six palettes for the year that paints itself\./);
  assert.match(card, /role="group" aria-label="[^"]+"/, 'the swatches are a labelled group');
  assert.match(card, /data-palette-preview aria-hidden="true"/, 'the painted year is decoration');
  assert.match(css, /\.motion-ok \.pal-year \.cell \{ transition:/, 'the recolouring only moves when motion is welcome');
  assert.doesNotMatch(css, /pal-sw__tag|pal-year__tag/, 'no tag styles left');
  assert.doesNotMatch(await read('welcome/palette-card.js'), /'Free'|'Plus'|\.free\b/, 'the card writes no tag');
});
