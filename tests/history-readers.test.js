import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalStore } from '../src/state/local-store.js';
import { normalizeDayState } from '../src/state/day-state.js';
import { createSavedDays } from '../src/state/saved-days.js';
import { searchPlannerDays } from '../src/features/search.js';
import { candidatesForSavedDay, needsAttention } from '../src/features/unresolved.js';
import { createPlanner139 } from './support/app-1.39.3.js';
import { HISTORY_TODAY, QuotaStorage, historyDays, seedHistory } from './support/history.js';

// Search, Unresolved, the floating window and the week review with years of history (1.39.4): every saved day is
// parsed once and again only once it changed, and Unresolved reads the days once per list, not once per candidate.
// What they show is what 1.39.3 showed (its code, tests/support/app-1.39.3.js).

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** `count` days of `kind` in a store, with a counting normaliser for this tree's cache, and 1.39.3's planner over them. */
function history(count, { kind = 'typical', selected = HISTORY_TODAY, settings = { categories: [], openWork: [] } } = {}) {
  const storage = new QuotaStorage();
  const days = historyDays(count, { kind });
  seedHistory(storage, days);
  const store = createLocalStore(storage);
  let normalised = 0;
  const savedDays = createSavedDays(store, { normalize: (record, day) => { normalised += 1; return normalizeDayState(record, day); } });
  const old = createPlanner139({ store, today: HISTORY_TODAY, selected, settings });
  const live = { liveDay: selected, liveState: old.state };
  return { storage, store, days, savedDays, old, live, settings, normalised: () => { const n = normalised; normalised = 0; return n; } };
}

const QUERIES = ['lyon', 'the', 'Review', 'garden shed', '#2601', 'kitchen tap, ', 'zzz nothing', 'invoices', '  budget  '];

test('saved days are parsed once, and again only once they change, however they change', () => {
  const h = history(300);
  const first = h.savedDays.read(h.live);
  assert.equal(h.normalised(), 300);
  assert.equal(first.length, 301, 'every saved day, and the day on screen');
  assert.deepEqual(first.map(([key]) => key), [...first.map(([key]) => key)].sort().reverse(), 'newest first');
  assert.equal(first[0][1], h.live.liveState, 'the day on screen as the planner holds it');
  assert.deepEqual(first, h.old.savedPlannerDays(), 'what 1.39.3 read');
  assert.equal(h.savedDays.read(h.live).length, 301);
  assert.equal(h.normalised(), 0, 'nothing changed: nothing parsed');
  // An edit, a sync pull (no mutation told), a day removed, a day that isn't JSON (read as 1.39.3 did: a blank day).
  const [a, b, c, d] = [h.days[5][0], h.days[6][0], h.days[7][0], h.days[8][0]];
  h.store.writeJSON(`daily-planner:${a}`, { ...h.days[5][1], focus: 'Edited' });
  h.store.withoutMutationTracking(() => h.store.writeJSON(`daily-planner:${b}`, { ...h.days[6][1], focus: 'Pulled' }));
  h.store.remove(`daily-planner:${c}`);
  h.storage.setItem(`daily-planner:${d}`, '{not json');
  const again = new Map(h.savedDays.read(h.live));
  assert.equal(h.normalised(), 3, 'only the three days that changed');
  assert.deepEqual([again.get(a).focus, again.get(b).focus, again.has(c)], ['Edited', 'Pulled', false]);
  const blank = again.get(d);
  const blank139 = new Map(h.old.savedPlannerDays()).get(d);
  const withoutIds = day => JSON.parse(JSON.stringify(day, (key, value) => (key === 'id' ? undefined : value)));
  assert.deepEqual(withoutIds(blank), withoutIds(blank139));
  assert.equal(h.savedDays.stats().cached, 299, 'the removed day is forgotten');
});

test('Search finds exactly what 1.39.3 found, re-parsing only the days that changed between keystrokes', () => {
  for (const kind of ['typical', 'mixed']) {
    const h = history(600, { kind });
    const search = query => searchPlannerDays({ query, days: h.savedDays.read(h.live), categories: [], blockTimeRange: () => '' });
    h.savedDays.read(h.live);
    h.normalised();
    for (const query of QUERIES) assert.deepEqual(search(query), h.old.searchPlanner(query), `${kind}: “${query}”`);
    assert.equal(h.normalised(), 0, `${kind}: ${QUERIES.length} keystrokes, nothing parsed again`);
    h.store.writeJSON(`daily-planner:${h.days[100][0]}`, { ...h.days[100][1], notes: 'Tickets to Zanzibar booked' });
    const results = search('zanzibar');
    assert.equal(h.normalised(), 1, 'one day changed: one day parsed');
    assert.deepEqual(results, h.old.searchPlanner('zanzibar'));
    assert.ok(results.some(result => result.day === h.days[100][0] && result.kind === 'notes'));
  }
});

/** 1.39.3's list and this tree's, compared entry for entry. */
function sameUnresolved(h, label) {
  const now = needsAttention(h.savedDays.read(h.live), { todayKey: HISTORY_TODAY, openWork: h.settings.openWork });
  const then = h.old.needsAttentionEntries();
  assert.deepEqual(now, then, label);
  return now;
}

