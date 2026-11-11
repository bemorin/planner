/**
 * The opening seal (1.35.1): what the planner shows while it loads.
 *
 * index.html carries it, so it is on screen from the first paint, before any
 * module has loaded: the planner's mark (the sun on its horizon) drawn as
 * with a pen on a dark disc, a warm stroke turning round it, a short greeting
 * under it and, at the bottom, where the plans are kept. styles/opening.css
 * draws and animates it; nothing here is needed for it to show.
 *
 * This module, loaded early by index.html (app.js imports the same one),
 * writes the greeting and the line about privacy as soon as it runs, then
 * takes the seal away as the planner shows (src/features/app-entrance.js):
 * - on the first opening of a browser session (1.35.2: a new tab, a new
 *   launch of the installed app, or a new day; SESSION_KEY in sessionStorage,
 *   which counts as first whenever it can't be read), the seal holds for
 *   HOLD_MS from its first paint, so the mark is drawn, the stroke turns and
 *   the greeting is read, even when the planner is ready sooner: the planner
 *   is drawn underneath meanwhile, and shows as the seal fades out (LEAVE_MS),
 *   usable from the first frame of that fade. A reload or Back/Forward in the
 *   same session holds it as 1.35.1 did: seen for MIN_VISIBLE_MS, a ready
 *   planner kept back MAX_HOLD_MS at most;
 * - a click, a tap or a key skips it at once (skipOnInput), and that input
 *   never reaches the planner: the whole gesture (the key up to its keyup, the
 *   press up to its click) is stopped before the page sees it, and so is a
 *   second press during the fade (a double click or tap). A gesture let go
 *   where the page can't see it (Alt+Tab, Ctrl+L, Back) ends as the window
 *   loses focus or the page is hidden, and nothing is stopped once the seal
 *   is gone, but for SKIP_TAIL_MS of the skipping gesture's own release;
 * - no hold when a dialog opens on launch (first-run setup, ?help) or the
 *   page is hidden;
 * - with reduced motion the seal stands still, holds HOLD_REDUCED_MS on the
 *   first opening of a session (briefly after) and leaves with a quick fade;
 * - should app.js never get there, the stylesheet fades the seal by itself
 *   at SEAL_FAILSAFE_MS, after the hold and its fade (the planner itself is
 *   shown at PLANNER_FAILSAFE_MS, under it: styles/entrance.css).
 * The seal is aria-hidden; a polite status beside it says the planner is
 * loading, and goes with it.
 *
 * The greeting: “Welcome to Daily Planner” the very first time, “Opening your
 * day…” when the planner was already opened today, “Welcome back to Daily
 * Planner” otherwise. It keeps one date, the day the planner was last opened,
 * in OPENED_KEY (never synced or backed up). The line at the bottom says
 * where the plans are: in this browser, and in the person's own Google Drive
 * or Dropbox (1.38) when sync is connected there (read from the sync's own
 * note, src/sync/ledger.js).
 *
 * No imports, so the browser runs it as soon as the page is parsed, long
 * before the planner's own modules have arrived.
 */

export const OPENED_KEY = 'daily-planner-ui:opened';
const SETTINGS_KEY = 'daily-planner:settings';
const DRIVE_KEY = 'daily-planner-sync:google';
const DROPBOX_KEY = 'daily-planner-sync:dropbox';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const GREETINGS = Object.freeze({
  first: 'Welcome to Daily Planner',
  today: 'Opening your day…',
  back: 'Welcome back to Daily Planner'
});

export const TRUST_LINES = Object.freeze({
  device: 'Private · your plans stay on this device',
  drive: 'Private · your plans stay on your devices and your Google Drive',
  dropbox: 'Private · your plans stay on your devices and your Dropbox'
});

