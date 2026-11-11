import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BACK_STATE_KEY, ONE_TIME_PARAMS, RETIRED_PARAMS, VIEW_KEY, backLayers, cleanHref, createBackStack, installBackStack, readMarker } from '../src/ui/back-stack.js';
import { wireBackButton } from '../src/features/back-button.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const ORIGIN = 'https://planner.bemorin.com';

/**
 * A browser tab's session history, as far as the stack can see it: entries (another site's leave the
 * planner), pushState / replaceState at once, go() a task later (then popstate, or leaving the page), and the
 * person's own Back / Forward. `flush()` runs what is due: the stack's scheduled update, then the traversals.
 */
function fakeTab({ url = '/', before = 1, state = null, withNavigation = false } = {}) {
  const entries = [];
  for (let i = 0; i < before; i += 1) entries.push({ site: 'other', url: `/elsewhere-${i}`, state: null });
  entries.push({ url, state });
  let index = entries.length - 1;
  let left = false;
  const listeners = [];
  const scheduled = [];
  const traversals = [];
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const copy = value => (value == null ? null : JSON.parse(JSON.stringify(value)));
  const current = () => entries[index];
  const location = {
    get href() { return `${ORIGIN}${current().url}`; },
    get pathname() { return new URL(this.href).pathname; },
    get search() { return new URL(this.href).search; },
    get hash() { return new URL(this.href).hash; }
  };
  const move = target => {
    if (left || target < 0 || target >= entries.length) return;
    index = target;
    if (current().site === 'other') { left = true; return; }
    listeners.forEach(listener => listener({ state: copy(current().state) }));
  };
  const history = {
    scrollRestoration: 'auto',
    get state() { return copy(current().state); },
    get length() { return entries.length; },
    pushState(next, _title, nextUrl) {
      calls.push(['push', readMarker(next)?.d, nextUrl]);
      entries.splice(index + 1);
      entries.push({ url: nextUrl ?? current().url, state: copy(next) });
      index += 1;
    },
    replaceState(next, _title, nextUrl) {
      calls.push(['replace', readMarker(next)?.d, nextUrl]);
      entries[index] = { ...current(), url: nextUrl ?? current().url, state: copy(next) };
    },
    go(delta) {
      calls.push(['go', delta]);
      traversals.push(() => move(index + delta));
    }
  };
  // The planner's own entries come first in the Navigation API; other sites are not in it.
  const navigation = withNavigation ? {
    get currentEntry() { const own = entries.slice(0, index + 1).filter(entry => entry.site !== 'other'); return current().site === 'other' ? null : { index: own.length - 1 }; },
    entries() { return entries.filter(entry => entry.site !== 'other'); }
  } : undefined;
  const win = { addEventListener: (type, listener) => { if (type === 'popstate') listeners.push(listener); } };
  const tab = {
    history,
    location,
    navigation,
    win,
    calls,
    schedule: fn => scheduled.push(fn),
    timers: {
      set: (fn, ms) => { timerId += 1; timers.set(timerId, { fn, ms }); return timerId; },
      clear: id => timers.delete(id)
    },
    /** The person presses Back (or Forward: +1). Like the browser, it acts on the entry current when it runs. */
    press(delta = -1) { traversals.push(() => move(index + delta)); },
    /** Only the stack's scheduled update (what it asks of the history is queued, not run). */
    runScheduled() { while (scheduled.length) scheduled.shift()(); },
    flush() {
      for (let guard = 0; guard < 50 && (scheduled.length || traversals.length); guard += 1) {
        while (scheduled.length) scheduled.shift()();
        if (traversals.length) traversals.shift()();
      }
    },
    /** Runs the timers (a traversal that never answered). */
    expire() { const due = [...timers.values()]; timers.clear(); due.forEach(timer => timer.fn()); tab.flush(); },
    get index() { return index; },
    get left() { return left; },
    get depth() { return readMarker(current().state)?.d ?? null; },
    get url() { return current().url; },
    get entries() { return entries; },
    reload() { listeners.length = 0; scheduled.length = 0; traversals.length = 0; },
    stack(options = {}) {
      return createBackStack({ history, location, navigation, win, schedule: tab.schedule, timers: tab.timers, ...options });
    }
  };
  return tab;
}

