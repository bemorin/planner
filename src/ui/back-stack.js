/**
 * The Back button (1.36): the phone's back gesture or button, the browser's
 * Back and the installed app's back behave as in a native app.
 *
 * - Back closes what is open, the topmost first: a dialog, a menu, a
 *   popover, an overlay (the year review, the share sheet…). Then it goes
 *   back to the view before (Week → Day; Horizon, a dialog of its own, to
 *   the view it was opened over).
 * - Only from the view the planner opened on, with nothing open, does Back
 *   leave, as the browser does.
 * - A dialog that can't be dismissed keeps Back for itself: its `back` does
 *   its own safe step (first-run setup goes one step back) or nothing, and
 *   tells the stack it is still open, so the entry comes back.
 *
 * How: every open layer and every view away from the first holds one entry in
 * the browser's history, pushed with this planner's own marker in
 * history.state ({ dpBack: { s: session, d: depth } }) and the planner's
 * clean address. The entries are interchangeable: only how many there are
 * counts. The stack keeps `items` (what is open, bottom first) and makes the
 * history follow: one entry above the first per item. A layer closed another
 * way (its button, Escape, a click outside) takes one entry off with
 * history.go(-1); a dialog opened as another closes (replace, or both in one
 * task) changes nothing. While a traversal of its own is under way, the stack
 * waits for its popstate and only then looks again, so Back and Forward never
 * drift from what is on screen. A Back that arrives meanwhile is taken as
 * that traversal (the history then follows the screen again).
 *
 * On popstate from the user: a Back pops items from the top and calls each
 * one's `back`; one that stays open (it kept Back) stops there and the stack
 * goes forward again onto the entry it still owns (history.go, never a push:
 * Chrome skips entries pushed without a user gesture). A layer opened while
 * another's `back` runs (a “Leave the session?” question) shares that one's
 * entry: the next Back answers it (Cancel). A Forward to an entry nothing
 * holds is undone.
 *
 * Nothing is pushed before start() (app.js calls it once the planner shows:
 * never during boot or while the opening seal holds). On every load the
 * current entry becomes the first one of a new session, whatever an earlier
 * load left there (a reload never brings layers back); entries left below by
 * an earlier load are skipped when Back reaches them. Addresses the planner
 * reads once and cleans (?help, ?start, a sign-in's answer), and the
 * parameters of links from earlier releases (RETIRED_PARAMS), never come back:
 * every entry pushed carries the clean address, and one reached by Back is
 * cleaned too.
 *
 * The floating window (Document Picture-in-Picture) has no history and is
 * left alone. The decisions are unit-tested with a fake history in
 * tests/back-stack.test.js.
 */

export const BACK_STATE_KEY = 'dpBack';

/**
 * Read once as the planner loads, then taken out of the address: help (src/features/help-link.js), start
 * (src/first-visit.js); code, state, error and error_description: Dropbox's answer to a sign-in (1.38,
 * src/features/personal-sync.js).
 */
export const ONE_TIME_PARAMS = Object.freeze(['help', 'start', 'code', 'state', 'error', 'error_description']);

/**
 * The parameters of links that earlier releases sent (until 1.38): a licence or a gift key from an email, a
 * purchase's return, a referral. Nothing reads them any more; they are only taken out of the address, with the
 * one-time ones, so an old token never stays in the address bar or the history.
 */
export const RETIRED_PARAMS = Object.freeze(['license', 'gift', 'key', 'checkout_id', 'purchase', 'ref']);

const CLEANED_PARAMS = Object.freeze([...ONE_TIME_PARAMS, ...RETIRED_PARAMS]);

/** The key of the item a view away from the first holds (Week, when the planner opened on Day). */
export const VIEW_KEY = Object.freeze({ view: true });

/** The address without the one-time and retired parameters, as a path for pushState / replaceState (the rest of the query and the hash stay). */
export function cleanHref(href, params = CLEANED_PARAMS) {
  try {
    const url = new URL(href);
    params.forEach(name => url.searchParams.delete(name));
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_) {
    return '';
  }
}

/** This planner's marker in a history state, or null: { s: session, d: depth }. */
export function readMarker(state) {
  const mark = state && typeof state === 'object' ? state[BACK_STATE_KEY] : null;
  return mark && typeof mark.s === 'string' && Number.isInteger(mark.d) && mark.d >= 0 ? mark : null;
}

