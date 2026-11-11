import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PAINT,
  PAINT_PALETTES,
  PAINT_STORAGE_KEY,
  applyPaint,
  choosePaint,
  normalizePaint,
  readPaint,
  renderPaintChooser,
  syncPaint,
  writePaint
} from '../src/features/paint-palettes.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    has: key => map.has(key)
  };
}

const fakeDoc = () => ({ documentElement: { dataset: {} } });

test('the palette list matches the contract: terracotta first, five more, the same storage key as 1.38', () => {
  assert.deepEqual(PAINT_PALETTES.map(palette => palette.id), ['terracotta', 'ocean', 'forest', 'plum', 'graphite', 'sunset']);
  assert.equal(DEFAULT_PAINT, 'terracotta');
  assert.equal(PAINT_STORAGE_KEY, 'daily-planner-ui:paint');
});

test('unknown or missing values normalise to the default', () => {
  assert.equal(normalizePaint('plum'), 'plum');
  assert.equal(normalizePaint('Plum'), DEFAULT_PAINT);
  assert.equal(normalizePaint(null), DEFAULT_PAINT);
  assert.equal(normalizePaint(undefined), DEFAULT_PAINT);
});

test('storage: the default removes the key, a palette is stored, failures fall back', () => {
  const storage = memoryStorage();
  assert.equal(writePaint('forest', storage), 'forest');
  assert.equal(storage.getItem(PAINT_STORAGE_KEY), 'forest');
  assert.equal(readPaint(storage), 'forest');
  writePaint(DEFAULT_PAINT, storage);
  assert.equal(storage.has(PAINT_STORAGE_KEY), false);
  assert.equal(readPaint(memoryStorage({ [PAINT_STORAGE_KEY]: 'neon' })), DEFAULT_PAINT);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readPaint(broken), DEFAULT_PAINT);
  assert.equal(writePaint('ocean', broken), 'ocean', 'a blocked storage never throws');
});

test('applying a palette sets or clears html[data-paint]', () => {
  const doc = fakeDoc();
  assert.equal(applyPaint('ocean', doc), 'ocean');
  assert.equal(doc.documentElement.dataset.paint, 'ocean');
  applyPaint(DEFAULT_PAINT, doc);
  assert.equal('paint' in doc.documentElement.dataset, false);
  assert.equal(applyPaint('ocean', {}), DEFAULT_PAINT, 'no document: nothing to paint');
});

test('a palette stored by 1.38 paints at once, with no licence: nothing to migrate', () => {
  const storage = memoryStorage({ [PAINT_STORAGE_KEY]: 'plum' });
  const doc = fakeDoc();
  assert.equal(syncPaint({ storage, doc }), 'plum');
  assert.equal(doc.documentElement.dataset.paint, 'plum');
  assert.equal(storage.getItem(PAINT_STORAGE_KEY), 'plum', 'the choice is kept as it was');
  assert.equal(syncPaint({ storage: memoryStorage(), doc }), DEFAULT_PAINT, 'nothing stored: terracotta');
  assert.equal('paint' in doc.documentElement.dataset, false);
});

test('choosing: every palette can be chosen by everyone, and terracotta clears the key', () => {
  const storage = memoryStorage();
  const doc = fakeDoc();
  PAINT_PALETTES.forEach(({ id }) => {
    assert.equal(choosePaint(id, { storage, doc }), id, id);
    assert.equal(readPaint(storage), id);
  });
  assert.equal(choosePaint('graphite', { storage, doc }), 'graphite');
  assert.equal(storage.getItem(PAINT_STORAGE_KEY), 'graphite');
  assert.equal(doc.documentElement.dataset.paint, 'graphite');
  assert.equal(choosePaint(DEFAULT_PAINT, { storage, doc }), DEFAULT_PAINT);
  assert.equal(storage.has(PAINT_STORAGE_KEY), false);
  assert.equal('paint' in doc.documentElement.dataset, false);
  assert.equal(choosePaint('neon', { storage, doc }), DEFAULT_PAINT, 'an unknown value falls back to the default');
});

test('the chooser shows every palette open to choose, the current one marked, with no lock, badge or price', () => {
  const html = renderPaintChooser({ current: 'ocean' });
  PAINT_PALETTES.forEach(palette => assert.match(html, new RegExp(`data-paint-choice="${palette.id}"`)));
  assert.match(html, /data-paint-choice="ocean" aria-pressed="true"/);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.doesNotMatch(html, /is-locked|hz-plus-badge|Plus|needs|unlock/i);
  assert.match(html, /On this device only\. Every palette works in light and dark\./);
  assert.match(renderPaintChooser({ current: 'bogus' }), /data-paint-choice="terracotta" aria-pressed="true"/);
});

test('every palette beyond terracotta has light rules, both dark rules and a swatch class in styles/year.css', () => {
  const css = readFileSync(new URL('../styles/year.css', import.meta.url), 'utf8');
  PAINT_PALETTES.filter(palette => palette.id !== DEFAULT_PAINT).forEach(({ id }) => {
    assert.ok(css.includes(`html[data-paint="${id}"]`), `${id}: light rule`);
    assert.ok(css.includes(`.hz-palette--${id}`), `${id}: swatch class`);
    assert.ok(css.includes(`:root:not([data-theme="light"])[data-paint="${id}"]`), `${id}: system dark rule`);
    assert.ok(css.includes(`:root[data-theme="dark"][data-paint="${id}"]`), `${id}: explicit dark rule`);
  });
  assert.ok(css.includes('.hz-palette--terracotta'), 'the default swatch resets to terracotta');
  assert.equal((css.match(/!important/g) || []).length, 0);
});
