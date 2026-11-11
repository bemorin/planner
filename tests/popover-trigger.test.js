import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeElement, fakeDocument } from './support/fake-dom.js';
import { closeOnTriggerClick, popoverTrigger, triggerLayer } from '../src/ui/popover-trigger.js';
import { openListbox } from '../src/ui/listbox.js';

// A second click on the trigger of an open popover closes it, and the next opens it again (1.39.2). Before, the
// outside-click handler left the trigger alone and every opener began by closing what was open, so Week starts on,
// the Displayed hours pickers, the category menus and the date pickers were drawn again, their opening animation
// replayed, instead of closing.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The app's popover layer as app.js keeps it (showPopover / closePopover), and how many times one was shown. */
function popoverHost(doc) {
  const host = {
    open: null,
    shown: 0,
    showPopover(anchor, popover, options = {}) {
      doc.body.append(popover);
      const trigger = options.trigger || anchor;
      host.open = { el: popover, anchor, trigger, parent: options.parentPopover || null };
      trigger.setAttribute('aria-expanded', 'true');
      host.shown += 1;
    },
    closePopover() {
      if (!host.open) return;
      (host.open.trigger || host.open.anchor).setAttribute('aria-expanded', 'false');
      host.open.el.remove();
      host.open = host.open.parent;
    }
  };
  return host;
}

/** A click as the browser delivers it: the document's capture listeners first, then the target's own, unless stopped. */
async function click(doc, target) {
  const event = { target, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} };
  (doc.listeners.click || []).forEach(fn => fn(event));
  if (!event.stopped) await target.dispatch('click', event);
  return event;
}

function setup() {
  const doc = fakeDocument();
  globalThis.document = doc;
  const host = popoverHost(doc);
  const unwire = closeOnTriggerClick(doc, { getOpen: () => host.open, close: host.closePopover });
  return { doc, host, unwire };
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, value) => ({ value, label }));

test('the open popover whose trigger was clicked: on it or inside it, never from inside the popover', () => {
  const doc = fakeDocument();
  const trigger = doc.createElement('button');
  const icon = new FakeElement('svg', { doc });
  trigger.append(icon);
  const popover = doc.createElement('div');
  const option = doc.createElement('button');
  popover.append(option);
  doc.body.append(trigger, popover);
  const open = { el: popover, anchor: trigger, trigger, parent: null };
  assert.equal(triggerLayer(open, trigger), open);
  assert.equal(triggerLayer(open, icon), open, 'its icon is part of it');
  assert.equal(triggerLayer(open, option), null, 'a choice in the list is not the trigger');
  assert.equal(triggerLayer(open, doc.body), null, 'elsewhere: the outside-click handler’s business');
  assert.equal(triggerLayer(null, trigger), null, 'nothing open');
  const anchored = { el: popover, anchor: trigger, parent: null };
  assert.equal(triggerLayer(anchored, icon), anchored, 'without a trigger named, the anchor is it');

  // A date picker opened from a control inside another popover: its trigger closes it; the first one’s closes both.
  const childTrigger = doc.createElement('button');
  popover.append(childTrigger);
  const child = { el: doc.createElement('div'), anchor: childTrigger, trigger: childTrigger, parent: open };
  doc.body.append(child.el);
  assert.equal(triggerLayer(child, childTrigger), child);
  assert.equal(triggerLayer(child, trigger), open);
  assert.equal(triggerLayer(child, option), null, 'another control in the popover underneath');
});

test('the trigger of a list: the button itself, or the menu button of a time field rather than the field', () => {
  const doc = fakeDocument();
  const button = doc.createElement('button');
  assert.equal(popoverTrigger(button), button);
  const field = new FakeElement('.time-combo', { doc, tag: 'span' });
  const input = new FakeElement('input', { doc, tag: 'input' });
  const menu = new FakeElement('button[aria-haspopup]', { doc, tag: 'button' });
  field.append(input, menu);
  assert.equal(popoverTrigger(field, input), menu, 'the ⌄, even when the field’s input had focus');
  const plain = new FakeElement('.wrap', { doc });
  const inner = doc.createElement('button');
  plain.append(inner);
  assert.equal(popoverTrigger(plain), inner);
  assert.equal(popoverTrigger(null), null);
});

