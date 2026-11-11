import { contentHash } from './hash.js';
import { SETTINGS_RECORD_ID, plannerRecordIds, readPlannerRecord, syncedValue } from './records.js';

export const SYNC_DOCUMENT_VERSION = 1;

export async function localSyncRecords(store, ledger) {
  const ids = new Set(plannerRecordIds(store));
  const ledgerState = ledger.read();
  Object.entries(ledgerState.records || {}).forEach(([recordId, entry]) => {
    if (entry?.deletedAt) ids.add(recordId);
  });

  const records = {};
  for (const recordId of [...ids].sort()) {
    const entry = ledger.entry(recordId) || {};
    if (entry.deletedAt) {
      const payload = { deleted: true, deletedAt: entry.deletedAt };
      records[recordId] = {
        updatedAt: entry.dirtyAt || entry.deletedAt,
        deletedAt: entry.deletedAt,
        hash: await contentHash(payload),
        value: null
      };
      continue;
    }
    const value = readPlannerRecord(store, recordId);
    if (value == null) continue;
    records[recordId] = await asSynced(recordId, {
      updatedAt: entry.dirtyAt || new Date(0).toISOString(),
      deletedAt: null,
      hash: await contentHash(value),
      value
    });
  }
  return records;
}

/**
 * A record as it syncs (./records.js syncedValue()), hashed as such. When the form it is kept in differs (settings that
 * still hold the fields of the paid add-on of earlier releases), `storedHash` is the hash of that form: the one bases
 * agreed on before 1.39 were made from (./merge.js agreedBase()). It is only compared, never written to the copy.
 */
async function asSynced(recordId, record) {
  if (!record || record.deletedAt) return record;
  const value = syncedValue(recordId, record.value);
  if (value === record.value) return record;
  return { ...record, value, hash: await contentHash(value), storedHash: record.hash };
}

/** The records of the copy as they sync: compared and applied so; the copy keeps its own until this device sends one. */
export async function syncedRecords(records = {}) {
  const view = {};
  for (const [recordId, record] of Object.entries(records)) view[recordId] = await asSynced(recordId, record);
  return view;
}

/** A record as the copy holds it: what this device sends. */
export const documentRecord = ({ updatedAt, deletedAt, hash, value }) => ({ updatedAt, deletedAt, hash, value });

/**
 * 1.39, as the planner starts: a base agreed on before 1.39 was made from the settings with the fields of the paid
 * add-on still in them. While the settings are still as agreed (not changed since), the base is restated without
 * those fields, so the next save, which drops them, is taken only for what it really changes. Only this device's
 * ledger is written, never the settings. Reads what it needs at once, so a save made meanwhile changes nothing here.
 */
export async function restateRetiredBase(store, ledger) {
  try {
    const entry = ledger.entry(SETTINGS_RECORD_ID);
    const kept = readPlannerRecord(store, SETTINGS_RECORD_ID);
    const value = syncedValue(SETTINGS_RECORD_ID, kept);
    if (!entry?.lastSyncedHash || entry.dirtyAt || entry.deletedAt || kept == null || value === kept) return false;
    if (await contentHash(kept) !== entry.lastSyncedHash) return false;
    return ledger.restateBase(SETTINGS_RECORD_ID, { from: entry.lastSyncedHash, to: await contentHash(value) });
  } catch {
    return false;
  }
}

/**
 * The sync document. Beside the records (1.38, inside the seal): `copyId`, which copy this is, made anew each time a
 * copy is first sealed or started over (src/sync/protection.js), and `movedTo`, the cloud the person moved this
 * planner to (“Switch to Dropbox”), so the devices still on this one offer to follow. Both left out when not set.
 */
export function createSyncDocument(records = {}, { now = () => new Date(), copyId = '', copyFrom = '', movedTo = '' } = {}) {
  return {
    app: 'Daily Planner',
    kind: 'personal-sync',
    version: SYNC_DOCUMENT_VERSION,
    updatedAt: now().toISOString(),
    ...(copyId ? { copyId, copyFrom: copyFrom || 'new' } : {}),
    ...(movedTo ? { movedTo } : {}),
    records
  };
}

export function normalizeSyncDocument(raw) {
  if (!raw || raw.app !== 'Daily Planner' || raw.kind !== 'personal-sync' || raw.version !== SYNC_DOCUMENT_VERSION || typeof raw.records !== 'object') {
    return createSyncDocument({});
  }
  const records = {};
  for (const [recordId, record] of Object.entries(raw.records)) {
    if (!record || typeof record.hash !== 'string') continue;
    records[recordId] = {
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : null,
      hash: record.hash,
      value: record.deletedAt ? null : record.value
    };
  }
  return { ...raw, records };
}
