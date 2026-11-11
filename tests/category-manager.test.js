import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { focusFallback, newCategory, nextCategoryColor } from '../src/features/category-manager.js';

const rows = ['a', 'b', 'c'];

test('archiving or restoring keeps focus on the same category, on its counterpart control', () => {
  assert.deepEqual(focusFallback({ control: 'archive', index: 1 }, rows)[0], { row: 'same', control: 'restore' });
  assert.deepEqual(focusFallback({ control: 'restore', index: 0 }, rows)[0], { row: 'same', control: 'archive' });
});

test('a deleted category hands focus to the row that took its place, then to Add', () => {
  const steps = focusFallback({ control: 'remove', index: 2 }, rows);
  assert.deepEqual(steps.map(step => step.row), ['same', 2, 'add']);
  assert.equal(focusFallback({ control: 'remove', index: 5 }, rows)[1].row, 2, 'the last row when the deleted one was last');
  assert.deepEqual(focusFallback({ control: 'remove', index: 0 }, []).map(step => step.row), ['same', 'add'], 'Add when no category is left');
});

const palette = [{ value: '#111' }, { value: '#222' }, { value: '#333' }];

test('a new category takes the first colour no active one uses, archived ones aside', () => {
  assert.equal(nextCategoryColor([{ color: '#111' }, { color: '#222', archived: true }], palette), '#222');
  assert.equal(nextCategoryColor([], palette), '#111');
  assert.equal(nextCategoryColor(palette.map(p => ({ color: p.value })), palette), '#111', 'every colour used: one in turn');
});

test('the add row makes a category from a typed name, trimmed to 40 characters, and nothing from an empty one', () => {
  assert.deepEqual(newCategory('  Freelance / Entreprise ', [{ color: '#111' }], palette, 'id-1'), { id: 'id-1', name: 'Freelance / Entreprise', color: '#222', archived: false, archivedAt: '' });
  assert.equal(newCategory('   ', [], palette, 'id-2'), null);
  assert.equal(newCategory('x'.repeat(50), [], palette, 'id-3').name.length, 40);
  assert.equal(newCategory('One more', palette.map(p => ({ color: p.value })), palette, 'id-4'), null, 'one active category per colour at most');
  assert.equal(newCategory('One more', [{ color: '#111', archived: true }, { color: '#222' }, { color: '#333' }], palette, 'id-5')?.color, '#111', 'an archived one leaves room, and its colour');
});

test('Settings lists categories in one column of whole names, archived ones in a folded disclosure, adding inline (1.39.1)', () => {
  const source = readFileSync(new URL('../src/features/category-manager.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/settings.css', import.meta.url), 'utf8');
  // One list; no two-up grid, no cut names.
  assert.match(css, /^\.category-settings \{ min-width: 0; display: grid; gap: 4px; \}/m);
  assert.doesNotMatch(css, /\.category-settings \{[^}]*grid-template-columns/);
  assert.doesNotMatch(css, /\.(?:category-name|archived-category-name)[^{]*\{[^}]*(?:text-overflow|white-space: nowrap)/);
  assert.match(css, /\.archived-category-name \{[^}]*overflow-wrap: anywhere;/);
  // The row: colour, the name across the row, Archive and Delete as icon buttons keeping their names and tooltips.
  assert.match(css, /\.category-setting \{\n {2}min-width: 0;\n {2}min-height: 36px;\n {2}display: grid;\n {2}grid-template-columns: 30px minmax\(0, 1fr\) 28px 28px;/);
  assert.match(source, /aria-label="\$\{escAttr\(`Archive \$\{category\.name \|\| 'category'\}`\)\}" data-tooltip="Archive"/);
  assert.match(source, /aria-label="\$\{escAttr\(`Delete \$\{category\.name \|\| 'category'\}`\)\}" data-tooltip="Delete"/);
  assert.match(source, /aria-label="\$\{escAttr\(`Restore \$\{category\.name \|\| 'category'\}`\)\}" data-tooltip="Restore"/);
  // Archived (n), folded each time its dialog opens, opened when one is archived.
  assert.match(source, /<summary data-category-control="archived">\$\{icon\('chevron'\)\}<span>Archived \(\$\{archived\.length\}\)<\/span><\/summary>/);
  assert.match(source, /if \(wrap\.closest\('\[hidden\]'\)\) archivedOpen\.delete\(wrap\);/);
  assert.match(source, /archivedOpen\.add\(wrap\);\n {6}ctx\.persistSettings\(\);/);
  // The add row: Enter (focus to the new name) or leaving the field; a first Escape drops the draft.
  assert.match(source, /if \(event\.key === 'Enter' && !event\.isComposing\) \{\n {8}event\.preventDefault\(\);\n {8}commit\(true\);/);
  assert.match(source, /if \(focusNew\) pendingFocus = \{ wrap, id: category\.id, control: 'name' \};/);
  assert.match(source, /input\.addEventListener\('blur', \(\) => \{ if \(input\.value\.trim\(\)\) setTimeout\(\(\) => commit\(false\)\); \}\);/);
  assert.match(source, /else if \(event\.key === 'Escape' && input\.value\) \{/);
  assert.match(source, /if \(active\.length < ctx\.palette\.length\) list\.append\(addRow\(wrap, draft\)\);/);
});