/** A layer as app.js registers a dialog: open until closed; `back` closes it (or keeps it, when `keep`). */
function layer(stack, name, { keep = false, onBack = null } = {}) {
  const item = { name, open: true, backs: 0 };
  item.close = () => { item.open = false; stack.closed(item); };
  stack.open(item, { alive: () => item.open, back: () => { item.backs += 1; onBack?.(); if (!keep) item.close(); } });
  return item;
}

test('the address without what the planner reads once: the rest of the query and the hash stay', () => {
  assert.deepEqual([...ONE_TIME_PARAMS], ['help', 'start', 'code', 'state', 'error', 'error_description']);
  // Dropbox's answer to a sign-in (1.38): read once by Personal sync, never pushed back into the history.
  assert.equal(cleanHref(`${ORIGIN}/?code=abc&state=xyz`), '/');
  assert.equal(cleanHref(`${ORIGIN}/?error=access_denied&error_description=The+user+chose+not+to+give+your+app+access&state=xyz&theme=dark`), '/?theme=dark');
  assert.equal(cleanHref(`${ORIGIN}/?help&theme=dark#today`), '/?theme=dark#today');
  assert.equal(cleanHref(`${ORIGIN}/?help&gift=ABCD-EFGH`), '/', 'a gift key from an earlier release goes too');
  assert.equal(cleanHref(`${ORIGIN}/?start`), '/', 'the public pages’ Open the planner links');
  assert.equal(cleanHref(`${ORIGIN}/index.html?view=week`), '/index.html?view=week');
  assert.equal(cleanHref('not a url'), '');
});

test('the parameters of links from earlier releases are only taken out of the address: a licence, a gift key, a purchase, a referral', () => {
  assert.deepEqual([...RETIRED_PARAMS], ['license', 'gift', 'key', 'checkout_id', 'purchase', 'ref']);
  for (const name of RETIRED_PARAMS) {
    assert.equal(cleanHref(`${ORIGIN}/?${name}=example-token-0001`), '/', name);
    assert.equal(cleanHref(`${ORIGIN}/?theme=dark&${name}=example-token-0001#today`), '/?theme=dark#today', `${name}: the rest stays`);
  }
  assert.equal(cleanHref(`${ORIGIN}/?license=example.token.0001&gift=ABCD-EFGH&key=K1&checkout_id=ch_example&purchase=1&ref=EXAMPLE&view=week`), '/?view=week');
  assert.equal(cleanHref(`${ORIGIN}/?keyboard=1&referrer=a&gifts=2`), '/?keyboard=1&referrer=a&gifts=2', 'only those names, never a longer one');

  // A licence link opened from an old email: the address is clean once the planner shows, and Back never finds it again.
  const tab = fakeTab({ url: '/?license=example.token.0001&theme=dark' });
  const stack = tab.stack();
  stack.start();
  assert.equal(tab.url, '/?theme=dark');
  layer(stack, 'settings');
  tab.flush();
  tab.press();
  tab.flush();
  assert.ok(tab.entries.slice(1).every(entry => !entry.url.includes('license')), 'no entry keeps it');

  // Stripped only: nothing in the planner reads them.
  for (const file of ['app.js', 'src/first-visit.js', 'src/features/help-link.js', 'src/features/personal-sync.js']) {
    assert.doesNotMatch(read(file), /searchParams\.(?:get|has|getAll)\(\s*'(?:license|gift|key|checkout_id|purchase|ref)'/, file);
  }
});

test('the marker: this planner’s own, with a session and a depth', () => {
  assert.deepEqual(readMarker({ [BACK_STATE_KEY]: { s: 'abc', d: 2 } }), { s: 'abc', d: 2 });
  assert.equal(readMarker(null), null);
  assert.equal(readMarker({ other: 1 }), null);
  assert.equal(readMarker({ [BACK_STATE_KEY]: { s: 'abc', d: -1 } }), null);
  assert.equal(readMarker({ [BACK_STATE_KEY]: { s: 'abc', d: 1.5 } }), null);
  assert.equal(readMarker({ [BACK_STATE_KEY]: { d: 1 } }), null);
});

test('every load starts as the first entry of a new session; nothing is pushed before start', () => {
  const tab = fakeTab({ url: '/?help', state: { [BACK_STATE_KEY]: { s: 'earlier', d: 3 } } });
  const stack = tab.stack({ session: 'now' });
  assert.equal(tab.depth, 0, 'a stale state from an earlier load is replaced');
  assert.equal(readMarker(tab.history.state).s, 'now');
  assert.equal(tab.url, '/?help', 'the address is left for the launch code to read');
  assert.equal(tab.history.scrollRestoration, 'manual', 'Back never scrolls the page');
  // Launch dialogs open during boot: no entry yet.
  layer(stack, 'setup');
  layer(stack, 'help');
  tab.flush();
  assert.equal(tab.history.length, 2);
  assert.equal(tab.calls.filter(([kind]) => kind === 'push').length, 0, 'never during boot or while the opening seal holds');
  stack.start();
  tab.flush();
  assert.equal(tab.depth, 2, 'one entry per layer still open');
  assert.deepEqual(tab.entries.slice(1).map(entry => entry.url), ['/', '/', '/'], 'the first entry cleaned, and every entry pushed with the clean address');
});

test('a layer opened holds one entry; Back closes it, the topmost first, without any traversal of its own', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  const settings = layer(stack, 'settings');
  tab.flush();
  const privacy = layer(stack, 'privacy');
  tab.flush();
  assert.equal(tab.depth, 2);
  tab.press();
  tab.flush();
  assert.equal(privacy.open, false);
  assert.equal(settings.open, true);
  assert.equal(tab.depth, 1);
  tab.press();
  tab.flush();
  assert.equal(settings.open, false);
  assert.equal(tab.depth, 0);
  assert.equal(tab.calls.filter(([kind]) => kind === 'go').length, 0);
  tab.press();
  tab.flush();
  assert.equal(tab.left, true, 'with nothing open, Back leaves as the browser does');
});