test('Week starts on: the first click opens the list, the second closes it, the third opens it again', async () => {
  const { doc, host, unwire } = setup();
  const trigger = doc.make('[data-week-starts-on]', { tag: 'button' });
  doc.body.append(trigger);
  trigger.addEventListener('click', () => openListbox(host, trigger, weekdays, 1, () => {}, { compact: true, matchWidth: true }));

  await click(doc, trigger);
  const first = host.open?.el;
  assert.ok(first?.isConnected, 'open');
  assert.equal(first.getAttribute('role'), 'listbox');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement?.getAttribute('aria-selected'), 'true', 'focus on the chosen day');

  const second = await click(doc, trigger);
  assert.ok(second.stopped, 'the click stops before the opener, which would draw the list again');
  assert.equal(host.open, null, 'closed');
  assert.equal(first.isConnected, false);
  assert.equal(host.shown, 1, 'not shown again: no opening animation replayed');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, trigger, 'focus back on the trigger');

  await click(doc, trigger);
  assert.ok(host.open?.el?.isConnected && host.open.el !== first, 'the next click opens it again');
  assert.equal(host.shown, 2);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  // Escape still closes it from inside, with focus back on the trigger.
  let stopped = false;
  await host.open.el.dispatch('keydown', { key: 'Escape', stopPropagation() { stopped = true; } });
  assert.ok(stopped);
  assert.equal(host.open, null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, trigger);
  unwire();
  assert.equal((doc.listeners.click || []).length, 0, 'unwired');
});

test('a choice in the list is not a click on the trigger: it is chosen, the list closes, focus goes back', async () => {
  const { doc, host } = setup();
  const trigger = doc.make('[data-week-starts-on]', { tag: 'button' });
  doc.body.append(trigger);
  const chosen = [];
  trigger.addEventListener('click', () => openListbox(host, trigger, weekdays, 1, item => chosen.push(item.value), { compact: true }));
  await click(doc, trigger);
  const sunday = host.open.el.children[0];
  const event = await click(doc, sunday);
  assert.equal(event.stopped, false, 'the document’s listener lets it through to the option');
  assert.deepEqual(chosen, [0]);
  assert.equal(host.open, null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, trigger);
});

test('Displayed hours, From: aria-expanded on the menu button, not the field; a click in the field keeps the list open', async () => {
  const { doc, host } = setup();
  const field = new FakeElement('.time-combo', { doc, tag: 'span' });
  const input = new FakeElement('input', { doc, tag: 'input' });
  const menu = new FakeElement('button[aria-haspopup]', { doc, tag: 'button' });
  menu.setAttribute('aria-label', 'Choose start hour');
  field.append(input, menu);
  doc.body.append(field);
  const hours = Array.from({ length: 24 }, (_, value) => ({ value, label: `${String(value).padStart(2, '0')}:00` }));
  menu.addEventListener('click', () => openListbox(host, field, hours, 8, () => {}, { compact: true, matchWidth: true, alignSelected: true, timeMenu: true }));

  await click(doc, menu);
  assert.ok(host.open, 'open');
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  assert.equal(field.getAttribute('aria-expanded'), null, 'never on the field round it');
  assert.equal(host.open.el.getAttribute('aria-label'), 'Choose start hour');
  await click(doc, input);
  assert.ok(host.open, 'typing in the field is not the trigger');
  await click(doc, menu);
  assert.equal(host.open, null, 'the second click on ⌄ closes it');
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, menu);
  await click(doc, menu);
  assert.ok(host.open, 'and the next opens it again');
});

