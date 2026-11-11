import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SAVED_MS, alertView, createSyncStatus, popoverMarkup } from '../src/features/sync-status.js';
import { fakeDocument } from './support/fake-dom.js';

// Personal sync's header alert (1.38): when it shows, what it says, and its popover's one tap.

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const now = new Date(2026, 10, 10, 16, 20, 0);
const lastSyncedAt = new Date(2026, 10, 10, 14, 58, 0).toISOString();
const idle = { configured: true, cloud: 'google', clouds: ['google', 'dropbox'], connected: true, busy: false, reconnect: false, accessUntil: 0, dirty: false, dirtyCount: 0, lastSyncedAt, conflicts: 0, need: '', error: '' };
const ended = { ...idle, reconnect: true, dirty: true, dirtyCount: 3 };

test('it shows only while something waits on the person', () => {
  assert.equal(alertView({ ...ended, configured: false }, { now }), null, 'no cloud offered');
  assert.equal(alertView({ ...ended, connected: false }, { now }), null, 'not connected');
  assert.equal(alertView(idle, { now }), null, 'everything saved');
  assert.equal(alertView({ ...idle, dirty: true, dirtyCount: 2, accessUntil: now.getTime() + 600_000 }, { now }), null, 'changes waiting with access: they go on their own');
  assert.equal(alertView({ ...idle, reconnect: true }, { now }), null, 'access ended, nothing waiting: Settings says it, the header doesn’t');
  const view = alertView(ended, { now });
  assert.deepEqual(
    [view.kind, view.pill, view.label, view.title, view.lead, view.primary, view.action, view.secondary],
    ['reconnect', 'Not in Drive since 14:58', 'Not saved to Google Drive since 14:58', 'Not saved to Google Drive since 14:58', '3 changes are safe on this device.', 'Reconnect and save', 'reconnect', 'Sync settings']
  );
  assert.equal(view.body, 'Google ends access after an hour. One tap reconnects and sends them; nothing is lost meanwhile.');
  assert.equal(alertView({ ...ended, dirtyCount: 1 }, { now }).lead, '1 change is safe on this device.');
  assert.equal(alertView({ ...ended, dirtyCount: null }, { now }).lead, 'Your changes are safe on this device.');
  assert.equal(alertView({ ...ended, lastSyncedAt: '' }, { now }).pill, 'Not in Drive yet');
  assert.equal(alertView({ ...ended, lastSyncedAt: new Date(2026, 10, 9, 18, 30).toISOString() }, { now }).pill, 'Not in Drive since yesterday, 18:30');
  assert.equal(alertView({ ...ended, error: 'Your browser blocked Google’s window. Allow pop-ups for the planner, then try again.' }, { now }).body, 'Your browser blocked Google’s window. Allow pop-ups for the planner, then try again.', 'a tap that didn’t finish says why');
  const dropbox = alertView({ ...ended, cloud: 'dropbox' }, { now });
  assert.deepEqual([dropbox.pill, dropbox.title], ['Not in Dropbox since 14:58', 'Not saved to Dropbox since 14:58']);
  assert.match(dropbox.body, /^Dropbox asked to be connected again\./);
});

