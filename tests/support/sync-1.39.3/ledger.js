// Frozen: src/sync/ledger.js as 1.39.3 shipped it (main at 214b27f), only its imports pointed back at src/. Tests run
// it to prove that what 1.39.4 writes still reads the same in 1.39.x (tests/sync-ledger.test.js), and
// scripts/perf-history.mjs measures it as the “before”. Never edit it.
import { plannerKeyToRecordId } from '../../../src/sync/records.js';

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

export function createSyncLedger(storage = localStorage, { now = () => new Date() } = {}) {
  const read = () => {
    const parsed = safeParse(storage.getItem(LEDGER_KEY), null);
    if (!parsed || parsed.version !== VERSION || typeof parsed.records !== 'object') return { version: VERSION, records: {} };
    return parsed;
  };

  const write = ledger => storage.setItem(LEDGER_KEY, JSON.stringify(ledger));

  // “Changed” marks the browser refused to store (its storage full), held here and written with the next one, so a
  // change saved on this device is still sent. Until then they count as changes waiting (entry(), dirtyEntries(),
  // so the automatic sync sees them), and a mark whose record is synced or forgotten meanwhile is dropped: a stale
  // one (a deletion above all) is never written over what was agreed on since.
  const unwritten = new Map();
  // What recordMutation last wrote ({ raw, at: id → { time, removed } }), to leave a day marked moments ago alone.
  let lastMarked = null;
  const records = () => {
    const stored = read().records;
    if (!unwritten.size) return stored;
    const merged = { ...stored };
    for (const [id, mark] of unwritten) merged[id] = { ...(merged[id] || {}), ...mark };
    return merged;
  };

  /**
   * Notes that a planner key changed here (dirty, or deleted), to be sent at the next sync. Returns true once the
   * mark is stored, false when the browser refused it (it is kept and written with the next), null for a key
   * Personal sync doesn't carry. Never throws.
   */
  const recordMutation = mutation => {
    const recordId = plannerKeyToRecordId(mutation?.key);
    if (!recordId) return null;
    const removed = mutation.type === 'remove';
    // Typing saves a day every few hundred milliseconds. A day this function marked changed less than
    // REMARK_MS ago, in a ledger nobody has written since (the very string it wrote), is left as it is: the whole
    // ledger is not parsed and written again at each keystroke (1.39.3).
    const raw = storage.getItem(LEDGER_KEY);
    const known = lastMarked && raw === lastMarked.raw && !unwritten.size ? lastMarked.at.get(recordId) : null;
    if (known && !removed && known.removed === false && now().getTime() - known.time < REMARK_MS) return true;
    unwritten.set(recordId, { dirtyAt: nowIso(now), deletedAt: removed ? nowIso(now) : null });
    const ledger = safeParse(raw, null);
    const next = !ledger || ledger.version !== VERSION || typeof ledger.records !== 'object' ? { version: VERSION, records: {} } : ledger;
    for (const [id, mark] of unwritten) next.records[id] = { ...(next.records[id] || {}), ...mark };
    const text = JSON.stringify(next);
    try {
      storage.setItem(LEDGER_KEY, text);
    } catch (_) {
      lastMarked = null;
      return false;
    }
    const time = now().getTime();
    const at = lastMarked && raw === lastMarked.raw ? lastMarked.at : new Map();
    for (const [id, mark] of unwritten) at.set(id, { time, removed: !!mark.deletedAt });
    lastMarked = { raw: text, at };
    unwritten.clear();
    return true;
  };

  const entry = recordId => records()[recordId] || null;

  const dirtyEntries = () => Object.entries(records()).filter(([, record]) => !!record?.dirtyAt);

  const hasDirty = () => dirtyEntries().length > 0;

  const oldestDirtyAt = () => {
    const stamps = dirtyEntries().map(([, record]) => Date.parse(record.dirtyAt)).filter(Number.isFinite);
    if (!stamps.length) return null;
    return new Date(Math.min(...stamps)).toISOString();
  };

  const markSynced = (recordId, { hash, deletedAt = null } = {}) => {
    unwritten.delete(recordId);
    const ledger = read();
    ledger.records[recordId] = {
      ...(ledger.records[recordId] || {}),
      lastSyncedHash: hash || null,
      dirtyAt: null,
      deletedAt: deletedAt || null,
      syncedAt: nowIso(now)
    };
    write(ledger);
  };

  const markRemoteApplied = (recordId, { hash, deletedAt = null } = {}) => markSynced(recordId, { hash, deletedAt });

  /** The same base, hashed another way (./document.js restateRetiredBase()): only while it is still `from`; nothing else changes. */
  const restateBase = (recordId, { from, to } = {}) => {
    const ledger = read();
    const record = ledger.records[recordId];
    if (!record || !from || !to || record.lastSyncedHash !== from) return false;
    record.lastSyncedHash = to;
    write(ledger);
    return true;
  };

  const forgetRecord = recordId => {
    unwritten.delete(recordId);
    const ledger = read();
    delete ledger.records[recordId];
    write(ledger);
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
  const copy = () => {
    const stored = read().copy;
    if (stored && typeof stored === 'object') return { cloud: CLOUD_IDS.includes(stored.cloud) ? stored.cloud : '', id: typeof stored.id === 'string' ? stored.id : '' };
    const google = safeParse(storage.getItem(`${PROVIDER_PREFIX}google`), null);
    return google?.lastSyncedAt ? { cloud: 'google', id: '' } : null;
  };
  const setCopy = (next = {}) => {
    const ledger = read();
    ledger.copy = { cloud: CLOUD_IDS.includes(next?.cloud) ? next.cloud : '', id: String(next?.id || '') };
    write(ledger);
  };

  /**
   * Another copy (a switch to another cloud, or a copy started over): what was agreed on with the previous
   * one says nothing about this one, so each record is compared as at a first sync (what differs stops as a
   * conflict; what is the same on both sides is simply agreed on). Changes waiting and deletions stay.
   */
  const resetBases = (next = { cloud: '', id: '' }) => {
    const ledger = read();
    Object.values(ledger.records).forEach(record => { if (record) delete record.lastSyncedHash; });
    ledger.copy = { cloud: CLOUD_IDS.includes(next?.cloud) ? next.cloud : '', id: String(next?.id || '') };
    write(ledger);
  };

  const reset = () => {
    unwritten.clear();
    storage.removeItem(LEDGER_KEY);
    CLOUD_IDS.forEach(id => storage.removeItem(providerKey(id)));
    storage.removeItem(CLOUD_KEY);
  };

  /** What the bases are now, with the copy they belong to: kept aside before a switch of cloud (createScratchLedger()). */
  const snapshot = () => ({ ...read(), copy: copy() });

  return {
    entry,
    read,
    snapshot,
    recordMutation,
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
