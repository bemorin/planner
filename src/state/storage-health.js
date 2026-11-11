/**
 * Whether the planner's local saves land, and how full local storage is (1.39.3).
 *
 * localStorage refuses a write once an origin's quota is reached. The store
 * (./local-store.js) never throws for it; it reports each write's result
 * (onWrite), and createSaveHealth() keeps what the person must be told: a
 * change was refused and nothing has been saved since. The header notice and
 * How it works → Data on this device read it (src/features/storage-alert.js).
 *
 * Quotas count keys and values together, in UTF-16 code units (2 bytes a
 * character). Chromium allows 10 MiB an origin (5,242,880 characters,
 * measured), Safari 5 MiB (2,621,440; WebKit bug 245479). The browser can't be
 * asked for this quota (navigator.storage.estimate() covers IndexedDB and the
 * caches, gigabytes, not localStorage), so the planner takes Chromium's where
 * the browser says it is Chromium, and Safari's, the smaller, everywhere else.
 */

/** Safari's localStorage quota, 5 MiB, in characters (2 bytes each). */
export const SAFARI_BUDGET_CHARS = (5 * 1024 * 1024) / 2;
/** Chromium's (Chrome, Edge, Opera, Samsung Internet…), 10 MiB, in characters. */
export const CHROMIUM_BUDGET_CHARS = (10 * 1024 * 1024) / 2;
/** From this share of the budget, Data on this device warns, and the header once a day. */
export const STORAGE_WARN_SHARE = 0.8;

const DAY_KEY = /^daily-planner:\d{4}-\d{2}-\d{2}$/;
/** Personal sync's “changed” marks (src/sync/ledger.js). */
export const LEDGER_KEY = 'daily-planner-sync:ledger';
/** The writes the planner needs: its days, its settings and its other daily-planner: keys, and the sync marks. */
export const isPlannerWrite = key => typeof key === 'string' && (key.startsWith('daily-planner:') || key === LEDGER_KEY);

/** The quota to measure against: Chromium's where the browser is Chromium (navigator.vendor), else Safari's. */
export function storageBudget(nav = globalThis.navigator) {
  return nav?.vendor === 'Google Inc.' ? CHROMIUM_BUDGET_CHARS : SAFARI_BUDGET_CHARS;
}

/**
 * What `storage` holds: { chars } for every key, keys and values, as the quotas count them; { days } saved; and,
 * with `bytes`, the UTF-8 size of the planner's own keys (daily-planner:…), as Data on this device shows it.
 * Never throws (a storage that can't be read counts as empty).
 */
export function measureStorage(storage, { bytes = false } = {}) {
  const result = { chars: 0, bytes: 0, days: 0 };
  const encoder = bytes && typeof TextEncoder === 'function' ? new TextEncoder() : null;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key == null) continue;
      const value = storage.getItem(key) || '';
      result.chars += key.length + value.length;
      if (!key.startsWith('daily-planner:')) continue;
      if (DAY_KEY.test(key)) result.days += 1;
      if (encoder) result.bytes += encoder.encode(key).length + encoder.encode(value).length;
    }
  } catch (_) {}
  return result;
}

/**
 * How full storage is against `budget`: { chars, budget, share, percent, warn }. `percent` is whole and rounded
 * down, so the warning starts exactly when it reads 80%, and never above 100.
 */
export function storageLevel(chars, budget = SAFARI_BUDGET_CHARS) {
  const used = Math.max(0, Number(chars) || 0);
  const share = budget > 0 ? used / budget : 0;
  return { chars: used, budget, share, percent: Math.min(100, Math.floor(share * 100)), warn: share >= STORAGE_WARN_SHARE };
}

/**
 * The results of the planner's writes, as the person must hear of them.
 *
 * - A refused change (a day, the settings, another daily-planner: key): `failing` until that key is written again.
 * - The days are read again from storage (another day opened, a sync, an import): a day's refused change is no
 *   longer on screen either, so it is gone; `failing` stays (`lost`) until the next change lands.
 * - Only Personal sync's “changed” mark refused, the change itself saved: `syncMarkRefused`, not `failing`.
 * - Writes made by a sync pull (not tracked: `tracked: false`) are Personal sync's to tell (src/sync/engine.js
 *   `refused`), not these.
 *
 * `onChange()` runs only when one of them changes, never at each refused keystroke.
 */
export function createSaveHealth({ onChange = () => {} } = {}) {
  const failed = new Set();
  let lost = false;
  let saved = false;
  const failing = () => lost || [...failed].some(key => key !== LEDGER_KEY);
  const markRefused = () => !failing() && failed.has(LEDGER_KEY);
  const signature = () => `${failing()}|${markRefused()}`;

  function update(change) {
    const before = signature();
    change();
    if (signature() !== before) {
      try { onChange({ failing: failing(), syncMarkRefused: markRefused() }); } catch (_) {}
    }
  }

  return {
    /** One write's result, from the store's onWrite ({ key, ok, tracked }); other keys and sync pulls are ignored. */
    note({ key, ok, tracked = true } = {}) {
      if (!isPlannerWrite(key) || tracked === false) return;
      update(() => {
        if (ok) {
          failed.delete(key);
          if (key !== LEDGER_KEY) { lost = false; saved = true; }
        } else failed.add(key);
      });
    },
    /** The planner read its days again: a day's refused change is gone with what was on screen. */
    reloaded() {
      update(() => {
        for (const key of [...failed]) {
          if (DAY_KEY.test(key)) { failed.delete(key); lost = true; }
        }
      });
    },
    get failing() { return failing(); },
    get syncMarkRefused() { return markRefused(); },
    get lost() { return lost; },
    /** Whether a change has landed since the planner opened: saving works in this browser. */
    get saved() { return saved; },
    keys: () => [...failed]
  };
}
