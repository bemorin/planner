import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, isDay, isoWeek, isoWeekStart, weekday, periodStart, shiftPeriod, periodEnd, periodKey, sameOffset,
  comparisonRanges, periodHistory, sumEvents, firstEventDay,
  TREND_METRICS, metricById, metricValue, metricTrend, metricFirstDay, change, ratio, yearsToShow,
  FUNNELS, funnelSteps, funnelOverall, SECTION_EVENTS, sectionUsage, installUsage, seriesWindow, normalizeSeries
} from '../admin/trends.js';

const daily = (from, to, count) => {
  const days = {};
  for (let day = from; day <= to; day = addDays(day, 1)) days[day] = typeof count === 'function' ? count(day) : count;
  return days;
};

test('days are UTC calendar days', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(isDay('2026-02-29'), false);
  assert.equal(isDay('2028-02-29'), true);
  assert.equal(isDay('2026-13-01'), false);
  assert.equal(isDay(''), false);
  assert.equal(weekday('2026-10-05'), 0, 'Monday');
  assert.equal(weekday('2026-10-11'), 6, 'Sunday');
});

test('ISO weeks run Monday to Sunday and belong to the year of their Thursday', () => {
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2025-12-29'), { year: 2026, week: 1 }, 'a Monday in December can open week 1');
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 }, '2026 has 53 weeks');
  assert.deepEqual(isoWeek('2021-01-03'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2026-10-11'), { year: 2026, week: 41 });
  assert.equal(isoWeekStart('2026-10-11'), '2026-10-05');
  assert.equal(isoWeekStart('2026-10-05'), '2026-10-05');
  assert.equal(periodKey('week', '2027-01-03'), '2026-W53');
  assert.equal(periodKey('month', '2026-10-11'), '2026-10');
  assert.equal(periodKey('year', '2026-10-11'), '2026');
});

test('periods start, shift and end on calendar boundaries', () => {
  assert.equal(periodStart('week', '2026-10-08'), '2026-10-05');
  assert.equal(periodStart('month', '2026-10-08'), '2026-10-01');
  assert.equal(periodStart('year', '2026-10-08'), '2026-01-01');
  assert.equal(shiftPeriod('month', '2026-01-01', -1), '2025-12-01');
  assert.equal(shiftPeriod('month', '2026-11-01', 2), '2027-01-01');
  assert.equal(shiftPeriod('month', '2026-10-01', -12), '2025-10-01');
  assert.equal(shiftPeriod('week', '2026-10-05', -1), '2026-09-28');
  assert.equal(shiftPeriod('year', '2026-01-01', -1), '2025-01-01');
  assert.equal(periodEnd('month', '2028-02-01'), '2028-02-29');
  assert.equal(periodEnd('month', '2026-02-01'), '2026-02-28');
  assert.equal(periodEnd('week', '2026-12-28'), '2027-01-03');
  assert.equal(periodEnd('year', '2026-01-01'), '2026-12-31');
});