/** The day of the browser session's first opening (sessionStorage): the full hold is for that one. */
export const SESSION_KEY = 'daily-planner-ui:sealed';
/** On the first opening of a session, the seal stays this long from its first paint before it leaves, however soon the planner is ready… */
export const HOLD_MS = 3000;
/** …and this long with reduced motion (a still seal: time to read the greeting). */
export const HOLD_REDUCED_MS = 1200;
/** On a reload or Back/Forward in the same session (1.35.1): on screen at least this long before it starts to leave… */
export const MIN_VISIBLE_MS = 450;
/** …but a ready planner is never kept back longer than this. */
export const MAX_HOLD_MS = 140;
/** Its way out (styles/opening.css: the same durations). */
export const LEAVE_MS = 220;
export const LEAVE_REDUCED_MS = 160;
/** Should the fade never run (no animations), the seal goes this long after it would have ended. */
export const LEAVE_FALLBACK_MS = 1000;
/** styles/opening.css fades the seal by itself at this point (its opening-failsafe animation): after the hold and its fade. */
export const SEAL_FAILSAFE_MS = 3500;
/** styles/entrance.css shows the planner by itself at this point, under the seal (FAILSAFE_MS in app-entrance.js). */
export const PLANNER_FAILSAFE_MS = 2400;
/** The guard waits at least this long once the planner shows, so the planner's own way out comes first. */
export const GUARD_GRACE_MS = 400;
/** After the skipping key or press is let go, its own click (or a tap's) is still stopped this long. */
export const SKIP_TAIL_MS = 400;