test('a layer closed another way (its button, Escape, a click outside) takes its entry off; then Back goes on from there', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  stack.view('week', { back: () => stack.view('day') });
  tab.flush();
  const block = layer(stack, 'block');
  tab.flush();
  assert.equal(tab.depth, 2);
  block.close();
  tab.flush();
  assert.deepEqual(tab.calls.at(-1), ['go', -1]);
  assert.equal(tab.depth, 1);
  tab.press();
  tab.flush();
  assert.equal(stack.has(VIEW_KEY), false, 'Back after Escape goes back to Day');
  assert.equal(tab.depth, 0);
  tab.press();
  tab.flush();
  assert.equal(tab.left, true);
});

test('a dialog that replaces another, or one closed and another opened at once, changes nothing in the history', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  const help = { open: true };
  stack.open(help, { alive: () => help.open, back: () => {} });
  tab.flush();
  const pushes = tab.calls.length;
  const feedback = { open: true };
  stack.swap(help, feedback, { alive: () => feedback.open, back: () => { feedback.open = false; stack.closed(feedback); } });
  help.open = false;
  stack.closed(help);
  tab.flush();
  assert.equal(tab.calls.length, pushes, 'the new dialog takes the old one’s entry');
  assert.equal(stack.has(feedback), true);
  // A popover closed and the next opened in the same task (a colour, then another).
  const first = layer(stack, 'first popover');
  tab.flush();
  const before = tab.calls.length;
  first.close();
  layer(stack, 'second popover');
  tab.flush();
  assert.equal(tab.calls.length, before);
  assert.equal(tab.depth, 2);
  tab.press();
  tab.press();
  tab.flush();
  assert.equal(feedback.open, false);
  assert.equal(tab.depth, 0);
});

test('Week holds one entry; Back goes back to Day; going back to Day by its button takes the entry off', () => {
  const tab = fakeTab();
  let range = 'day';
  const stack = tab.stack({ baseView: 'day' });
  const setRange = view => { range = view; stack.view(view, { back: () => setRange('day') }); };
  stack.start();
  setRange('week');
  tab.flush();
  assert.equal(tab.depth, 1);
  setRange('week');
  tab.flush();
  assert.equal(tab.depth, 1, 'the same view again adds nothing');
  tab.press();
  tab.flush();
  assert.equal(range, 'day');
  assert.equal(tab.depth, 0);
  setRange('week');
  tab.flush();
  setRange('day');
  tab.flush();
  assert.deepEqual(tab.calls.at(-1), ['go', -1]);
  assert.equal(tab.depth, 0);
  tab.press();
  tab.flush();
  assert.equal(tab.left, true, 'the first view: Back leaves');
});

