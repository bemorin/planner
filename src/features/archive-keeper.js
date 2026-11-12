import { whenPlannerShown } from './app-entrance.js';
import { ARCHIVE_BUDGET, needsRoom, planMoves } from '../state/day-placement.js';
import { ARCHIVE_LOCK, LEASE_KEY } from '../state/day-store.js';
import { buildPlannerBackup } from '../state/planner-backup.js';
import { storageChars } from '../state/storage-health.js';
import { createRecoveryStore } from '../sync/recovery-store.js';

/**
 * The planner's side of the day archive (1.40, src/state/day-store.js): when older days load and when they move, and
 * what the planner shows meanwhile.
 *
 * Loading
 * - The archive loads once the planner shows, when the browser is idle, or at once when something asks for it
 *   (afterHistory() in app.js: Journal, Search, Unresolved, Time stats and Insights, Horizon, Export backup…). With
 *   nothing archived, nothing loads and IndexedDB is never opened.
 * - A day in view that may be archived and isn't loaded yet (store.pending()) is read-only: the Day and Week view is
 *   inert, with “Opening this day…”, until it is; then the planner draws it again.
 *
 * Moving (a pass: store.moveDays())
 * - At idle once the planner shows, and after each Close day, when localStorage is at half of Safari's budget or
 *   more: the oldest days move, down to 40%. Never today, future days or the last 62 days, nor the days on screen.
 * - At once after a refused save (an emergency pass), whatever else holds: the header says “Saving…” meanwhile, up to
 *   EMERGENCY_WAIT_MS for the lock, then the refused change is saved again (onRoom).
 * - One pass at a time across tabs, and never beside a pull, an import or a sync's local side: the store's exclusive
 *   Web Lock `daily-planner:archive`, or, without Web Locks, its lease (src/state/day-store.js exclusive()). Idle
 *   passes run only if it is free; an emergency one waits for it a little, then once more in the background.
 * - Idle passes wait while a tab of a release before 1.40 is open: each 1.40 tab holds the shared lock
 *   `daily-planner:tab`, and the service worker counts the planner's windows (sw.js, `planner-windows`); more windows
 *   than holders means an older tab. They also wait until a service worker of 1.40 or later controls the page, so the
 *   offline copy can never bring back code that doesn't know where older days went. On localhost there is no
 *   service worker (app.js registerPwa()), so neither is asked. Without Web Locks (Safari before 15.4) tabs can't be
 *   counted: only the worker's version is checked, and an older tab's blind writes are handled as at a start.
 * - The first pass in a browser takes a recovery snapshot first (`before-archive`, src/sync/recovery-store.js).
 * - Installed (standalone), the planner asks the browser to keep its storage (navigator.storage.persist()), at the
 *   first pass and at each start while it isn't kept; never in a tab, where Firefox would ask the person.
 *
 * ARCHIVE_MOVES = false (a hotfix) stops new moves; reading and moving days back go on.
 */

export const ARCHIVE_MOVES = true;
export { ARCHIVE_LOCK, LEASE_KEY };
export const TAB_LOCK = 'daily-planner:tab';
export const EMERGENCY_WAIT_MS = 3000;
const ASK_MS = 1500;
export const MIN_WORKER = '1.40.0';

export const OPENING = 'Opening this day…';
export const UNAVAILABLE_DAY = 'This day is kept in this browser’s database, which isn’t answering right now. Reload the planner to try again.';
export const LOST_DAY = 'This day was kept in this browser’s database, which doesn’t have it now. Sync now, or import a backup, to bring it back.';

/** What the view says while a day in it can't be read yet, for the archive's status. */
export const pendingText = status => (status === 'unavailable' ? UNAVAILABLE_DAY : status === 'lost' ? LOST_DAY : OPENING);

/** Whether `version` (X.Y.Z) is `min` or later. */
export function atLeast(version, min = MIN_WORKER) {
  if (!version) return false;
  const parts = value => String(value || '').split('.').map(part => Number(part) || 0);
  const [a, b] = [parts(version), parts(min)];
  for (let index = 0; index < 3; index += 1) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  return true;
}

