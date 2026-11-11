import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pipStyles } from '../src/features/pip-styles.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');

// Chromium ignores every ::-webkit-scrollbar part of an element as soon as the
// standard scrollbar-width / scrollbar-color apply to it, and draws its own
// bar instead (with arrows on Windows and Linux). So the standard properties
// may only be set where ::-webkit-scrollbar is unknown, except to hide a bar
// (scrollbar-width: none, with ::-webkit-scrollbar { display: none }).

function unguarded(css) {
  const outside = css.replace(/@supports not selector\(::-webkit-scrollbar\) \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return [...outside.matchAll(/[^{}]*\{[^{}]*\bscrollbar-(?:width|color):[^{}]*\}/g)].map(match => match[0].trim())
    .filter(rule => !/scrollbar-width: none;/.test(rule));
}

async function stylesheets() {
  const files = [];
  for (const dir of ['styles', 'admin', 'welcome', 'legal', 'contact']) {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.css')) files.push(`${dir}/${entry.name}`);
    }
  }
  return files;
}

test('every stylesheet keeps the standard scrollbar properties for browsers without ::-webkit-scrollbar', async () => {
  const files = await stylesheets();
  assert.ok(files.includes('styles/core.css') && files.includes('welcome/landing.css') && files.includes('legal/legal.css') && files.includes('admin/admin.css'), files.join(' '));
  for (const file of files) assert.deepEqual(unguarded(await read(file)), [], `${file}: scrollbar-width / scrollbar-color outside the guard`);
  assert.deepEqual(unguarded(pipStyles()), [], 'the floating window');
  assert.deepEqual(unguarded('a { color: red; }\n* { scrollbar-width: thin; }'), ['* { scrollbar-width: thin; }'], 'the check finds one');
});

// The bar's sizes: a 12px gutter whose thumb is 6px at rest (3px of transparent
// border round it) and 8px, darker, under the pointer or while dragged.
const SIZES = {
  '--scrollbar-size': '12px',
  '--scrollbar-inset': '3px',
  '--scrollbar-inset-active': '2px',
  '--scrollbar-thumb-min': '2.5rem'
};
const THUMB = 'color-mix(in srgb, var(--line-strong) 62%, var(--paper))';
const THUMB_ACTIVE = 'color-mix(in srgb, var(--muted) 46%, var(--paper))';

/** Every declaration of a custom property in `css`: [[name, value], …]. */
const declarations = (css, name) => [...css.matchAll(new RegExp(`(${name}): ([^;]+);`, 'g'))].map(match => match[2].trim());

/** The bar itself, drawn from the tokens only: no width, inset or colour typed twice. */
function assertBar(css, label) {
  for (const [name, value] of Object.entries(SIZES)) assert.deepEqual(declarations(css, name), [value], `${label}: ${name} set once, to ${value}`);
  // The colours, set first on :root (a dialog or a dark band may mix them with its own background).
  assert.equal(declarations(css, '--scrollbar-thumb')[0], THUMB, `${label}: the thumb at rest`);
  assert.equal(declarations(css, '--scrollbar-thumb-hover')[0], THUMB_ACTIVE, `${label}: the thumb under the pointer`);
  assert.match(css, /\*::-webkit-scrollbar \{ width: var\(--scrollbar-size\); height: var\(--scrollbar-size\); \}/, label);
  assert.match(css, /\*::-webkit-scrollbar-button \{ display: none; width: 0; height: 0; \}/, label);
  assert.match(css, /\*::-webkit-scrollbar-thumb \{\s*min-height: var\(--scrollbar-thumb-min\);\s*border: var\(--scrollbar-inset\) solid transparent;\s*border-radius: 999px;\s*background: var\(--scrollbar-thumb\);\s*background-clip: padding-box;\s*\}/, `${label}: the thumb at rest`);
  assert.match(css, /\*::-webkit-scrollbar-thumb:hover,\s*\*::-webkit-scrollbar-thumb:active \{\s*border-width: var\(--scrollbar-inset-active\);\s*background: var\(--scrollbar-thumb-hover\);\s*background-clip: padding-box;\s*\}/, `${label}: wider and darker under the pointer and while dragged`);
  // No part of a bar is sized anywhere else (a bar hidden on purpose aside).
  const sized = [...css.matchAll(/([^{}]*::-webkit-scrollbar(?:-thumb|-track)?(?::[a-z]+)?)\s*\{([^{}]*)\}/g)]
    .filter(([, , body]) => /\b(?:width|height|border)\b/.test(body) && !/display: none/.test(body))
    .filter(([, , body]) => !/var\(--scrollbar-/.test(body) && !/width: 0; height: 0/.test(body));
  assert.deepEqual(sized.map(([, selector]) => selector.trim()), [], `${label}: a bar sized outside the tokens`);
}

test('one scrollbar everywhere: a 12px gutter, a 6px thumb at rest, 8px and darker under the pointer or while dragged', async () => {
  for (const file of ['styles/core.css', 'welcome/landing.css', 'legal/legal.css']) assertBar(await read(file), file);
  // Firefox can't take a width: it keeps the thin bar, in the thumb's colour.
  const css = await read('styles/core.css');
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\) \{\n {2}html,\n {2}\* \{ scrollbar-width: thin; scrollbar-color: var\(--scrollbar-thumb\) transparent; \}\n\}/);
  for (const file of ['welcome/landing.css', 'legal/legal.css']) assert.match(await read(file), /@supports not selector\(::-webkit-scrollbar\) \{\n {2}html,\n {2}\* \{ scrollbar-width: thin; scrollbar-color: var\(--scrollbar-thumb\) transparent; \}\n\}/, file);
  // No other stylesheet sizes a bar of its own.
  for (const file of await stylesheets()) {
    if (['styles/core.css', 'welcome/landing.css', 'legal/legal.css'].includes(file)) continue;
    const source = await read(file);
    const sized = [...source.matchAll(/::-webkit-scrollbar[^{]*\{([^}]*)\}/g)].filter(([, body]) => !/display: none/.test(body));
    assert.deepEqual(sized.map(match => match[0]), [], `${file}: its own bar`);
    assert.equal(declarations(source, '--scrollbar-size').length, 0, `${file}: its own size`);
  }
});