test('conflicts and a passphrase have their own words, and lead to Settings', () => {
  const conflict = alertView({ ...idle, conflicts: 2 }, { now });
  assert.deepEqual([conflict.kind, conflict.pill, conflict.action, conflict.secondary], ['conflict', 'Sync needs a choice', 'settings', '']);
  assert.equal(conflict.lead, '2 items were edited on both devices.');
  const enter = alertView({ ...ended, need: 'enter' }, { now });
  assert.deepEqual([enter.kind, enter.pill, enter.title, enter.primary], ['passphrase', 'Passphrase needed', 'Sync is waiting for your passphrase', 'Enter passphrase'], 'a passphrase comes before anything else');
  assert.equal(alertView({ ...idle, need: 'changed' }, { now }).title, 'The passphrase was changed');
  const create = alertView({ ...idle, cloud: 'dropbox', need: 'create' }, { now });
  assert.deepEqual([create.title, create.primary], ['Choose a passphrase to start syncing', 'Choose a passphrase']);
  for (const view of [conflict, enter, create, alertView(ended, { now })]) assert.doesNotMatch(Object.values(view).join(' '), /'/, 'curly apostrophes only');
});

test('the popover: named by its title, described by its lines, the main action last', () => {
  const html = popoverMarkup(alertView(ended, { now }), 'google');
  assert.match(html, /<strong id="sync-alert-title">Not saved to Google Drive since 14:58<\/strong><span id="sync-alert-lead">3 changes are safe on this device\.<\/span>/);
  assert.match(html, /<p id="sync-alert-body">Google ends access after an hour\./);
  assert.match(html, /data-sync-alert-action="settings">Sync settings<\/button><button class="primary-button" type="button" data-sync-alert-action="reconnect"><svg[^]*<span>Reconnect and save<\/span><\/button>/);
  assert.doesNotMatch(html, /\bon[a-z]+=/, 'no inline handlers');
});

function harness({ compact = false, phone = false, state = idle } = {}) {
  const doc = fakeDocument();
  const trigger = doc.make('[data-sync-alert]', { tag: 'button' });
  trigger.hidden = true;
  const text = doc.make('[data-sync-alert-text]');
  const live = doc.make('[data-sync-alert-live]');
  const search = doc.make('[data-search-open]', { tag: 'button' });
  const listeners = new Set();
  const calls = [];
  let finish = null;
  const sync = {
    state: { ...state },
    getState() { return { ...this.state }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(patch) { this.state = { ...this.state, ...patch }; listeners.forEach(fn => fn(this.state)); },
    prepare() { calls.push('prepare'); },
    reconnect() { calls.push('reconnect'); return new Promise(resolve => { finish = resolve; }); }
  };
  const media = { '(max-width: 1080px)': compact, '(max-width: 560px)': phone };
  const win = { innerWidth: phone ? 390 : 1440, matchMedia: query => ({ matches: !!media[query], addEventListener() {} }), requestAnimationFrame: fn => fn(), addEventListener() {}, removeEventListener() {} };
  const layers = { open: [], closed: [], items: new Map() };
  const stack = { open: (key, options) => { layers.open.push(key); layers.items.set(key, options); }, closed: key => { layers.closed.push(key); layers.items.delete(key); } };
  const pending = [];
  const timers = { set: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clear: () => {} };
  const settings = [];
  const layout = [];
  const status = createSyncStatus({ sync, openSettings: () => settings.push('open'), onLayout: () => layout.push(1), doc, win, now: () => now, timers, layers: stack });
  return { doc, trigger, text, live, search, sync, calls, status, layers, pending, settings, layout, finish: value => finish(value), popover: () => doc.body.children.find(child => child.className.includes('sync-popover')) || null };
}

test('the pill: hidden while nothing waits, then the short words, with the full sentence as its tooltip', () => {
  const h = harness();
  assert.equal(h.trigger.hidden, true);
  h.sync.set(ended);
  assert.equal(h.trigger.hidden, false);
  assert.equal(h.text.textContent, 'Not in Drive since 14:58');
  assert.equal(h.trigger.dataset.tooltip, 'Not saved to Google Drive since 14:58');
  assert.equal(h.trigger.getAttribute('aria-label'), null, 'its visible words name it');
  assert.ok(h.calls.includes('prepare'), 'Google’s sign-in loads as soon as the alert can show');
  assert.ok(h.layout.length > 0, 'the header lays the date out again');
  h.sync.set(idle);
  assert.equal(h.trigger.hidden, true, 'saved: nothing');
});

test('the compact header: an icon named by the full sentence', () => {
  const h = harness({ compact: true, state: ended });
  assert.equal(h.trigger.hidden, false);
  assert.equal(h.trigger.getAttribute('aria-label'), 'Not saved to Google Drive since 14:58');
  assert.equal(h.trigger.dataset.tooltip, 'Not saved to Google Drive since 14:58');
});

test('the popover opens with focus inside, and Escape, a click outside and Back close it', async () => {
  const h = harness({ state: ended });
  await h.trigger.click();
  const popover = h.popover();
  assert.ok(popover, 'opened');
  assert.equal(popover.getAttribute('role'), 'dialog');
  assert.equal(popover.getAttribute('aria-labelledby'), 'sync-alert-title');
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(h.doc.activeElement, popover.querySelector('.primary-button'), 'focus goes in, on its main action');
  assert.equal(h.layers.open.length, 1, 'Back knows it is open');
  let stopped = false;
  await popover.dispatch('keydown', { key: 'Escape', stopPropagation() { stopped = true; } });
  assert.equal(h.popover(), null);
  assert.ok(stopped, 'the planner’s own Escape handling doesn’t see it');
  assert.equal(h.doc.activeElement, h.trigger, 'focus comes back to the pill');
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.layers.closed.length, 1);

  await h.trigger.click();
  h.doc.activeElement = null;
  h.doc.listeners.pointerdown.forEach(fn => fn({ target: h.doc.body }));
  assert.equal(h.popover(), null, 'a click outside closes it');
  assert.equal(h.doc.activeElement, null, 'without moving focus');

  await h.trigger.click();
  const back = [...h.layers.items.values()].at(-1).back;
  back();
  assert.equal(h.popover(), null, 'Back closes it, through the back stack');

  await h.trigger.click();
  let keyStopped = false;
  await h.popover().dispatch('keydown', { key: 'f', stopPropagation() { keyStopped = true; } });
  assert.ok(keyStopped, 'single-key shortcuts stay out while it is open');
});

test('a second click on the pill closes the popover, and the next opens it again (1.39.2)', async () => {
  const h = harness({ state: ended });
  await h.trigger.click();
  const first = h.popover();
  assert.ok(first, 'opened');
  // The press on the pill itself is not a click outside: the popover is still there when its click comes.
  h.doc.listeners.pointerdown.forEach(fn => fn({ target: h.trigger }));
  assert.equal(h.popover(), first, 'still open after the press on the pill');
  await h.trigger.click();
  assert.equal(h.popover(), null, 'the second click closes it, instead of opening it again');
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.doc.activeElement, h.trigger, 'focus on the pill');
  assert.equal(h.layers.closed.length, 1, 'Back forgets it');
  assert.equal((h.doc.listeners.pointerdown || []).length, 0, 'no outside-click handler left behind');
  await h.trigger.click();
  assert.ok(h.popover() && h.popover() !== first, 'the third opens it again');
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'true');
});

