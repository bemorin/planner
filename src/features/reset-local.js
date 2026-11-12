/**
 * Reset local data (1.40.1): it touches only this browser. The copy in Dropbox or Google Drive and the other devices
 * keep everything.
 *
 * 1. Personal sync is turned off here first, when connected (src/features/personal-sync.js forgetHere()): a sync under
 *    way finishes, none starts, and the connection, both clouds' access and the seal's key material go. The copy is
 *    never written or deleted from.
 * 2. Every saved day in both homes (localStorage and the archive's database, src/state/day-store.js clearAll()), the
 *    settings and the planner's other keys go without a mutation: no tombstone, nothing for any sync to send.
 * 3. The sync ledger is cleared, connected or not, so a later first connection to an existing copy deletes nothing
 *    from it (the engine only deletes what has a base here) and brings the plans back.
 * 4. The recovery snapshots go too (the one before older days first moved, those before changes from sync, at a
 *    conflict): they hold days, and the dialog says every saved day goes from this browser.
 */

/**
 * Said in the Reset dialog while another planner tab is open (1.40.1): that tab, of whatever release, could bring
 * everything back (its sync under way pulls the planner in again, and a tab of 1.40.0 or earlier never stands down).
 */
export const OTHER_TABS_LINE = 'The planner is open in another tab. Close it there first, then reset.';

/** The Reset dialog's line when Personal sync is connected: `name` is the cloud's (“Dropbox”, “Google Drive”). */
export const resetSyncLine = name => `Personal sync is turned off in this browser. Your copy in ${name} and your other devices keep everything; connect again to bring your plans back.`;

/** What the Reset dialog adds for Personal sync's state ({ connected, name }): the line, or '' when not connected. */
export function resetSyncNote({ connected = false, name = '' } = {}) {
  return connected && name ? resetSyncLine(name) : '';
}

/**
 * The Reset dialog as it opens, and again as Reset is asked for: Personal sync's line, and whether Reset may run now
 * (refused, with OTHER_TABS_LINE, while another planner tab is open; Export stays). `modal`: the dialog; `sync`:
 * Personal sync (getState(), provider); `otherTabs`: whether another planner tab is open. Resolves to true when it may.
 */
export async function refreshResetDialog({ modal, sync = null, otherTabs = async () => false } = {}) {
  const note = modal?.querySelector?.('[data-reset-sync-note]');
  const blocked = modal?.querySelector?.('[data-reset-blocked]');
  const state = sync?.getState?.();
  if (note) {
    note.textContent = resetSyncNote({ connected: !!(state?.configured && state.connected), name: sync?.provider?.name });
    note.hidden = !note.textContent;
  }
  let others = false;
  try { others = !!(await otherTabs()); } catch (_) { others = false; }
  if (blocked) {
    blocked.textContent = others ? OTHER_TABS_LINE : '';
    blocked.hidden = !others;
  }
  return !others;
}

/**
 * Resets this browser. `store`: the day store; `ledger`: the sync ledger; `sync`: Personal sync (its forgetHere());
 * `keys`: other planner keys to remove (outside `daily-planner:`); `forgetSnapshots`: removes the recovery snapshots;
 * `otherTabs`: whether another planner tab is open, in which case nothing is done ({ refused: true }).
 * Returns { removed (keys), cloud (the name of the cloud sync was turned off for, or ''), snapshots }.
 */
export async function resetLocalData({ store, ledger, sync = null, keys = [], forgetSnapshots = async () => 0, otherTabs = async () => false } = {}) {
  let others = false;
  try { others = !!(await otherTabs()); } catch (_) { others = false; }
  if (others) return { refused: true, removed: 0, cloud: '', snapshots: 0 };
  let cloud = '';
  try { cloud = (await sync?.forgetHere?.()) || ''; } catch (_) { cloud = ''; }
  const removed = await store.clearAll('daily-planner:');
  store.withoutMutationTracking(() => keys.forEach(key => store.remove(key)));
  // Again, with the days gone: room for the new generation now, even in a browser that was full.
  try { ledger?.reset?.(); } catch (_) {}
  let snapshots = 0;
  try { snapshots = (await forgetSnapshots()) || 0; } catch (_) { snapshots = 0; }
  return { removed, cloud, snapshots };
}
