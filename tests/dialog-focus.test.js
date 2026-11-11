import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDialogReturns, edgeStep, focusOpener, tabStopsOf, twinSelector } from '../src/ui/dialog-focus.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');

test('Tab wraps only at the edges of a dialog, and comes in from outside', () => {
  assert.equal(edgeStep(4, 3), 0, 'Tab on the last stop goes to the first');
  assert.equal(edgeStep(4, 0, true), 3, 'Shift+Tab on the first goes to the last');
  assert.equal(edgeStep(4, 1), null, 'between the edges the browser keeps its order');
  assert.equal(edgeStep(4, 2, true), null);
  assert.equal(edgeStep(4, -1), 0, 'from outside (or the title): the first stop');
  assert.equal(edgeStep(4, -1, true), 3, 'and backwards, the last');
  assert.equal(edgeStep(1, 0), 0, 'a single stop keeps focus');
  assert.equal(edgeStep(1, 0, true), 0);
  assert.equal(edgeStep(0, -1), -1, 'nothing to focus: the dialog holds focus itself');
});

test('the stops: shown, enabled, not inert, not taken out of the order; a radio group counts once', () => {
  const item = (el, extra = {}) => ({ el, tabIndex: 0, disabled: false, inert: false, rendered: true, radio: null, ...extra });
  const stops = tabStopsOf([
    item('close'),
    item('title', { tabIndex: -1 }),
    item('hidden', { rendered: false }),
    item('off', { disabled: true }),
    item('behind', { inert: true }),
    item('a1', { radio: { name: 'a', checked: false } }),
    item('a2', { radio: { name: 'a', checked: true } }),
    item('a3', { radio: { name: 'a', checked: false } }),
    item('b1', { radio: { name: 'b', checked: false } }),
    item('b2', { radio: { name: 'b', checked: false } }),
    item('lone', { radio: { name: 'c', checked: false } }),
    item('done')
  ]);
  assert.deepEqual(stops, ['close', 'a2', 'b1', 'lone', 'done']);
});

test('focus goes back to a twin when the planner drew the opener again', () => {
  assert.equal(twinSelector('button', [['class', 'icon-button'], ['type', 'button'], ['data-settings-open', ''], ['data-tooltip', 'Settings']]), 'button[data-settings-open]');
  assert.equal(twinSelector('button', [['id', 'go'], ['data-x', '1']]), 'button[id="go"]', 'an id wins');
  assert.equal(twinSelector('div', [['class', 'time-block'], ['data-block-id', 'b2'], ['role', 'button']]), 'div[data-block-id="b2"]', 'a row’s own id');
  assert.equal(
    twinSelector('button', [['class', 'item-time'], ['data-open-linked-block', '']], [['class', 'item-row'], ['data-item-id', 'p2']]),
    '[data-item-id="p2"] button[data-open-linked-block]',
    'a control inside a row is found inside that row'
  );
  assert.equal(twinSelector('button', [['data-x', 'say "hi"']]), 'button[data-x="say \\"hi\\""]', 'quotes are escaped');
  assert.equal(twinSelector('button', [['class', 'plain'], ['data-tooltip', 'Hi']]), '', 'nothing stable to go by');
});