test('Horizon over Week: Back closes Horizon, then goes back to Day; Day chosen in Horizon goes back two at once', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  stack.view('week', { back: () => stack.view('day') });
  tab.flush();
  let horizon = layer(stack, 'horizon');
  tab.flush();
  assert.equal(tab.depth, 2);
  tab.press();
  tab.flush();
  assert.equal(horizon.open, false);
  assert.equal(stack.has(VIEW_KEY), true);
  horizon = layer(stack, 'horizon');
  tab.flush();
  horizon.close();
  stack.view('day');
  tab.flush();
  assert.deepEqual(tab.calls.at(-1), ['go', -2], 'one traversal');
  assert.equal(tab.depth, 0);
});

test('a dialog that can’t be dismissed keeps Back: its own step, the entry comes back by going forward (never a push)', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  layer(stack, 'first-run setup', { keep: true });
  stack.start();
  tab.flush();
  assert.equal(tab.depth, 1);
  const pushes = tab.calls.filter(([kind]) => kind === 'push').length;
  for (let i = 0; i < 3; i += 1) {
    tab.press();
    tab.flush();
    assert.equal(tab.depth, 1, 'back on its entry');
    assert.equal(tab.left, false);
  }
  assert.equal(tab.calls.filter(([kind]) => kind === 'push').length, pushes, 'Chrome skips entries pushed without a gesture: only go()');
  assert.deepEqual(tab.calls.filter(([kind]) => kind === 'go'), [['go', 1], ['go', 1], ['go', 1]]);
});

test('a question asked by a layer’s own Back shares its entry: the next Back answers it, the layer stays', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  let question = null;
  const plan = layer(stack, 'Plan your year', { keep: true, onBack: () => { question = layer(stack, 'Leave the session?'); } });
  tab.flush();
  tab.press();
  tab.flush();
  assert.equal(plan.open, true);
  assert.equal(question.open, true);
  assert.equal(tab.depth, 1, 'no entry of its own: no push without a gesture');
  tab.press();
  tab.flush();
  assert.equal(question.open, false, 'Back answers it (Cancel)');
  assert.equal(plan.open, true);
  assert.equal(tab.depth, 1);
  // Asked again, then answered Leave: the question goes (no history), then the plan and its entry.
  tab.press();
  tab.flush();
  question.close();
  plan.close();
  tab.flush();
  assert.equal(tab.depth, 0);
  assert.equal(stack.snapshot().items.length, 0);
});

test('a layer that closes on Back but opens another in its place hands it its entry', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  let next = null;
  layer(stack, 'first', { onBack: () => { next = layer(stack, 'in its place'); } });
  tab.flush();
  tab.press();
  tab.flush();
  assert.equal(next.open, true);
  assert.equal(tab.depth, 1);
  tab.press();
  tab.flush();
  assert.equal(next.open, false);
  assert.equal(tab.depth, 0);
});

test('fast repeated Backs: each closes one layer, in order, and the history ends where the screen is', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  stack.view('week', { back: () => stack.view('day') });
  const items = ['settings', 'help', 'privacy'].map(name => { const item = layer(stack, name); tab.flush(); return item; });
  assert.equal(tab.depth, 4);
  for (let i = 0; i < 4; i += 1) tab.press();
  tab.flush();
  assert.deepEqual(items.map(item => item.open), [false, false, false]);
  assert.equal(stack.has(VIEW_KEY), false);
  assert.equal(tab.depth, 0);
  assert.equal(tab.left, false);
});