test('Unresolved lists exactly what 1.39.3 listed, reading each saved day once', () => {
  const h = history(500);
  const list = sameUnresolved(h, 'typical history');
  assert.equal(h.normalised(), 500, 'each day parsed once for the whole list (1.39.3: once per day per candidate)');
  assert.ok(list.length >= 8, `${list.length} entries`);
  assert.ok(list.some(entry => entry.kind === 'task') && list.some(entry => entry.kind === 'priority'));
  sameUnresolved(h, 'again');
  assert.equal(h.normalised(), 0, 'nothing changed: nothing parsed');

  // A candidate already carried to a later day, or saved for later, is left out; forgotten, too.
  const [entry] = list;
  const text = entry.kind === 'block' ? entry.block.title : entry.item.text;
  h.settings.openWork.push({ id: 'open-1', text: `  ${text.toUpperCase()} `, originDay: entry.originDay, carriedCount: 0 });
  const saved = sameUnresolved(h, 'with Later');
  assert.ok(!saved.some(item => item.key === entry.key && item.originDay === entry.originDay));
  h.settings.openWork.length = 0;
  const second = list.filter(item => item.originDay !== entry.originDay).at(-1);
  const later = h.days.find(([key]) => key > second.originDay);
  const carried = { ...later[1], tasks: [...later[1].tasks, { id: 'carried-by-hand', text: (second.item?.text || second.block.title), done: false, carriedCount: 1, originDay: second.originDay }] };
  h.store.writeJSON(`daily-planner:${later[0]}`, carried);
  assert.ok(!sameUnresolved(h, 'carried by hand').some(item => item.key === second.key));
  const copyOnSameDay = { ...carried, tasks: carried.tasks.map(task => (task.id === 'carried-by-hand' ? { ...task, carriedCount: 0 } : task)) };
  h.store.writeJSON(`daily-planner:${later[0]}`, copyOnSameDay);
  assert.ok(sameUnresolved(h, 'a copy never carried (count 0) does not count').some(item => item.key === second.key));
});

test('Unresolved matches 1.39.3 on every kind of day, a past day on screen, and blocks of their own', () => {
  for (const kind of ['light', 'rich', 'mixed']) sameUnresolved(history(300, { kind }), kind);
  // A past day on screen, edited in memory: its live state counts, not what storage holds.
  const h = history(300, { selected: '2026-06-15' });
  h.live.liveState.tasks[0].text = 'Edited on screen, not saved yet';
  h.live.liveState.tasks[0].done = false;
  h.live.liveState.blocks.push({ ...h.live.liveState.blocks[0], id: 'own-block', title: 'A block of its own', linkedType: '', linkedId: '', done: false });
  const list = sameUnresolved(h, 'a past day on screen');
  assert.ok(list.some(item => item.originDay === '2026-06-15' && item.item?.text === 'Edited on screen, not saved yet'));
  assert.ok(list.some(item => item.kind === 'block' && item.block.id === 'own-block'));
  assert.deepEqual(candidatesForSavedDay('2026-06-15', h.live.liveState), h.old.candidatesForSavedDay('2026-06-15', h.live.liveState));
});

/** Freezes `value` and everything in it: any change made to it afterwards throws (modules run in strict mode). */
const deepFreeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; };

test('the days handed out are shared, never changed: frozen, Search, Unresolved and its candidates read them all the same', () => {
  const h = history(200);
  const days = h.savedDays.read(h.live);
  days.filter(([key]) => key !== h.live.liveDay).forEach(([, day]) => deepFreeze(day));
  assert.doesNotThrow(() => {
    for (const query of QUERIES) searchPlannerDays({ query, days: h.savedDays.read(h.live), categories: [], blockTimeRange: () => '' });
    needsAttention(h.savedDays.read(h.live), { todayKey: HISTORY_TODAY, openWork: [{ id: 'o', text: 'x', originDay: h.days[3][0] }] });
    h.savedDays.read(h.live).forEach(([key, day]) => candidatesForSavedDay(key, day));
  });
  assert.equal(h.savedDays.read(h.live)[1][1], days[1][1], 'the same objects, still');
  sameUnresolved(h, 'over frozen days');
});

test('the planner reads its history through them: Search, Unresolved, the floating window, the week review', () => {
  const app = read('app.js');
  assert.match(app, /const savedDays = createSavedDays\(store\);/);
  assert.match(app, /function savedPlannerDays\(\) \{ return savedDays\.read\(\{ liveDay: ymd\(\), liveState: state \}\); \}/);
  assert.match(app, /function needsAttentionEntries\(\) \{ return needsAttention\(savedPlannerDays\(\), \{ todayKey: ymd\(new Date\(\)\), openWork: settings\.openWork \|\| \[\] \}\); \}/);
  assert.match(app, /days: savedPlannerDays\(\),/, 'Search');
  assert.match(app, /needs: needsAttentionEntries\(\)\.length,/, 'the week review');
  assert.match(app, /unresolved: \(\) => \(\{ needs: needsAttentionEntries\(\), later: settings\.openWork \|\| \[\] \}\)/, 'the floating window');
  assert.doesNotMatch(app, /candidateAlreadyTransferred|function candidatesForSavedDay|function candidateTriaged/);
  const sw = read('sw.js');
  for (const path of ['./src/state/saved-days.js', './src/features/unresolved.js', './src/state/day-move.js']) assert.ok(sw.includes(`'${path}'`), `${path} cached for offline use`);
});