test('to-date comparisons use the same days of the previous period', () => {
  const week = comparisonRanges('week', '2026-10-08');
  assert.deepEqual(week.current, { from: '2026-10-05', to: '2026-10-08' });
  assert.deepEqual(week.previous, { from: '2026-09-28', to: '2026-10-01' }, 'Monday to the same weekday');
  assert.deepEqual(week.lastYear, { from: '2025-10-06', to: '2025-10-09' }, '52 weeks earlier keeps the weekdays');
  assert.equal(weekday(week.lastYear.from), 0);

  const month = comparisonRanges('month', '2026-03-31');
  assert.deepEqual(month.current, { from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(month.previous, { from: '2026-02-01', to: '2026-02-28' }, 'cut at the end of a shorter month');
  assert.deepEqual(month.lastYear, { from: '2025-03-01', to: '2025-03-31' });

  const leap = comparisonRanges('year', '2028-02-29');
  assert.deepEqual(leap.current, { from: '2028-01-01', to: '2028-02-29' });
  assert.deepEqual(leap.previous, { from: '2027-01-01', to: '2027-02-28' });
  assert.equal(leap.lastYear, null, 'a year’s previous period already is last year');

  assert.equal(sameOffset('month', '2026-02-01', '2026-01-30'), '2026-02-28');
  assert.equal(sameOffset('week', '2026-09-28', '2026-10-11'), '2026-10-04');
});

test('history lists whole periods, oldest first, the last one to date', () => {
  const weeks = periodHistory('week', '2026-10-08', 12);
  assert.equal(weeks.length, 12);
  assert.deepEqual(weeks.at(-1), { key: '2026-W41', from: '2026-10-05', to: '2026-10-08', current: true });
  assert.deepEqual(weeks[0], { key: '2026-W30', from: '2026-07-20', to: '2026-07-26', current: false });
  const months = periodHistory('month', '2026-10-08', 12);
  assert.equal(months[0].from, '2025-11-01');
  assert.equal(months[0].to, '2025-11-30');
  assert.equal(months.at(-1).to, '2026-10-08');
  assert.deepEqual(periodHistory('year', '2026-10-08', 2).map(row => [row.key, row.from, row.to]), [['2025', '2025-01-01', '2025-12-31'], ['2026', '2026-01-01', '2026-10-08']]);
});

const series = {
  from: '2025-01-01',
  to: '2026-10-08',
  events: {
    landing_viewed: daily('2025-09-01', '2026-10-08', 10),
    app_active_day: daily('2026-01-01', '2026-10-08', 20),
    app_active_week: daily('2026-01-01', '2026-10-08', day => (weekday(day) === 0 ? 7 : 1)),
    app_active_month: daily('2026-01-01', '2026-10-08', day => (day.endsWith('-01') ? 30 : 0)),
    app_installed_day: daily('2026-01-01', '2026-10-08', 5),
    week_view_opened: daily('2026-01-01', '2026-10-08', 10),
    search_opened: daily('2026-01-01', '2026-10-08', day => (day >= '2026-10-05' ? 4 : 2)),
    print_used: { '2026-10-06': 1 },
    install_accepted: { '2026-10-06': 2, '2026-09-29': 1 },
    landing_cta_app: { '2026-10-06': 6, '2026-10-07': 4 },
    onboarding_completed: { '2026-10-07': 3, '2026-09-30': 1 },
    year_plan_completed: { '2026-10-07': 2 },
    quarter_review_completed: { '2026-10-01': 1, '2026-10-06': 2 },
    year_review_opened: { '2025-12-31': 4 }
  }
};

test('sums count only the days inside the range', () => {
  assert.equal(sumEvents(series.events, ['landing_viewed'], { from: '2026-10-05', to: '2026-10-08' }), 40);
  assert.equal(sumEvents(series.events, ['landing_cta_app', 'onboarding_completed'], { from: '2026-10-05', to: '2026-10-08' }), 13);
  assert.equal(sumEvents(series.events, ['missing'], { from: '2026-10-05', to: '2026-10-08' }), 0);
  assert.equal(firstEventDay(series.events, ['app_active_day', 'landing_viewed']), '2025-09-01');
  assert.equal(firstEventDay(series.events, ['nothing']), '');
});

test('the tiles count usage only: no sales, revenue or Plus figures (1.39: everything is free)', () => {
  assert.deepEqual(TREND_METRICS.map(metric => metric.id), ['landing', 'devices', 'active-days', 'installed-days', 'days-closed', 'years-planned', 'quarter-check-ins', 'year-reviews']);
  for (const metric of TREND_METRICS) assert.ok(metric.events, `${metric.id} reads anonymous counts`);
  assert.deepEqual(FUNNELS.map(funnel => funnel.id), ['planner']);
});

test('active devices read weeks, months, then device-months for a year', () => {
  const devices = metricById('devices');
  const ranges = { week: comparisonRanges('week', '2026-10-08'), month: comparisonRanges('month', '2026-10-08'), year: comparisonRanges('year', '2026-10-08') };
  assert.equal(metricValue(series, devices, 'week', ranges.week.current), 10, 'app_active_week Monday → Thursday');
  assert.equal(metricValue(series, devices, 'month', ranges.month.current), 30, 'app_active_month this month');
  assert.equal(metricValue(series, devices, 'year', ranges.year.current), 300, 'ten months of app_active_month');
  assert.equal(TREND_METRICS.length, 8);
  assert.equal(metricById('nope'), null);
});

test('changes are signed percentages, "new" when nothing came before', () => {
  assert.deepEqual(change(5, 0), { kind: 'new', pct: null });
  assert.deepEqual(change(0, 0), { kind: 'flat', pct: 0 });
  assert.deepEqual(change(15, 10), { kind: 'up', pct: 50 });
  assert.deepEqual(change(5, 10), { kind: 'down', pct: -50 });
  assert.deepEqual(change(10, 10), { kind: 'flat', pct: 0 });
  assert.equal(ratio(1, 0), null);
  assert.equal(ratio(1, 4), 0.25);
});

test('a tile compares with the previous period and, when counts exist, a year earlier', () => {
  const landing = metricTrend(series, metricById('landing'), 'week', '2026-10-08');
  assert.equal(landing.current, 40);
  assert.equal(landing.previous, 40);
  assert.equal(landing.lastYear, 40, 'counted since September 2025');
  assert.equal(landing.history.length, 12);
  assert.equal(landing.history.at(-1).value, 40, 'current week to date');
  assert.equal(landing.history.at(-2).value, 70, 'last full week');

  assert.equal(landing.previousPartial, false);

  const active = metricTrend(series, metricById('active-days'), 'month', '2026-10-08');
  assert.equal(active.lastYear, null, 'nothing was counted a year ago');
  assert.equal(active.firstDay, '2026-01-01');

  const yearly = metricTrend(series, metricById('landing'), 'year', '2026-10-08', { count: 2 });
  assert.equal(yearly.lastYear, null);
  assert.deepEqual(yearly.history.map(row => row.value), [1220, 2810]);
  assert.equal(yearly.previousPartial, true, 'counting began in September 2025, part-way through last year’s same days');

  const lateStart = { ...series, events: { landing_viewed: daily('2025-09-05', '2026-10-08', 10) } };
  assert.equal(metricTrend(lateStart, metricById('landing'), 'month', '2026-09-20').lastYear, null, 'September 2025 was only partly counted');
  assert.equal(metricTrend(lateStart, metricById('landing'), 'month', '2026-10-08').lastYear, 80);
  assert.equal(metricTrend(series, metricById('landing'), 'month', '2026-10-08').lastYear, 80);

  const quarters = metricTrend(series, metricById('quarter-check-ins'), 'week', '2026-10-08');
  assert.equal(quarters.current, 2);
  assert.equal(quarters.previous, 1, 'the same days of last week');
  assert.equal(quarters.firstDay, '2026-10-01');
  assert.equal(quarters.previousPartial, true, 'first counted part-way through last week');
});

test('each metric starts at its own first count', () => {
  assert.equal(firstEventDay(series.events, Object.keys(series.events)), '2025-09-01', 'the earliest count of any event');
  assert.equal(firstEventDay({}, []), '');
  assert.equal(metricFirstDay(series, metricById('years-planned'), 'week'), '2026-10-07');
  assert.equal(metricFirstDay(series, metricById('year-reviews'), 'month'), '2025-12-31');
  assert.equal(metricFirstDay(series, metricById('devices'), 'year'), '2026-01-01');
});

test('all years start at the first year with data', () => {
  assert.equal(yearsToShow(series, '2026-10-08'), 2);
  assert.equal(yearsToShow({ from: '2025-01-01', to: '2026-10-08', events: { landing_viewed: { '2026-03-01': 1 } } }, '2026-10-08'), 1);
  assert.equal(yearsToShow({ events: {} }, '2026-10-08'), 1);
});

test('funnels give step and overall rates from independent counts', () => {
  const ranges = comparisonRanges('week', '2026-10-08');
  const planner = FUNNELS.find(funnel => funnel.id === 'planner');
  // Landing visits → clicked “Open the planner” → finished onboarding → closed a day.
  const steps = funnelSteps(series, planner, ranges.current);
  assert.deepEqual(steps.map(step => step.value), [40, 10, 3, 0]);
  assert.equal(steps[0].fromPrevious, null);
  assert.equal(steps[1].fromPrevious, 0.25);
  assert.equal(steps[2].fromFirst, 3 / 40);
  assert.equal(planner.steps[planner.outcome].events[0], 'onboarding_completed', 'closed days come from every planner, not only new ones');
  const overall = funnelOverall(series, planner, ranges);
  assert.equal(overall.current, 3 / 40);
  assert.equal(overall.previous, 1 / 40, 'one onboarding over the same days of last week');
  assert.deepEqual(funnelOverall({ events: {} }, planner, ranges), { current: null, previous: null });
  // Independent counts: a step can pass the one before it.
  const busy = { events: { landing_viewed: { '2026-10-06': 2 }, landing_cta_app: { '2026-10-06': 5 } } };
  assert.equal(funnelSteps(busy, planner, ranges.current)[1].fromPrevious, 2.5);
});

test('section usage is a share of active days, most used first', () => {
  const ranges = comparisonRanges('week', '2026-10-08');
  const rows = sectionUsage(series, ranges);
  assert.equal(rows.length, SECTION_EVENTS.length);
  assert.deepEqual(rows.slice(0, 3).map(row => row.name), ['week_view_opened', 'search_opened', 'print_used']);
  const search = rows.find(row => row.name === 'search_opened');
  assert.equal(search.share, 16 / 80);
  assert.equal(search.previousShare, 8 / 80);
  assert.ok(Math.abs(search.changePts - 10) < 1e-9);
  const horizon = rows.find(row => row.name === 'horizon_opened');
  assert.equal(horizon.share, 0);
  const empty = sectionUsage({ events: {} }, ranges);
  assert.ok(empty.every(row => row.share === null && row.changePts === null));
  assert.deepEqual(empty.map(row => row.name), [...SECTION_EVENTS], 'stable order without data');

  const installs = installUsage(series, ranges);
  assert.deepEqual(installs.accepted, { current: 2, previous: 1 });
  assert.equal(installs.installedShare.current, 0.25);
});

test('the series window and answer are checked before use', () => {
  assert.deepEqual(seriesWindow('2026-10-11'), { from: '2025-01-01', to: '2026-10-11' });
  assert.equal(normalizeSeries(null), null);
  assert.equal(normalizeSeries({ error: 'Not found' }), null);
  assert.equal(normalizeSeries({ events: {}, to: 'soon' }), null);
  // An older API's sales fields are dropped: only the counts are read.
  const clean = normalizeSeries({ from: '2025-01-01', to: '2026-10-11', events: {}, sales: [{ day: '2026-10-01' }], testSales: [], salesUnavailable: true });
  assert.deepEqual(clean, { from: '2025-01-01', to: '2026-10-11', events: {} });
  assert.deepEqual(normalizeSeries({ to: '2026-10-11', events: {} }), { from: '2026-10-11', to: '2026-10-11', events: {} });
});

test('Week · Month · Year is a radio group whose pill slides like the planner’s view switch', async () => {
  const { periodKeyTarget } = await import('../admin/trends-view.js');
  const { readFile } = await import('node:fs/promises');
  const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  // The keyboard: the arrows wrap round, Home and End go to the ends, other keys do nothing.
  assert.equal(periodKeyTarget('ArrowRight', 0, 3), 1);
  assert.equal(periodKeyTarget('ArrowDown', 2, 3), 0, 'wraps round');
  assert.equal(periodKeyTarget('ArrowLeft', 0, 3), 2, 'wraps round');
  assert.equal(periodKeyTarget('ArrowUp', 1, 3), 0);
  assert.equal(periodKeyTarget('Home', 2, 3), 0);
  assert.equal(periodKeyTarget('End', 0, 3), 2);
  assert.equal(periodKeyTarget('Enter', 1, 3), -1);
  assert.equal(periodKeyTarget('ArrowRight', 0, 0), -1, 'no buttons, no move');

  const html = await read('admin/index.html');
  const group = /<div class="trends-switch"[\s\S]*?<\/div>/.exec(html)[0];
  assert.match(group, /role="radiogroup" aria-label="Compare by"/);
  assert.match(group, /<span class="trends-switch__indicator" data-trends-indicator aria-hidden="true"><\/span>/);
  const radios = [...group.matchAll(/<button type="button" role="radio"([^>]*)>(\w+)<\/button>/g)].map(match => [match[2], /aria-checked="true"/.test(match[1]), /tabindex="-1"/.test(match[1])]);
  assert.deepEqual(radios, [['Week', true, false], ['Month', false, true], ['Year', false, true]], 'one tab stop: the chosen period');
  assert.doesNotMatch(group, /aria-pressed/);

  const view = await read('admin/trends-view.js');
  // The planner's slide (the same spring as src/ui/motion.js slideIndicator), straight from the library: src/ui/motion.js would mark the page has-motion and take the dropdowns' transition away.
  assert.match(view, /import \{ animate, spring \} from '\.\.\/src\/vendor\/motion\.js';/);
  assert.doesNotMatch(view, /src\/ui\/motion\.js'/);
  assert.match(view, /animate\(pill, keyframes, \{ type: spring, bounce: 0\.16, duration: 0\.4 \}\)/);
  assert.match(await read('src/ui/motion.js'), /return run\(indicator, keyframes, \{ type: spring, bounce: 0\.16, duration: 0\.4 \}, \[\]\);/, 'still the planner’s');
  assert.match(view, /if \(!animateMove \|\| !from\.width \|\| reducedMotion\(\) \|\| typeof pill\.animate !== 'function'\) return;/, 'no movement with reduced motion');
  assert.match(view, /button\.setAttribute\('aria-checked', String\(on\)\);\n {6}button\.tabIndex = on \? 0 : -1;/);
  assert.match(view, /syncSwitch\(\{ animate: true \}\);/, 'it slides when a period is chosen');
  assert.match(view, /new ResizeObserver\(\(\) => placeIndicator\(false\)\)\.observe\(group\)/, 'and is placed without sliding once shown or resized');

  const css = await read('admin/admin.css');
  assert.match(css, /\.trends-switch \{ position: relative;[^}]*border-radius: 999px;/);
  assert.match(css, /\.trends-switch__indicator \{ position: absolute;[^}]*background: var\(--surface-strong\);/);
  assert.match(css, /\.trends-switch:not\(:has\(\[data-ready\]\)\) button\.is-active \{/, 'the chosen period reads as chosen before the pill is measured');
  assert.doesNotMatch(css, /\.trends-switch button\[aria-pressed/);
});