test('a dialog that comes back once the one over it closes stays closed when a second Back reaches it meanwhile', () => {
  // As app.js does it (openModal / closeModal): Add category opens in place of Settings with an entry of its own
  // (Settings, waiting to come back, keeps its own); 180 ms after Add category closes, Settings comes back,
  // unless it was closed meanwhile.
  const run = steps => {
    const tab = fakeTab();
    const stack = tab.stack();
    stack.start();
    const shown = new Set();
    const due = [];
    let returnTo = null;
    let opened = 0;
    const open = key => { shown.add(key); opened += 1; stack.open(key, { back: () => close(key), alive: () => shown.has(key) || returnTo === key }); };
    const close = key => {
      stack.closed(key);
      if (returnTo === key) returnTo = null;
      const under = key === 'category' ? returnTo : null;
      shown.delete(key);
      if (under) due.push(() => { if (returnTo !== under) return; returnTo = null; open(under); });
    };
    open('settings');
    tab.flush();
    returnTo = 'settings';
    open('category');
    shown.delete('settings');
    tab.flush();
    assert.equal(tab.depth, 2);
    opened = 0;
    steps({ tab, close, later: () => { due.splice(0).forEach(fn => fn()); tab.flush(); } });
    return { tab, shown, opened };
  };
  const one = run(({ tab, later }) => { tab.press(); tab.flush(); later(); });
  assert.deepEqual([...one.shown], ['settings'], 'one Back: Settings comes back');
  assert.equal(one.tab.depth, 1, 'on the entry it kept');
  const two = run(({ tab, later }) => { tab.press(); tab.flush(); tab.press(); tab.flush(); later(); });
  assert.deepEqual([...two.shown], [], 'two Backs before it came back: both closed');
  assert.equal(two.opened, 0, 'Settings never reopens');
  assert.equal(two.tab.depth, 0, 'the history is back at the first entry');
  assert.equal(two.tab.left, false);
  assert.equal(two.tab.calls.filter(([kind]) => kind === 'push').length, 2, 'no entry pushed for it again');
  const button = run(({ tab, close, later }) => { close('category'); tab.press(); tab.flush(); later(); });
  assert.deepEqual([...button.shown], [], 'its × then Back: both closed');
  assert.equal(button.tab.depth, 0);
  assert.equal(button.tab.left, false);
  const app = read('app.js');
  assert.match(app, /if \(restore && returnsLater\(modal\)\) \{\n(?: {6}[^\n]*\n)*? {6}if \(modal === categoryReturnModal\) categoryReturnModal = null;\n {6}if \(modal === confirmationReturnModal\) confirmationReturnModal = null;\n {6}if \(modal === openWorkReturnModal\) openWorkReturnModal = null;\n/, 'closeModal: a dialog waiting to come back that is closed stays closed');
  assert.match(app, /if \(returnModal && returnsLater\(returnModal\)\) \{\n {8}if \(categoryReturn\) categoryReturnModal = null;/, 'the return happens only while still waited for');
});

test('a Back that arrives while a traversal of the stack’s own is under way never leaves screen and history apart', () => {
  for (const userFirst of [false, true]) {
    const tab = fakeTab();
    const stack = tab.stack();
    stack.start();
    const settings = layer(stack, 'settings');
    tab.flush();
    const popover = layer(stack, 'popover');
    tab.flush();
    popover.close();
    // The popover's entry goes with a go(-1); the person presses Back just after it, or just before it runs.
    if (userFirst) { tab.press(); tab.runScheduled(); } else { tab.runScheduled(); tab.press(); }
    tab.flush();
    assert.equal(settings.open, false, 'that Back closes Settings');
    assert.equal(tab.depth, 0, 'one entry per layer still open');
    assert.equal(tab.left, false);
  }
});

test('Forward onto an entry nothing holds any more is undone', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  const settings = layer(stack, 'settings');
  tab.flush();
  tab.press();
  tab.flush();
  assert.equal(settings.open, false);
  tab.press(1);
  tab.flush();
  assert.equal(tab.depth, 0);
  assert.equal(settings.open, false, 'nothing comes back');
});

test('a layer gone without a word is skipped: Back closes the next one, and the history follows', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  const settings = layer(stack, 'settings');
  tab.flush();
  const gone = layer(stack, 'gone');
  tab.flush();
  gone.open = false;
  tab.press();
  tab.flush();
  assert.equal(settings.open, false, 'one Back, one visible change');
  assert.equal(tab.depth, 0);
});

test('a traversal that never answers is given up after a moment: the entry shown stands for where the planner is', () => {
  const tab = fakeTab();
  const stack = tab.stack();
  stack.start();
  const settings = layer(stack, 'settings');
  tab.flush();
  const go = tab.history.go;
  tab.history.go = delta => tab.calls.push(['lost go', delta]);
  settings.close();
  tab.flush();
  assert.equal(stack.snapshot().inflight, true, 'Backs wait meanwhile');
  tab.expire();
  assert.equal(stack.snapshot().inflight, false);
  assert.equal(tab.depth, 0, 'the entry re-marked: nothing is open');
  assert.equal(tab.calls.filter(([kind]) => kind === 'lost go').length, 1, 'no retry');
  tab.history.go = go;
  const popover = layer(stack, 'popover');
  tab.flush();
  tab.press();
  tab.flush();
  assert.equal(popover.open, false, 'and Back works on from there');
});

