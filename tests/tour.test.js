import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boldTerms, buildTourSteps, carryStep, placeCard, plainText, readTourFlags, richText, scrollDelta, SHORTCUTS, shouldOfferTour, spotlightHoles, stepEyebrow, TOUR_FLAG_KEY, TOUR_MEDIA, TOUR_STEPS, tourEnvironment, unionRect, visibleArea } from '../src/features/tour-model.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const quality = await readFile(new URL('../scripts/quality.mjs', import.meta.url), 'utf8');
const horizonView = await readFile(new URL('../src/features/horizon-view.js', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../src/features/onboarding.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../styles/core.css', import.meta.url), 'utf8');
const tourCss = await readFile(new URL('../styles/tour.css', import.meta.url), 'utf8');
const tourJs = await readFile(new URL('../src/features/tour.js', import.meta.url), 'utf8');
const stats = await readFile(new URL('../src/features/stats.js', import.meta.url), 'utf8');

/** Where the planner's own labels live: a bold name in a step must read exactly like one of them. */
const UI_SOURCES = [html, app, horizonView, stats];
const SYMBOL = /^[^\p{L}\p{N}]+$/u;
function labelled(term, sources = UI_SOURCES) {
  return term.split(' · ').every(part => SYMBOL.test(part) || sources.some(source => source.includes(part)));
}

// What a wide desktop shows: everything except the phone controls and the closed More menu.
const PHONE_ONLY = ['[data-mobile-view-switch]', '[data-mobile-view="horizon"]', '[data-week-view]', '[data-mobile-schedule-add]', '[data-mobile-more]', '[data-mobile-more-menu]', '[data-today]'];
const desktop = (hidden = []) => selector => ![...PHONE_ONLY, ...hidden].includes(selector);
// A phone (≤620px): the bottom bar with Horizon, the Day / Week button, More; no header switch or secondary buttons.
const PHONE_HIDDEN = ['[data-view-switch]', '[data-view-option="horizon"]', '[data-view-option="week"]', '.date-nav', '[data-prev]', '[data-next]', '[data-today]', '[data-schedule-add]', '[data-pip]', '[data-print]', '[data-settings-open]', '[data-help-open]', '[data-expanded-view]', '[data-mobile-more-menu]'];
const phone = ({ hidden = [], pane = 'plan' } = {}) => (selector, stepPane = '') => {
  if ([...PHONE_HIDDEN, ...hidden].includes(selector)) return false;
  const showing = stepPane || pane;
  if (['.focus', '.priority-section', '[data-secondary-priorities]', '.tasks-section'].includes(selector)) return showing === 'plan';
  if (['[data-mobile-schedule-add]', '[data-blocks] .time-block', '[data-end-day-open]'].includes(selector)) return showing === 'schedule';
  return true;
};

const ids = steps => steps.map(step => step.id);
const keysOf = step => step.keys.map(item => item.keys.join(''));

test('a desktop gets ten steps, in the order of the screen, with their shortcuts', () => {
  const steps = buildTourSteps({ layout: 'desktop', keys: true, visible: desktop() });
  assert.deepEqual(ids(steps), ['views', 'dates', 'outcomes', 'tasks', 'schedule', 'closeDay', 'horizon', 'reflect', 'tools', 'settings']);
  assert.ok(steps.length >= 8 && steps.length <= 12);
  const by = Object.fromEntries(steps.map(step => [step.id, step]));
  assert.deepEqual(keysOf(by.views), ['V']);
  assert.deepEqual(keysOf(by.dates), ['←→', 'N']);
  assert.deepEqual(keysOf(by.schedule), ['T']);
  assert.deepEqual(keysOf(by.closeDay), ['D']);
  assert.deepEqual(keysOf(by.horizon), ['Y', '1–7']);
  assert.deepEqual(keysOf(by.reflect), ['J', 'U', 'S']);
  assert.deepEqual(keysOf(by.tools), ['F', 'I', 'P']);
  assert.deepEqual(keysOf(by.settings), ['G', 'H']);
  assert.equal(by.outcomes.join, true, 'Keep in mind and the outcomes are one spotlight');
  steps.forEach(step => {
    assert.ok(step.title && step.body && step.name, `${step.id} has a title, words and a name for the highlighted element`);
    assert.ok(plainText(step.body).length <= 260, `${step.id} stays short (${plainText(step.body).length} characters)`);
    assert.doesNotMatch(`${step.title} ${step.body}`, /'|"/, `${step.id} uses curly quotes`);
    assert.equal(step.pane, '', 'desktop steps never switch a phone pane');
  });
});

test('each step names what it shows in bold, as the planner labels it', () => {
  const layouts = [
    buildTourSteps({ layout: 'desktop', keys: true, visible: desktop() }),
    buildTourSteps({ layout: 'desktop', keys: true, visible: selector => !['[data-print]', '[data-settings-open]', '[data-help-open]', '[data-mobile-view-switch]', '[data-week-view]', '[data-mobile-more-menu]'].includes(selector) }),
    buildTourSteps({ layout: 'phone', keys: false, touch: true, visible: phone() })
  ];
  const expected = { views: 'Day · Week · Horizon', tools: 'Search', reflect: 'Journal', closeDay: 'Close day', settings: 'Settings', schedule: 'Add a block|+', outcomes: 'Most important outcome', tabs: 'Plan' };
  layouts.flat().forEach(step => {
    const terms = boldTerms(step.body);
    assert.ok(terms.length, `${step.id}: names something in bold`);
    terms.forEach(term => assert.ok(labelled(term), `${step.id}: “${term}” reads like the planner’s own label`));
    if (expected[step.id]) assert.ok(expected[step.id].split('|').some(term => terms.includes(term)), `${step.id}: ${expected[step.id]} in bold`);
    assert.doesNotMatch(plainText(step.body), /\*\*/, `${step.id}: no stray marks`);
  });
  const desk = layouts[0].find(step => step.id === 'tools');
  assert.deepEqual(boldTerms(desk.body), ['Search', 'Floating mode', 'Print']);
});

test('bold marks become text parts, never markup', () => {
  assert.deepEqual(richText('Open **Print** now'), [{ text: 'Open ', strong: false }, { text: 'Print', strong: true }, { text: ' now', strong: false }]);
  assert.deepEqual(richText('**A** and **B**'), [{ text: 'A', strong: true }, { text: ' and ', strong: false }, { text: 'B', strong: true }]);
  assert.deepEqual(richText('a ** lone mark'), [{ text: 'a ** lone mark', strong: false }], 'an unpaired mark stays as typed');
  assert.deepEqual(richText('<img src=x onerror=alert(1)> **<b>x</b>**').map(part => part.text), ['<img src=x onerror=alert(1)> ', '<b>x</b>'], 'text stays text');
  assert.equal(plainText('The **Journal** and **Unresolved**'), 'The Journal and Unresolved');
  assert.deepEqual(richText(''), []);
  // The card builds <strong> nodes with textContent, and announces the words without their marks.
  assert.match(tourJs, /strong\.textContent = part\.text;/);
  assert.match(tourJs, /plainText\(step\.body\)/);
  assert.doesNotMatch(tourJs, /innerHTML = step\.body/);
  assert.match(tourCss, /\.tour-card__text strong \{/);
});

test('pointer and touch wording, and no shortcuts where Help shows none', () => {
  const pointer = buildTourSteps({ layout: 'desktop', keys: true, touch: false, visible: desktop() });
  const touch = buildTourSteps({ layout: 'desktop', keys: false, touch: true, visible: desktop() });
  assert.match(plainText(pointer.find(step => step.id === 'schedule').body), /^Click an empty slot/);
  assert.match(plainText(touch.find(step => step.id === 'schedule').body), /^Tap an empty slot/);
  assert.match(plainText(touch.find(step => step.id === 'dates').body), /Tap the date/);
  assert.ok(touch.every(step => step.keys.length === 0), 'a touch-only tablet shows no keycaps');
});

test('floating mode is only taught where the browser has it', () => {
  const steps = buildTourSteps({ layout: 'desktop', keys: true, visible: desktop(['[data-pip]']) });
  const tools = steps.find(step => step.id === 'tools');
  assert.deepEqual(keysOf(tools), ['F', 'P']);
  assert.doesNotMatch(tools.body, /Floating/);
  assert.deepEqual(tools.spot, ['[data-search-open]', '[data-print]']);
});

test('a narrow desktop (secondary buttons under More) ends on the More menu', () => {
  const steps = buildTourSteps({ layout: 'desktop', keys: true, visible: selector => !['[data-print]', '[data-settings-open]', '[data-help-open]', '[data-mobile-view-switch]', '[data-week-view]', '[data-mobile-more-menu]'].includes(selector) });
  const tools = steps.find(step => step.id === 'tools');
  assert.match(plainText(tools.body), /Print, under More/);
  assert.deepEqual(keysOf(tools), ['F', 'I', 'P'], 'P still prints');
  const last = steps.at(-1);
  assert.equal(last.id, 'settings');
  assert.equal(last.menu, 'more');
  assert.deepEqual(last.spot, ['[data-mobile-more]', '[data-mobile-more-menu]'], 'the menu it opens is lit with its button');
});

test('a phone follows the bottom tabs, the header and More, without keycaps', () => {
  const steps = buildTourSteps({ layout: 'phone', keys: false, touch: true, visible: phone() });
  assert.deepEqual(ids(steps), ['tabs', 'dates', 'outcomes', 'tasks', 'schedule', 'closeDay', 'horizon', 'reflect', 'settings']);
  assert.ok(steps.every(step => step.keys.length === 0));
  const by = Object.fromEntries(steps.map(step => [step.id, step]));
  assert.equal(by.tabs.title, 'Plan, Schedule, Horizon');
  assert.deepEqual(by.dates.spot, ['[data-week-view]', '[data-date-picker]'], 'Now only shows away from today');
  assert.equal(by.outcomes.pane, 'plan');
  assert.equal(by.tasks.pane, 'plan');
  assert.equal(by.schedule.pane, 'schedule', 'the schedule steps switch to the Schedule tab');
  assert.equal(by.closeDay.pane, 'schedule');
  assert.equal(by.schedule.spot[0], '[data-mobile-schedule-add]');
  assert.deepEqual(by.horizon.spot, ['[data-mobile-view="horizon"]']);
  assert.equal(by.settings.menu, 'more');
  assert.match(plainText(by.settings.body), /take this tour again/);
  assert.doesNotMatch(steps.map(step => plainText(step.body)).join(' '), /\bClick\b/, 'phones are tapped');
});

test('a phone answers for the pane each step shows, not the one on screen', () => {
  const fromSchedule = buildTourSteps({ layout: 'phone', keys: false, visible: phone({ pane: 'schedule' }) });
  assert.deepEqual(ids(fromSchedule), ['tabs', 'dates', 'outcomes', 'tasks', 'schedule', 'closeDay', 'horizon', 'reflect', 'settings']);
});

test('between 621 and 790px the phone tour uses the header switch for Horizon', () => {
  const header = ['[data-view-switch]', '[data-view-option="horizon"]', '[data-view-option="week"]'];
  const visible = (selector, pane) => (header.includes(selector) ? true : phone({ hidden: ['[data-mobile-view="horizon"]', '[data-week-view]'] })(selector, pane));
  const by = Object.fromEntries(buildTourSteps({ layout: 'phone', keys: true, visible }).map(step => [step.id, step]));
  assert.equal(by.tabs.title, 'Plan and Schedule');
  assert.deepEqual(by.dates.spot, ['[data-view-switch]', '[data-date-picker]']);
  assert.deepEqual(by.horizon.spot, ['[data-view-option="horizon"]']);
  assert.deepEqual(keysOf(by.horizon), ['Y'], 'a keyboard in this range still sees the keys');
});

test('a step whose element is hidden is left out', () => {
  const steps = buildTourSteps({ layout: 'desktop', keys: true, visible: desktop(['[data-end-day-open]', '.tasks-section']) });
  assert.ok(!ids(steps).includes('closeDay'));
  assert.ok(!ids(steps).includes('tasks'));
  assert.equal(steps.length, 8);
  assert.deepEqual(buildTourSteps({ layout: 'desktop', visible: () => false }), []);
});

test('shortcut labels have one source, and it matches the planner', () => {
  const keymap = app.slice(app.indexOf('const shortcuts = {'), app.indexOf('const action = shortcuts[key];'));
  assert.ok(keymap.length > 100, 'found the planner keymap');
  Object.entries(SHORTCUTS).forEach(([id, shortcut]) => {
    assert.ok(shortcut.codes.length || id === 'horizonSections', `${id} is a planner key (or Horizon's own)`);
    shortcut.codes.forEach(code => assert.match(keymap, new RegExp(`\\b${code}: `), `${id}: app.js handles "${code}"`));
    shortcut.controls.forEach((control, index) => {
      const attr = control.slice(1, -1).split('=')[0];
      const value = control.includes('=') ? control.slice(1, -1).split('=')[1] : null;
      const tag = html.split('\n').find(line => line.includes(value ? `${attr}=${value}` : `${attr} `) && line.includes('data-tooltip-key'));
      assert.ok(tag, `${id}: ${control} carries a tooltip key`);
      const key = shortcut.keys[Math.min(index, shortcut.keys.length - 1)];
      assert.match(tag, new RegExp(`data-tooltip-key="${key}"`), `${id}: ${control} shows ${key}`);
    });
    shortcut.keys.forEach(key => assert.match(html, new RegExp(`<kbd>${key}</kbd>`), `${id}: How it works lists ${key}`));
  });
  assert.match(app, /dataset\.tooltipKey = 'D'/, 'Close day shows D');
  assert.match(horizonView, /\/\^\[1-7\]\$\/\.test\(event\.key\)/, 'Horizon takes 1–7 for its sections');
  assert.equal(SHORTCUTS.floating.requires, '[data-pip]');
});

test('the step model has no shortcut the planner lacks', () => {
  ['desktop', 'phone'].forEach(layout => TOUR_STEPS[layout].forEach(def => def.variants.forEach(variant => (variant.keys || []).forEach(id => assert.ok(SHORTCUTS[id], `${layout}/${def.id}: ${id}`)))));
});

test('eyebrows and carrying a step across a breakpoint', () => {
  assert.equal(stepEyebrow(2, 9), 'Tour · 3 of 9');
  const desk = buildTourSteps({ layout: 'desktop', visible: desktop() });
  const mob = buildTourSteps({ layout: 'phone', visible: phone() });
  assert.equal(mob[carryStep(desk, mob, desk.findIndex(step => step.id === 'closeDay'))].id, 'closeDay');
  assert.equal(carryStep(desk, mob, desk.findIndex(step => step.id === 'tools')), desk.findIndex(step => step.id === 'tools'), 'no twin: the same position');
  assert.equal(carryStep(desk, mob.slice(0, 3), 9), 2, 'clamped to the shorter list');
});

test('environment follows the planner media rules', () => {
  const env = queries => tourEnvironment(query => queries.includes(query));
  assert.deepEqual(env([]), { layout: 'desktop', keys: true, touch: false });
  assert.deepEqual(env([TOUR_MEDIA.phone, TOUR_MEDIA.noKeys, TOUR_MEDIA.touch]), { layout: 'phone', keys: false, touch: true });
  assert.deepEqual(env([TOUR_MEDIA.touch]), { layout: 'desktop', keys: true, touch: true }, 'a tablet with a keyboard keeps its keys');
  const coreRule = '(max-width: 760px), (hover: none) and (pointer: coarse)';
  assert.equal(TOUR_MEDIA.noKeys, coreRule);
  assert.ok(core.includes(`@media ${coreRule} {\n  .help-faq.help-faq--shortcuts`), 'the rule that hides Help’s shortcut list');
  assert.ok(core.includes(`@media ${TOUR_MEDIA.phone} {\n  .planner`), 'the phone layout breakpoint');
});

test('spotlight holes: padded, clipped, a row merged, a stack kept apart, or joined', () => {
  const view = { width: 400, height: 300 };
  assert.deepEqual(spotlightHoles([{ left: 100, top: 100, right: 140, bottom: 130 }], view), [{ left: 94, top: 94, right: 146, bottom: 136 }]);
  assert.deepEqual(spotlightHoles([{ left: 0, top: 0, right: 30, bottom: 30 }], view), [{ left: 4, top: 4, right: 36, bottom: 36 }], 'never past the edge');
  const row = spotlightHoles([{ left: 100, top: 10, right: 132, bottom: 42 }, { left: 133, top: 10, right: 165, bottom: 42 }, { left: 166, top: 10, right: 198, bottom: 42 }], view);
  assert.deepEqual(row, [{ left: 94, top: 4, right: 204, bottom: 48 }], 'header buttons read as one group');
  const apart = spotlightHoles([{ left: 10, top: 10, right: 40, bottom: 40 }, { left: 300, top: 10, right: 330, bottom: 40 }], view);
  assert.equal(apart.length, 2);
  const stack = spotlightHoles([{ left: 330, top: 10, right: 362, bottom: 42 }, { left: 220, top: 48, right: 362, bottom: 280 }], view);
  assert.equal(stack.length, 2, 'a button and the menu under it stay two shapes');
  const joined = spotlightHoles([{ left: 10, top: 10, right: 200, bottom: 50 }, { left: 10, top: 90, right: 200, bottom: 160 }], view, { join: true });
  assert.deepEqual(joined, [{ left: 4, top: 4, right: 206, bottom: 166 }]);
  assert.deepEqual(spotlightHoles([{ left: 10, top: 10, right: 10, bottom: 50 }, null], view), []);
  assert.deepEqual(unionRect([{ left: 1, top: 2, right: 3, bottom: 4 }, { left: 0, top: 5, right: 2, bottom: 9 }]), { left: 0, top: 2, right: 3, bottom: 9 });
  assert.equal(unionRect([]), null);
});

test('the card sits beside its spotlight and always on screen', () => {
  const view = { width: 1440, height: 900 };
  const size = { width: 352, height: 240 };
  const header = placeCard({ left: 30, top: 12, right: 280, bottom: 58 }, size, view);
  assert.deepEqual(header, { side: 'below', left: 12, top: 72 }, 'below, kept off the left edge');
  const low = placeCard({ left: 600, top: 700, right: 700, bottom: 740 }, size, view);
  assert.equal(low.side, 'above');
  assert.equal(low.top, 700 - 14 - 240);
  const column = placeCard({ left: 550, top: 80, right: 1410, bottom: 895 }, size, view);
  assert.equal(column.side, 'left', 'a tall column on the right: the card goes to its left');
  assert.equal(column.left, 550 - 14 - 352);
  const leftColumn = placeCard({ left: 30, top: 80, right: 500, bottom: 895 }, size, view);
  assert.equal(leftColumn.side, 'right');
  const phoneView = { width: 390, height: 844 };
  const fill = placeCard({ left: 4, top: 60, right: 386, bottom: 760 }, { width: 366, height: 220 }, phoneView);
  assert.equal(fill.side, 'over', 'no room anywhere: over the end that hides it least');
  assert.equal(fill.top, 844 - 12 - 220);
  [header, low, column, leftColumn, fill].forEach(place => {
    assert.ok(place.left >= 12 && place.top >= 12, 'inside the margins');
  });
  assert.ok(fill.left + 366 <= 390 - 12);
});

test('pinch-zoomed: spotlight and card stay in the part of the page on screen, the card at its usual size', () => {
  const inner = { width: 390, height: 844 };
  assert.deepEqual(visibleArea(null, inner), { left: 0, top: 0, width: 390, height: 844, scale: 1 }, 'no visualViewport');
  assert.deepEqual(visibleArea({ offsetLeft: 0, offsetTop: 0, width: 0, height: 0, scale: 1 }, inner), { left: 0, top: 0, width: 390, height: 844, scale: 1 }, 'not laid out yet');
  // Zoomed 2.5× on the lower left, as after typing in a task (the card once ended up off screen there).
  const area = visibleArea({ offsetLeft: 0, offsetTop: 360, width: 156, height: 337.6, scale: 2.5 }, inner);
  assert.deepEqual(area, { left: 0, top: 360, width: 156, height: 337.6, scale: 2.5 });
  const holes = spotlightHoles([{ left: 10, top: 300, right: 380, bottom: 520 }], area);
  assert.deepEqual(holes, [{ left: 4, top: 364, right: 152, bottom: 526 }], 'clipped to the screen, not the page');
  const size = { width: 352, height: 180 };
  const place = placeCard(unionRect(holes), size, area);
  // In page pixels: the card, scaled by 1 / 2.5, fits in the 156 × 338 that is on screen.
  assert.ok(place.left >= area.left && place.left + size.width / area.scale <= area.left + area.width, `left ${place.left}`);
  assert.ok(place.top >= area.top && place.top + size.height / area.scale <= area.top + area.height, `top ${place.top}`);
  assert.equal(place.side, 'below');
  // A target off screen (the header, scrolled away by the zoom): no hole, the card in the middle of what is on screen.
  assert.deepEqual(spotlightHoles([{ left: 10, top: 10, right: 100, bottom: 50 }], area), []);
  const middle = placeCard(null, size, area);
  assert.equal(middle.side, 'over');
  assert.equal(middle.left, 0 + 19 / 2.5);
  assert.equal(middle.top, 360 + Math.round((844 - 180) / 2) / 2.5);
  // Not zoomed: page and screen are the same, as before.
  assert.deepEqual(placeCard({ left: 30, top: 12, right: 280, bottom: 58 }, size, { width: 1440, height: 900 }), { side: 'below', left: 12, top: 72 });
});

test('scroll just enough to show a target, centred', () => {
  const port = { top: 100, bottom: 700 };
  assert.equal(scrollDelta({ top: 200, bottom: 300 }, port), 0, 'already in view');
  assert.equal(scrollDelta({ top: 800, bottom: 900 }, port), 450, 'below: centred');
  assert.equal(scrollDelta({ top: 0, bottom: 60 }, port), -370, 'above: centred');
  assert.equal(scrollDelta({ top: 650, bottom: 1500 }, port), 538, 'taller than the area: its top first');
});

test('flags live under daily-planner-ui:, and earlier users are offered the tour once', () => {
  assert.equal(TOUR_FLAG_KEY, 'daily-planner-ui:tour', 'never synced or backed up (only daily-planner: keys are)');
  assert.deepEqual(readTourFlags(null), { seen: '', offered: '' });
  assert.deepEqual(readTourFlags('{bad'), { seen: '', offered: '' });
  assert.deepEqual(readTourFlags('{"seen":"2026-10-20T10:00:00Z"}'), { seen: '2026-10-20T10:00:00Z', offered: '' });
  assert.equal(shouldOfferTour({ seen: '', offered: '' }, { onboardingComplete: true }), true);
  assert.equal(shouldOfferTour({ seen: '', offered: '' }, { onboardingComplete: false }), false, 'never during setup');
  assert.equal(shouldOfferTour({ seen: '', offered: '' }, { onboardingComplete: true, busy: true }), false, 'never over a dialog');
  assert.equal(shouldOfferTour({ seen: 'x', offered: '' }, { onboardingComplete: true }), false);
  assert.equal(shouldOfferTour({ seen: '', offered: 'x' }, { onboardingComplete: true }), false, 'once');
});

test('the tour is wired: entries, setup hand-off, cache and styles', () => {
  assert.equal((html.match(/data-tour-open/g) || []).length, 2, 'How it works and More');
  assert.match(html, /<button class="primary-button" type="button" data-tour-open>Take the tour<\/button>/, 'How it works: the main action');
  assert.match(onboarding, /startTour\(\);/);
  assert.match(app, /startTour: \(\) => tour\.startWhenIdle\(\)/);
  assert.match(app, /tour\.maybeOffer\(\)/);
  assert.match(sw, /'\.\/src\/features\/tour\.js'/);
  assert.match(sw, /'\.\/src\/features\/tour-model\.js'/);
  assert.match(styles, /@import url\('\.\/styles\/tour\.css'\);/);
  assert.match(quality, /'tour\.css'/);
});

test('the tour never traps a phone or a click, and leaves the page as it found it', () => {
  // Pinch-zoom and panning stay free; once closing, clicks go through.
  assert.doesNotMatch(tourCss, /touch-action/);
  assert.match(tourCss, /\.tour:not\(\.is-open\) \{ pointer-events: none; \}/);
  assert.match(tourJs, /visualViewport\?\.\[method\]\('resize', onViewport\)/);
  assert.match(tourJs, /visualViewport\?\.\[method\]\('scroll', onViewport\)/);
  // Never over a popover; the pane comes back whatever the layout now.
  assert.match(tourJs, /const busy = \(\) => [^\n]*qs\('\.app-popover'\)/);
  assert.match(app, /createTour\(\{[^\n]*closePopovers: closeAllPopovers/);
  assert.match(tourJs, /if \(saved\.pane && currentPane\(\) !== saved\.pane\) setPane\(saved\.pane\);/);
  // What's new and the feedback request wait while the offer is up.
  assert.match(app, /feedbackFeature\.maybePrompt\(\{[^\n]*tour\.offerVisible\(\)/);
  // On Schedule, the offer sits above the + button.
  assert.match(tourCss, /body:has\(\.workspace\[data-mobile-active="schedule"\]\) \.tour-offer \{ bottom: calc\(var\(--mobile-dock-clearance\) \+ 74px\); \}/);
});
