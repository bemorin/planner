import { addDaysKey, ymdKey } from '../lib/dates.js';
import { createLocalStore } from './local-store.js';
import { createDayArchive } from './day-archive.js';
import { importPlannerBackup } from './planner-backup.js';
import { ARCHIVE_BUDGET, MANIFEST_KEY, MOVE_GOAL_SHARE, MOVE_START_SHARE, batchesOf, dayOfKey, decodeLease, decodeManifest, encodeLease, encodeManifest, hotFloor, isBlankDay, keyOfDay, sharesItems } from './day-placement.js';

/**
 * The planner's store (1.40): one day store, two homes. Recent days stay in localStorage as they always have; older
 * days move, only once room is needed, to this browser's IndexedDB (./day-archive.js), as the identical string. This
 * keeps local-store's synchronous calls (get, set, remove, readJSON, writeJSON, keys, removePrefix, canWrite,
 * withoutMutationTracking), so everything that reads history sees every day once the archive is loaded.
 *
 * Four rules:
 * 1. localStorage wins. A day in both homes is the localStorage copy, and every write goes to localStorage,
 *    synchronously, as before. An archived day that is written moves back (its archived copy goes).
 * 2. Moving is not a change: a move fires no mutation (no ledger mark, no tombstone, no Journal refresh).
 * 3. A move is put → verify → manifest → compare-and-delete (moveDays()): stopped anywhere, both homes hold equal
 *    copies, or the archive holds a verified one, and the next pass resumes.
 * 4. A day that may be archived but isn't loaded yet is read-only (pending()): its writes are refused (false, as for
 *    a full browser, but without telling onWrite; the Day, Week and floating views are inert meanwhile), so a blank
 *    read is never saved over a real day.
 *
 * And so that nothing is lost between them (the 1.40 review):
 * - Everything that changes the archive runs alone, across tabs: the Web Lock `daily-planner:archive`, or where
 *   Web Locks are missing the lease LEASE_KEY (fixed width, rewritten in place, so it never needs room once written).
 *   Passes, pulls and imports never interleave; a sync holds it while it reads this device's records and applies
 *   what it pulls (src/sync/engine.js), so a move never looks like a deletion to the merge.
 * - The archive is never cleared because the manifest is missing: only Reset clears it. What the database holds
 *   without a manifest (a pass, pull or import stopped before its manifest; a Reset that couldn't clear it) is
 *   adopted by the first pass, or as the planner opens once localStorage is half full: a day localStorage lacks is
 *   one of the planner's days, never thrown away unseen. Checking costs no IndexedDB in the normal case
 *   (indexedDB.databases() says whether the database exists).
 * - The manifest counts the days the archive holds (counted in it after each change, never added up) and `gen` goes
 *   up each time days are added, so another tab knows to read them before it can take any of them for absent.
 * - A load that finds fewer days than the manifest counts, or misses a day the sync ledger knows, is 'lost': never
 *   taken for deletions; it ends only once a sync has brought back what the copy has (settle()), or nothing is
 *   missing any more.
 *
 * Non-day keys (the settings, daily-planner:workspace…) go straight to localStorage. With no manifest, nothing was
 * ever archived: ready() resolves at once and IndexedDB is never opened.
 *
 * status(): 'none' (nothing archived), 'loading', 'ready', 'unavailable' (IndexedDB failed this session: older days
 * read-only), 'lost' (days the archive should hold are missing: never taken for deletions).
 */

