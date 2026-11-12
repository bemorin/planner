import { plannerKeyToRecordId } from './records.js';

const LEDGER_KEY = 'daily-planner-sync:ledger';
// Each cloud's state on this device (connected, last sync, last error): daily-planner-sync:google
// (since 1.20) and daily-planner-sync:dropbox (1.38). Which one this device syncs with:
// daily-planner-sync:cloud, absent before 1.38, when Google Drive was the only one.
const PROVIDER_PREFIX = 'daily-planner-sync:';
const CLOUD_KEY = 'daily-planner-sync:cloud';
const CLOUD_IDS = ['google', 'dropbox'];
const VERSION = 1;
/** A day changed again within this time of its last mark keeps that mark (dirtyAt): typing doesn't rewrite the ledger. */
const REMARK_MS = 30 * 1000;

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

/**
 * A record's entry as the ledger keeps it (1.39.4, still format 1): `dirtyAt` and `deletedAt` only when set, and no
 * `syncedAt` (written by earlier releases, never read). Every release reads a missing field as it read null, so the
 * entries of 1.39.3 and these read the same everywhere. Up to 1.39.3 an entry was about 173 characters once synced
 * (74 never synced); compact, about 103 (56). Returns `entry` itself when it is compact already.
 */
export function compactEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (!('syncedAt' in entry) && entry.dirtyAt !== null && entry.deletedAt !== null) return entry;
  const { syncedAt: _syncedAt, ...kept } = entry;
  if (kept.dirtyAt == null) delete kept.dirtyAt;
  if (kept.deletedAt == null) delete kept.deletedAt;
  return kept;
}

/** An entry as callers read it: `dirtyAt` and `deletedAt` always there, null when not set. */
const fullEntry = entry => (entry ? { ...entry, dirtyAt: entry.dirtyAt || null, deletedAt: entry.deletedAt || null } : null);

/** `entry` with a “changed” mark: dirty since `dirtyAt`, deleted at `deletedAt` (a set clears a deletion). */
function markedEntry(entry, { dirtyAt, deletedAt }) {
  const next = { ...(entry || {}), dirtyAt };
  if (deletedAt) next.deletedAt = deletedAt;
  else delete next.deletedAt;
  return compactEntry(next);
}

/** `entry` agreed on: the same on this device and in the copy, with `hash` (a tombstone when `deletedAt`). */
function syncedEntry(entry, { hash, deletedAt = null } = {}) {
  const next = { ...(entry || {}), lastSyncedHash: hash || null };
  delete next.dirtyAt;
  delete next.syncedAt;
  if (deletedAt) next.deletedAt = deletedAt;
  else delete next.deletedAt;
  return next;
}

const copyOf = next => ({ cloud: CLOUD_IDS.includes(next?.cloud) ? next.cloud : '', id: String(next?.id || '') });

/** The same bases, forgotten (another copy): every entry without `lastSyncedHash`, as new objects. */
function withoutBases(records) {
  const next = {};
  for (const [recordId, record] of Object.entries(records)) {
    if (record && 'lastSyncedHash' in record) {
      const { lastSyncedHash: _base, ...kept } = record;
      next[recordId] = kept;
    } else next[recordId] = record;
  }
  return next;
}

/**
 * Whether the copy just read is the one this device's bases were agreed on with (1.38). `last`: what the ledger
 * remembers, { cloud, id } (id '' for a copy without one: a plain copy from before 1.38), or null when this device
 * never synced. `copy`: what the transport found, { cloud, format, id, from } (src/sync/protection.js).
 *
 * - The same cloud and the same copyId: the same copy.
 * - A copy without an id (plain), on the cloud this device last synced a copy without an id: the same copy.
 * - The first sight of an id, on the cloud this device last synced a copy without an id, and minted by sealing
 *   that copy (`from: 'continued'`): the same copy, carried on sealed. Minted by starting over ('replaced') or
 *   for a new file ('new'): another copy.
 * - Anything else (another id, another cloud, a device that never synced): another copy.
 */
export function sameCopy(last, copy) {
  if (!last?.cloud || !copy?.cloud || last.cloud !== copy.cloud) return false;
  const lastId = String(last.id || '');
  const id = String(copy.id || '');
  if (lastId) return lastId === id;
  return !id || copy.from === 'continued';
}

function nowIso(now = () => new Date()) {
  return now().toISOString();
}

/**
 * A ledger in memory, as another one was (its snapshot()): to merge once more with the copy a device is leaving,
 * with the bases agreed on with that copy, without touching the device's own ledger (Switch to Dropbox).
 */
