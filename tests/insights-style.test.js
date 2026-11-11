import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Grid and flex items paint one after the other: without a lift, the next
// mark (to the right, or the row below) covers the ring of the mark being read.
test('the Insights mark being read sits above its neighbours, inside its own chart', async () => {
  const css = await readFile(join(root, 'styles/insights.css'), 'utf8');
  assert.match(css, /\[data-ins-chart\] \{ isolation: isolate; \}/, 'each chart is its own stacking context');
  assert.match(css, /\[data-ins-chart\] \[data-tip\]:is\(\.is-hot, :focus-visible\) \{ z-index: 1; \}/, 'hovered and focused marks are lifted');
  assert.match(css, /\[data-ins-chart\] \[data-tip\] \{[^}]*scroll-margin: 8px;/, 'a mark reached with the arrow keys scrolls into view with its ring');
  // Every ring is a box-shadow or an outline: neither moves the layout.
  for (const rule of css.match(/[^}]*\.is-hot[^{]*\{[^}]*\}/g) || []) assert.doesNotMatch(rule, /\b(?:border|margin|padding|width|height|transform)\s*:/, rule.trim());
});
