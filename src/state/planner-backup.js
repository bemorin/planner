import { withoutRetiredSettings } from './retired-keys.js';

export function formatStorageBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Everything the planner keeps, as a backup file: its days and settings from `store`. With `live` ({ day, state,
 * settings }), the day on screen and the settings in memory are laid over what storage holds (1.39.3): a change the
 * browser refused to save (its storage full) is still in the file.
 */
export function buildPlannerBackup(store, { exportedAt = new Date().toISOString(), live = null } = {}) {
  const days = {};
  store.keys('daily-planner:').forEach(key => {
    if (key === 'daily-planner:settings') return;
    const day = key.replace('daily-planner:', '');
    const raw = store.get(key);
    try { days[day] = JSON.parse(raw); } catch (_) { days[day] = raw; }
  });
  let settings = null;
  try { settings = withoutRetiredSettings(store.readJSON('daily-planner:settings')); } catch (_) {}
  if (live?.day && live.state && typeof live.state === 'object') days[live.day] = JSON.parse(JSON.stringify(live.state));
  if (live?.settings && typeof live.settings === 'object') settings = withoutRetiredSettings(JSON.parse(JSON.stringify(live.settings)));
  // Version 13, as in 1.38: a 1.39 backup imports into 1.38 unchanged, and the other way round.
  return { app: 'Daily Planner', version: 13, exportedAt, settings, days };
}

/**
 * The backup's file name (1.40): daily-planner-backup-YYYY-MM-DD.json, and …-recent-days.json when older days are in
 * this browser's database and can't be read now (the archive 'unavailable' or 'lost'): the file then says what it is.
 */
export const backupFileName = (day, archive = 'none') => `daily-planner-backup-${day}${archive === 'unavailable' || archive === 'lost' ? '-recent-days' : ''}.json`;
export const RECENT_DAYS_BACKUP = 'Your older days are kept in this browser’s database, which can’t be read right now, so this backup has your recent days only. Reload the planner and export again to include them.';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Room an import keeps free while it writes (1.39.4), so the planner can still save afterwards: today's changes, the
 * settings, and Personal sync's “changed” mark for each day imported, all written once the import is done. It is held
 * by a placeholder key (outside the planner's data: never backed up or synced) and given back at the end. 5% of the
 * browser's budget at least, and about 64 characters a day for the marks, counted ahead in steps of IMPORT_STEP days.
 */
export const IMPORT_ROOM_KEY = 'daily-planner-ui:import-room';
export const IMPORT_ROOM_SHARE = 0.05;
const IMPORT_ROOM_MIN = 65536;
const MARK_CHARS = 64;
const IMPORT_STEP = 200;

/**
 * Import backup (1.39.4): writes the backup's settings, then its days, newest first, and counts what it stored and
 * what it didn't, so an import that couldn't keep everything is never told complete. It stops writing older days once
 * the room left is down to the margin above (or once the browser refuses a day): those days count as refused too, and
 * storage keeps room for what comes next. When room runs out, the settings and the most recent days are the ones
 * kept. Each day replaces the one of the same date; other days stay as they are.
 *
 * `budget`: the browser's quota in characters (./storage-health.js storageBudget()), for the margin.
 * Returns { days, stored, refused: [dates not stored, newest first], settings: 'stored' | 'refused' | 'none' }.
 */
export function importPlannerBackup(store, backup, { budget = 2621440 } = {}) {
  let settings = 'none';
  if (backup?.settings && typeof backup.settings === 'object') {
    settings = store.writeJSON('daily-planner:settings', withoutRetiredSettings(backup.settings)) === false ? 'refused' : 'stored';
  }
  const dates = Object.keys(backup?.days || {}).filter(day => DAY.test(day)).sort().reverse();
  const margin = Math.max(Math.round(budget * IMPORT_ROOM_SHARE), IMPORT_ROOM_MIN);
  const hold = landed => store.set(IMPORT_ROOM_KEY, ' '.repeat(margin + MARK_CHARS * (landed + IMPORT_STEP))) !== false;
  // A margin that can't be held: storage is already that full, and no day is written.
  let stored = 0;
  const refused = [];
  try {
    let room = dates.length ? hold(0) : false;
    let heldFor = IMPORT_STEP;
    for (const day of dates) {
      if (room && stored >= heldFor) { room = hold(stored); heldFor = stored + IMPORT_STEP; }
      if (!room) { refused.push(day); continue; }
      if (store.writeJSON(`daily-planner:${day}`, backup.days[day]) === false) {
        room = false;
        refused.push(day);
        continue;
      }
      stored += 1;
    }
  } finally {
    // Given back however the import ends; one left by a tab closed in the middle goes at the next start, or with Reset.
    store.remove(IMPORT_ROOM_KEY);
  }
  return { days: dates.length, stored, refused, settings };
}

const number = n => n.toLocaleString('en');
const daysCount = n => `${number(n)} ${n === 1 ? 'day' : 'days'}`;
const were = n => (n === 1 ? 'was' : 'were');

/**
 * What Import says once it is done (importPlannerBackup()'s result): `complete` when everything was stored, which
 * needs no words; otherwise `text`, in plain words: what was imported, and what wasn't.
 */
export function importReport({ days = 0, stored = 0, refused = [], settings = 'none' } = {}) {
  if (!refused.length && settings !== 'refused') return { complete: true, text: '' };
  const lead = 'This browser is out of space for your planner, so';
  const tail = 'Your backup file still has everything.';
  if (!stored && settings !== 'stored') return { complete: false, text: `${lead} nothing from this backup could be imported. ${tail}` };
  const daysPart = !days ? ''
    : !refused.length ? `all its ${daysCount(days)} ${were(days)} imported`
      : !stored ? `none of its ${daysCount(days)} could be imported`
        : `${number(stored)} of its ${daysCount(days)} ${were(stored)} imported, and ${number(refused.length)} ${refused.length === 1 ? 'wasn’t' : 'weren’t'}`;
  const settingsPart = settings === 'refused' ? 'its settings weren’t imported' : settings === 'stored' && !stored ? 'its settings were imported' : '';
  return { complete: false, text: `${lead} only part of this backup was imported: ${[daysPart, settingsPart].filter(Boolean).join('; ')}. ${tail}` };
}