export const ARCHIVE_LOCK = 'daily-planner:archive';
/** Without Web Locks: which tab works on the archive, until when (./day-placement.js encodeLease()). */
export const LEASE_KEY = 'daily-planner-store:lease';
/** Reset local data couldn't delete the archive's database: it is deleted at the next start (1.40). */
export const RESET_KEY = 'daily-planner-store:reset';
export const LEASE_MS = 60000;
const BUSY = 'busy';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createDayStore(storage = globalThis.localStorage, {
  onMutation = null,
  onWrite = null,
  archive = null,
  // The days the sync ledger knows (src/sync/ledger.js dayMarks()): { live, deleted }, Sets of YYYY-MM-DD.
  ledgerDays = () => null,
  // Forgets ledger entries of days gone for good (after a lost archive was settled).
  forgetDays = () => {},
  onReady = null,
  onChange = null,
  defer = fn => setTimeout(fn, 60),
  locks = globalThis.navigator?.locks || null,
  leaseSettleMs = 20,
  budget = ARCHIVE_BUDGET
} = {}) {
  const local = createLocalStore(storage, { onMutation, onWrite });
  // The archived strings this tab has loaded, by planner key (daily-planner:YYYY-MM-DD → json).
  const memory = new Map();
  // Older tabs' blanks over archived days, removed under the lock once the archive is seen to still hold the day
  // (key → { value, json }): pending meanwhile.
  const blanks = new Map();
  let blanking = null;
  let depth = 0;
  // 'waiting': a manifest, and the archive not asked for yet (status() says 'loading').
  let status = readManifest() ? 'waiting' : 'none';
  // The manifest's `gen` this tab has read the archive at: another one means days were added since.
  let seenGen = null;
  let loading = null;
  let displacedCount = 0;
  let lastAside = null;
  let orphansChecked = false;
  // IndexedDB work that follows a write (an archived copy dropped or kept aside): one after another, each alone.
  let queue = Promise.resolve();
  let home = null;
  let replacing = 0;
  // Writes whose value never came from a read here (a pull, an import): they may write a pending day.
  let trusted = 0;

  function readManifest() {
    try { return decodeManifest(storage.getItem(MANIFEST_KEY)); } catch (_) { return null; }
  }
  const manifest = () => readManifest();
  const raw = key => { try { return storage.getItem(key); } catch (_) { return null; } };
  const tell = () => { try { onChange?.(status); } catch (_) {} };
  const told = () => { try { onReady?.(status); } catch (_) {} };
  const notify = mutation => {
    if (depth || typeof onMutation !== 'function') return;
    try { onMutation(mutation); } catch (_) {}
  };
  const NONE = Object.freeze({ live: new Set(), deleted: new Set() });
  const marks = () => { try { const value = ledgerDays(); return value?.live && value?.deleted ? value : NONE; } catch (_) { return NONE; } };
  const archiveOf = () => {
    if (!home) home = typeof archive === 'function' ? archive() : archive || createDayArchive();
    return home;
  };
  const latest = (a, b) => (a > b ? a : b);
  const used = () => {
    let chars = 0;
    try { for (let index = 0; index < storage.length; index += 1) { const name = storage.key(index); if (name != null) chars += name.length + (storage.getItem(name) || '').length; } } catch (_) {}
    return chars;
  };
  const nearFull = () => used() >= budget * MOVE_START_SHARE;
  const loaded = () => status === 'ready';
  const known = current => loaded() && !!current && seenGen === current.gen;
  const resetPending = () => raw(RESET_KEY) != null;
  const clearResetFlag = () => { try { storage.removeItem(RESET_KEY); } catch (_) {} };

  // ---------------------------------------------------------------------------
  // Alone across tabs: the Web Lock, or the lease
  // ---------------------------------------------------------------------------

  const owner = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  let inTab = Promise.resolve();
  let inTabBusy = 0;
  const readLease = () => { try { return decodeLease(storage.getItem(LEASE_KEY)); } catch (_) { return null; } };
  const writeLease = until => { try { storage.setItem(LEASE_KEY, encodeLease({ owner, until })); return true; } catch (_) { return false; } };

  /**
   * The lease, by `deadline`: true once this tab holds it, false when no tab holds one and it can't be written (a
   * browser full before it was ever written: this goes on, which every step allows), BUSY when another tab holds it.
   */
  async function takeLease(deadline) {
    for (;;) {
      const lease = readLease();
      if (!lease || lease.owner === owner || !(lease.until > Date.now())) {
        if (!writeLease(Date.now() + LEASE_MS)) return false;
        // Two tabs writing at once: the last one wins, the other sees it and waits.
        await sleep(leaseSettleMs);
        if (readLease()?.owner === owner) return true;
      }
      if (Date.now() >= deadline) return BUSY;
      await sleep(50);
    }
  }

  /**
   * Runs `fn(lock)` alone across tabs. `ifAvailable`: only if nothing else runs; `waitMs`: how long to wait; `lock`:
   * the lock a caller holds already (a sync applying its pulls), so nothing waits for itself. BUSY when not run.
   */
  async function exclusive(fn, { ifAvailable = false, waitMs = Infinity, lock = null } = {}) {
    if (lock?.held) return fn(lock);
    const token = { held: true, renew: () => {} };
    const run = async () => { try { return await fn(token); } finally { token.held = false; } };
    if (typeof locks?.request === 'function') {
      if (ifAvailable) return locks.request(ARCHIVE_LOCK, { mode: 'exclusive', ifAvailable: true }, held => (held ? run() : BUSY));
      if (!Number.isFinite(waitMs)) return locks.request(ARCHIVE_LOCK, { mode: 'exclusive' }, run);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), waitMs);
      try {
        return await locks.request(ARCHIVE_LOCK, { mode: 'exclusive', signal: controller.signal }, () => { clearTimeout(timer); return run(); });
      } catch (error) {
        if (error?.name === 'AbortError') return BUSY;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (ifAvailable && inTabBusy) return BUSY;
    const deadline = Date.now() + (ifAvailable ? 0 : waitMs);
    const previous = inTab;
    let done;
    inTab = new Promise(resolve => { done = resolve; });
    inTabBusy += 1;
    try {
      await previous;
      const leased = await takeLease(deadline);
      if (leased === BUSY) return BUSY;
      token.renew = () => { if (leased) writeLease(Date.now() + LEASE_MS); };
      try { return await run(); } finally { if (leased && readLease()?.owner === owner) writeLease(0); }
    } finally {
      inTabBusy -= 1;
      done();
    }
  }

  const later = work => {
    queue = queue.then(() => exclusive(lock => work(archiveOf(), lock))).catch(() => {});
    return queue;
  };

  // ---------------------------------------------------------------------------
  // The manifest
  // ---------------------------------------------------------------------------

  /**
   * Writes the manifest, which a pass and a placement advance before they remove anything. Rewritten, it always fits
   * (fixed width). Written for the first time, in a browser so full that its few characters don't fit (the pass that
   * would make room is the first one): `first` (a day put and verified) leaves localStorage, its value still the one
   * archived, and the manifest is written in the same synchronous step; if it still doesn't fit, the day is put back
   * as it was. Should a browser keep the one and not the other, the day is in the database without a manifest, and
   * is adopted at the next start (adopt()). True once written.
   */
  function writeManifest(next, first = null, current = manifest()) {
    try {
      storage.setItem(MANIFEST_KEY, encodeManifest(next));
      return true;
    } catch (_) {
      if (current || !first || raw(first.key) !== first.json) return false;
      try { storage.removeItem(first.key); } catch (_) { return false; }
      try {
        storage.setItem(MANIFEST_KEY, encodeManifest(next));
        return true;
      } catch (_) {
        try { storage.setItem(first.key, first.json); } catch (_) {}
        return false;
      }
    }
  }

  /**
   * The manifest's count, as the archive holds it after a change (`delta`: what is about to go). While days are
   * missing ('lost'), it never comes down: what it counted is still owed.
   */
  async function recount(store, delta = 0) {
    const current = manifest();
    if (!current) return;
    let days;
    try { days = await store.count(); } catch (_) { return; }
    const next = Math.max(0, days + delta);
    try { storage.setItem(MANIFEST_KEY, encodeManifest({ ...current, days: status === 'lost' ? Math.max(current.days, next) : next })); } catch (_) {}
  }

  /** The archived copy of `key` goes, if it is still `json` (null: whatever it is), and another tab hasn't done it. */
  function dropLater(key, json = null) {
    const day = dayOfKey(key);
    later(async store => {
      const found = await store.read([day]);
      if (!found.has(day) || (json != null && found.get(day) !== json)) return;
      await recount(store, -1);
      await store.remove([day]);
    });
  }

  /**
   * The archived version of `key` is kept aside (a tab wrote over it blind), if it is still `json`, and the write that
   * replaced it is still there: taken back out meanwhile (another tab removed an older tab's blank), the archived day
   * stands, so the day is never in neither home.
   */
  function keepAsideLater(key, json, reason = 'older-tab') {
    const day = dayOfKey(key);
    later(async store => {
      const found = await store.read([day]);
      if (found.get(day) !== json) return;
      if (raw(key) == null && !marks().deleted.has(day)) {
        if (!memory.has(key)) memory.set(key, json);
        return;
      }
      await recount(store, -1);
      await store.keepAside([{ day, json, reason }], { drop: [day] });
      displacedCount += 1;
      lastAside = { day, at: new Date().toISOString() };
      tell();
    });
  }

  // ---------------------------------------------------------------------------
  // Reading and writing
  // ---------------------------------------------------------------------------

  /**
   * True for a day that may be in the archive and isn't loaded here: not in localStorage, not in memory, before the
   * manifest's `before`, and not known absent (the archive read at the manifest's current `gen`). The manifest is
   * read each time, because another tab may have just moved days; this is only asked when localStorage has no value.
   */
  function pending(key) {
    const day = dayOfKey(key);
    if (!day) return false;
    if (blanks.has(key)) return true;
    if (memory.has(key) || raw(key) != null) return false;
    const current = manifest();
    if (!current || !(day < current.before)) return false;
    if (known(current)) return false;
    if (loaded()) refresh();
    return true;
  }

  const get = key => {
    const value = local.get(key);
    if (value != null) return value;
    return memory.has(key) ? memory.get(key) : null;
  };

  const set = (key, value) => {
    const day = dayOfKey(key);
    if (!day) return local.set(key, value);
    if (!trusted && pending(key)) return false;
    const archived = memory.get(key);
    // A blank day that wasn't made from the archived one, over a real one: what a blank read would save. Refused, unless
    // it comes from elsewhere (a pull applies it, the archived version kept aside; an import replaces it).
    if (archived != null && !trusted && !sharesItems(value, archived) && isBlankDay(value) && !isBlankDay(archived)) return false;
    const ok = local.set(key, value);
    if (ok && archived != null) {
      memory.delete(key);
      // Its edit (sharing its items), or a day replaced (an import), simply moves back; a day written blind over it
      // (sharing nothing: a tab that couldn't see it) keeps the archived copy aside.
      if (replacing || sharesItems(String(value), archived) || isBlankDay(archived)) dropLater(key, archived);
      else keepAsideLater(key, archived);
    }
    return ok;
  };

  const remove = key => {
    const archived = dayOfKey(key) ? memory.get(key) : undefined;
    const ok = local.remove(key);
    if (archived != null) {
      memory.delete(key);
      dropLater(key);
    }
    return ok;
  };

  const readJSON = (key, fallback = null) => {
    const value = get(key);
    if (value == null) return fallback;
    try { return JSON.parse(value); } catch (_) { return fallback; }
  };
  const writeJSON = (key, value) => set(key, JSON.stringify(value));

  const keys = (prefix = '') => {
    const result = local.keys(prefix);
    if (!memory.size) return result;
    const seen = new Set(result);
    for (const key of memory.keys()) if (key.startsWith(prefix) && !seen.has(key)) result.push(key);
    return result;
  };

  const removePrefix = prefix => {
    const matches = keys(prefix);
    matches.forEach(remove);
    return matches.length;
  };

  const withoutMutationTracking = fn => {
    depth += 1;
    try { return local.withoutMutationTracking(fn); } finally { depth -= 1; }
  };

  // ---------------------------------------------------------------------------
  // Reconciliation: a day in both homes, at a start and as other tabs write
  // ---------------------------------------------------------------------------

  /**
   * One day, its archived copy in memory, `value` what localStorage holds now (§3.4 of the 1.40 design):
   * - none: the archived day stands, unless the ledger says it was deleted;
   * - the same string: a pass stopped before its removals; the next pass finishes it;
   * - made from the archived one (sharing its items), or the archived one empty: the archived copy goes;
   * - a blank written blind over it (an older tab opened the day as empty and saved it): the blank goes, the day is
   *   the archived one again (a change: it syncs), under the lock, once the archive is seen to hold it still
   *   (checkBlanks()): another 1.40 tab may have just applied that blank from a sync and kept the archived day aside,
   *   and then the blank stands, as there;
   * - anything else written blind: the archived version is kept aside in `displaced`, and said so.
   */
  function reconcileKey(key, value, gone = marks().deleted) {
    const json = memory.get(key);
    if (json == null) return;
    if (value == null) {
      if (gone.has(dayOfKey(key))) { memory.delete(key); dropLater(key); }
      return;
    }
    if (value === json) return;
    if (sharesItems(value, json) || isBlankDay(json)) {
      memory.delete(key);
      dropLater(key, json);
    } else if (isBlankDay(value)) {
      if (raw(key) !== value) return;
      blanks.set(key, { value, json });
      blanking = later(store => checkBlanks(store));
    } else {
      memory.delete(key);
      keepAsideLater(key, json);
    }
  }

  function reconcile() {
    const gone = marks().deleted;
    for (const key of [...memory.keys()]) reconcileKey(key, raw(key), gone);
  }

  /**
   * Inside the lock: each older tab's blank waiting (`blanks`) goes, if the archive still holds the day it covers; if
   * it doesn't (kept aside by the tab that applied the blank from a sync), the blank stands, as in that tab. Run by the
   * job each one queues, and first thing by a sync's local side and a pass (ready({ lock })), so neither reads a
   * blank, nor archives one over a real day. The planner is then told, to draw the day again.
   */
  async function checkBlanks(store = archiveOf()) {
    if (!blanks.size) return;
    const waiting = [...blanks];
    let found = null;
    try { found = await store.read(waiting.map(([key]) => dayOfKey(key))); } catch (_) { found = null; }
    for (const [key, { value, json }] of waiting) {
      blanks.delete(key);
      // Written again since (or the archive unreadable): as any write.
      if (!found || raw(key) !== value) continue;
      if (found.get(dayOfKey(key)) !== json) {
        if (memory.get(key) === json) memory.delete(key);
        continue;
      }
      try { storage.removeItem(key); } catch (_) { continue; }
      memory.set(key, json);
      notify({ type: 'set', key });
    }
    told();
  }

  /** What says older days are missing: days the ledger knows that neither home has, and a count short of the manifest's. */
  function shortfall(current, count) {
    if (!current) return { missing: [], short: false };
    const missing = [];
    for (const day of marks().live) {
      if (!(day < current.before)) continue;
      const key = keyOfDay(day);
      if (!memory.has(key) && raw(key) == null) missing.push(day);
    }
    return { missing, short: count < current.days };
  }

  /** Loads the archive into memory: once, when something needs it (ready()) or at idle. */
  function load() {
    if (loading) return loading;
    status = 'loading';
    tell();
    loading = (async () => {
      const store = archiveOf();
      const current = manifest();
      let records = null;
      let aside = [];
      try {
        await store.open();
        records = await store.all();
        aside = await store.displaced();
      } catch (_) {
        records = null;
      }
      // From here on, synchronous: the status, memory, reconciliation and the planner told, with nothing between.
      loading = null;
      if (!records) status = 'unavailable';
      else {
        for (const { day, json } of records) {
          const key = keyOfDay(day);
          if (typeof json === 'string' && !memory.has(key)) memory.set(key, json);
        }
        seenGen = current ? current.gen : null;
        displacedCount = aside.length;
        noteAside(aside);
        const { missing, short } = shortfall(current, records.length);
        status = (current && current.days > 0 && !records.length) || short || missing.length ? 'lost' : 'ready';
        reconcile();
      }
      tell();
      told();
      return status;
    })();
    return loading;
  }

  /**
   * Resolves (with status()) once every day this browser keeps can be read: at once when nothing was archived. Days
   * another tab added since this one read the archive are read first, and older tabs' blanks over archived days are
   * settled (checkBlanks(): here when the caller holds the lock, a sync's local side or a pass, which reconcile what
   * localStorage holds first; else by its job).
   */
  async function ready({ lock = null } = {}) {
    if (status === 'none' || status === 'waiting') {
      if (!manifest()) {
        if (!orphansChecked && nearFull()) await adopt({ lock });
        if (!manifest()) { status = 'none'; return status; }
      }
      await load();
    } else if (status === 'loading') {
      await loading;
    } else if (status === 'ready') {
      const current = manifest();
      if (!current) { memory.clear(); seenGen = null; status = 'none'; tell(); return status; }
      if (current.gen !== seenGen) await refresh();
      // Holding the lock (a sync's local side, a pass): what other tabs wrote over archived days is taken in now, even
      // before their storage events arrive, so neither reads an older tab's blank nor archives a write over a day.
      if (lock && status === 'ready') reconcile();
    }
    if (blanks.size) await (lock ? checkBlanks() : blanking);
    return status;
  }

  /** Whether every day can be read now, without waiting. */
  const isReady = () => {
    if (status === 'none') return !manifest() && (orphansChecked || !nearFull());
    if (status === 'ready') return known(manifest()) && !blanks.size;
    return status === 'unavailable' || status === 'lost';
  };

  // ---------------------------------------------------------------------------
  // What the database holds without a manifest
  // ---------------------------------------------------------------------------

  /**
   * Inside the lock, no manifest: Reset's leftovers are cleared (it asked for that); otherwise each day the database
   * holds and localStorage lacks (and the ledger doesn't say deleted) is adopted, with a manifest covering it. A day
   * in both homes is nothing to adopt: localStorage wins, and the next put replaces the archived copy.
   */
  async function adoptRecords(records, store) {
    if (resetPending()) { await clearDatabase(store); return false; }
    const gone = marks().deleted;
    const stranded = records.filter(({ day, json }) => typeof json === 'string' && raw(keyOfDay(day)) == null && !gone.has(day));
    if (!stranded.length) return false;
    const before = addDaysKey(stranded.reduce((max, entry) => latest(max, entry.day), ''), 1);
    const chars = records.reduce((total, entry) => total + (Number(entry.chars) || 0), 0);
    const twin = records.find(({ day, json }) => raw(keyOfDay(day)) === json);
    if (!writeManifest({ before, days: records.length, chars, gen: 1 }, twin ? { key: keyOfDay(twin.day), json: twin.json } : null, null)) return false;
    for (const { day, json } of records) if (typeof json === 'string') memory.set(keyOfDay(day), json);
    seenGen = 1;
    status = 'ready';
    reconcile();
    tell();
    told();
    return true;
  }

  /**
   * Once per session, with no manifest and localStorage half full (or a save refused): the database checked for days to
   * adopt, only where the browser can say it exists without opening it (indexedDB.databases()). Elsewhere (Firefox
   * before 126) nothing is opened, so created, to look: the first pass, which opens it anyway, adopts what is there.
   */
  async function adopt({ lock = null } = {}) {
    orphansChecked = true;
    const store = archiveOf();
    let there = null;
    try { there = await store.exists(); } catch (_) { there = null; }
    if (there !== true) return false;
    const result = await exclusive(async () => {
      if (manifest()) return false;
      let records;
      try { await store.open(); records = await store.all(); } catch (_) { return false; }
      return adoptRecords(records, store);
    }, { lock });
    return result === true;
  }

  // ---------------------------------------------------------------------------
  // Other tabs
  // ---------------------------------------------------------------------------

  let removalsHeard = [];
  let setsHeard = [];
  let hearScheduled = false;
  let hearing = null;
  let refreshing = null;

  /** Days added to the archive since this tab read it (another tab's pass, pull or import), read from it. */
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const current = manifest();
      if (!current) {
        // The manifest gone: Reset in another tab. Nothing is archived any more.
        if (memory.size || status === 'ready') { memory.clear(); seenGen = null; status = 'none'; tell(); }
        return;
      }
      if (status === 'none' || status === 'waiting') { await load(); return; }
      if (!loaded() || current.gen === seenGen) return;
      let records;
      try { records = await archiveOf().all(); } catch (_) { return; }
      const gone = marks().deleted;
      let added = 0;
      for (const { day, json } of records) {
        const key = keyOfDay(day);
        if (raw(key) != null || gone.has(day) || memory.get(key) === json) continue;
        memory.set(key, json);
        added += 1;
      }
      seenGen = current.gen;
      if (added) { tell(); told(); }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function hear() {
    const removals = removalsHeard;
    const sets = setsHeard;
    removalsHeard = [];
    setsHeard = [];
    const current = manifest();
    const gone = marks().deleted;
    // A day another tab wrote, whose archived copy this tab holds: reconciled as at a start (an older tab's blank,
    // say, never shown here nor synced from here).
    for (const { key, value } of sets) if (memory.has(key) && raw(key) === value) reconcileKey(key, value, gone);
    // A day another tab removed: moved (its string archived), deleted (its tombstone), or an edit that tab's pass
    // removed before it could see it (it differs from what was archived): that edit is put back.
    const moved = removals.filter(({ key }) => current && dayOfKey(key) < current.before && raw(key) == null);
    if (moved.length) {
      let archived = null;
      try { archived = await archiveOf().read(moved.map(({ key }) => dayOfKey(key))); } catch (_) { archived = null; }
      for (const { key, oldValue } of moved) {
        const day = dayOfKey(key);
        if (raw(key) != null) continue;
        if (gone.has(day)) { memory.delete(key); continue; }
        const json = archived ? archived.get(day) : oldValue;
        if (json == null) { memory.delete(key); continue; }
        memory.set(key, json);
        if (json !== oldValue) {
          try { storage.setItem(key, oldValue); } catch (_) {
            // No room to put it back: it goes in the archive instead, verified, in place of the older string.
            later(async store => {
              const found = await store.read([day]);
              if (found.get(day) !== json) return;
              await store.put([{ day, json: oldValue }]);
              memory.set(key, oldValue);
            });
          }
        }
      }
    }
    // An archived day deleted in another tab fires no event of its own (it wasn't in localStorage): its tombstone in
    // the ledger says so.
    if (gone.size) for (const key of [...memory.keys()]) if (gone.has(dayOfKey(key)) && raw(key) == null) memory.delete(key);
    await refresh();
  }

  /**
   * Another tab's write, as its `storage` event says: a day removed or written, or the manifest changed (a pass,
   * a placement, Reset). Taken in a moment later, all together, once the writes made with it (the ledger's) are in.
   */
  function storageEvent({ key, oldValue = null, newValue = null } = {}) {
    if (key != null && key !== MANIFEST_KEY) {
      if (!dayOfKey(key)) return;
      if (newValue == null && oldValue != null) removalsHeard.push({ key, oldValue });
      else if (newValue != null) setsHeard.push({ key, value: newValue });
      else return;
    }
    if (hearScheduled) return;
    hearScheduled = true;
    defer(() => {
      hearScheduled = false;
      const run = (hearing || Promise.resolve()).then(hear).catch(() => {});
      hearing = run.finally(() => { if (hearing === run) hearing = null; });
    });
  }

  // ---------------------------------------------------------------------------
  // Moving days
  // ---------------------------------------------------------------------------

  /** The days in localStorage, [{ day, chars }] (key and value, as quotas count them): what a pass plans from. */
  function hotDays() {
    const days = [];
    for (const key of local.keys('daily-planner:')) {
      const day = dayOfKey(key);
      if (day) days.push({ day, chars: key.length + (raw(key) || '').length });
    }
    return days;
  }

  async function moveLocked(plan, { stopAt, lock }) {
    const state = await ready({ lock });
    if (state !== 'ready' && state !== 'none') return { moved: 0, chars: 0, stopped: state };
    const batches = typeof plan === 'function' ? await plan({ status: state }) : plan;
    if (!batches?.length) return { moved: 0, chars: 0, stopped: 'nothing' };
    const store = archiveOf();
    let moved = 0;
    let chars = 0;
    let removals = 0;
    try { await store.open(); } catch (_) { return { moved, chars, stopped: 'put' }; }
    // The first pass in this browser: what the database holds already is adopted, or cleared for Reset, never
    // thrown away unseen. Too full for adoption's own manifest, the days left without one ride on the first batch's.
    // A Reset unfinished: its leftovers are cleared first, never adopted, shown or synced, and nothing moves until
    // they are.
    let carry = [];
    if (!manifest()) {
      if (resetPending()) {
        if (!(await clearDatabase(store))) return { moved, chars, stopped: 'reset' };
      } else {
        let records = [];
        try { records = await store.all(); } catch (_) { return { moved, chars, stopped: 'put' }; }
        if (records.length && !(await adoptRecords(records, store))) {
          const gone = marks().deleted;
          carry = records.filter(({ day, json }) => typeof json === 'string' && raw(keyOfDay(day)) == null && !gone.has(day));
        }
      }
    }
    for (const batch of batches) {
      lock.renew();
      const found = [];
      for (const day of batch) {
        const key = keyOfDay(day);
        const json = raw(key);
        if (json != null) found.push({ day, key, json });
      }
      if (!found.length) continue;
      // A day the archive holds as another string, which this one wasn't made from (a tab that couldn't see it wrote
      // over it, and this tab hasn't heard it yet): left where it is, for reconciliation, never put over the archived one.
      let there;
      try { there = await store.read(found.map(entry => entry.day)); } catch (_) { return { moved, chars, stopped: 'put' }; }
      const entries = found.filter(({ day, json }) => { const old = there.get(day); return old == null || old === json || sharesItems(json, old) || isBlankDay(old); });
      if (!entries.length) continue;
      try { await store.put(entries.map(({ day, json }) => ({ day, json }))); } catch (_) { return { moved, chars, stopped: 'put' }; }
      if (stopAt === 'put') return { moved, chars, stopped: 'put' };
      let back;
      let count;
      try { back = await store.read(entries.map(entry => entry.day)); count = await store.count(); } catch (_) { return { moved, chars, stopped: 'verify' }; }
      if (entries.some(entry => back.get(entry.day) !== entry.json)) return { moved, chars, stopped: 'verify' };
      if (stopAt === 'verify') return { moved, chars, stopped: 'verify' };
      const current = manifest();
      const carried = carry.reduce((max, entry) => latest(max, addDaysKey(entry.day, 1)), '');
      const before = latest(latest(current?.before || '', addDaysKey(entries[entries.length - 1].day, 1)), carried);
      const size = entries.reduce((total, entry) => total + entry.key.length + entry.json.length, 0);
      const fresh = entries.filter(entry => !memory.has(entry.key)).reduce((total, entry) => total + entry.key.length + entry.json.length, 0);
      const gen = (current?.gen || 0) + 1;
      if (!writeManifest({ before, days: count, chars: (current?.chars || 0) + fresh, gen }, entries[0], current)) return { moved, chars, stopped: 'manifest' };
      for (const entry of carry) memory.set(keyOfDay(entry.day), entry.json);
      carry = [];
      // This tab knew every archived day at the manifest it read: it knows them at this one too.
      if (status === 'none' || known(current)) seenGen = gen;
      if (status === 'none') { status = 'ready'; tell(); }
      if (stopAt === 'manifest') return { moved, chars, stopped: 'manifest' };
      for (const entry of entries) {
        memory.set(entry.key, entry.json);
        try { if (storage.getItem(entry.key) === entry.json) storage.removeItem(entry.key); } catch (_) {}
        removals += 1;
        if (typeof stopAt === 'number' && removals >= stopAt) return { moved, chars, stopped: 'remove' };
      }
      moved += entries.length;
      chars += size;
    }
    return { moved, chars, stopped: null };
  }

  /**
   * Moves days to the archive, alone across tabs. `plan`: the batches ([[day…]…], oldest first: day-placement.js
   * planMoves()), or a function returning them, called once this tab runs alone (so it plans from what localStorage
   * holds then). For each batch:
   * a. the strings read from localStorage; b. put, in one strict transaction; c. read back in another, string for
   * string; d. the manifest advanced (its count taken from the archive), before anything is removed; e. in one
   * synchronous loop, each day removed from localStorage, without a mutation, only if its value is still exactly the
   * string archived (an edit made since stays; one made in another tab and not seen here yet is put back by that
   * tab, hear()); f. the strings kept in memory. Any failure stops the pass where it is.
   *
   * `ifAvailable`, `waitMs`: as exclusive(). `stopAt` ('put', 'verify', 'manifest', or a number of removals) stops it
   * there as a closed tab would: for tests and the browser scenarios. Returns { moved, chars, stopped: null | 'put' |
   * 'verify' | 'manifest' | 'remove' | 'nothing' | 'busy' | a status }.
   */
  async function moveDays(plan, { stopAt = null, ifAvailable = false, waitMs = Infinity } = {}) {
    await queue;
    const result = await exclusive(lock => moveLocked(plan, { stopAt, lock }), { ifAvailable, waitMs });
    return result === BUSY ? { moved: 0, chars: 0, stopped: 'busy' } : result;
  }

  // ---------------------------------------------------------------------------
  // Many days at once: an import, a pull, Reset
  // ---------------------------------------------------------------------------

  /** Whether days can be placed in the archive now: it is read (or empty, or lost but answering), and opens. */
  async function archiveUsable(lock = null) {
    const state = await ready({ lock });
    if (state === 'unavailable') return false;
    // A Reset unfinished, and still not finishable: its leftovers are never mixed with new days.
    if (resetPending() && !(await finishReset({ lock }))) return false;
    try { await archiveOf().open(); return true; } catch (_) { return false; }
  }

  /**
   * Inside the lock: puts `entries` ([{ day, key, json }]) in the archive, batch by batch, each read back string for
   * string. Returns the entries stored and verified; the others weren't (an archive full or failing).
   */
  async function putVerified(entries, lock) {
    const stored = [];
    const store = archiveOf();
    if (!manifest()) {
      if (resetPending()) {
        if (!(await clearDatabase(store))) return stored;
      } else {
        let records = [];
        try { records = await store.all(); } catch (_) { return stored; }
        if (records.length) await adoptRecords(records, store);
      }
    }
    for (const batch of batchesOf(entries.map(entry => ({ ...entry, chars: entry.key.length + entry.json.length })))) {
      lock?.renew?.();
      try {
        await store.put(batch.map(({ day, json }) => ({ day, json })));
        const back = await store.read(batch.map(entry => entry.day));
        for (const entry of batch) if (back.get(entry.day) === entry.json) stored.push(entry);
      } catch (_) {}
    }
    return stored;
  }

  const countOf = async () => { try { return await archiveOf().count(); } catch (_) { return null; } };

  /**
   * Inside the lock: days just put and verified become archived days, in one synchronous step: the manifest advanced
   * first (`count`: what the archive holds now), then each kept in memory and its localStorage copy (an older version:
   * these replace it) removed. Each is a change (`set`), unless `tracked` is false (a pull: no change of this
   * device's). No manifest, no move: the days stay where they were, and are returned as not placed.
   */
  function placed(entries, { tracked = true, count = null } = {}) {
    if (!entries.length) return [];
    const current = manifest();
    const last = entries.reduce((max, entry) => latest(max, entry.day), '');
    const before = latest(current?.before || '', addDaysKey(last, 1));
    const size = entries.filter(entry => !memory.has(entry.key)).reduce((total, entry) => total + entry.key.length + entry.json.length, 0);
    const counted = count == null ? (current?.days || 0) + entries.length : count;
    const days = status === 'lost' ? Math.max(current?.days || 0, counted) : counted;
    const gen = (current?.gen || 0) + 1;
    if (!writeManifest({ before, days, chars: (current?.chars || 0) + size, gen }, null, current)) return [];
    if (status === 'none' || known(current)) seenGen = gen;
    if (status === 'none') status = 'ready';
    for (const entry of entries) {
      memory.set(entry.key, entry.json);
      try { storage.removeItem(entry.key); } catch (_) {}
      if (tracked) notify({ type: 'set', key: entry.key });
    }
    tell();
    return entries;
  }

  const replacingAll = fn => { replacing += 1; trusted += 1; try { return fn(); } finally { replacing -= 1; trusted -= 1; } };

  /** After an import, a lost archive ends once nothing is missing any more (never otherwise: an import is no proof). */
  async function ifComplete() {
    if (status !== 'lost') return;
    const current = manifest();
    const count = await countOf();
    const { missing, short } = shortfall(current, count ?? 0);
    if (count == null || missing.length || short) return;
    seenGen = current?.gen ?? null;
    status = 'ready';
    tell();
    told();
  }

  /**
   * Import backup (1.40): its settings and its recent days to localStorage, as before, and its older days, once
   * localStorage would pass `goal` of Safari's budget (the “changed” marks of every day imported counted in), to the
   * archive: put, then verified, before anything is replaced, alone across tabs. Every day imported is a change, so it
   * syncs. Returns what importPlannerBackup() returns ({ days, stored, refused, settings }): nothing imported in part
   * in silence.
   *
   * `bulk(fn)`: runs the synchronous writes as one (app.js inBulk(): the ledger written once). `budget`: the browser's
   * own quota (for the room an import keeps free while it writes); `today`: YYYY-MM-DD.
   */
  async function importDays(backup, { budget: quota = ARCHIVE_BUDGET, today = ymdKey(new Date()), goal = MOVE_GOAL_SHARE, markChars = 64, bulk = fn => fn() } = {}) {
    const all = Object.keys(backup?.days || {}).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort().reverse();
    await ready();
    const asBefore = () => bulk(() => replacingAll(() => importPlannerBackup(api, backup, { budget: quota })));
    if (!all.length) return asBefore();
    const floor = hotFloor(today);
    let room = Math.floor(budget * goal) - used() - markChars * all.length;
    for (const day of all) { const current = raw(keyOfDay(day)); if (current != null) room += keyOfDay(day).length + current.length; }
    const hot = [];
    const cold = [];
    for (const day of all) {
      const key = keyOfDay(day);
      const json = JSON.stringify(backup.days[day]);
      const size = key.length + json.length;
      if (!cold.length && (day >= floor || size <= room)) { hot.push(day); room -= size; } else cold.push({ day, key, json });
    }
    // Everything fits in localStorage, or there is no archive to place days in: as 1.39.4 imported.
    if (!cold.length || !(await archiveUsable())) {
      const report = asBefore();
      await ifComplete();
      return report;
    }
    const result = await exclusive(async lock => {
      await ready({ lock });
      const verified = await putVerified(cold, lock);
      const first = await countOf();
      let archived = [];
      const report = bulk(() => {
        archived = placed(verified, { count: first });
        return replacingAll(() => importPlannerBackup(api, { settings: backup.settings, days: Object.fromEntries(hot.map(day => [day, backup.days[day]])) }, { budget: quota }));
      });
      const kept = new Set(archived.map(entry => entry.day));
      const missed = cold.filter(entry => !kept.has(entry.day)).map(entry => entry.day);
      // What localStorage refused goes to the archive after all.
      const leftover = report.refused.map(day => ({ day, key: keyOfDay(day), json: JSON.stringify(backup.days[day]) }));
      const verifiedLate = leftover.length ? await putVerified(leftover, lock) : [];
      const second = verifiedLate.length ? await countOf().then(count => bulk(() => placed(verifiedLate, { count }))) : [];
      const late = new Set(second.map(entry => entry.day));
      const refused = [...report.refused.filter(day => !late.has(day)), ...missed].sort().reverse();
      return { days: all.length, stored: all.length - refused.length, refused, settings: report.settings };
    });
    await ifComplete();
    return result;
  }

  /**
   * A sync pull (1.40, src/sync/engine.js): [[key, value]] written as the copy holds them, null removing the key, all
   * untracked. Recent days and the settings go to localStorage, and so do older days while localStorage stays within
   * `goal` of Safari's budget (an archived day changed elsewhere moves back, as any edit does), newest first; the rest
   * go straight to the archive, put and verified, alone across tabs (`lock`: the sync's, held already). Returns
   * { refused: [keys not stored] }, left un-applied by the engine.
   */
  async function placeMany(entries, { today = ymdKey(new Date()), goal = MOVE_GOAL_SHARE, baseChars = 110, lock = null } = {}) {
    const writes = entries.filter(([, value]) => value !== null && value !== undefined);
    const old = writes.filter(([key]) => dayOfKey(key) && dayOfKey(key) < hotFloor(today));
    let cold = [];
    if (old.length) {
      await ready({ lock });
      // The ledger grows too: each record pulled gets its base there (about `baseChars` characters), in localStorage.
      let room = Math.floor(budget * goal) - used() - baseChars * entries.length;
      const sorted = [...old].sort((a, b) => (a[0] < b[0] ? 1 : -1));
      for (const [key, value] of sorted) {
        const json = JSON.stringify(value);
        const current = raw(key);
        const size = key.length + json.length - (current != null ? key.length + current.length : 0);
        if (!cold.length && size <= room) { room -= size; continue; }
        cold.push({ day: dayOfKey(key), key, json, value });
      }
      // IndexedDB is opened only when a day is to go there; without it, every day goes to localStorage, as before.
      if (cold.length && !(await archiveUsable(lock))) cold = [];
    }
    const apply = (verified = [], count = null) => {
      let placedKeys = new Set();
      const refused = [];
      trusted += 1;
      try {
        withoutMutationTracking(() => {
          placedKeys = new Set(placed(verified, { tracked: false, count }).map(entry => entry.key));
          for (const [key, value] of entries) {
            if (placedKeys.has(key)) continue;
            const ok = value === null || value === undefined ? remove(key) : writeJSON(key, value);
            if (ok === false) refused.push(key);
          }
        });
      } finally {
        trusted -= 1;
      }
      return { refused };
    };
    if (!cold.length) return apply();
    const result = await exclusive(async held => {
      const verified = await putVerified(cold, held);
      return apply(verified, verified.length ? await countOf() : null);
    }, { lock });
    return result === BUSY ? apply() : result;
  }

  /**
   * Inside the lock: the archive's database emptied (days and copies kept aside), or deleted when that fails; when even
   * that can't be done now (another tab holds it open, IndexedDB not answering), RESET_KEY asks the next start to.
   */
  async function clearDatabase(store) {
    let there = null;
    try { there = await store.exists(); } catch (_) { there = null; }
    if (there === false) { clearResetFlag(); return true; }
    try { await store.clear({ displaced: true }); clearResetFlag(); return true; } catch (_) {}
    try { await store.destroy(); home = null; clearResetFlag(); return true; } catch (_) {}
    try { storage.setItem(RESET_KEY, '1'); } catch (_) {}
    return false;
  }

  /**
   * Reset local data (1.40): every day in either home removed, each with the event local-store gives a removal (so
   * the deletions sync), the older days this tab couldn't read included (those the ledger knows), then the manifest
   * removed, then the archive's database emptied, or deleted, or left for the next start to delete (databaseLeft()):
   * nothing archived is ever read again. Returns how many keys went.
   */
  async function clearAll(prefix = 'daily-planner:', { bulk = fn => fn() } = {}) {
    await ready();
    const daysToo = keyOfDay('2000-01-01').startsWith(prefix);
    const count = await exclusive(async () => {
      const unread = daysToo ? [...marks().live].map(keyOfDay) : [];
      const removed = bulk(() => {
        const matches = [...new Set([...keys(prefix), ...unread])];
        if (daysToo) {
          try { storage.removeItem(MANIFEST_KEY); } catch (_) {}
          memory.clear();
          seenGen = null;
          status = 'none';
        }
        matches.forEach(key => local.remove(key));
        return matches.length;
      });
      if (daysToo) {
        displacedCount = 0;
        lastAside = null;
        await clearDatabase(archiveOf());
      }
      return removed;
    });
    tell();
    return count;
  }

  /**
   * A Reset that couldn't delete the database: tried again at the next start, before anything is archived anew (no
   * pass, pull or import places days while it is unfinished). Checked again inside the lock: another tab may have
   * finished it meanwhile, and archived days since, which are never emptied for it.
   */
  async function finishReset({ lock = null } = {}) {
    if (!resetPending()) return true;
    const done = await exclusive(async () => {
      if (!resetPending()) return true;
      if (manifest()) { clearResetFlag(); return true; }
      return clearDatabase(archiveOf());
    }, { lock });
    return done === true;
  }

  /**
   * The archive was found missing days ('lost'), and a sync has brought back what the copy has (restoreMissing): what
   * is still missing is gone for good (its ledger entries forgotten, so no sync waits on it), and older days can be
   * written again.
   */
  async function settle() {
    if (status !== 'lost') return false;
    const result = await exclusive(async () => {
      if (status !== 'lost') return false;
      const current = manifest();
      const count = await countOf();
      if (count == null) return false;
      const { missing } = shortfall(current, count);
      if (missing.length) forgetDays(missing);
      const gen = (current?.gen || 0) + 1;
      if (current) writeManifest({ ...current, days: count, gen });
      seenGen = current ? gen : null;
      status = 'ready';
      return true;
    });
    if (result === true) { tell(); told(); }
    return result === true;
  }

  // ---------------------------------------------------------------------------
  // What this browser keeps
  // ---------------------------------------------------------------------------

  /**
   * What this browser keeps: { days (saved days, both homes), archived (of them, in IndexedDB only), archivedChars,
   * displaced (earlier versions kept aside), lastAside ({ day, at } of the latest), status }.
   */
  function stats() {
    let days = 0;
    let archived = 0;
    let archivedChars = 0;
    const hot = new Set();
    for (const key of local.keys('daily-planner:')) if (dayOfKey(key)) { hot.add(key); days += 1; }
    for (const [key, json] of memory) {
      if (hot.has(key)) continue;
      days += 1;
      archived += 1;
      archivedChars += key.length + json.length;
    }
    // Days not loaded yet count as the manifest says.
    if (!loaded() && status !== 'lost') {
      const current = manifest();
      if (current && !archived) { archived = current.days; archivedChars = current.chars; days += current.days; }
    }
    return { days, archived, archivedChars, displaced: displacedCount, lastAside, status: status === 'waiting' ? 'loading' : status };
  }

  /**
   * What the copies kept aside say: how many, and the latest kept by a tab writing blind that hasn't been put back (one
   * kept as the person restored another, or one restored, is no news to them).
   */
  function noteAside(list) {
    displacedCount = list.length;
    const news = list.find(entry => entry.reason !== 'restored-over' && !entry.restoredAt);
    lastAside = news ? { day: news.day, at: news.displacedAt } : null;
  }

  /**
   * The earlier versions kept aside, newest first ([{ id, day, json, displacedAt, reason, restoredAt? }]); [] when none
   * or unreadable.
   */
  async function displaced() {
    if (!manifest() && !displacedCount) return [];
    try { return await archiveOf().displaced(); } catch (_) { return []; }
  }

  /**
   * Puts the copy kept aside `id` back as its day (a change: it syncs). The day as it is now, if anything, is kept
   * aside in its place first, so restoring never throws away what the other tab typed. The copy restored stays too,
   * marked `restoredAt`: the older tab that wrote over the day may still be open, and save its version over it again
   * (a copy kept aside goes only with Reset). False when it couldn't.
   */
  async function restoreAside(id) {
    const state = await ready();
    if (state !== 'ready' && state !== 'none') return false;
    const entry = (await displaced()).find(item => item.id === id);
    if (!entry) return false;
    const key = keyOfDay(entry.day);
    const result = await exclusive(async () => {
      const store = archiveOf();
      const current = get(key);
      let keptIds = [];
      if (current != null && current !== entry.json) {
        try { keptIds = (await store.keepAside([{ day: entry.day, json: current, reason: 'restored-over' }])) || []; } catch (_) { return false; }
      }
      trusted += 1;
      replacing += 1;
      let ok;
      try { ok = set(key, entry.json); } finally { trusted -= 1; replacing -= 1; }
      if (ok === false) {
        if (keptIds.length) { try { await store.forget(keptIds); } catch (_) {} }
        return false;
      }
      try { await store.rewrite([{ ...entry, restoredAt: new Date().toISOString() }]); } catch (_) {}
      try { noteAside(await store.displaced()); } catch (_) {}
      return true;
    });
    if (result === true) tell();
    return result === true;
  }

  const api = {
    get,
    set,
    remove,
    readJSON,
    writeJSON,
    keys,
    removePrefix,
    canWrite: prefix => local.canWrite(prefix),
    withoutMutationTracking,
    pending,
    ready,
    isReady,
    status: () => (status === 'waiting' ? 'loading' : status),
    stats,
    hotDays,
    moveDays,
    exclusive: (fn, options) => exclusive(fn, options).then(result => (result === BUSY ? null : result)),
    storageEvent,
    displaced,
    restoreAside,
    importDays,
    placeMany,
    clearAll,
    finishReset,
    databaseLeft: resetPending,
    /** The latest earlier version kept aside by a tab writing blind: { day, at }, or null. */
    lastAside: () => lastAside,
    settle,
    /** Once per session: the database checked for days a stopped first move left in it without a manifest. */
    adopt: () => adopt(),
    /** The IndexedDB work queued after writes, and what other tabs did, taken in (tests, and before a pass). */
    settled: async () => { await queue; await hearing; await refreshing; await queue; }
  };
  return api;
}
