import { normalizeDayState } from '../../src/state/day-state.js';
import { searchPlannerDays } from '../../src/features/search.js';
import { withoutRetiredSettings } from '../../src/state/retired-keys.js';

// Frozen: the history-wide readers of app.js as 1.39.3 shipped them (main at 214b27f), lifted out of the planner's
// closure as they were, word for word, over `store`, the day on screen (`ymd()` and `state`) and `settings`. Tests
// compare 1.39.4's modules with them (same results), and scripts/perf-history.mjs measures them as the “before”.
// Never edit the function bodies.
export function createPlanner139({ store, today, selected = today, state = null, settings = {}, blockTimeRange = () => '' }) {
  const ymd = (d = selected) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));
  state = state || normalizeDayState(store.readJSON(`daily-planner:${selected}`), selected);
  const Date139 = class extends Date { constructor(...args) { super(...(args.length ? args : [`${today}T12:00:00Z`])); } };

  // app.js:2075-2087
  function savedPlannerDays() {
    const days = new Map();
    try {
      store.keys('daily-planner:')
        .filter(key => /^daily-planner:\d{4}-\d{2}-\d{2}$/.test(key))
        .forEach(key => {
          const day = key.slice('daily-planner:'.length);
          try { days.set(day, normalizeDayState(store.readJSON(key), day)); } catch (_) {}
        });
    } catch (_) {}
    days.set(ymd(), state);
    return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }

  // app.js:2089-2096
  function searchPlanner(query) {
    return searchPlannerDays({
      query,
      days: savedPlannerDays(),
      categories: settings.categories,
      blockTimeRange
    });
  }

  // app.js:2377-2379
  function candidateTriaged(dayState, key) {
    return (dayState.triaged || []).some(value => value === `${key}:later` || value === `${key}:drop` || value.startsWith(`${key}@`));
  }

  // app.js:2403-2423
  function candidatesForSavedDay(dayKey, dayState) {
    const candidates = [];
    const linked = (type, id) => dayState.blocks.find(block => block.linkedType === type && block.linkedId === id) || null;
    dayState.priorities.forEach((item, index) => {
      const key = `priority:${item.id}`;
      if (!item.text.trim() || item.done || candidateTriaged(dayState, key)) return;
      candidates.push({ key, kind: 'priority', item, index, block: linked('priority', item.id), originDay: dayKey });
    });
    dayState.tasks.forEach((item, index) => {
      const key = `task:${item.id}`;
      if (!item.text.trim() || item.done || candidateTriaged(dayState, key)) return;
      candidates.push({ key, kind: 'task', item, index, block: linked('task', item.id), originDay: dayKey });
    });
    dayState.blocks.forEach(block => {
      if (block.linkedType && block.linkedId) return;
      const key = `block:${block.id}`;
      if (block.done || candidateTriaged(dayState, key)) return;
      candidates.push({ key, kind: 'block', block, originDay: dayKey });
    });
    return candidates;
  }

  // app.js:3147-3157
  function candidateAlreadyTransferred(candidate, sourceDay) {
    const text = (candidate.kind === 'block' ? candidate.block?.title : candidate.item?.text || '').trim().toLocaleLowerCase();
    if (!text) return false;
    if ((settings.openWork || []).some(item => item.originDay === sourceDay && item.text.trim().toLocaleLowerCase() === text)) return true;
    return savedPlannerDays().some(([dayKey, dayState]) => {
      if (dayKey <= sourceDay) return false;
      const items = [...(dayState.priorities || []), ...(dayState.tasks || [])];
      if (items.some(item => item.originDay === sourceDay && item.text.trim().toLocaleLowerCase() === text && Number(item.carriedCount) > 0)) return true;
      return (dayState.blocks || []).some(block => block.originDay === sourceDay && block.title.trim().toLocaleLowerCase() === text && Number(block.carriedCount) > 0);
    });
  }

  // app.js:3159-3167 (`new Date()` is `today`)
  function needsAttentionEntries() {
    const todayKey = ymd(new Date139());
    const entries = [];
    savedPlannerDays().forEach(([dayKey, dayState]) => {
      if (dayKey >= todayKey) return;
      candidatesForSavedDay(dayKey, dayState).forEach(candidate => { if (!candidateAlreadyTransferred(candidate, dayKey)) entries.push(candidate); });
    });
    return entries.sort((a, b) => b.originDay.localeCompare(a.originDay));
  }

  // app.js:2263-2269, confirmImport()'s writes: every result ignored.
  function importBackup(pendingImport) {
    Object.entries(pendingImport.days || {}).forEach(([day, value]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      store.writeJSON(`daily-planner:${day}`, value);
    });
    if (pendingImport.settings && typeof pendingImport.settings === 'object') store.writeJSON('daily-planner:settings', withoutRetiredSettings(pendingImport.settings));
  }

  return { savedPlannerDays, searchPlanner, candidatesForSavedDay, candidateAlreadyTransferred, needsAttentionEntries, importBackup, get state() { return state; } };
}
