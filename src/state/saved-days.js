import { normalizeDayState } from './day-state.js';

const DAY_KEY = /^daily-planner:(\d{4}-\d{2}-\d{2})$/;

/**
 * Every saved day, parsed and normalised, for the readers that need them all at once: Search at each keystroke,
 * Unresolved, the floating window and the week review (1.39.4). A day is parsed again only when the string stored
 * for it changed since the last read; a day removed is forgotten. Nothing is told of changes: a write here, a sync
 * pull, another tab, all simply store another string. With 10,000 days, a keystroke then costs what the days it
 * changed cost, not every day again.
 *
 * What read() hands out is shared between readers until its day changes: read it, never change it (a day to edit
 * is loaded on its own, as loadStateForDate() does).
 */
export function createSavedDays(store, { normalize = normalizeDayState } = {}) {
  const cache = new Map();
  let parses = 0;

  /**
   * The saved days, newest first, as [key, day] pairs: the day on screen (`liveDay`) as the planner holds it
   * (`liveState`), never from storage. Each day is the cache's own object, shared with every later read until its
   * string changes: read it, never change it (tests freeze them to be sure, tests/history-readers.test.js).
   */
  const read = ({ liveDay = '', liveState = null } = {}) => {
    const days = new Map();
    const seen = new Set();
    let keys = [];
    try { keys = store.keys('daily-planner:'); } catch (_) {}
    for (const key of keys) {
      const day = DAY_KEY.exec(key)?.[1];
      if (!day) continue;
      seen.add(day);
      const raw = store.get(key);
      let entry = cache.get(day);
      if (!entry || entry.raw !== raw) {
        // As store.readJSON() reads it: a string that isn't JSON is no record (a blank day once normalised).
        let record = null;
        try { record = raw == null ? null : JSON.parse(raw); } catch (_) { record = null; }
        let value = null;
        try { value = normalize(record, day); } catch (_) { value = null; }
        parses += 1;
        entry = { raw, value };
        cache.set(day, entry);
      }
      if (entry.value) days.set(day, entry.value);
    }
    for (const day of cache.keys()) if (!seen.has(day)) cache.delete(day);
    if (liveDay && liveState) days.set(liveDay, liveState);
    return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  };

  return {
    read,
    /** How many days were parsed since this was made (tests and scripts/perf-history.mjs). */
    stats: () => ({ parses, cached: cache.size }),
    /** Lets go of every parsed day (the next read parses them again). */
    clear: () => cache.clear()
  };
}
