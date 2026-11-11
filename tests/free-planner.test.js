import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createInsightsFeature } from '../src/features/insights.js';
import { renderInsightsEntry } from '../src/features/insights-view.js';
import { DEFAULT_PAINT, PAINT_PALETTES, choosePaint, renderPaintChooser } from '../src/features/paint-palettes.js';
import { quarterSeasonCard, renderQuarterMenuItem } from '../src/features/quarter-review.js';
import { addDaysKey, atNoon, ymdKey } from '../src/lib/dates.js';

// 1.39: Daily Planner is free. What was “Plus” (Plan your year with the misogi, quarterly check-ins, the year in
// review, Insights and the palettes) is part of the planner for everyone, with no licence, lock, badge or price.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sourceFiles(rel));
    else if (/\.(?:js|mjs|css)$/.test(entry.name)) files.push(rel);
  }
  return files;
}
const planner = () => ['app.js', 'index.html', 'styles.css', 'sw.js', ...sourceFiles('src'), ...sourceFiles('styles')].map(path => [path, read(path)]);

// ---------------------------------------------------------------------------
// Features available with no licence
// ---------------------------------------------------------------------------

test('no licence anywhere: the modules that checked, sold or previewed Plus are gone, and nothing loads them', () => {
  const gone = ['src/lib/plus.js', 'src/lib/pricing.js', 'src/lib/checkout-summary.js', 'src/ui/checkout-window.js', 'src/ui/checkout-window.css', 'src/vendor/creem-embed-0.3.4.mjs', 'src/features/plus-dialog.js', 'src/features/plus-check.js', 'src/features/plus-cycle.js', 'src/features/plus-previews.js', 'src/features/plus-samples.js', 'src/features/plus-insights.js', 'src/features/insights-sample.js', 'styles/plus.css'];
  for (const path of gone) assert.equal(existsSync(new URL(path, root)), false, path);
  for (const [path, source] of planner()) {
    // src/state/retired-keys.js names the old storage keys, to remove them.
    if (path === 'src/state/retired-keys.js') continue;
    assert.doesNotMatch(source, /plus-dialog|plus-check|plus-cycle|plus-previews|plus-samples|plus-insights|insights-sample|lib\/plus\.js|pricing\.js|checkout-summary|checkout-window|creem-embed|styles\/plus\.css/, path);
    assert.doesNotMatch(source, /\bhasPlus\b|\bplusActive\b|\bplusAvailable\b|\bonPlusChange\b|\bPLUS_PUBLIC_KEY\b|\bvisitorCurrency\b|\bstartCheckout\b|\bclaimPurchase\b|\bredeemGift\b|\bcheckPlusLicense\b|\brememberReferral\b/, path);
  }
});