/** The local calendar day of `date`, as YYYY-MM-DD. */
export function dayKey(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Which greeting: 'first' (never opened here, nothing planned yet), 'today'
 * (already opened today) or 'back'. `known`: this browser already holds a
 * planner (its settings), from before the day was first kept.
 */
export function greetingFor({ last = null, today = dayKey(), known = false } = {}) {
  const day = DAY.test(String(last || '')) ? last : null;
  if (day && day === today) return 'today';
  return day || known ? 'back' : 'first';
}

/**
 * True when the sync's note says Google Drive is connected and has synced at
 * least once (and this copy can sync with it): Connect is noted before
 * Google's sign-in, which the person may still cancel.
 */
export function driveConnected(note, { configured = true } = {}) {
  if (!configured || !note) return false;
  try {
    const state = JSON.parse(note);
    return state?.connected === true && typeof state.lastSyncedAt === 'string' && state.lastSyncedAt.trim() !== '';
  } catch (_) { return false; }
}

// This copy syncs with Drive only when it has a Google client id (runtime-config.js, read like src/config.js).
function driveConfigured() {
  const value = globalThis.__DAILY_PLANNER_CONFIG__?.GOOGLE_CLIENT_ID;
  return typeof value === 'string' && value.trim() !== '';
}

// …and with Dropbox only when it has an app key of the right form (as src/config.js reads it).
function dropboxConfigured() {
  const value = globalThis.__DAILY_PLANNER_CONFIG__?.DROPBOX_APP_KEY;
  return typeof value === 'string' && /^[a-z0-9]{10,32}$/.test(value.trim());
}

function localStore() {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}

function sessionStore() {
  try { return globalThis.sessionStorage || null; } catch (_) { return null; }
}

/**
 * True for the first opening of this browser session today (a new tab, a new
 * launch of the installed app, or the first after midnight), noted for the
 * next one: a reload or Back/Forward in the same tab reads false. Storage
 * that can't be read or written counts as first.
 */
export function firstOpening(storage, { now = new Date() } = {}) {
  const today = dayKey(now);
  let first = true;
  try { first = storage?.getItem(SESSION_KEY) !== today; } catch (_) {}
  try { if (first) storage?.setItem(SESSION_KEY, today); } catch (_) {}
  return first;
}

/**
 * What this opening says ({ greeting, trust }, keys of GREETINGS and
 * TRUST_LINES, or trust 'none'), and today noted for the next one. Storage
 * that can't be read (blocked) greets as the first time and says nothing
 * about where the plans stay: nothing is kept beyond this visit then.
 */
export function readOpening(storage, { now = new Date(), configured = driveConfigured(), dropbox = dropboxConfigured() } = {}) {
  const today = dayKey(now);
  let last = null;
  let known = false;
  let drive = false;
  let box = false;
  let readable = !!storage;
  try {
    last = storage?.getItem(OPENED_KEY) ?? null;
    known = storage?.getItem(SETTINGS_KEY) != null;
    drive = driveConnected(storage?.getItem(DRIVE_KEY), { configured });
    box = driveConnected(storage?.getItem(DROPBOX_KEY), { configured: dropbox });
  } catch (_) { readable = false; }
  // At most one date, written once a day.
  try { if (last !== today) storage?.setItem(OPENED_KEY, today); } catch (_) {}
  return { greeting: greetingFor({ last, today, known }), trust: !readable ? 'none' : box ? 'dropbox' : drive ? 'drive' : 'device' };
}

const findSeal = doc => {
  try { return doc?.querySelector?.('[data-opening]') || null; } catch (_) { return null; }
};

/**
 * Writes the greeting and the privacy line into the seal; `data-greeting` then
 * lets them fade in. `data-session` says whether this is the session's first
 * opening ('first', the full hold) or not ('again'), read once per page.
 */
export function fillOpening({ doc = globalThis.document, storage = localStore(), session = sessionStore(), now = new Date(), configured } = {}) {
  const seal = findSeal(doc);
  if (!seal || seal.dataset.greeting) return null;
  seal.dataset.session = firstOpening(session, { now }) ? 'first' : 'again';
  const opening = readOpening(storage, configured === undefined ? { now } : { now, configured });
  const greeting = seal.querySelector('[data-opening-greeting]');
  const trust = seal.querySelector('[data-opening-trust]');
  if (greeting) greeting.textContent = GREETINGS[opening.greeting];
  if (trust) trust.textContent = TRUST_LINES[opening.trust] || '';
  if (opening.trust === 'none') {
    const line = seal.querySelector('.opening__trust');
    if (line) line.hidden = true;
  }
  seal.dataset.greeting = opening.greeting;
  return opening;
}

// What each seal is waiting for: skipped (a click, a tap or a key), and the planner's way in while it is held.
const states = new WeakMap();
function stateOf(seal) {
  let state = states.get(seal);
  if (!state) states.set(seal, (state = { skipped: false, release: null, input: null }));
  return state;
}

/** Out of the page; a planner still held for it shows now, and its input watch ends (a gesture under way: SKIP_TAIL_MS at most). */
function removeSeal(seal) {
  try { seal.remove(); } catch (_) {}
  const state = states.get(seal);
  state?.input?.settled?.();
  state?.release?.();
}

const reducedMotionNow = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * How long a ready planner still waits for the seal (ms): on the session's
 * first opening, until the seal has been on screen HOLD_MS (HOLD_REDUCED_MS
 * with reduced motion); after it (`first` false: a reload, Back/Forward),
 * until it has been seen MIN_VISIBLE_MS, MAX_HOLD_MS at most. Not at all when
 * a dialog opens on launch (it comes on top), when the page is hidden, or
 * when how long it has been on screen can't be told.
 */
export function holdFor({ shownMs = 0, dialog = false, visible = true, reducedMotion = false, first = true } = {}) {
  if (dialog || !visible || !Number.isFinite(shownMs)) return 0;
  if (!first) return Math.round(Math.min(MAX_HOLD_MS, Math.max(0, MIN_VISIBLE_MS - shownMs)));
  return Math.round(Math.max(0, (reducedMotion ? HOLD_REDUCED_MS : HOLD_MS) - shownMs));
}

/**
 * How long the seal has been on screen: its failsafe started with it, on its
 * first frame (styles/opening.css). Counted from that start, not read from
 * the animation's own clock, which stands still while a long task (the
 * planner's first render) keeps the page from drawing a new frame.
 */
function shownFor(seal) {
  try {
    const clock = seal.getAnimations?.().find(animation => animation.animationName === 'opening-failsafe');
    const start = clock?.startTime == null ? NaN : Number(clock.startTime);
    const now = Number(globalThis.performance?.now?.());
    if (Number.isFinite(start) && Number.isFinite(now)) return Math.max(0, now - start);
    const time = clock?.currentTime == null ? NaN : Number(clock.currentTime);
    if (Number.isFinite(time)) return time;
  } catch (_) {}
  return globalThis.performance?.now?.() ?? HOLD_MS;
}

/** The hold for this document's seal (0 without one, or once it was skipped): the full one unless fillOpening found the session opened already. */
export function openingHold({ doc = globalThis.document, dialog = false, reducedMotion = reducedMotionNow() } = {}) {
  const seal = findSeal(doc);
  if (!seal || states.get(seal)?.skipped) return 0;
  return holdFor({ shownMs: shownFor(seal), dialog, visible: doc.visibilityState === 'visible', reducedMotion, first: seal.dataset?.session !== 'again' });
}

/**
 * Holds the planner's way in (`release`) for `ms`: it runs then, or at once
 * when the seal is skipped, when the page is hidden, or when the seal goes
 * some other way (the stylesheet's failsafe). Without a seal, or nothing to
 * wait for, it runs now. Returns how long it waits.
 */
export function holdOpening(ms, release, { doc = globalThis.document, win = globalThis } = {}) {
  const seal = findSeal(doc);
  const state = seal ? stateOf(seal) : null;
  if (!state || state.skipped || !(ms > 0)) {
    release();
    return 0;
  }
  let timer = 0;
  const hidden = () => { if (doc.visibilityState !== 'visible') run(); };
  function run() {
    if (state.release !== run) return;
    state.release = null;
    win.clearTimeout?.(timer);
    try { doc.removeEventListener?.('visibilitychange', hidden); } catch (_) {}
    release();
  }
  state.release = run;
  try { doc.addEventListener?.('visibilitychange', hidden); } catch (_) {}
  timer = win.setTimeout(run, ms);
  return ms;
}

/**
 * Someone clicked, tapped or pressed a key while the seal was on screen: it
 * goes now. A planner held for it shows at once ('shown'); one already shown
 * (an older app.js), or shown by the stylesheet's failsafe, is uncovered
 * ('left'); one still loading shows the moment it is ready ('waiting').
 */
export function skipOpening({ doc = globalThis.document } = {}) {
  const seal = findSeal(doc);
  if (!seal || seal.hasAttribute('data-leaving')) return 'none';
  const state = stateOf(seal);
  state.skipped = true;
  if (state.release) {
    state.release();
    return 'shown';
  }
  const booting = !!doc.documentElement?.hasAttribute?.('data-booting');
  if (booting && shownFor(seal) < PLANNER_FAILSAFE_MS) return 'waiting';
  leaveOpening({ doc });
  return 'left';
}

// The input a person gives: where a gesture starts, where it is let go, and all it brings (compatibility mouse events, a tap's click, a key's keypress).
const GESTURE_STARTS = new Set(['pointerdown', 'mousedown', 'touchstart', 'keydown']);
const GESTURE_ENDS = new Set(['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'keyup']);
const NEW_GESTURE = new Set(['pointerdown', 'touchstart', 'keydown']);
const PRESSES = new Set(['pointerdown', 'mousedown', 'touchstart']);
export const SKIP_EVENTS = Object.freeze(['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'touchcancel', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keypress', 'keyup']);
/** What ends a gesture whose release the page never sees: the window loses focus (Alt+Tab, Ctrl+L, Ctrl+F) or the page goes (Back) or is hidden. */
export const LOST_EVENTS = Object.freeze(['blur', 'pagehide', 'visibilitychange']);

/** A key the browser keeps for itself (reload, a new tab, full screen, developer tools…): stopped from the page, never prevented. */
export const browserKey = event => !!(event.ctrlKey || event.metaKey || event.altKey) || /^F\d{1,2}$/.test(String(event.key || ''));

/**
 * Any click, tap or key skips the seal (skipOpening), and that input never
 * reaches the planner underneath: the window sees it first (capture) and stops
 * it there — the key until its keyup, the press until its click — and
 * prevents what it would do (a Tab moving focus, a tap's click), except a
 * browser shortcut. Only a person's input counts (isTrusted): a script's own
 * events pass. Once the seal is leaving, new input goes to the planner as
 * usual, except a press during the fade that a skip started (LEAVE_MS: the
 * second click of a double click, the second tap of a double tap), stopped
 * the same way; a key is the planner's at once.
 * A gesture whose release the page never sees (Alt+Tab, Ctrl+L or Ctrl+F
 * take the focus, Alt+Left leaves) ends when the window loses focus or the
 * page is hidden or left (LOST_EVENTS). The watch ends with the gesture that
 * skipped it, or with the seal: once it is gone, only that gesture's own
 * release is still stopped, for SKIP_TAIL_MS at most.
 */
export function skipOnInput({ doc = globalThis.document, win = globalThis } = {}) {
  const seal = findSeal(doc);
  if (!seal || typeof win?.addEventListener !== 'function') return null;
  const state = stateOf(seal);
  const options = { capture: true, passive: false };
  // 'idle'; 'down' while the key or press that skipped is held; 'tail' once it is let go, while its click may still come.
  let phase = 'idle';
  let tail = 0;
  let grace = 0;
  let fade = 0;
  // A skip's fade is under way: a new press is still the skip's.
  let fading = false;
  let watching = true;
  const present = () => findSeal(doc) === seal;
  const up = () => present() && !seal.hasAttribute('data-leaving');
  const stop = () => {
    if (!watching) return;
    watching = false;
    phase = 'idle';
    [tail, grace, fade].forEach(timer => win.clearTimeout?.(timer));
    SKIP_EVENTS.forEach(type => win.removeEventListener(type, onInput, options));
    LOST_EVENTS.forEach(type => win.removeEventListener(type, onLost, options));
  };
  const settle = () => {
    phase = 'idle';
    win.clearTimeout?.(tail);
    if (!up() && !(fading && present())) stop();
  };
  const swallow = event => {
    if (event.cancelable && !(event.type.startsWith('key') && browserKey(event))) event.preventDefault();
    event.stopImmediatePropagation();
  };
  // The window lost focus (its own blur, not an element's), or the page was hidden or left: the gesture under way is over.
  function onLost(event) {
    if (event.type === 'blur' && event.target !== win) return;
    if (event.type === 'visibilitychange' && doc.visibilityState === 'visible') return;
    settle();
  }
  function onInput(event) {
    if (!event.isTrusted) return;
    const type = event.type;
    // A new key or press (a held key's repeats are the same key) once the seal is gone, or after the one that skipped was let go: that one is over.
    if (NEW_GESTURE.has(type) && !event.repeat && (phase === 'tail' || !present())) settle();
    if (!watching) return;
    if (phase === 'idle') {
      if (!up() && !(fading && present() && PRESSES.has(type))) {
        if (!fading) stop();
        return;
      }
      swallow(event);
      if (GESTURE_STARTS.has(type)) {
        phase = 'down';
        skipOpening({ doc });
      }
      return;
    }
    swallow(event);
    if (GESTURE_ENDS.has(type) || (phase === 'tail' && !GESTURE_STARTS.has(type))) {
      phase = 'tail';
      win.clearTimeout?.(tail);
      tail = win.setTimeout(settle, SKIP_TAIL_MS);
    }
  }
  SKIP_EVENTS.forEach(type => win.addEventListener(type, onInput, options));
  LOST_EVENTS.forEach(type => win.addEventListener(type, onLost, options));
  state.input = {
    stop,
    // The seal started to leave: after a skip, presses stay its own for LEAVE_MS.
    leaving: () => {
      if (!state.skipped || !watching) return;
      fading = true;
      win.clearTimeout?.(fade);
      fade = win.setTimeout(() => { fading = false; if (phase === 'idle') stop(); }, LEAVE_MS);
    },
    // The seal is gone: nothing more to stop, but the skipping gesture's own release, SKIP_TAIL_MS at most.
    settled: () => {
      fading = false;
      win.clearTimeout?.(fade);
      if (phase === 'idle') return stop();
      win.clearTimeout?.(grace);
      grace = win.setTimeout(stop, SKIP_TAIL_MS);
    }
  };
  return state.input;
}

/**
 * Takes the seal away: a short fade (styles/opening.css, [data-leaving]),
 * then out of the page once the fade has ended. The fade starts with the
 * frame that shows the planner, which a slow device may draw late: the seal
 * is never cut short, and a fallback removes it should the fade never run.
 * It goes at once when the page is hidden, or when the stylesheet's failsafe
 * has already begun to fade it. Returns the fade's length (0: gone at once).
 */
export function leaveOpening({ doc = globalThis.document, reducedMotion = reducedMotionNow() } = {}) {
  const seal = findSeal(doc);
  if (!seal || seal.hasAttribute('data-leaving')) return 0;
  let faded = false;
  try { faded = Number(globalThis.getComputedStyle?.(seal).opacity ?? 1) < 0.99; } catch (_) {}
  if (faded || doc.visibilityState !== 'visible') {
    removeSeal(seal);
    return 0;
  }
  const ms = reducedMotion ? LEAVE_REDUCED_MS : LEAVE_MS;
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    removeSeal(seal);
  };
  seal.addEventListener?.('animationend', event => { if (event.target === seal && event.animationName === 'opening-leave') remove(); });
  seal.setAttribute('data-leaving', '');
  states.get(seal)?.input?.leaving?.();
  setTimeout(remove, ms + LEAVE_FALLBACK_MS);
  return ms;
}

/**
 * Keeps the seal from outliving the planner whatever else the page holds,
 * without relying on app.js (during an update a flaky connection can mix a
 * new index.html with files from before 1.35.1):
 * - a stylesheet that can't place the seal (from before 1.35.1) means it
 *   would sit unstyled above the planner: it goes at once;
 * - once the stylesheet's failsafe has faded it (SEAL_FAILSAFE_MS, after the
 *   hold; 2.4 s in a 1.35.1 stylesheet), it goes from the page, so nothing (a
 *   print preview, say) can play that fade again, and a planner still held
 *   for it shows;
 * - should the planner show without taking it away (an app.js from before
 *   1.35.1), it leaves once its hold is over (at least GUARD_GRACE_MS later,
 *   so the planner's own way out comes first; over a dialog, no hold), or
 *   at once on a click or a key.
 */
export function guardOpening({ doc = globalThis.document, win = globalThis } = {}) {
  const seal = findSeal(doc);
  if (!seal) return 'none';
  let position = 'fixed';
  try { position = win.getComputedStyle?.(seal)?.position || 'fixed'; } catch (_) {}
  if (position !== 'fixed') {
    removeSeal(seal);
    return 'unstyled';
  }
  seal.addEventListener?.('animationend', event => {
    if (event.target === seal && event.animationName === 'opening-failsafe') removeSeal(seal);
  });
  const root = doc.documentElement;
  if (!root || typeof win.MutationObserver !== 'function') return 'guarded';
  const observer = new win.MutationObserver(() => {
    if (root.hasAttribute('data-booting')) return;
    observer.disconnect();
    let wait = GUARD_GRACE_MS;
    try { wait = Math.max(GUARD_GRACE_MS, openingHold({ doc, dialog: !!doc.querySelector('.modal:not([hidden])') })); } catch (_) {}
    win.setTimeout(() => {
      if (findSeal(doc) === seal && !seal.hasAttribute('data-leaving')) leaveOpening({ doc });
    }, wait);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-booting'] });
  return 'guarded';
}

if (typeof document !== 'undefined') {
  fillOpening();
  if (guardOpening() === 'guarded') skipOnInput();
}
