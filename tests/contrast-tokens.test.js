import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pipStyles } from '../src/features/pip-styles.js';

// WCAG 2.1 AA for the colour tokens of every theme the planner and the public pages define (1.35):
// text 4.5:1 on the page, cards and soft fills; icons, dots and switch tracks (--faint-mark) 3:1; quiet text
// stays a step under muted wherever that still passes (dark), and equals it where it cannot (light).

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');

const channel = value => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = hex => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map(ch => ch + ch).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};
const luminance = hex => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a, b, share) => `#${rgb(a).map((v, i) => Math.round(v * share + rgb(b)[i] * (1 - share)).toString(16).padStart(2, '0')).join('')}`;

/** The custom properties declared in the first block that opens at `opener` (no nested braces in token blocks). */
function tokens(css, opener) {
  const start = css.indexOf(opener);
  assert.ok(start >= 0, `block ${opener}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)].map(match => [match[1], match[2].toLowerCase()]));
}

async function themes() {
  const core = await read('styles/core.css');
  const theme = await read('styles/theme.css');
  const landing = await read('welcome/landing.css');
  const legal = await read('legal/legal.css');
  const pip = pipStyles();
  const planner = tokens(core, ':root {');
  return {
    'planner light': planner,
    'planner dark (system)': { ...planner, ...tokens(theme, ':root:not([data-theme="light"]) {') },
    'planner dark (chosen)': { ...planner, ...tokens(theme, ':root[data-theme="dark"] {') },
    'landing light': tokens(landing, ':root {'),
    'landing dark': { ...tokens(landing, ':root {'), ...tokens(landing, '@media (prefers-color-scheme: dark) {\n  :root {') },
    'legal light': tokens(legal, ':root {'),
    'legal dark': { ...tokens(legal, ':root {'), ...tokens(legal, '@media (prefers-color-scheme: dark) {\n  :root {') },
    'floating window light': tokens(pip, ':root {'),
    'floating window dark': { ...tokens(pip, ':root {'), ...tokens(pip, ':root[data-theme="dark"] {') }
  };
}

const SURFACES = ['paper', 'surface', 'surface-strong', 'soft'];

test('quiet and muted text reach 4.5:1 on the page, cards and soft fills, in every theme', async () => {
  for (const [name, t] of Object.entries(await themes())) {
    for (const text of ['ink', 'muted', 'faint']) {
      for (const surface of SURFACES) {
        const ratio = contrast(t[text], t[surface]);
        assert.ok(ratio >= 4.5, `${name}: --${text} ${t[text]} on --${surface} ${t[surface]} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test('icons, dots and switch tracks (--faint-mark) reach 3:1, and stay lighter than text', async () => {
  for (const [name, t] of Object.entries(await themes())) {
    assert.ok(t['faint-mark'], `${name}: --faint-mark is defined`);
    for (const surface of SURFACES) {
      const ratio = contrast(t['faint-mark'], t[surface]);
      assert.ok(ratio >= 3, `${name}: --faint-mark on --${surface} is ${ratio.toFixed(2)}:1`);
      assert.ok(ratio < contrast(t.faint, t[surface]), `${name}: marks recede behind quiet text`);
    }
  }
});

test('faint stays a visible step under muted where it can (dark), and is never darker than muted', async () => {
  for (const [name, t] of Object.entries(await themes())) {
    const muted = contrast(t.muted, t.paper);
    const faint = contrast(t.faint, t.paper);
    assert.ok(faint <= muted + 0.001, `${name}: faint is not stronger than muted`);
    if (name.includes('dark')) assert.ok(muted - faint >= 1, `${name}: faint ${faint.toFixed(2)} vs muted ${muted.toFixed(2)}`);
  }
});

test('coloured text on its own tint, the legal kicker and the “now” pills reach 4.5:1', async () => {
  const all = await themes();
  const landing = all['landing light'];
  // The habit green on the chips and quarter cells: its tint over a white card (18%) and over the page (12%).
  assert.ok(contrast(landing.habit, mix(landing.habit, landing['surface-strong'], 0.18)) >= 4.5);
  assert.ok(contrast(landing.habit, mix(landing.habit, landing.paper, 0.12)) >= 4.5);
  const horizon = tokens(await read('styles/horizon.css'), ':root {');
  assert.equal(horizon['hz-habit'], landing.habit, 'the planner’s habit green is the landing’s');
  assert.ok(contrast(all['legal light'].accent, all['legal light'].paper) >= 4.5, 'the legal kicker');
  for (const theme of ['landing light', 'landing dark']) assert.ok(contrast(all[theme]['on-now'], all[theme].now) >= 4.5, `${theme}: the now pill`);
  const light = tokens(await read('styles/core.css'), ':root { --current-time');
  const dark = all['planner dark (system)'];
  assert.ok(contrast(light['on-current-time'], light['current-time']) >= 4.5, 'the week’s now pill, light');
  assert.ok(contrast(dark['on-current-time'], dark['current-time']) >= 4.5, 'the week’s now pill, dark');
  const pip = all['floating window dark'];
  assert.ok(contrast(pip['now-ink'], pip['now-line']) >= 4.5, 'the floating window’s now pill');
});