test('Horizon opens Plan your year, the year in review, the quarter check-in and every palette directly', () => {
  const view = read('src/features/horizon-view.js');
  for (const name of ['openQuarter', 'openPlan', 'openReview', 'pickPaint']) {
    const body = new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n {2}\\}`).exec(view)?.[1] || '';
    assert.ok(body, name);
    assert.doesNotMatch(body, /unlock|plus/i, `${name} has no gate`);
    assert.match(body, /^\s*(?:const [a-z]+ = )?(?:quarterReview\.open|yearReview\.open|new Date\(\)|choosePaint\()/, `${name} goes straight to the feature`);
  }
  assert.match(view, /function openQuarter\(requested\) \{\n {4}quarterReview\.open\(parseQuarterKey\(requested\)\);/);
  assert.match(view, /function openReview\(requested\) \{\n {4}yearReview\.open\(/);
  assert.match(view, /yearPlan\.open\(\{ year: options\.includes\(wanted\) \? wanted : defaultPlanYear\(today\) \}\);/);
  // The context app.js hands to Horizon and Insights has no Plus in it, and the quarter nudge after closing a day is for everyone.
  const app = read('app.js');
  assert.doesNotMatch(app, /\bplus:\s*\{/);
  assert.match(app, /const nudge = quarterNudgeFor\(\{ dayKey: ymd\(date\), planningDays: activeWeekdays\(\), yearData: horizonYearData\(year\) \}\);/);
  assert.match(app, /insightsEntry: year => renderInsightsEntry\(year\),/);
});

test('every palette paints for everyone, and the entry points carry no badge', () => {
  const storage = new Map();
  const store = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const doc = { documentElement: { dataset: {} } };
  for (const { id } of PAINT_PALETTES) assert.equal(choosePaint(id, { storage: store, doc }), id);
  assert.equal(choosePaint(DEFAULT_PAINT, { storage: store, doc }), DEFAULT_PAINT);
  const icon = () => '';
  const yearData = () => ({ habits: ['', '', '', ''], habitChecks: {}, misogiMilestones: [], miniAdventures: [], quarterReviews: {} });
  const progress = () => ({ year: 2026, months: Array.from({ length: 12 }, () => ({ days: [], closed: 0 })) });
  const card = quarterSeasonCard({ today: new Date(2026, 9, 3, 12), shownYear: 2026, yearData, progress, icon });
  assert.match(card, /data-horizon-quarter="2026-Q3"/);
  for (const html of [card, renderQuarterMenuItem({ at: { year: 2026, quarter: 2 } }), renderInsightsEntry(2026), renderPaintChooser({ current: 'ocean' })]) {
    assert.doesNotMatch(html, /hz-plus-badge|is-locked|\bPlus\b|unlock|licen[cs]e/i);
  }
});

/** Just enough of an element for Insights to render into and bind. */
function fakeWrap() {
  return {
    innerHTML: '',
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    closest: () => null,
    querySelector(selector) { return selector === '[data-insights]' && this.innerHTML.includes('data-insights') ? { dataset: {} } : null; },
    querySelectorAll: () => []
  };
}

test('Insights work out this planner’s own days, with no licence: no sample, no lock, its own title', () => {
  const todayKey = ymdKey(atNoon(new Date()));
  const records = {};
  for (let key = addDaysKey(todayKey, -70); key < todayKey; key = addDaysKey(key, 1)) {
    const weekday = new Date(`${key}T12:00:00`).getDay();
    if (weekday === 0 || weekday === 6) continue;
    records[key] = { priorities: [{ text: 'Main', done: weekday !== 5 }], tasks: [{ text: 'Mail', done: true }], blocks: [{ start: 540, duration: 120, categoryId: 'deep' }], endedAt: `${key}T18:00:00`, closeTransfers: [] };
  }
  const read = [];
  const wrap = fakeWrap();
  const modal = { hidden: false, querySelector: () => wrap };
  const insights = createInsightsFeature({ readDay: key => { read.push(key); return records[key] || null; }, categoryFor: id => (id === 'deep' ? { id, name: 'Deep work', color: '#3e5f96' } : null), planningDays: () => [1, 2, 3, 4, 5], weekStartsOn: () => 1, hours: () => ({ startHour: 7, endHour: 20 }), dayKeys: () => Object.keys(records).map(key => `daily-planner:${key}`), modal: () => modal });
  insights.invalidate();
  insights.render(wrap);
  assert.ok(read.length > 0, 'its own days are read');
  assert.match(wrap.innerHTML, /data-insights/);
  assert.match(wrap.innerHTML, /What stands out/);
  assert.doesNotMatch(wrap.innerHTML, /Plus|data-ins-unlock|ins-lock|is-sample|Sample/);
  assert.deepEqual(insights.header(), { eyebrow: 'Insights', title: 'What your days add up to' });
  assert.equal(insights.locked, undefined, 'nothing is locked');
});

// ---------------------------------------------------------------------------
// No Plus entry points in the DOM
// ---------------------------------------------------------------------------

test('the planner’s page has no Plus window, menu item, Settings card, badge or note', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /data-plus|modal--plus|plus-dialog|plus-entry|mobile-plus-action|settings-group--plus|reset-plus-note|hz-plus-badge|data-insights-badge/);
  // Visible words, without the markup and the icons' path data.
  const words = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(words, /\bPlus\b|licen[cs]e|gift link|\bupgrade|\bunlock|\bpremium|\bprice|partner|team gift|€\s?\d|\$\s?\d/i);
  const attributes = [...html.matchAll(/(?:aria-label|title|data-tooltip|placeholder|alt)="([^"]*)"/g)].map(match => match[1]).join(' ');
  assert.doesNotMatch(attributes, /\bPlus\b|licen[cs]e|gift|upgrade|unlock|premium|price/i);
  assert.match(html, /<button type="button" data-stats-view="insights" role="tab" aria-selected="false">Insights<\/button>/);
});

test('no script draws a Plus entry point, a lock or a price in the planner', () => {
  for (const [path, source] of planner()) {
    if (path.endsWith('.css')) assert.doesNotMatch(source, /\.plus-|\.hz-plus-badge|\.ins-lock|\.modal--plus|\.share-sheet__partner|\.help-partners/, path);
    else {
      assert.doesNotMatch(source, /data-plus|hz-plus-badge|data-ins-unlock|Daily Planner Plus|See Plus|Get Plus/, path);
      assert.doesNotMatch(source, /\b(?:with|without|needs|come with|comes with) (?:Daily Planner )?Plus\b/, path);
    }
  }
  // Nothing reads a licence, gift, checkout or referral parameter any more: the Back stack only takes those of
  // earlier releases' links out of the address (RETIRED_PARAMS, tests/back-stack.test.js).
  for (const [path, source] of planner()) {
    assert.doesNotMatch(source, /(?:searchParams|params|query)\.(?:get|has|getAll)\(\s*'(?:license|gift|key|purchase|checkout_id|ref|via|aff)'/, path);
  }
  const backStack = read('src/ui/back-stack.js');
  assert.match(backStack, /export const RETIRED_PARAMS = Object\.freeze\(\['license', 'gift', 'key', 'checkout_id', 'purchase', 'ref'\]\);/);
  assert.deepEqual(backStack.match(/'(?:license|gift|key|purchase|checkout_id|ref)'/g), ["'license'", "'gift'", "'key'", "'checkout_id'", "'purchase'", "'ref'"], 'named once, in that list only');
});
