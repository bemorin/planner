/**
 * Changes that span several keys, written so that a full browser never loses what they move (1.39.4): a block dragged
 * across the Week or moved to another date in its editor, Close day carrying items to later days and to Later, and
 * Unresolved's Plan and Save.
 *
 * Where things go is written first (the target days, then the settings that hold Later), and where they come from
 * last (the source day, which then no longer lists them). When the browser refuses a write (its storage full), each
 * write made before it gets its previous string back, so it is all or nothing: never an item on no day, never one on
 * two. The refused write reaches the storage notice through the store's onWrite, as any other.
 */

/**
 * Writes `entries` ([key, value] pairs) in that order, all or nothing.
 *
 * - `saved(key)`: the string stored now (null when none), read just before the key is written;
 * - `write(key, value)`: stores it, false when refused;
 * - `put(key, raw)`: puts a previous string back (null removes the key). It always fits: it was there a moment ago,
 *   and the rest only got shorter since.
 *
 * Returns true once every write landed; false when one was refused, everything put back as it was.
 */
export function writeInOrder(entries, { saved, write, put }) {
  const done = [];
  for (const [key, value] of entries) {
    const before = saved(key);
    if (write(key, value) === false) {
      for (const [doneKey, raw] of done.reverse()) put(doneKey, raw);
      return false;
    }
    done.push([key, before]);
  }
  return true;
}

/**
 * A move from one day to another (a block in the Week or in its editor): the target day, then the source.
 *
 * - `read(key)`: the day to edit, a copy of its own (the day on screen too), never the one the planner shows;
 * - `change(source, target)`: edits the two (the same object when both keys are the same day); false: nothing to do;
 * - `saved`, `write`, `put`: as writeInOrder(), keyed by day.
 *
 * Returns 'moved' (both written: the caller shows the copies), 'refused' (nothing changed, in storage or on screen)
 * or 'none'.
 */
export function moveBetweenDays({ sourceKey, targetKey, read, change, ...writes }) {
  const source = read(sourceKey);
  const target = targetKey === sourceKey ? source : read(targetKey);
  if (change(source, target) === false) return 'none';
  const entries = targetKey === sourceKey ? [[targetKey, target]] : [[targetKey, target], [sourceKey, source]];
  return writeInOrder(entries, writes) ? 'moved' : 'refused';
}

/**
 * The planner's writes for such changes (app.js), so that nothing else writes in the middle of one or after it is
 * put back:
 *
 * - The retry of refused saves (app.js retryRefused(), which stores what memory holds) is held off while the writes
 *   and their rollback run (`hold`), and runs once (`retry`) after everything landed: otherwise a key put back, which
 *   frees room, could let it store the closed day of a Close day that was just undone.
 * - Personal sync's “changed” marks of the forward writes wait until the whole sequence landed (ledger.deferMarks());
 *   a key put back is written untracked and its mark dropped (ledger.undoMark()): restored, it is no change, and a
 *   day that didn't exist before leaves no tombstone. `onMarks(marked)` hears of the marks' one write.
 *
 * Returns writeInOrder()'s `saved`, `write`, `put`, with `guarded(fn)` (runs `fn` under both rules, returns what it
 * returned) and `commit(entries, apply)` (writeInOrder, guarded; once all landed, `apply()` shows the change, then
 * the retry runs; true, or false with everything as it was).
 */
export function createPlannerWrites({ store, ledger = null, hold = fn => fn(), retry = () => {}, onMarks = () => {} }) {
  const writes = {
    saved: key => store.get(key),
    write: (key, value) => store.writeJSON(key, value),
    put: (key, raw) => {
      ledger?.undoMark?.(key);
      return store.withoutMutationTracking(() => (raw == null ? store.remove(key) : store.set(key, raw)));
    }
  };
  const guarded = fn => hold(() => {
    if (!ledger?.deferMarks) return fn();
    const { value, marked } = ledger.deferMarks(fn);
    if (marked !== null) onMarks(marked);
    return value;
  });
  const commit = (entries, apply = null) => {
    const ok = guarded(() => writeInOrder(entries, writes));
    if (ok) {
      apply?.();
      retry();
    }
    return ok;
  };
  return { ...writes, guarded, commit, retry };
}
