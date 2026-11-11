import { withoutRetiredSettings } from './retired-keys.js';

export function formatStorageBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildPlannerBackup(store, { exportedAt = new Date().toISOString() } = {}) {
  const days = {};
  store.keys('daily-planner:').forEach(key => {
    if (key === 'daily-planner:settings') return;
    const day = key.replace('daily-planner:', '');
    const raw = store.get(key);
    try { days[day] = JSON.parse(raw); } catch (_) { days[day] = raw; }
  });
  let settings = null;
  try { settings = withoutRetiredSettings(store.readJSON('daily-planner:settings')); } catch (_) {}
  // Version 13, as in 1.38: a 1.39 backup imports into 1.38 unchanged, and the other way round.
  return { app: 'Daily Planner', version: 13, exportedAt, settings, days };
}
