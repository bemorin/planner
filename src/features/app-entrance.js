/**
 * The planner's opening (1.30): a calm entrance on a cold open.
 *
 * Until app.js has drawn the first real day, the static shell stays out of
 * sight on the paper background: index.html marks the document
 * `data-booting` before the first paint, and styles/entrance.css keeps the
 * planner transparent until this module releases it. Nobody sees an empty
 * skeleton jump into place, and should this module never run, the stylesheet
 * shows the planner on its own after FAILSAFE_MS. While it is out of sight,
 * the planner ([data-app]) is also inert (index.html sets it as it is
 * parsed): a Tab press or a click never lands on a control nobody can see,
 * and screen readers find nothing yet. Releasing it lifts both on the same
 * frame; index.html's own timer lifts inert after FAILSAFE_MS should this
 * module never run.
 *
 * Then, once per browser session, the header settles and the day rises in
 * with a short stagger: Web Animations on opacity and transform only, done
 * within ENTRANCE_BUDGET_MS. It is decoration and never holds anyone up: it
 * runs on the compositor, the controls work from the first frame they are
 * shown, focus is untouched and nothing is announced. It steps
 * aside when motion is reduced, the page opens in the background, comes back
 * from history, a dialog opens on launch (first-run setup, ?help), or the
 * device is slow to draw the first frame (a short fade then, or nothing). View switches never replay it.
 *
 * While the planner is out of sight, the opening seal stands in for it
 * (1.35.1, src/features/opening-seal.js): it leaves on the frame the planner
 * is shown, and a planner ready sooner waits for it, about 3 s from its first
 * paint on the first opening of a browser session (a moment on a reload),
 * unless someone clicks, taps or presses a key (showPlanner, 1.35.2). What
 * comes a little after opening waits for the seal to be gone
 * (whenPlannerShown).
 */

// A namespace, not named imports: should an update leave an opening-seal.js
// from 1.35.1 in the cache, a name it lacks is undefined here instead of
// stopping the whole planner from loading.
import * as seal from './opening-seal.js';
import { asksForHelp } from './help-link.js';

export const ENTRANCE_SEEN_KEY = 'daily-planner-ui:entrance-seen';
/** The whole entrance ends within this many milliseconds of its first frame. */
export const ENTRANCE_BUDGET_MS = 600;
/** A planner first drawn later than this after navigation only fades in. */
export const LATE_BOOT_MS = 1200;
/**
 * styles/entrance.css shows the planner by itself at this point and index.html
 * lifts inert (keep the three in step, and PLANNER_FAILSAFE_MS in
 * opening-seal.js); the seal, on top, fades by itself later (SEAL_FAILSAFE_MS).
 */
export const FAILSAFE_MS = 2400;

const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';
// Each group starts at `offset` ms, its items `gap` ms apart, each moving `distance` px into place (0: a fade).
const GROUPS = {
  header: { offset: 0, gap: 24, duration: 300, distance: -4 },
  grid: { offset: 30, gap: 0, duration: 280, distance: 0 },
  left: { offset: 50, gap: 34, duration: 360, distance: 8 },
  right: { offset: 60, gap: 34, duration: 360, distance: 8 },
  dock: { offset: 120, gap: 0, duration: 320, distance: 12 },
  meter: { offset: 220, gap: 0, duration: 380, distance: 0 }
};

/**
 * Whether this load earns the entrance at all: a fresh, visible navigation in
 * this browser session, with motion allowed and no dialog arriving on top.
 */
export function shouldPlay({ reducedMotion = false, navigationType = 'navigate', visible = true, seen = false, dialog = false } = {}) {
  if (reducedMotion || !visible || seen || dialog) return false;
  return navigationType === 'navigate' || navigationType === 'reload' || !navigationType;
}

/**
 * 'full' (header and stagger), 'fade' (one short fade of the whole planner, for
 * a late first frame) or 'none' (the planner simply appears). `bootMs` is how
 * long after navigation the first real day was drawn; `frameLagMs`, how late
 * the first frame after that came.
 */
export function entranceMode({ bootMs = 0, frameLagMs = 0, ...conditions } = {}) {
  if (!shouldPlay(conditions)) return 'none';
  if (bootMs >= FAILSAFE_MS || frameLagMs > 400) return 'none';
  if (bootMs > LATE_BOOT_MS || frameLagMs > 120) return 'fade';
  return 'full';
}

/**
 * Delays and travel for each group's items, given how many of each are on
 * screen. Gaps tighten so the last item still lands within the budget.
 */