test('dialogs use the same bar, its thumb mixed with the dialog’s surface, still below the close button and above sticky footers', async () => {
  const css = await read('styles/core.css');
  assert.match(css, /\.modal__scroll \{\n {2}--scrollbar-thumb: color-mix\(in srgb, var\(--line-strong\) 62%, var\(--surface\)\);\n {2}--scrollbar-thumb-hover: color-mix\(in srgb, var\(--muted\) 46%, var\(--surface\)\);\n\}/);
  assert.doesNotMatch(css, /\.modal__scroll::-webkit-scrollbar/, 'no bar of its own');
  assert.match(css, /\.modal__scroll \{ margin: 42px 5px 8px; max-height: calc\(min\(760px, 100dvh - 2rem\) - 50px\); padding-top: 0; \}/, 'the scroll area starts below the close button');
  // The landing page's dialog uses the same tokens (welcome/landing.css).
  const landing = await read('welcome/landing.css');
  assert.match(landing, /--scrollbar-thumb: color-mix\(in srgb, var\(--line-strong\) 62%, var\(--paper\)\);/);
});

test('a bar hidden on purpose stays hidden in every browser, and the dashboard shares the planner’s', async () => {
  for (const [file, selector] of [['styles/core.css', '.end-day-triage'], ['styles/horizon.css', '.hz-tabs__list']]) {
    const source = await read(file);
    assert.ok(source.includes(`${selector}::-webkit-scrollbar { display: none; }`), `${file}: ${selector}`);
    assert.match(source, new RegExp(`${selector.replace('.', '\\.')} \\{[^}]*scrollbar-width: none;`), `${file}: ${selector}`);
  }
  // The dashboard loads the planner's stylesheet, and the build makes one file of the planner's.
  assert.match(await read('admin/index.html'), /<link rel="stylesheet" href="\.\.\/styles\.css">/);
  assert.match(await read('styles.css'), /@import url\('\.\/styles\/core\.css'\);/);
});

test('the floating window has the same bar as the planner', () => {
  const css = pipStyles();
  for (const [name, value] of Object.entries(SIZES)) assert.deepEqual(declarations(css, name), [value], name);
  assert.deepEqual(declarations(css, '--scrollbar-thumb'), [THUMB]);
  assert.deepEqual(declarations(css, '--scrollbar-thumb-hover'), [THUMB_ACTIVE]);
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\) \{ \* \{ scrollbar-width: thin; scrollbar-color: var\(--scrollbar-thumb\) transparent; \} \}/);
  assert.match(css, /\*::-webkit-scrollbar \{ width: var\(--scrollbar-size\); height: var\(--scrollbar-size\); \}/);
  assert.match(css, /\*::-webkit-scrollbar-button \{ display: none; width: 0; height: 0; \}/);
  assert.match(css, /\*::-webkit-scrollbar-thumb \{ min-height: var\(--scrollbar-thumb-min\); border: var\(--scrollbar-inset\) solid transparent; border-radius: 999px; background: var\(--scrollbar-thumb\); background-clip: padding-box; \}/);
  assert.match(css, /\*::-webkit-scrollbar-thumb:hover, \*::-webkit-scrollbar-thumb:active \{ border-width: var\(--scrollbar-inset-active\); background: var\(--scrollbar-thumb-hover\); background-clip: padding-box; \}/);
});