test('Reconnect and save: called within the click itself, then “Saved” for a moment, then nothing', async () => {
  const h = harness({ state: ended });
  await h.trigger.click();
  const button = h.popover().querySelector('[data-sync-alert-action]:not(.text-button)') || h.popover().children.find(child => child.dataset.syncAlertAction === 'reconnect');
  const clicked = h.popover().dispatch('click', { target: button });
  assert.deepEqual(h.calls.filter(call => call === 'reconnect'), ['reconnect'], 'reconnect() ran before the click handler awaited anything');
  await clicked;
  assert.equal(h.popover(), null, 'the popover closes');
  assert.equal(h.text.textContent, 'Saving…');
  assert.equal(h.trigger.getAttribute('aria-disabled'), 'true');
  h.sync.state = { ...idle };
  h.finish({ status: 'ok' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.trigger.dataset.mode, 'saved');
  assert.equal(h.text.textContent, 'Saved');
  assert.equal(h.live.textContent, 'Saved to Google Drive.', 'said to screen readers');
  assert.equal(h.pending.at(-1).ms, SAVED_MS);
  h.doc.activeElement = h.trigger;
  h.pending.at(-1).fn();
  assert.equal(h.trigger.hidden, true, 'then it goes');
  assert.equal(h.doc.activeElement, h.search, 'focus moves on to Search, beside it');
});

test('a reconnect that didn’t finish leaves the alert as it was', async () => {
  const h = harness({ state: ended });
  await h.trigger.click();
  const button = h.popover().children.find(child => child.dataset.syncAlertAction === 'reconnect');
  await h.popover().dispatch('click', { target: button });
  h.finish(null);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.trigger.dataset.mode, 'alert');
  assert.equal(h.text.textContent, 'Not in Drive since 14:58');
});