test('cleaned addresses stay clean: entries carry the clean address, and an entry reached by Back is cleaned too', () => {
  const tab = fakeTab({ url: '/?start' });
  const stack = tab.stack();
  stack.start();
  assert.equal(tab.url, '/', 'the public pages’ ?start read, then cleaned as the planner shows');
  tab.entries[tab.index].url = '/?help';
  layer(stack, 'settings');
  tab.flush();
  assert.equal(tab.url, '/');
  tab.press();
  tab.flush();
  assert.equal(tab.url, '/', 'an entry left dirty is cleaned on arrival');
  assert.equal(tab.depth, 0);
});

test('after a reload with a layer open, Back goes past the earlier load’s entries in one step', () => {
  const tab = fakeTab({ withNavigation: true });
  let stack = tab.stack({ session: 'first' });
  stack.start();
  stack.view('week', { back: () => {} });
  tab.flush();
  layer(stack, 'settings');
  tab.flush();
  assert.equal(tab.depth, 2);
  tab.reload();
  stack = tab.stack({ session: 'second' });
  stack.start();
  tab.flush();
  assert.equal(tab.depth, 0, 'the reload starts clean on the first view');
  tab.press();
  tab.flush();
  assert.equal(tab.left, true, 'the person leaves, as from the first view');
});

test('without the Navigation API too, Back after a reload goes past the earlier load’s entries', () => {
  const tab = fakeTab();
  let stack = tab.stack({ session: 'first' });
  stack.start();
  layer(stack, 'settings');
  tab.flush();
  layer(stack, 'popover');
  tab.flush();
  tab.reload();
  stack = tab.stack({ session: 'second' });
  stack.start();
  tab.press();
  tab.flush();
  assert.equal(tab.left, true);
});

test('in an installed app whose first entry is the planner’s, Back after a reload stops on that first entry, nothing open', () => {
  const tab = fakeTab({ before: 0, withNavigation: true });
  let stack = tab.stack({ session: 'first' });
  stack.start();
  layer(stack, 'settings');
  tab.flush();
  layer(stack, 'popover');
  tab.flush();
  tab.reload();
  stack = tab.stack({ session: 'second' });
  stack.start();
  const goes = tab.calls.filter(([kind]) => kind === 'go').length;
  tab.press();
  tab.flush();
  assert.equal(tab.index, 0, 'the first entry: the next Back closes the app');
  assert.equal(readMarker(tab.history.state).s, 'second', 'adopted: the stack stays whole');
  assert.deepEqual(tab.calls.filter(([kind]) => kind === 'go').slice(goes), [['go', -1]], 'never a step out of range');
  assert.equal(stack.snapshot().items.length, 0);
});

test('an entry without a marker (a fragment link) is adopted where the planner stands', () => {
  const tab = fakeTab();
  const stack = tab.stack({ session: 's' });
  stack.start();
  const settings = layer(stack, 'settings');
  tab.flush();
  tab.history.pushState(null, '', '/#notes');
  stack.onPopState({ state: null });
  assert.deepEqual(readMarker(tab.history.state), { s: 's', d: 1 });
  tab.press();
  tab.flush();
  assert.equal(settings.open, true, 'Back from the fragment returns to the same place');
  tab.press();
  tab.flush();
  assert.equal(settings.open, false);
});

test('backLayers talks to the installed stack (the share sheet, Horizon’s overlays)', () => {
  const seen = [];
  installBackStack({ open: (key, options) => seen.push(['open', key, typeof options.back]), closed: key => seen.push(['closed', key]) });
  backLayers.open('sheet', { back: () => {} });
  backLayers.closed('sheet');
  installBackStack(null);
  backLayers.open('ignored', {});
  assert.deepEqual(seen, [['open', 'sheet', 'function'], ['closed', 'sheet']]);
});