export function createArchiveKeeper({
  store,
  storage = null,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  nav = typeof navigator !== 'undefined' ? navigator : null,
  today = () => new Date(),
  inView = () => [],
  reload = () => {},
  refresh = () => {},
  onRoom = () => {},
  onSaving = () => {},
  blocked = false,
  moves = ARCHIVE_MOVES,
  recoveryStore = null,
  buildBackup = () => buildPlannerBackup(store),
  localDev = ['localhost', '127.0.0.1', '::1'].includes(globalThis.location?.hostname || ''),
  // A test-only stop in the middle of a pass (scripts/archive-scenarios.mjs), read only on a local development address.
  hook = () => (localDev ? globalThis.__DAILY_PLANNER_ARCHIVE_HOOK__ || null : null),
  askMs = ASK_MS,
  waitMs = EMERGENCY_WAIT_MS
} = {}) {
  let viewPending = false;
  let running = null;
  let emergencies = 0;
  let last = null;
  const owner = Math.random().toString(36).slice(2);
  const todayKey = () => {
    const now = today();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  // A day was shown while it couldn't be read: once the archive is read, it is drawn again, whatever was drawn since
  // (a render that finds it readable just before then never cancels that).
  let reloadDue = false;

  /** The days in view (planner keys): inert, with a line saying why, while one of them can't be read yet. Returns whether. */
  function guard(keys = []) {
    const waiting = keys.some(key => store.pending?.(key));
    const workspace = doc?.querySelector('[data-workspace]');
    const note = doc?.querySelector('[data-day-opening]');
    if (workspace) workspace.inert = waiting;
    if (note) {
      note.hidden = !waiting;
      if (waiting) note.textContent = pendingText(store.status?.());
    }
    viewPending = waiting;
    if (waiting) { reloadDue = true; store.ready?.(); }
    return waiting;
  }

  /** The archive has loaded (or can't be, or another tab's days were read): history starts again, a day that waited is drawn. */
  function loaded() {
    try { refresh(); } catch (_) {}
    if (reloadDue) {
      reloadDue = false;
      viewPending = false;
      try { reload(); } catch (_) {}
    }
  }

  /** The service worker's answer to `message`, or null within ASK_MS. */
  function ask(message) {
    const worker = nav?.serviceWorker?.controller;
    if (!worker || typeof MessageChannel !== 'function') return Promise.resolve(null);
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const done = value => { clearTimeout(timer); try { channel.port1.close(); } catch (_) {} resolve(value); };
      const timer = setTimeout(() => done(null), askMs);
      channel.port1.onmessage = event => done(event.data || null);
      try { worker.postMessage(message, [channel.port2]); } catch (_) { done(null); }
    });
  }

  /**
   * Whether an idle pass may run: a service worker of 1.40 or later controls the page, and no planner window is open
   * that doesn't hold the tab lock (an older tab). On localhost, where there is no service worker, yes.
   */
  async function clear() {
    if (localDev) return true;
    const answer = await ask({ type: 'planner-windows' });
    if (!answer || !atLeast(answer.version)) return false;
    // Without Web Locks (Safari before 15.4), tabs can't be counted: the worker's version is the only check, and the
    // lease keeps passes one at a time.
    if (typeof nav?.locks?.query !== 'function') return true;
    const holders = await tabLocks();
    return holders != null && Number(answer.windows) <= holders;
  }

  /** How many planner tabs of 1.40 or later hold the shared tab lock; null when it can't be told. */
  async function tabLocks() {
    try { return ((await nav.locks.query()).held || []).filter(lock => lock.name === TAB_LOCK).length; } catch (_) { return null; }
  }

  /**
   * Whether a planner window of an older release is open now, as the roll call says (more windows than tab locks):
   * false when it can't be told (no worker of 1.40 answering, no Web Locks) and on localhost.
   */
  async function olderTabOpen() {
    if (localDev || typeof nav?.locks?.query !== 'function') return false;
    const answer = await ask({ type: 'planner-windows' });
    if (!answer || !atLeast(answer.version)) return false;
    const holders = await tabLocks();
    return holders != null && Number(answer.windows) > holders;
  }

  const standalone = () => !!(win?.matchMedia?.('(display-mode: standalone)')?.matches || nav?.standalone === true);
  /** Installed: asks the browser to keep this site's storage, once it isn't kept already. Silent. */
  async function keepStorage() {
    if (!standalone() || typeof nav?.storage?.persist !== 'function') return false;
    try { return (await nav.storage.persisted?.()) || await nav.storage.persist(); } catch (_) { return false; }
  }

  /** The recovery snapshot taken before a browser's first pass: true once kept. */
  async function snapshotFirst() {
    try {
      const snapshots = recoveryStore || createRecoveryStore();
      await snapshots.save(await buildBackup(), 'before-archive');
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * One pass, if room is needed: { moved, chars, stopped } or null when none ran. `emergency`: a save was just refused,
   * so it runs whatever an idle pass waits for, and the header says “Saving…” meanwhile.
   */
  function pass({ emergency = false } = {}) {
    if (!emergency) return running || run(false);
    if (!moves || blocked || !storage) return Promise.resolve(null);
    // “Saving…” from the refused save until it is saved again (or can't be), an idle pass under way included: room
    // is made once more after it.
    emergencies += 1;
    if (emergencies === 1) onSaving();
    const done = running ? running.then(() => running || run(true)) : run(true);
    return done.finally(() => { emergencies -= 1; if (!emergencies) onSaving(); });
  }

  function run(emergency) {
    if (!moves || blocked || !storage) return Promise.resolve(null);
    if (!emergency && !needsRoom(storageChars(storage), { budget: ARCHIVE_BUDGET })) return Promise.resolve(null);
    // What moves, decided once the pass runs alone (src/state/day-store.js moveDays(): the archive lock or lease).
    const plan = async ({ status }) => {
      const used = storageChars(storage);
      if (!emergency && !needsRoom(used, { budget: ARCHIVE_BUDGET })) return null;
      const { batches } = planMoves({ days: store.hotDays(), used, today: todayKey(), budget: ARCHIVE_BUDGET, exclude: inView() });
      if (!batches.length) return null;
      if (status === 'none') {
        // The first pass in this browser: a snapshot of everything first (an emergency pass goes on without it).
        if (!(await snapshotFirst()) && !emergency) return null;
        keepStorage();
      }
      return batches;
    };
    running = (async () => {
      let result = null;
      try {
        if (!emergency && !(await clear())) return null;
        result = await store.moveDays(plan, { stopAt: hook()?.stopAt ?? null, ifAvailable: !emergency, waitMs: emergency ? waitMs : Infinity });
        if (result?.stopped === 'busy') {
          // Another tab's pass (or a sync) holds the archive: an emergency waits for it in the background, then makes
          // room and saves again, so a refused change never stays “Not saved” once there is room.
          if (emergency) followUp(plan);
          result = null;
        }
      } catch (_) {
        result = null;
      } finally {
        running = null;
      }
      last = result;
      // Room made: what was refused is saved again now, while the header still says “Saving…”.
      if (result?.moved || emergency) { try { onRoom(result); } catch (_) {} }
      return result;
    })();
    return running;
  }

  let following = null;
  function followUp(plan) {
    if (following) return following;
    following = store.moveDays(plan, { stopAt: hook()?.stopAt ?? null }).then(result => {
      last = result;
      try { onRoom(result); } catch (_) {}
      return result;
    }, () => null).finally(() => { following = null; });
    return following;
  }

  /** Once the planner shows: the tab answers the roll call, the archive loads at idle if anything was archived, and room is made if needed. */
  function start({ whenShown = callback => whenPlannerShown(callback, { doc, win }) } = {}) {
    try { nav?.locks?.request?.(TAB_LOCK, { mode: 'shared' }, () => new Promise(() => {}))?.catch?.(() => {}); } catch (_) {}
    win?.addEventListener?.('storage', event => { if (!storage || !event.storageArea || event.storageArea === storage) store.storageEvent?.(event); });
    const idle = win?.requestIdleCallback ? fn => win.requestIdleCallback(fn, { timeout: 4000 }) : fn => setTimeout(fn, 400);
    whenShown(() => idle(() => {
      // A Reset that couldn't delete the database last time, done now; then what needs reading, then room if needed.
      Promise.resolve(store.finishReset?.()).catch(() => {}).then(() => {
        if (!store.isReady?.()) store.ready?.();
        if (store.status?.() !== 'none') keepStorage();
        pass();
      });
    }));
  }

  return {
    guard,
    loaded,
    start,
    pass,
    /** After Close day: room is made if needed. */
    idle: () => pass(),
    /** A save was refused: room is made now. */
    refused: () => pass({ emergency: true }),
    /** An emergency pass is running: the header says “Saving…”. */
    get saving() { return emergencies > 0; },
    get viewPending() { return viewPending; },
    /** Whether a tab of an older release is open (Data on this device says so next to Restore). */
    olderTabOpen,
    /** The days on screen (YYYY-MM-DD): the Day, or the planning week. */
    inView: () => inView(),
    /** What the last pass did (tests and the browser scenarios). */
    get last() { return last; },
    /** An emergency pass waiting in the background for another tab's (tests). */
    get followingUp() { return following; },
    clear,
    keepStorage,
    /** Reset local data: the snapshot taken before the first pass goes with the planner (sync's own snapshots stay). */
    forget: async () => {
      try { return await (recoveryStore || createRecoveryStore()).remove(snapshot => snapshot.reason === 'before-archive'); } catch (_) { return 0; }
    }
  };
}