test('Sync settings opens Settings on Personal sync', async () => {
  const h = harness({ state: ended });
  await h.trigger.click();
  const button = h.popover().children.find(child => child.dataset.syncAlertAction === 'settings');
  await h.popover().dispatch('click', { target: button });
  assert.deepEqual(h.settings, ['open']);
  assert.equal(h.popover(), null);
});

test('its place and look: before Search, ochre, an icon at the compact header, the popover across a phone', async () => {
  const index = await read('index.html');
  const actions = index.slice(index.indexOf('<div class="actions" aria-label="Planner actions">'), index.indexOf('data-search-open'));
  assert.match(actions, /<button class="sync-alert" type="button" data-sync-alert hidden aria-haspopup="dialog" aria-expanded="false">/, 'right before Search');
  const css = await read('styles/sync.css');
  assert.match(css, /\.sync-alert \{[^}]*color: var\(--sync-wait-ink\);/);
  assert.match(css, /@media \(max-width: 1080px\) \{\n {2}\.sync-alert \{ width: 40px; height: 40px;/, 'an icon where the header hides its secondary buttons');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.sync-alert,/);
  assert.match(css, /\.sync-popover__actions \.primary-button \{ order: -1; width: 100%; min-height: 46px; \}/, 'phones: stacked, full width');
  assert.match(await read('app.js'), /createSyncStatus\(\{ sync: personalSyncFeature, openSettings: openSyncSettings/);
  assert.match(await read('sw.js'), /'\.\/src\/features\/sync-status\.js'/);
});

test('green and ochre read clearly, in light and dark (WCAG AA)', async () => {
  const channel = value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const rgb = hex => [0, 2, 4].map(i => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
  const luminance = hex => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const mix = (a, b, share) => `#${rgb(a).map((v, i) => Math.round(v * share + rgb(b)[i] * (1 - share)).toString(16).padStart(2, '0')).join('')}`;
  const block = (css, opener) => {
    const start = css.indexOf(opener);
    assert.ok(start >= 0, opener);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(match => [match[1], match[2].toLowerCase()]));
  };
  const [core, theme, sync] = await Promise.all([read('styles/core.css'), read('styles/theme.css'), read('styles/sync.css')]);
  const light = { ...block(core, ':root {'), ...block(sync, ':root {') };
  const dark = { ...light, ...block(theme, ':root:not([data-theme="light"]) {'), ...block(sync, ':root:not([data-theme="light"]) {') };
  assert.deepEqual(block(sync, ':root:not([data-theme="light"]) {'), block(sync, ':root[data-theme="dark"] {'), 'the same dark tokens, chosen or from the system');
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    const pairs = [
      ['the ochre title on the waiting card', t['sync-wait-ink'], mix(t['sync-wait'], t['surface-strong'], 0.06)],
      ['muted text on the waiting card', t.muted, mix(t['sync-wait'], t['surface-strong'], 0.06)],
      ['the pill’s words', t['sync-wait-ink'], mix(t['sync-wait'], t['surface-strong'], 0.08)],
      ['“A tap every hour”', t['sync-wait-ink'], mix(t['sync-wait'], t['surface-strong'], 0.13)],
      ['“Saves on its own”', t['sync-ok'], mix(t['sync-ok'], t['surface-strong'], 0.11)],
      ['“Saved” on the pill', t['sync-ok'], mix(t['sync-ok'], t['surface-strong'], 0.09)]
    ];
    for (const [what, text, surface] of pairs) assert.ok(contrast(text, surface) >= 4.5, `${name}: ${what} ${text} on ${surface} is ${contrast(text, surface).toFixed(2)}:1`);
    assert.ok(contrast(t['sync-wait'], t['surface-strong']) >= 3, `${name}: the ochre dot shows`);
    assert.ok(contrast(t['sync-ok'], t['surface-strong']) >= 3, `${name}: the green dot shows`);
  }
});
