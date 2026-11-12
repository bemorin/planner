import { esc, escAttr } from '../lib/text.js';
import { createRecoveryStore } from '../sync/recovery-store.js';
import { formatStorageBytes } from '../state/planner-backup.js';
import { storageUsageText } from './storage-alert.js';

/**
 * How it works → Data on this device, what this browser keeps besides the planner itself (1.40):
 *
 * - its figures: the planner's own data, every saved day, and the older ones kept in this browser's database, with
 *   about how much room that takes (navigator.storage.estimate(), which counts the offline copy too, so it is never
 *   used for the storage bar), and whether this browser keeps it for good (navigator.storage.persisted(), which the
 *   planner asks for once installed: src/features/archive-keeper.js);
 * - a Download for each recovery snapshot (src/sync/recovery-store.js: before changes from Personal sync are applied,
 *   at a sync conflict, before older days first moved) and for each earlier copy of a day kept aside (a tab that
 *   couldn't see the day saved over it). Each is a backup file that Import backup reads.
 * - a Restore for each earlier copy of a day kept aside: it puts that version back as the day, and keeps the version
 *   there now aside in its place (src/state/day-store.js restoreAside()), so restoring never throws one away; the copy
 *   restored stays in the list, marked so. While a planner tab of an older release is open (the roll call,
 *   src/features/archive-keeper.js olderTabOpen()), a line says it may save over the day again.
 */

/** Said next to Restore while a planner tab of an older release is open. */
export const OLDER_TAB_NOTE = 'An older version of the planner is open in another tab. Close it first, or it may save over this day again.';

export const SNAPSHOT_REASONS = Object.freeze({
  'before-archive': 'Your whole planner, before older days first moved',
  'before-remote-sync': 'Your whole planner, before changes from your other devices',
  'sync-conflict': 'Your whole planner, at a sync conflict'
});

const when = (iso, options = {}) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', ...options });
};
const dayLabel = day => when(`${day}T12:00:00`, { weekday: 'short' });

/** A backup file (version 13, as Export backup writes it) holding one earlier copy of a day. */
export function keptAsideBackup({ day, json, displacedAt }) {
  let value = json;
  try { value = JSON.parse(json); } catch (_) {}
  return { app: 'Daily Planner', version: 13, exportedAt: displacedAt || new Date().toISOString(), settings: null, days: { [day]: value } };
}

/**
 * The rows of the list: { id, label, detail, file, data, restore (a copy kept aside: its id) }. Snapshots first, newest
 * first, then the copies kept aside.
 */
export function recoveryRows({ snapshots = [], displaced = [] } = {}) {
  const rows = [];
  for (const snapshot of snapshots) {
    if (!snapshot?.data) continue;
    const day = String(snapshot.createdAt || '').slice(0, 10);
    rows.push({ id: `snapshot:${snapshot.id}`, label: SNAPSHOT_REASONS[snapshot.reason] || 'Your whole planner, kept before a change', detail: when(snapshot.createdAt), file: `daily-planner-snapshot-${day}-${snapshot.reason || 'kept'}.json`, data: snapshot.data });
  }
  for (const entry of displaced) {
    const what = entry.reason === 'restored-over' ? 'the version Restore replaced' : 'an earlier version';
    const detail = `kept aside ${when(entry.displacedAt)}${entry.restoredAt ? `, put back ${when(entry.restoredAt)}` : ''}`;
    rows.push({ id: `aside:${entry.id}`, label: `${dayLabel(entry.day)}, ${what}`, detail, file: `daily-planner-earlier-${entry.day}.json`, data: keptAsideBackup(entry), restore: entry.id });
  }
  return rows;
}

export function createStorageRecovery({
  store,
  download = () => {},
  onRestore = () => {},
  olderTabOpen = async () => false,
  doc = typeof document !== 'undefined' ? document : null,
  nav = typeof navigator !== 'undefined' ? navigator : null,
  recoveryStore = createRecoveryStore()
} = {}) {
  const wrap = doc?.querySelector('[data-storage-recovery]');
  const list = doc?.querySelector('[data-storage-recovery-list]');
  const note = doc?.querySelector('[data-storage-recovery-note]');
  let rows = [];
  let drawn = 0;

  list?.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-storage-recovery-download]');
    const row = button && rows.find(item => item.id === button.dataset.storageRecoveryDownload);
    if (row) download(row.file, JSON.stringify(row.data, null, 2), 'application/json');
    const restore = event.target.closest?.('[data-storage-recovery-restore]');
    const kept = restore && rows.find(item => item.id === restore.dataset.storageRecoveryRestore);
    if (!kept?.restore || restore.disabled) return;
    restore.disabled = true;
    const done = await store.restoreAside(kept.restore);
    if (!done) { restore.disabled = false; restore.textContent = 'Couldn’t restore'; return; }
    onRestore(kept);
  });

  /** The figures (`bytes`: the planner's data in localStorage), then, once known, the database's size and the list. */
  async function render(bytes = 0) {
    const output = doc?.querySelector('[data-storage-usage]');
    const stats = store.stats();
    if (output) output.textContent = storageUsageText({ bytes, ...stats });
    const turn = ++drawn;
    const [snapshots, displaced, estimate, persisted, older] = await Promise.all([
      recoveryStore.list().catch(() => []),
      store.displaced ? store.displaced() : [],
      stats.archived && typeof nav?.storage?.estimate === 'function' ? nav.storage.estimate().catch(() => null) : null,
      typeof nav?.storage?.persisted === 'function' ? nav.storage.persisted().catch(() => false) : false,
      Promise.resolve().then(olderTabOpen).catch(() => false)
    ]);
    if (turn !== drawn) return rows;
    // The site's size (the offline copy included), once older days are kept; whether this browser keeps it all for good.
    const extra = [estimate?.usage ? `this site about ${formatStorageBytes(estimate.usage)}` : '', persisted ? 'kept by this browser until you clear it' : ''].filter(Boolean).join(', ');
    if (output && extra) output.textContent = `${storageUsageText({ bytes, ...stats })} (${extra})`;
    rows = recoveryRows({ snapshots, displaced });
    if (wrap) wrap.hidden = !rows.length;
    if (note) { note.hidden = !(older && rows.some(row => row.restore)); note.textContent = note.hidden ? '' : OLDER_TAB_NOTE; }
    if (list) {
      list.innerHTML = rows.map(row => `<li><span><strong>${esc(row.label)}</strong><small>${esc(row.detail)}</small></span><span class="storage-recovery__actions">${row.restore ? `<button class="text-button" type="button" data-storage-recovery-restore="${escAttr(row.id)}" aria-label="Restore ${escAttr(row.label)}: the version there now is kept aside in its place">Restore</button>` : ''}<button class="text-button" type="button" data-storage-recovery-download="${escAttr(row.id)}">Download</button></span></li>`).join('');
    }
    return rows;
  }

  return { render, get rows() { return rows; } };
}
