import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSettings, normalizePlannerSettings } from '../src/state/settings-state.js';

test('category colours and ids from storage are plain values, never markup', () => {
  const settings = normalizePlannerSettings({
    categories: [
      { id: 'deep-work', name: 'Deep work', color: '#5F7084' },
      { id: 'x" onmouseover="alert(1)', name: 'Odd', color: 'red"><img src=x onerror=alert(1)>' },
      { id: 'short', name: '', color: ' #abc ' },
      null,
      'not a category'
    ]
  }, { detectedWeekStart: 1, currentYear: 2026 });
  assert.equal(settings.categories.length, 3);
  assert.deepEqual(settings.categories[0], { id: 'deep-work', name: 'Deep work', color: '#5F7084', archived: false, archivedAt: '' });
  assert.match(settings.categories[1].id, /^category-/);
  assert.match(settings.categories[1].color, /^#[0-9a-f]{6}$/i);
  assert.equal(settings.categories[2].color, '#abc');
  assert.equal(settings.categories[2].name, 'Category');
});

test('default settings preserve first-run behavior', () => {
  const settings = createDefaultSettings({ detectedWeekStart: 0, currentYear: 2026 });
  assert.equal(settings.startHour, 8);
  assert.equal(settings.endHour, 18);
  assert.equal(settings.expandedView, false);
  assert.equal(settings.onboardingComplete, false);
  assert.equal(settings.weekStartsOn, 1);
  assert.equal(settings.weekStartsOnExplicit, false);
  assert.deepEqual(settings.planningDays, [1, 2, 3, 4, 5]);
  assert.equal(settings.horizonStartYear, 2026);
});

test('legacy fit settings preserve migration behavior', () => {
  const legacy = normalizePlannerSettings({ expandedView: false }, { detectedWeekStart: 1, currentYear: 2026 });
  assert.equal(legacy.expandedView, true);
  const current = normalizePlannerSettings({ fitDefaultV8: true, expandedView: false }, { detectedWeekStart: 1, currentYear: 2026 });
  assert.equal(current.expandedView, false);
});

test('planning days are normalized and deduplicated', () => {
  const settings = normalizePlannerSettings({ planningDays: [1, '1', 5, 9, -1] }, { detectedWeekStart: 1, currentYear: 2026 });
  assert.deepEqual(settings.planningDays, [1, 5]);
});

test('open work keeps meaningful records and normalizes counters', () => {
  const settings = normalizePlannerSettings({
    openWork: [
      { id: 'x', text: ' Keep me ', carriedCount: -2 },
      { id: 'empty', text: '   ' }
    ]
  }, { detectedWeekStart: 1, currentYear: 2026 });
  assert.equal(settings.openWork.length, 1);
  assert.equal(settings.openWork[0].id, 'x');
  assert.equal(settings.openWork[0].carriedCount, 0);
});


test('legacy settings migrate to Monday-first until a user explicitly chooses another week start', () => {
  const legacy = normalizePlannerSettings({ weekStartDay: 1, weekStartsOn: 0 }, { detectedWeekStart: 0, currentYear: 2026 });
  assert.equal(legacy.weekStartsOn, 1);
  assert.equal(legacy.weekStartsOnExplicit, false);

  const explicit = normalizePlannerSettings({ weekStartDay: 1, weekStartsOn: 0, weekStartsOnExplicit: true }, { detectedWeekStart: 1, currentYear: 2026 });
  assert.equal(explicit.weekStartsOn, 0);
  assert.equal(explicit.weekStartsOnExplicit, true);
});