test('each dialog remembers what opened it; one that replaces another takes that one over', () => {
  const doc = {};
  doc.body = { attributes: [], ownerDocument: doc };
  const node = name => ({ name, ownerDocument: doc, attributes: [{ name: `data-${name}`, value: '' }], localName: 'button', parentElement: null });
  const dialog = (...inside) => ({ contains: el => inside.includes(el) });
  const button = node('settings-open');
  const inner = node('inner');
  const help = dialog(inner);
  const horizon = dialog();
  const returns = createDialogReturns();
  returns.remember(help, button);
  assert.equal(returns.take(help).el, button);
  assert.equal(returns.take(help), null, 'taken once');
  returns.remember(help, inner);
  assert.equal(returns.take(help), null, 'something inside the dialog is not what opened it');
  returns.remember(help, doc.body);
  assert.equal(returns.take(help), null, 'nor is the page itself');
  // Help, opened from the header, gives way to Horizon from a button inside it: Horizon keeps both.
  returns.remember(help, button);
  returns.remember(horizon, inner, returns.take(help));
  const chain = returns.take(horizon);
  assert.equal(chain.el, inner, 'first, what opened it');
  assert.equal(chain.outer.el, button, 'behind it, what opened the dialog it replaced');
  assert.equal(chain.outer.selector, 'button[data-settings-open]');
  returns.remember(horizon, doc.body, chain.outer);
  assert.equal(returns.take(horizon).el, button, 'opened from nowhere in particular, it keeps the one it replaced');
});

test('focus goes back along the chain, to the first opener that can still take it', () => {
  const focused = [];
  const el = (name, usable) => ({ name, isConnected: usable, disabled: false, ownerDocument: {}, focus() { focused.push(name); }, closest: () => null, getClientRects: () => (usable ? [1] : []) });
  assert.equal(focusOpener({ el: el('gone', false), selector: '', outer: { el: el('header', true), selector: '' } }), true);
  assert.deepEqual(focused, ['header'], 'the button inside the closed dialog is gone: the header button takes focus');
  assert.equal(focusOpener({ el: el('gone', false), selector: '', outer: null }), false, 'nothing left: the caller decides');
  assert.equal(focusOpener(null), false);
});

test('the planner’s dialogs use the helper: focus in, Tab kept in, focus back', async () => {
  const app = await read('app.js');
  assert.match(app, /import \{ createDialogReturns, focusDialog, focusOpener, keepTab, twinIn \} from '\.\/src\/ui\/dialog-focus\.js';/);
  assert.match(app, /setTimeout\(\(\) => \{ if \(activeModal === modal\) focusDialog\(qs\('\.modal__panel', modal\), focusTarget\); \}, 80\);/, 'every dialog takes focus as it opens');
  assert.match(app, /if \(e\.key === 'Tab' && activeModal && !qs\('\.app-popover'\)\) \{ keepTab\(e, qs\('\.modal__panel', activeModal\)\); return; \}/, 'Tab stays in the dialog on top');
  assert.match(app, /if \(activeModal !== modal\) dialogReturns\.remember\(modal, document\.activeElement, activeModal && !stackOverCurrent \? dialogReturns\.take\(activeModal\) : null\);/);
  assert.match(app, /else if \(!focusOpener\(opener\)\)/, 'closing gives focus back to the opener');
  assert.match(app, /focusDialog\(qs\('\.modal__panel', returnModal\), back\);/, 'back in a dialog underneath, focus returns to what opened the one above');
  assert.match(await read('src/features/share-dialog.js'), /dialog\.addEventListener\('keydown', event => \{ keepTab\(event, dialog\); event\.stopPropagation\(\); \}\);/);
  assert.match(await read('welcome/privacy-dialog.js'), /dialog\.addEventListener\('keydown', event => keepTab\(event, dialog\)\);/);
  assert.match(await read('styles/theme.css'), /\[data-dialog-title\]:focus \{ outline: none; \}/, 'a focused title shows no ring: it is not a control');
});

test('the Day view’s fields have names and its lists hold list items', async () => {
  const page = await read('index.html');
  assert.match(page, /data-day-notes-editor contenteditable="true" role="textbox" aria-multiline="true" aria-label="Notes"/);
  assert.match(page, /data-block-notes-editor contenteditable="true" role="textbox" aria-multiline="true" aria-label="Notes"/);
  assert.match(page, /<ol class="priorities priorities--secondary" data-secondary-priorities><\/ol>/);
  assert.match(await read('app.js'), /document\.createElement\(type === 'task' \|\| index > 0 \? 'li' : 'div'\)/, 'the other outcomes are <li> in their <ol>');
});