export function createScratchLedger(state = null, options = {}) {
  const data = new Map();
  const storage = { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, String(value)); }, removeItem: key => { data.delete(key); } };
  if (state && typeof state === 'object') storage.setItem(LEDGER_KEY, JSON.stringify({ version: VERSION, records: state.records || {}, copy: state.copy || { cloud: '', id: '' } }));
  return createSyncLedger(storage, options);
}

/**
 * This device's sync ledger: for each record, the base agreed on with the copy (`lastSyncedHash`) and the changes
 * waiting (`dirtyAt`, `deletedAt`), in one localStorage key, `daily-planner-sync:ledger`.
 *
 * With years of history it holds thousands of entries (1.39.4): it is parsed only when the string stored differs from
 * the one this ledger last read or wrote, a sync reads it once (session()) and writes its marks in one go, and an
 * import of many days writes its “changed” marks once (deferMarks()). What it parsed is never changed in place:
 * every change makes new objects, so a parse can be handed out and kept.
 */
export function createSyncLedger(storage = localStorage, { now = () => new Date() } = {}) {
  // The string last read or written, and what it holds (never changed in place).
  let cache = { raw: undefined, value: null };
  const read = (raw = storage.getItem(LEDGER_KEY)) => {
    if (raw === cache.raw && cache.value) return cache.value;
    const parsed = safeParse(raw, null);
    let value = { version: VERSION, records: {} };
    if (parsed && parsed.version === VERSION && parsed.records && typeof parsed.records === 'object') {
      const records = {};
      for (const [recordId, record] of Object.entries(parsed.records)) records[recordId] = compactEntry(record);
      value = { ...parsed, records };
    }
    cache = { raw, value };
    return value;
  };

  /** Writes `ledger` (its entries compact). Throws when the browser refuses it, as it always has. */
  const write = ledger => {
    const raw = JSON.stringify(ledger);
    storage.setItem(LEDGER_KEY, raw);
    cache = { raw, value: ledger };
  };

  /** Reads the ledger as it is now, lets `fn` change a copy of it (new entries, never the ones read), writes it. */
  const change = fn => {
    const current = read();
    const next = { ...current, records: { ...current.records } };
    const result = fn(next);
    if (result === false) return false;
    write(next);
    return true;
  };

  // “Changed” marks the browser refused to store (its storage full), held here and written with the next one, so a
  // change saved on this device is still sent. Until then they count as changes waiting (entry(), dirtyEntries(),
  // so the automatic sync sees them), and a mark whose record is synced or forgotten meanwhile is dropped: a stale
  // one (a deletion above all) is never written over what was agreed on since. Marks made under deferMarks() wait
  // here too, until it writes them all at once.
  const unwritten = new Map();
  let deferring = 0;
  // The marks held when the outermost deferMarks() began: what undoMark() goes back to.
  let heldBefore = null;
  // What recordMutation last wrote ({ raw, at: id → { time, removed } }), to leave a day marked moments ago alone.
  let lastMarked = null;
  const withHeld = stored => {
    if (!unwritten.size) return stored;
    const merged = { ...stored };
    for (const [id, mark] of unwritten) merged[id] = markedEntry(merged[id], mark);
    return merged;
  };
  const records = () => withHeld(read().records);

  /**
   * Writes the held marks over the ledger stored as `raw` (read now when not given). True once stored (or none
   * held), false when refused (they stay held). Never throws.
   */
  const flushMarks = (raw = storage.getItem(LEDGER_KEY)) => {
    if (!unwritten.size) return true;
    const current = read(raw);
    const next = { ...current, records: withHeld(current.records) };
    try {
      write(next);
    } catch (_) {
      lastMarked = null;
      return false;
    }
    const time = now().getTime();
    const at = lastMarked && raw === lastMarked.raw ? lastMarked.at : new Map();
    for (const [id, mark] of unwritten) at.set(id, { time, removed: !!mark.deletedAt });
    lastMarked = { raw: cache.raw, at };
    unwritten.clear();
    return true;
  };

  /**
   * Notes that a planner key changed here (dirty, or deleted), to be sent at the next sync. Returns true once the
   * mark is stored, false when the browser refused it (it is kept and written with the next), null for a key
   * Personal sync doesn't carry, or while deferMarks() holds the marks to write them at once. Never throws.
   */
  const recordMutation = mutation => {
    const recordId = plannerKeyToRecordId(mutation?.key);
    if (!recordId) return null;
    const removed = mutation.type === 'remove';
    const mark = { dirtyAt: nowIso(now), deletedAt: removed ? nowIso(now) : null };
    if (deferring) {
      unwritten.set(recordId, mark);
      return null;
    }
    // Typing saves a day every few hundred milliseconds. A day this function marked changed less than
    // REMARK_MS ago, in a ledger nobody has written since (the very string it wrote), is left as it is: the whole
    // ledger is not parsed and written again at each keystroke (1.39.3).
    const raw = storage.getItem(LEDGER_KEY);
    const known = lastMarked && raw === lastMarked.raw && !unwritten.size ? lastMarked.at.get(recordId) : null;
    if (known && !removed && known.removed === false && now().getTime() - known.time < REMARK_MS) return true;
    unwritten.set(recordId, mark);
    return flushMarks(raw);
  };

  /**
   * Runs `fn`, holding the “changed” marks its writes make, then writes them all at once (1.39.4): an import of
   * years of days writes the ledger once, not once per day. Returns { value: what `fn` returned, marked: true once
   * the marks are stored, false when the browser refused them (held, as any refused mark), null when there were none }.
   */
  const deferMarks = fn => {
    let value;
    let marked = null;
    if (!deferring) heldBefore = new Map(unwritten);
    deferring += 1;
    try {
      value = fn();
    } finally {
      deferring -= 1;
      if (!deferring) heldBefore = null;
      // Written even when `fn` throws: what it wrote before is marked.
      if (!deferring && unwritten.size) marked = flushMarks();
    }
    return { value, marked };
  };

  /**
   * Inside deferMarks(): forgets the mark a planner key got since it began, because that write was put back (1.39.4,
   * src/state/day-move.js): a key restored is no change, and a day that didn't exist leaves no tombstone. A mark held
   * from before (refused earlier) stays. Outside deferMarks(), nothing to forget: false.
   */
  const undoMark = key => {
    const recordId = plannerKeyToRecordId(key);
    if (!deferring || !recordId) return false;
    if (heldBefore.has(recordId)) unwritten.set(recordId, heldBefore.get(recordId));
    else unwritten.delete(recordId);
    return true;
  };

  const entry = recordId => fullEntry(records()[recordId]);

  const dirtyEntries = () => Object.entries(records()).filter(([, record]) => !!record?.dirtyAt);

  const hasDirty = () => dirtyEntries().length > 0;

  const oldestDirtyAt = () => {
    const stamps = dirtyEntries().map(([, record]) => Date.parse(record.dirtyAt)).filter(Number.isFinite);
    if (!stamps.length) return null;
    return new Date(Math.min(...stamps)).toISOString();
  };

  const markSynced = (recordId, { hash, deletedAt = null } = {}) => {
    unwritten.delete(recordId);
    change(ledger => { ledger.records[recordId] = syncedEntry(ledger.records[recordId], { hash, deletedAt }); });
  };

  const markRemoteApplied = (recordId, { hash, deletedAt = null } = {}) => markSynced(recordId, { hash, deletedAt });

  /** The same base, hashed another way (./document.js restateRetiredBase()): only while it is still `from`; nothing else changes. */
  const restateBase = (recordId, { from, to } = {}) => change(ledger => {
    const record = ledger.records[recordId];
    if (!record || !from || !to || record.lastSyncedHash !== from) return false;
    ledger.records[recordId] = { ...record, lastSyncedHash: to };
    return true;
  });

  const forgetRecord = recordId => {
    unwritten.delete(recordId);
    change(ledger => { delete ledger.records[recordId]; });
  };

  const cloud = () => {
    const stored = storage.getItem(CLOUD_KEY);
    return CLOUD_IDS.includes(stored) ? stored : 'google';
  };
  const setCloud = id => { if (CLOUD_IDS.includes(id)) storage.setItem(CLOUD_KEY, id); };
  /**
   * The cloud this device has named, or '' when it never chose one: the saved choice (1.38), or Google Drive
   * for a device that synced with it before there was a choice.
   */
  const chosenCloud = () => {
    const stored = storage.getItem(CLOUD_KEY);
    if (CLOUD_IDS.includes(stored)) return stored;
    const google = safeParse(storage.getItem(`${PROVIDER_PREFIX}google`), null);
    return google && (google.connected || google.lastSyncedAt) ? 'google' : '';
  };
  const providerKey = id => `${PROVIDER_PREFIX}${CLOUD_IDS.includes(id) ? id : cloud()}`;

  const provider = (id = cloud()) => safeParse(storage.getItem(providerKey(id)), { connected: false, fileId: '', lastSyncedAt: '', lastError: '' });
  const saveProvider = (patch, id = cloud()) => {
    const next = { ...provider(id), ...patch };
    storage.setItem(providerKey(id), JSON.stringify(next));
    return next;
  };

  /**
   * The copy the bases were agreed on with (1.38): { cloud, id }, stored in the ledger beside them. A ledger
   * from before 1.38 has none: it synced the plain Google Drive copy, the only one there was.
   */
  const storedCopy = ledger => {
    const stored = ledger.copy;
    if (stored && typeof stored === 'object') return { cloud: CLOUD_IDS.includes(stored.cloud) ? stored.cloud : '', id: typeof stored.id === 'string' ? stored.id : '' };
    const google = safeParse(storage.getItem(`${PROVIDER_PREFIX}google`), null);
    return google?.lastSyncedAt ? { cloud: 'google', id: '' } : null;
  };
  const copy = () => storedCopy(read());
  const setCopy = (next = {}) => { change(ledger => { ledger.copy = copyOf(next); }); };

  /**
   * Another copy (a switch to another cloud, or a copy started over): what was agreed on with the previous
   * one says nothing about this one, so each record is compared as at a first sync (what differs stops as a
   * conflict; what is the same on both sides is simply agreed on). Changes waiting and deletions stay.
   */
  const resetBases = (next = { cloud: '', id: '' }) => {
    change(ledger => {
      ledger.records = withoutBases(ledger.records);
      ledger.copy = copyOf(next);
    });
  };

  /**
   * One sync's ledger (1.39.4): read once as the sync starts, then everything the sync notes (bases agreed on, bases
   * reset, the copy) is seen at once by its own reads and written by commit(), in one write, over the ledger as it is
   * by then: a change marked meanwhile (typing, another tab) stays. Its reads never touch storage. commit() throws
   * when the browser refuses the write, as each mark did before.
   */
  const session = () => {
    const stored = read();
    let view = withHeld(stored.records);
    let owned = view !== stored.records;
    let current = storedCopy(stored);
    let explicitCopy = !!(stored.copy && typeof stored.copy === 'object');
    let ops = [];
    const own = () => { if (!owned) { view = { ...view }; owned = true; } };
    const mark = (recordId, base) => {
      own();
      view[recordId] = syncedEntry(view[recordId], base);
      ops.push(ledger => { unwritten.delete(recordId); ledger.records[recordId] = syncedEntry(ledger.records[recordId], base); });
    };
    return {
      read: () => ({ version: VERSION, records: view }),
      entry: recordId => fullEntry(view[recordId]),
      copy: () => current,
      markSynced: (recordId, { hash, deletedAt = null } = {}) => mark(recordId, { hash, deletedAt }),
      markRemoteApplied: (recordId, { hash, deletedAt = null } = {}) => mark(recordId, { hash, deletedAt }),
      resetBases: (next = { cloud: '', id: '' }) => {
        view = withoutBases(view);
        owned = true;
        current = copyOf(next);
        explicitCopy = true;
        const to = current;
        ops.push(ledger => { ledger.records = withoutBases(ledger.records); ledger.copy = to; });
      },
      /** The copy these bases now belong to; nothing to write when the ledger already names it. */
      setCopy: (next = {}) => {
        const to = copyOf(next);
        if (explicitCopy && current?.cloud === to.cloud && current?.id === to.id) return;
        current = to;
        explicitCopy = true;
        ops.push(ledger => { ledger.copy = to; });
      },
      /** Writes what was noted since the last commit, if anything (one read, one write). */
      commit: () => {
        if (!ops.length) return true;
        const pending = ops;
        ops = [];
        return change(ledger => { pending.forEach(op => op(ledger)); });
      }
    };
  };

  const reset = () => {
    unwritten.clear();
    storage.removeItem(LEDGER_KEY);
    cache = { raw: undefined, value: null };
    CLOUD_IDS.forEach(id => storage.removeItem(providerKey(id)));
    storage.removeItem(CLOUD_KEY);
  };

  /** What the bases are now, with the copy they belong to: kept aside before a switch of cloud (createScratchLedger()). Read-only, as read(). */
  const snapshot = () => ({ ...read(), copy: copy() });

  return {
    entry,
    /** The ledger as stored, parsed: shared with the cache and every caller, so read it, never change it. */
    read: () => read(),
    snapshot,
    session,
    recordMutation,
    deferMarks,
    undoMark,
    dirtyEntries,
    hasDirty,
    oldestDirtyAt,
    markSynced,
    markRemoteApplied,
    restateBase,
    forgetRecord,
    cloud,
    setCloud,
    chosenCloud,
    provider,
    saveProvider,
    copy,
    setCopy,
    resetBases,
    reset
  };
}