test('the header menus and the tour are watched; the history starts once the planner shows', () => {
  const observers = [];
  class Observer {
    constructor(fn) { this.fn = fn; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  }
  const fire = target => observers.filter(observer => observer.targets.includes(target)).forEach(observer => observer.fn());
  const exportMenu = { hidden: true, contains: () => false };
  const moreMenu = { hidden: true, contains: () => true };
  const moreButton = { focused: 0, focus() { this.focused += 1; } };
  const tourRoot = {};
  const body = { children: [] };
  let touring = false;
  let tourIn = false;
  const doc = {
    body,
    activeElement: null,
    documentElement: { hasAttribute: () => false },
    querySelector: selector => ({ '[data-export-menu]': exportMenu, '[data-mobile-more-menu]': moreMenu, '[data-mobile-more]': moreButton, '[data-tour]': tourIn ? tourRoot : null })[selector] || null
  };
  const calls = [];
  const stack = { open: (key, options) => calls.push(['open', key, options]), closed: key => calls.push(['closed', key]), start: () => calls.push(['start']) };
  let closedMenus = 0;
  wireBackButton({ stack, doc, Observer, closeMenus: () => { closedMenus += 1; moreMenu.hidden = true; }, tour: { isActive: () => touring, end: () => { touring = false; } } });
  assert.deepEqual(calls.at(-1), ['start'], 'the planner shown: start');
  moreMenu.hidden = false;
  fire(moreMenu);
  const [kind, key, options] = calls.at(-1);
  assert.equal(kind, 'open');
  assert.equal(key, moreMenu);
  options.back();
  assert.equal(closedMenus, 1);
  assert.equal(moreButton.focused, 1, 'focus back on More, as Escape does');
  fire(moreMenu);
  assert.deepEqual(calls.at(-1), ['closed', moreMenu]);
  // The tour's layer appears, opens and closes.
  tourIn = true;
  touring = true;
  fire(body);
  assert.equal(calls.at(-1)[0], 'open');
  const tourKey = calls.at(-1)[1];
  // While it runs, the More menu it opens for a step is not a layer.
  moreMenu.hidden = false;
  fire(moreMenu);
  assert.equal(calls.at(-1)[1], tourKey);
  calls.at(-1)[2].back();
  assert.equal(touring, false, 'Back leaves the tour, as Escape does');
  fire(tourRoot);
  assert.deepEqual(calls.at(-1), ['closed', tourKey]);
});

test('app.js registers its dialogs, popovers and views; the other layers register their own', () => {
  const app = read('app.js');
  assert.match(app, /const backStack = installBackStack\(createBackStack\(\{ baseView: plannerRangeView \}\)\);/);
  assert.match(app, /if \(activeModal && activeModal !== modal && !stackOverCurrent && !returnsLater\(activeModal\)\) backStack\.swap\(activeModal, modal, layer\); else backStack\.open\(modal, layer\);/, 'one entry per dialog; one opened in place of another takes its entry');
  assert.match(app, /if \(restore\) backStack\.closed\(modal\);/, 'closing gives the entry back');
  assert.match(app, /backStack\.open\(popover, \{ alive: \(\) => popover\.isConnected,/);
  assert.match(app, /backStack\.closed\(activePopover\.el\);/);
  assert.match(app, /qs, qsa, backStack,/, 'the view switch records the view');
  assert.match(app, /openHelpFromAddress\(\{[^\n]*\n {4}\/\/[^\n]*\n {4}wireBackButton\(\{ stack: backStack, closeMenus: closeHeaderMenus, tour \}\);/, 'started after the launch links were read');
  assert.match(read('src/features/view-switch.js'), /backStack\?\.view\(view, \{ back: \(\) => setRange\(firstView\) \}\);/);
  assert.match(read('src/features/horizon-view.js'), /backLayers\.open\(handle, \{ back: \(\) => \(onEscape \? onEscape\(\) : handle\.close\(\)\),/, 'an overlay: Back does what Escape does');
  assert.match(read('src/features/horizon-view.js'), /activeOverlay = null;\n {8}backLayers\.closed\(handle\);/);
  assert.match(read('src/features/share-dialog.js'), /backLayers\.open\(handle, \{ back: \(\) => handle\.close\(\), alive: \(\) => openSheet === handle \}\);/);
  assert.match(read('src/features/share-dialog.js'), /closing = true;\n {6}backLayers\.closed\(handle\);/);
  const sw = read('sw.js');
  assert.match(sw, /'\.\/src\/ui\/back-stack\.js'/);
  assert.match(sw, /'\.\/src\/features\/back-button\.js'/);
});

test('first-run setup keeps Back for itself', () => {
  const onboarding = read('src/features/onboarding.js');
  assert.match(onboarding, /\{ back: \(\) => \{ if \(step > 1\) go\(step - 1\); return true; \} \}/, 'one step back, nothing on the first');
  assert.match(read('index.html'), /<div class="modal modal--onboarding" data-onboarding-modal data-modal-keep hidden>/);
  assert.match(read('app.js'), /if \(activeModal\?\.hasAttribute\('data-modal-keep'\)\) return;\n {6}if \(activeModal\) \{ closeModal\(activeModal\); return; \}/, 'Escape no longer closes it either');
});
