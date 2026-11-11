import { withoutRetiredSettings } from '../state/retired-keys.js';

export const SETTINGS_RECORD_ID = 'settings';
const DAY_RECORD_PREFIX = 'day:';
const DAY_KEY_RE = /^daily-planner:(\d{4}-\d{2}-\d{2})$/;

/**
 * What a record syncs as, compared, sent and applied (1.39): the settings without the fields of the paid add-on of
 * earlier releases (../state/retired-keys.js), so the settings of a device that still keeps them and of one that has
 * dropped them are the same record. Every other record syncs as it is kept.
 */
export const syncedValue = (recordId, value) => (recordId === SETTINGS_RECORD_ID ? withoutRetiredSettings(value) : value);

export function plannerKeyToRecordId(key) {
  if (key === 'daily-planner:settings') return SETTINGS_RECORD_ID;
  const match = String(key || '').match(DAY_KEY_RE);
  return match ? `${DAY_RECORD_PREFIX}${match[1]}` : '';
}

export function recordIdToPlannerKey(recordId) {
  if (recordId === SETTINGS_RECORD_ID) return 'daily-planner:settings';
  if (/^day:\d{4}-\d{2}-\d{2}$/.test(recordId || '')) return `daily-planner:${recordId.slice(DAY_RECORD_PREFIX.length)}`;
  return '';
}

export function plannerRecordIds(store) {
  return store.keys('daily-planner:')
    .map(plannerKeyToRecordId)
    .filter(Boolean)
    .sort();
}

export function readPlannerRecord(store, recordId) {
  const key = recordIdToPlannerKey(recordId);
  if (!key) return null;
  const raw = store.get(key);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}
