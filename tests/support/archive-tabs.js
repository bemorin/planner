import { createDayStore } from '../../src/state/day-store.js';
import { createMemoryArchive } from '../../src/state/day-archive.js';
import { planMoves } from '../../src/state/day-placement.js';
import { createLocalStore } from '../../src/state/local-store.js';
import { createSyncLedger } from '../../src/sync/ledger.js';
import { HISTORY_TODAY, QuotaStorage, SAFARI_BUDGET, historyDays, seedHistory } from './history.js';

/**
 * One browser for the day store's tests (1.40): one localStorage (a QuotaStorage at Safari's budget), one archive in
 * memory, and tabs over them. Each tab sees the others' writes as `storage` events, as browsers deliver them: after
 * the write, never to the tab that wrote, delivered when the test says (deliver()), so the window between a write
 * and its event can be tested.
 */
export function createBrowser({ quota = SAFARI_BUDGET, days = historyDays(700), archive = createMemoryArchive({ now: () => new Date('2026-11-11T09:00:00.000Z') }) } = {}) {
  const base = new QuotaStorage(quota);
  seedHistory(base, days);
  base.setItem('daily-planner:settings', '{"startHour":7}');
  const tabs = [];
  const queued = [];
  const emit = (from, event) => { for (const tab of tabs) if (tab !== from) queued.push([tab, event]); };

  /** A tab's view of localStorage: the same data, its writes heard by the other tabs. */
  const view = tab => ({
    get length() { return base.length; },
    key: index => base.key(index),
    getItem: key => base.getItem(key),
    setItem(key, value) {
      const oldValue = base.getItem(key);
      base.setItem(key, value);
      emit(tab, { key: String(key), oldValue, newValue: String(value) });
    },
    removeItem(key) {
      const oldValue = base.getItem(key);
      if (oldValue == null) return;
      base.removeItem(key);
      emit(tab, { key: String(key), oldValue, newValue: null });
    },
    clear() { base.clear(); }
  });

  /** A 1.40 tab: its store over this browser's localStorage and archive, wired to its own ledger as the planner is. */
  function tab({ name = `tab${tabs.length + 1}`, ...options } = {}) {
    const t = { name, deferred: [] };
    t.storage = view(t);
    t.ledger = createSyncLedger(t.storage, { now: () => new Date('2026-11-11T10:00:00.000Z') });
    t.events = [];
    t.store = createDayStore(t.storage, {
      archive,
      onMutation: mutation => { t.events.push(mutation); t.ledger.recordMutation(mutation); },
      ledgerDays: () => t.ledger.dayMarks(), forgetDays: days => t.ledger.forgetDays(days),
      defer: fn => t.deferred.push(fn),
      ...options
    });
    t.hear = event => t.store.storageEvent(event);
    t.plan = () => planMoves({ days: t.store.hotDays(), used: base.used(), today: HISTORY_TODAY });
    t.pass = options => t.store.moveDays(t.plan().batches, options);
    tabs.push(t);
    return t;
  }

  /** A tab of 1.39: a plain local store over the same localStorage, which knows nothing of the archive. */
  function olderTab() {
    const t = { name: 'older', deferred: [] };
    t.storage = view(t);
    t.ledger = createSyncLedger(t.storage, { now: () => new Date('2026-11-11T10:00:00.000Z') });
    t.store = createLocalStore(t.storage, { onMutation: t.ledger.recordMutation });
    t.hear = () => {};
    tabs.push(t);
    return t;
  }

  /** Delivers the storage events written so far, then what each tab deferred, and waits for what that started. */
  async function deliver() {
    while (queued.length) {
      const [target, event] = queued.shift();
      target.hear(event);
    }
    for (const t of tabs) {
      while (t.deferred.length) t.deferred.shift()();
      await t.store.settled?.();
    }
  }

  /** Every saved day, as `store` reads it, against what was seeded: [] when all equal. */
  const differences = store => days.filter(([day, value]) => store.get(`daily-planner:${day}`) !== JSON.stringify(value)).map(([day]) => day);

  return { base, archive, days, tab, olderTab, deliver, differences, closeTabs: () => { tabs.length = 0; queued.length = 0; } };
}