export function entranceSchedule(counts = {}, { budget = ENTRANCE_BUDGET_MS } = {}) {
  const plan = {};
  let end = 0;
  Object.entries(GROUPS).forEach(([name, group]) => {
    const count = Math.max(0, Math.floor(Number(counts[name]) || 0));
    const latest = Math.max(group.offset, budget - group.duration);
    const gap = count > 1 ? Math.min(group.gap, (latest - group.offset) / (count - 1)) : 0;
    plan[name] = Array.from({ length: count }, (_, index) => ({
      delay: Math.round(group.offset + index * gap),
      duration: group.duration,
      distance: group.distance
    }));
    plan[name].forEach(step => { end = Math.max(end, step.delay + step.duration); });
  });
  plan.total = end;
  return plan;
}

// ---------------------------------------------------------------------------
// In the page
// ---------------------------------------------------------------------------

const SELECTORS = {
  header: '.topbar .date-identity > :not(.date-title), .topbar .date-title > *, .topbar .actions',
  grid: '.schedule-scroll > .schedule',
  left: '.workspace > .left > *, .workspace > .week-agenda > *',
  right: '.schedule-head, .blocks > .time-block, .week-schedule > *',
  dock: '.mobile-view-switch, .mobile-quick-add',
  // The day's progress bar beside “Plan” fills from empty.
  meter: '.plan-head__meter'
};
const canAnimatePseudo = () => typeof KeyframeEffect === 'function' && 'pseudoElement' in KeyframeEffect.prototype;

// Only the starting frame is given: each element ends on its own resting style
// (a finished block rests dimmed, for one), so nothing jumps when it settles.
// It starts at 0.2% opacity, which renders the same as 0: the browser then counts
// the day as painted on the frame it is first drawn (its paint timing ignores
// fully transparent content until an animation from 0 has ended).
const FROM_OPACITY = 0.002;

function keyframesFor(name, distance) {
  if (name === 'meter') return [{ transform: 'scaleX(0)', transformOrigin: '0 50%' }, { transform: 'scaleX(1)', transformOrigin: '0 50%' }];
  return [distance ? { offset: 0, opacity: FROM_OPACITY, transform: `translateY(${distance}px)` } : { offset: 0, opacity: FROM_OPACITY }];
}

// Reading sessionStorage itself throws where storage is blocked or the origin is opaque.
function sessionStore() {
  try { return globalThis.sessionStorage; } catch (_) { return null; }
}

function readSeen(storage) {
  try { return storage?.getItem(ENTRANCE_SEEN_KEY) === '1'; } catch (_) { return false; }
}

function markSeen(storage) {
  try { storage?.setItem(ENTRANCE_SEEN_KEY, '1'); } catch (_) {}
}

function navigationType() {
  try { return globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type || 'navigate'; } catch (_) { return 'navigate'; }
}