test('a date picker opened from inside a popover: its trigger closes it alone, the first trigger closes both', async () => {
  const { doc, host } = setup();
  const eventButton = doc.createElement('button');
  doc.body.append(eventButton);
  const parent = doc.createElement('div');
  const dateButton = doc.createElement('button');
  parent.append(dateButton);
  host.showPopover(eventButton, parent);
  host.showPopover(dateButton, doc.createElement('div'), { parentPopover: host.open });
  assert.equal(dateButton.getAttribute('aria-expanded'), 'true');

  await click(doc, dateButton);
  assert.equal(host.open?.el, parent, 'the date picker closes, the popover under it stays');
  assert.equal(dateButton.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, dateButton);

  host.showPopover(dateButton, doc.createElement('div'), { parentPopover: host.open });
  await click(doc, eventButton);
  assert.equal(host.open, null, 'both close');
  assert.equal(eventButton.getAttribute('aria-expanded'), 'false');
  assert.equal(dateButton.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, eventButton);
});

test('the planner wires it: one listener for every popover, aria-expanded on the trigger, the date title by click', () => {
  const app = read('app.js');
  assert.match(app, /import \{ closeOnTriggerClick \} from '\.\/src\/ui\/popover-trigger\.js';/);
  assert.match(app, /closeOnTriggerClick\(document, \{ getOpen: \(\) => activePopover, close: closePopover \}\);/);
  assert.match(app, /const trigger = options\.trigger \|\| anchor;\n {4}activePopover = \{ el: popover, anchor, trigger, parent: options\.parentPopover \|\| null \};/);
  assert.match(app, /trigger\?\.setAttribute\('aria-expanded', 'true'\);/);
  assert.match(app, /\(activePopover\.trigger \|\| activePopover\.anchor\)\?\.setAttribute\('aria-expanded', 'false'\);/);
  // Escape gives focus back to the trigger when it was inside the popover.
  assert.match(app, /if \(activePopover\) \{ const \{ el, trigger \} = activePopover; const back = el\.contains\(document\.activeElement\) \|\| document\.activeElement === document\.body; closePopover\(\); if \(back\) trigger\?\.focus\?\.\(\{ preventScroll: true \}\); return; \}/);
  // The date title (a role="button") opens by a click from the keyboard too, so a second Enter closes it.
  assert.match(app, /datePicker\?\.addEventListener\('keydown', e => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); datePicker\.click\(\); \} \}\);/);
  // A list drawn over its trigger (alignSelected) puts the current choice over it, even a short one that can't
  // scroll there (a block's category: Uncategorized first): a second click there closes it unchanged.
  assert.match(app, /const shift = anchorCenterInPopover - \(selectedCenter - popover\.scrollTop\);\n {6}if \(Math\.abs\(shift\) >= 1\) popover\.style\.top = `\$\{\(top = clamp\(top \+ shift, boundary\.top \+ boundaryPad, /);
  // Lists whose button has no name of its own say theirs.
  assert.match(app, /\{ compact: true, matchWidth: true, label: 'Week starts on' \}/);
  assert.match(app, /className: 'category-menu', label: 'Category \/ project' \}/);
  assert.match(read('src/features/onboarding.js'), /label: isStart \? 'Show my day from' : 'Show my day until' \}/);
  // The list hands its trigger to the popover layer.
  assert.match(read('src/ui/listbox.js'), /ctx\.showPopover\(anchor, popover, \{ \.\.\.options, trigger \}\);/);
  assert.match(read('sw.js'), /'\.\/src\/ui\/popover-trigger\.js'/);
  // The popovers that toggle on their own still do: Horizon’s Add, the sync alert, the floating window’s date.
  assert.match(read('src/features/horizon-view.js'), /if \(document\.querySelector\('\.hz-add-menu'\)\) ctx\.closeAllPopovers\(\); else openAddMenu\(add\);/);
  assert.match(read('src/features/sync-status.js'), /if \(popover\) close\(\{ focus: true \}\);\n {4}else open\(\);/);
  assert.match(read('src/features/pip-window.js'), /if \(q\('\[data-pip-date-picker\]'\)\) \{ closePicker\(\); return; \}/);
});