const randomSession = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * @param {object} [options]
 * @param {History} [options.history]
 * @param {Location} [options.location]
 * @param {object} [options.navigation] the Navigation API, when there is one (only to skip entries left by an earlier load)
 * @param {EventTarget} [options.win] where popstate arrives
 * @param {string} [options.baseView] the view the planner opens on ('day')
 * @param {(fn: Function) => void} [options.schedule] runs the history update once the current task is done
 * @param {{ set: Function, clear: Function }} [options.timers]
 * @param {number} [options.settleMs] a traversal of its own not answered by then is taken as done
 */
export function createBackStack({
  history = globalThis.history,
  location = globalThis.location,
  navigation = globalThis.navigation,
  win = globalThis,
  baseView = 'day',
  schedule = fn => setTimeout(fn, 0),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) },
  session = randomSession(),
  settleMs = 1500
} = {}) {
  let items = [];
  let started = false;
  let depth = 0;
  // The deepest of this session's entries the browser still has (above `depth`: forward entries).
  let top = 0;
  let inflight = false;
  let settleTimer = null;
  let queued = false;
  // The item whose `back` is running: a layer opened meanwhile shares its entry.
  let capturing = null;
  // Where this session's first entry sits among the planner's entries (Navigation API), when known.
  let baseIndex = navigation?.currentEntry?.index;

  const marker = d => ({ [BACK_STATE_KEY]: { s: session, d } });
  const here = () => `${location.pathname}${location.search}${location.hash}`;
  const alive = item => {
    if (!item || item.removed) return false;
    try { return item.alive ? item.alive() !== false : true; } catch (_) { return false; }
  };
  const replace = (state, url) => { try { history.replaceState(state, '', url); } catch (_) {} };

  function cleanCurrent() {
    const clean = cleanHref(location.href);
    if (clean && clean !== here()) replace(history.state, clean);
  }

  function find(key) {
    if (capturing?.key === key) return capturing;
    for (const item of items) {
      if (item.key === key) return item;
      const child = item.attached.find(entry => entry.key === key);
      if (child) return child;
    }
    return null;
  }

  function update() {
    if (queued) return;
    queued = true;
    schedule(() => { queued = false; reconcile(false); });
  }

  function traverse(delta) {
    const from = depth;
    inflight = true;
    timers.clear(settleTimer);
    settleTimer = timers.set(() => {
      // No popstate came. If the browser moved all the same, take its word; if the step never ran, the entry it
      // shows stands for where the planner is now (no retry: a step that can't run would never stop).
      inflight = false;
      const mark = readMarker(history.state);
      if (mark?.s === session && mark.d !== from) { depth = mark.d; reconcile(false); return; }
      items = items.filter(alive);
      depth = items.length;
      top = Math.max(top, depth);
      replace(marker(depth), cleanHref(location.href) || here());
    }, settleMs);
    try { history.go(delta); } catch (_) { inflight = false; timers.clear(settleTimer); }
  }

  /** Makes the history hold one entry above the first per open item. `fromPop`: no user gesture now, so never push where an entry already exists ahead. */
  function reconcile(fromPop) {
    if (!started || inflight) return;
    items = items.filter(alive);
    items.forEach(item => { item.attached = item.attached.filter(alive); });
    const desired = items.length;
    if (desired === depth) return;
    if (desired < depth) { traverse(desired - depth); return; }
    if (fromPop && top > depth) { traverse(Math.min(desired, top) - depth); return; }
    const url = cleanHref(location.href) || here();
    while (depth < desired) {
      depth += 1;
      try { history.pushState(marker(depth), '', url); } catch (_) { depth -= 1; break; }
    }
    top = depth;
  }

  function settings(item, { kind, name, back, alive: isAlive } = {}) {
    if (kind) item.kind = kind;
    if (name !== undefined) item.name = name;
    if (back) item.back = back;
    if (isAlive) item.alive = isAlive;
    item.removed = false;
    return item;
  }

  /**
   * A layer opened (`key`: its element or handle). `back` runs when Back reaches it (by default nothing: give
   * one that closes it); it may keep the layer open. `alive` says whether it is still on screen.
   */
  function open(key, options = {}) {
    if (key == null) return;
    const known = find(key);
    if (known) { settings(known, options); return; }
    const item = settings({ key, kind: 'layer', name: '', back: null, alive: null, attached: [] }, options);
    if (capturing) capturing.attached.push(item);
    else items.push(item);
    update();
  }

  /** A layer closed, however (its own button, Escape, a click outside, Back). */
  function closed(key) {
    if (key == null) return;
    if (capturing?.key === key) capturing.removed = true;
    const before = items.length;
    items = items.filter(item => {
      item.attached = item.attached.filter(child => { if (child.key !== key) return true; child.removed = true; return false; });
      if (item.key !== key) return true;
      item.removed = true;
      return false;
    });
    if (items.length !== before) update();
  }

  /** `newKey` takes the place (and the entry) of `oldKey`: a dialog that opens in place of another. */
  function swap(oldKey, newKey, options = {}) {
    const item = oldKey == null ? null : find(oldKey);
    if (!item || find(newKey)) { open(newKey, options); return; }
    item.key = newKey;
    settings(item, options);
  }

  /** The view now shown ('day', 'week'): one away from the first holds an entry, whose `back` goes back to the first. */
  function view(name, { back } = {}) {
    const current = find(VIEW_KEY);
    if (name === baseView) { if (current) closed(VIEW_KEY); return; }
    if (current && !current.removed) { settings(current, { name, back }); return; }
    open(VIEW_KEY, { kind: 'view', name, back });
  }

  function run(item, back) {
    const previous = capturing;
    capturing = item;
    try { back?.(); } catch (_) {} finally { capturing = previous; }
  }

  /** One Back: 'closed' (the top item went), 'kept' (it kept Back for itself) or 'none'. */
  function stepBack() {
    while (items.length) {
      const item = items[items.length - 1];
      if (!alive(item)) { items.pop(); continue; }
      item.attached = item.attached.filter(alive);
      const child = item.attached[item.attached.length - 1];
      if (child) {
        // The question this item's own Back asked: Back answers it, the item stays.
        run(child, child.back);
        return 'kept';
      }
      items.pop();
      run(item, item.back);
      if (alive(item)) { items.push(item); return 'kept'; }
      // Closed, but it opened something in its place meanwhile: that one takes its entry.
      const heirs = item.attached.filter(alive);
      item.attached = [];
      items.push(...heirs);
      return 'closed';
    }
    return 'none';
  }

  /**
   * An entry this session didn't push: null (a fragment link) or left by an earlier load of the planner (a
   * reload while something was open). It is adopted where the planner stands, so the stack stays whole. One
   * from an earlier load ahead of this session's (Forward) is gone back from; one below its first entry
   * (Back) means the person is leaving: Back goes on past that load's entries, as far as the history allows
   * (with the Navigation API: before the first of them when other sites come first, else the first entry).
   */
  function foreign(mark) {
    const index = navigation?.currentEntry?.index;
    const known = Number.isInteger(index) && Number.isInteger(baseIndex);
    if (mark && known && index > baseIndex + depth) { try { history.go(baseIndex + depth - index); return; } catch (_) {} }
    replace(marker(depth), cleanHref(location.href) || here());
    if (!mark) return;
    if (known) baseIndex = index - depth;
    let skip = mark.d + 1;
    try { if (known && history.length <= navigation.entries().length) skip = Math.min(skip, index); } catch (_) {}
    if (skip > 0) { try { history.go(-skip); } catch (_) {} }
  }

  function onPopState(event) {
    const mark = readMarker(event?.state ?? history.state);
    cleanCurrent();
    if (!mark || mark.s !== session) { foreign(mark); return; }
    top = Math.max(top, mark.d);
    if (inflight) {
      inflight = false;
      timers.clear(settleTimer);
      depth = mark.d;
      reconcile(true);
      return;
    }
    if (mark.d >= depth) { depth = mark.d; reconcile(true); return; }
    let steps = depth - mark.d;
    depth = mark.d;
    while (steps > 0 && stepBack() === 'closed') steps -= 1;
    reconcile(true);
  }

  /** Once the planner shows: from now on the history follows what is open. */
  function start() {
    if (started) return;
    started = true;
    const mark = readMarker(history.state);
    if (!mark || mark.s !== session) replace(marker(depth), cleanHref(location.href) || here());
    else cleanCurrent();
    reconcile(false);
  }

  // Every load starts as the first entry of a new session: whatever state an earlier load left here goes.
  replace(marker(0), here());
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (_) {}
  win?.addEventListener?.('popstate', onPopState);

  return {
    open,
    closed,
    swap,
    view,
    start,
    has: key => !!find(key),
    /** For tests and diagnostics: what the stack holds. */
    snapshot: () => ({ depth, top, inflight, started, items: items.map(item => ({ kind: item.kind, name: item.name, attached: item.attached.length })) }),
    onPopState
  };
}

// The planner's one stack, for modules that open layers of their own (the share sheet, Horizon's overlays).
let installed = null;

/** Makes `stack` the one backLayers talks to. Returns it. */
export function installBackStack(stack) {
  installed = stack || null;
  return stack;
}

/** For layers opened outside app.js: open(key, { back, alive }) and closed(key) on the installed stack, if any. */
export const backLayers = Object.freeze({
  open: (key, options) => installed?.open(key, options),
  closed: key => installed?.closed(key)
});