function onScreen(el) {
  if (!el || !el.getClientRects().length) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

/**
 * Release the planner and, when this load earns it, play the entrance. Call
 * once, after the first render. `dialog`: a dialog opens over the planner as
 * it loads (first-run setup). `readyAt`: when the first day was drawn
 * (performance.now()), if the planner was then held for the seal.
 */
export function startAppEntrance({ dialog = false, doc = globalThis.document, storage = sessionStore(), readyAt } = {}) {
  const root = doc?.documentElement;
  if (!root) return 'none';
  // Shown and usable on the same frame: data-booting (the stylesheet) and inert (index.html) go together, and the seal leaves.
  const reveal = () => {
    root.removeAttribute('data-booting');
    try { doc.querySelector('[data-app]')?.removeAttribute('inert'); } catch (_) {}
    try { seal.leaveOpening({ doc }); } catch (_) {}
  };
  try {
    const seen = readSeen(storage);
    markSeen(storage);
    const conditions = {
      reducedMotion: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      navigationType: navigationType(),
      visible: doc.visibilityState === 'visible' && !doc.prerendering,
      seen,
      dialog
    };
    const decidedAt = performance.now();
    // How soon the day was ready decides the entrance, not how long the seal held it (a held planner still earns it).
    const bootMs = Number.isFinite(readyAt) ? readyAt : decidedAt;
    const planned = entranceMode({ ...conditions, bootMs });
    if (planned === 'none' || typeof root.animate !== 'function') { reveal(); return 'none'; }
    requestAnimationFrame(() => {
      try {
        // A dialog opened on this first frame, or the frame came late: the planner simply appears.
        const opened = !!doc.querySelector('.modal:not([hidden])');
        const mode = opened ? 'none' : entranceMode({ ...conditions, bootMs, frameLagMs: performance.now() - decidedAt });
        play(doc, mode);
      } catch (_) {
        // Decoration only: whatever went wrong, the planner is shown below.
      } finally {
        reveal();
      }
    });
    return planned;
  } catch (_) {
    reveal();
    return 'none';
  }
}

/**
 * Call once, after the first render (app.js): startAppEntrance, once the
 * opening seal has had its time (HOLD_MS from its first paint on the first
 * opening of a browser session, briefly after: src/features/opening-seal.js
 * openingHold): the planner waits, drawn and out of sight,
 * and shows as the seal leaves, or at once when someone clicks, taps or
 * presses a key (holdOpening). Without a seal, with a dialog arriving on
 * launch (first-run setup, ?help) or in a hidden
 * page, at once. `shown` (1.35.2): called once the planner is shown and the
 * seal gone (whenPlannerShown). Returns the entrance planned, or 'held'.
 */
export function showPlanner({ dialog = false, doc = globalThis.document, storage = sessionStore(), search = globalThis.location?.search || '', shown = null } = {}) {
  const arriving = dialog || asksForHelp(search);
  const readyAt = globalThis.performance?.now?.();
  const start = () => startAppEntrance({ dialog, doc, storage, readyAt });
  if (typeof shown === 'function') whenPlannerShown(shown, { doc });
  let hold = 0;
  try { hold = seal.openingHold({ doc, dialog: arriving }); } catch (_) {}
  if (!hold) return start();
  if (typeof seal.holdOpening === 'function') seal.holdOpening(hold, start, { doc });
  else setTimeout(start, hold);
  return 'held';
}

/**
 * Runs `callback` once the planner is shown (1.35.2): `data-booting` lifted,
 * and the opening seal gone from the page, or there was none. At once when
 * both are true already; otherwise on the change that makes them so. For what
 * comes a little after opening (the tour's offer, what's new), so it never
 * opens under the seal. Returns 'now' or 'waiting'.
 */
export function whenPlannerShown(callback, { doc = globalThis.document, win = globalThis } = {}) {
  const root = doc?.documentElement;
  const shown = () => !root?.hasAttribute?.('data-booting') && !doc.querySelector?.('[data-opening]');
  let observer = null;
  let done = false;
  const check = () => {
    if (done || !shown()) return false;
    done = true;
    observer?.disconnect();
    callback();
    return true;
  };
  if (check()) return 'now';
  if (!root || typeof win?.MutationObserver !== 'function') {
    done = true;
    callback();
    return 'now';
  }
  observer = new win.MutationObserver(check);
  observer.observe(root, { attributes: true, attributeFilter: ['data-booting'] });
  const parent = doc.querySelector?.('[data-opening]')?.parentNode;
  if (parent) observer.observe(parent, { childList: true });
  return 'waiting';
}

function play(doc, mode) {
  if (mode === 'none') return;
  const animations = [];
  const animate = (el, keyframes, options) => {
    try { animations.push(el.animate(keyframes, { id: 'entrance', easing: EASE_OUT, fill: 'backwards', ...options })); } catch (_) {}
  };
  if (mode === 'fade') {
    const planner = doc.querySelector('.planner');
    if (planner) animate(planner, [{ offset: 0, opacity: FROM_OPACITY }], { duration: 220 });
  } else {
    const targets = {};
    Object.entries(SELECTORS).forEach(([name, selector]) => {
      targets[name] = name === 'meter' && !canAnimatePseudo() ? [] : [...doc.querySelectorAll(selector)].filter(onScreen);
    });
    const plan = entranceSchedule(Object.fromEntries(Object.entries(targets).map(([name, list]) => [name, list.length])));
    Object.entries(targets).forEach(([name, list]) => list.forEach((el, index) => {
      const { delay, duration, distance } = plan[name][index];
      animate(el, keyframesFor(name, distance), { delay, duration, ...(name === 'meter' ? { pseudoElement: '::before' } : {}) });
    }));
  }
  if (!animations.length) return;
  const root = doc.documentElement;
  // `data-entrance` marks the few hundred milliseconds it plays (a hook for tests and styles).
  root.dataset.entrance = mode;
  // Input is never held: the animations run on the compositor while clicks and
  // keys work as usual. A page restored from the back/forward cache lands at once.
  const finish = () => animations.forEach(animation => { try { animation.finish(); } catch (_) {} });
  const settle = () => {
    globalThis.removeEventListener?.('pageshow', finish);
    delete root.dataset.entrance;
  };
  globalThis.addEventListener?.('pageshow', finish);
  Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(settle, settle);
}
