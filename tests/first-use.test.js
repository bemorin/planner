import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { anyTipSeen, buildGuideSteps, canShowGuide, coveredBy, GUIDE_DIALOGS, GUIDE_KEYS, GUIDES_BY_ID, guideEyebrow, guideKeyAction, markSeen, pickGuide, readTipsFlags, switchTips, TIPS_FLAG_KEY, tipsOn } from '../src/features/first-use-model.js';
import { boldTerms, plainText } from '../src/features/tour-model.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [html, app, sw, horizonView, stats, weekReview, insightsView, firstUseJs, tourJs, tourCss, guidesCss, core, journalJs] = await Promise.all([
  '../index.html', '../app.js', '../sw.js', '../src/features/horizon-view.js', '../src/features/stats.js', '../src/features/week-review.js',
  '../src/features/insights-view.js', '../src/features/first-use.js', '../src/features/tour.js', '../styles/tour.css', '../styles/guides.css', '../styles/core.css',
  '../src/features/journal.js'
].map(read));

// Where the dialogs' labels live: a bold name in a guide reads exactly like one of them.
const UI_SOURCES = [html, app, horizonView, stats, weekReview, insightsView];
const SYMBOL = /^[^\p{L}\p{N}]+$/u;
const labelled = term => term.split(' · ').every(part => SYMBOL.test(part) || UI_SOURCES.some(source => source.includes(part)));

const all = () => true;
const without = hidden => selector => !hidden.some(css => selector.includes(css));
const ids = steps => steps.map(step => step.id);
const GUIDE_IDS = Object.keys(GUIDES_BY_ID);

test('every guide: two to four short steps, its parts named in bold as the dialog labels them', () => {
  assert.deepEqual(GUIDE_IDS.sort(), ['block', 'blockEdit', 'closeDay', 'horizon', 'insights', 'journal', 'search', 'settings', 'stats', 'unresolved', 'weekReview']);
  for (const id of GUIDE_IDS) {
    for (const touch of [false, true]) {
      for (const mode of ['add', 'edit']) {
        const steps = buildGuideSteps(id, { keys: !touch, touch, visible: all, context: { mode } });
        assert.ok(steps.length >= 2 && steps.length <= 4, `${id}: ${steps.length} steps`);
        steps.forEach(step => {
          const words = plainText(step.body);
          assert.ok(step.title && step.name && words, `${id}/${step.id}: a title, words and a name for what it shows`);
          assert.ok(words.length <= 240, `${id}/${step.id}: short (${words.length})`);
          assert.doesNotMatch(`${step.title} ${words}`, /'|"/, `${id}/${step.id}: curly quotes`);
          assert.doesNotMatch(words, /\*\*/, `${id}/${step.id}: no stray marks`);
          boldTerms(step.body).forEach(term => assert.ok(labelled(term), `${id}/${step.id}: “${term}” reads like the dialog’s own label`));
          assert.equal(step.pane, '');
          assert.equal(step.menu, '');
          if (touch) {
            assert.equal(step.keys.length, 0, 'no keycaps on a touch screen');
            assert.doesNotMatch(words, /\bClick\b/, `${id}/${step.id}: tapped, not clicked`);
          }
        });
        assert.ok(steps.some(step => boldTerms(step.body).length), `${id}: names a part in bold`);
      }
    }
  }
});

test('the block editor: what to write, category, time, notes; an edit adds done and Delete', () => {
  const add = buildGuideSteps('block', { keys: true, visible: all, context: { mode: 'add' } });
  assert.deepEqual(ids(add), ['title', 'category', 'time', 'notes']);
  assert.deepEqual(add[0].spot, ['.block-title-row']);
  assert.deepEqual(boldTerms(add[0].body), ['What will you complete?']);
  assert.deepEqual(add[0].keys, [{ keys: ['Enter'], label: 'Add or save, from the title' }]);
  assert.deepEqual(boldTerms(add[1].body), ['Category / project', 'Time stats', 'Manage']);
  assert.equal(add[2].join, true, 'the times and duration shortcuts are one spotlight');
  assert.match(plainText(add[2].body), /930 means 9:30/);
  assert.deepEqual(add[3].keys, [{ keys: ['//'], label: 'Checkbox in Notes' }]);
  const edit = buildGuideSteps('block', { keys: true, visible: all, context: { mode: 'edit' } });
  assert.ok(boldTerms(edit[0].body).includes('Mark as done'));
  assert.deepEqual(edit[3].spot, ['.block-notes-field', '[data-block-delete]']);
  assert.ok(boldTerms(edit[3].body).includes('Delete'));
  const later = buildGuideSteps('blockEdit', { keys: true, visible: all });
  assert.deepEqual(ids(later), ['done', 'delete']);
  assert.deepEqual(later.map(step => step.spot[0]), ['[data-block-done]', '[data-block-delete]']);
});

test('Close day: where the day stands, the two lines, a decision per item, then close', () => {
  const steps = buildGuideSteps('closeDay', { keys: true, visible: without(['[data-end-day-habit]']) });
  assert.deepEqual(ids(steps), ['summary', 'reflect', 'carry', 'close']);
  assert.deepEqual(boldTerms(steps[0].body), ['Done', 'Still open', 'Carry to']);
  assert.deepEqual(boldTerms(steps[2].body), ['Save', 'Unresolved', 'Forget']);
  assert.deepEqual(steps[2].spot, ['[data-end-day-list] .end-day-item'], 'the first item, scrolled into view');
  assert.deepEqual(steps.at(-1).keys, [{ keys: ['Esc'], label: 'Leave without closing the day' }]);
  assert.doesNotMatch(plainText(steps[1].body), /Winning habit/);
  const habit = buildGuideSteps('closeDay', { visible: all });
  assert.deepEqual(habit[1].spot, ['.end-day-reflection', '[data-end-day-habit]'], 'the habit is lit with the two lines when it shows');
  assert.ok(boldTerms(habit[1].body).includes('Winning habit'));
  const nothingOpen = buildGuideSteps('closeDay', { visible: without(['.end-day-item']) });
  assert.deepEqual(ids(nothingOpen), ['summary', 'reflect', 'close'], 'nothing unfinished: no decision step');
});

test('guides that need something to show wait for it', () => {
  assert.deepEqual(buildGuideSteps('journal', { visible: without(['.journal-row']) }), [], 'an empty Journal explains itself');
  assert.deepEqual(ids(buildGuideSteps('journal', { visible: all })), ['columns', 'open']);
  assert.deepEqual(buildGuideSteps('unresolved', { visible: without(['.open-work-row']) }), []);
  const later = buildGuideSteps('unresolved', { visible: without(['[data-open-later]']) });
  assert.deepEqual(boldTerms(later[1].body), ['Plan', 'Forget'], 'Later has no Save');
  const needs = buildGuideSteps('unresolved', { visible: all });
  assert.deepEqual(boldTerms(needs[1].body), ['Plan', 'Save', 'Forget']);
  const review = buildGuideSteps('weekReview', { visible: without(['.week-review-section--unresolved', '.week-share']) });
  assert.deepEqual(ids(review), ['metrics', 'waiting']);
  assert.ok(boldTerms(review[1].body).includes('Where your scheduled time went'));
  const week = buildGuideSteps('stats', { visible: without(['.stats-summary', '[data-stats-help]']) });
  assert.deepEqual(week[1].spot, ['[data-stats-week-nav]'], 'Week view: the week arrows');
  assert.deepEqual(buildGuideSteps('nope', { visible: all }), []);
});

test('which guide a dialog brings, once each', () => {
  assert.equal(pickGuide('closeDay', {}, {}), 'closeDay');
  assert.equal(pickGuide('closeDay', {}, { closeDay: 'x' }), '', 'shown once');
  assert.equal(pickGuide('block', { mode: 'add' }, {}), 'block');
  assert.equal(pickGuide('block', { mode: 'edit' }, {}), 'block', 'the first open, even an edit, gets the whole editor');
  assert.equal(pickGuide('block', { mode: 'edit' }, { block: 'x' }), 'blockEdit', 'then an edit adds done and Delete');
  assert.equal(pickGuide('block', { mode: 'add' }, { block: 'x' }), '');
  assert.equal(pickGuide('block', { mode: 'edit' }, { block: 'x', blockEdit: 'x' }), '');
  assert.deepEqual(coveredBy('block', { mode: 'edit' }), ['block', 'blockEdit']);
  assert.deepEqual(coveredBy('block', { mode: 'add' }), ['block']);
  assert.equal(pickGuide('stats', { view: 'day' }, {}), 'stats');
  assert.equal(pickGuide('stats', { view: 'insights', insights: 'ready' }, {}), 'insights');
  assert.equal(pickGuide('stats', { view: 'insights', insights: 'thin' }, {}), '');
  assert.equal(pickGuide('dayClosed', { stage: 'day-prep' }, {}), '');
  assert.equal(pickGuide('dayClosed', { stage: 'review' }, {}), 'weekReview');
  assert.equal(pickGuide('help', {}, {}), '', 'only the main dialogs');
  Object.keys(GUIDE_DIALOGS).filter(id => !['block', 'stats', 'dayClosed'].includes(id)).forEach(id => assert.equal(pickGuide(id, {}, {}), id));
});

test('never during the tour, over another guide, a picker, the floating window or a dialog opened by code', () => {
  const base = { ready: true, person: true, busy: false, floating: false, open: true, popover: false };
  assert.equal(canShowGuide(base), true);
  assert.equal(canShowGuide({ ...base, ready: false }), false, 'not during first-run setup');
  assert.equal(canShowGuide({ ...base, busy: true }), false, 'the tour or another guide is on screen');
  assert.equal(canShowGuide({ ...base, floating: true }), false);
  assert.equal(canShowGuide({ ...base, open: false }), false, 'the dialog closed, or another is on top');
  assert.equal(canShowGuide({ ...base, popover: true }), false);
  assert.equal(canShowGuide({ ...base, person: false }), false, 'a dialog the planner opened by itself');
  assert.equal(canShowGuide(), false);
});

test('flags live under daily-planner-ui:, and the Tips switch turns every guide off or brings them all back', () => {
  assert.equal(TIPS_FLAG_KEY, 'daily-planner-ui:tips', 'never synced or backed up');
  assert.deepEqual(readTipsFlags(null), { seen: {} });
  assert.deepEqual(readTipsFlags('{bad'), { seen: {} });
  assert.deepEqual(readTipsFlags('{"seen":{"closeDay":"2026-10-20","x":3}}'), { seen: { closeDay: '2026-10-20' } }, 'only dates are kept');
  const flags = markSeen(readTipsFlags(null), ['block', 'blockEdit'], 't');
  assert.deepEqual(flags, { seen: { block: 't', blockEdit: 't' } });
  assert.equal(anyTipSeen(flags), true);
  assert.equal(anyTipSeen({ seen: {} }), false);
  // How it works → Tips is a switch: on while a guide is still to come.
  assert.equal(tipsOn({ seen: {} }), true);
  assert.equal(tipsOn(flags), true, 'some seen, others still to come');
  const off = switchTips(flags, false, 'u');
  assert.deepEqual(Object.keys(off.seen).sort(), [...GUIDE_IDS].sort(), 'off: every guide counts as seen, so none shows');
  assert.equal(tipsOn(off), false);
  assert.deepEqual(switchTips(off, true, 'v'), { seen: {} }, 'back on: each shows again the next time its dialog opens');
  assert.equal(tipsOn(markSeen({ seen: {} }, GUIDE_IDS, 'w')), false, 'every guide already seen: nothing is left, and the switch says so');
  assert.equal(guideEyebrow(0, 3), 'Tips · 1 of 3');
  assert.equal(guideEyebrow(0, 1), 'Tip');
});

test('the keys a guide teaches are the ones the dialog handles', () => {
  Object.values(GUIDES_BY_ID).forEach(guide => guide.steps.forEach(step => step.variants.forEach(variant => (variant.keys || []).forEach(key => assert.ok(GUIDE_KEYS[key], key)))));
  const form = /<form class="block-form" data-block-form>[\s\S]*?<\/form>/.exec(html)?.[0] || '';
  assert.match(form, /<input name="title"/, 'Enter in the title submits the block form');
  assert.match(form, /type="submit" data-block-submit/);
  assert.match(app, /if \(!\/\^\\\/\\\/\.\*\$\/\.test\(text\)\) return;/, '// makes a checkbox in Notes');
  assert.match(app, /if \(activeModal\) \{ closeModal\(activeModal\); return; \}/, 'Esc closes the dialog, nothing saved');
  assert.match(horizonView, /\/\^\[1-7\]\$\/\.test\(event\.key\)/);
  assert.match(horizonView, /event\.key === '\+'/);
  assert.match(horizonView, /event\.key === 'p' \|\| event\.key === 'P'/);
  const own = app.slice(app.indexOf('const activeModalShortcut = {'), app.indexOf('}[key];'));
  [['y', 'horizon'], ['j', 'journal'], ['u', 'open-work'], ['s', 'stats'], ['g', 'settings']].forEach(([key, name]) => assert.match(own, new RegExp(`${key}: '\\[data-${name}-modal\\]'`), `${key.toUpperCase()} closes ${name}`));
  assert.match(app, /f: openSearchModal/);
  assert.deepEqual([GUIDE_KEYS.closeHorizon, GUIDE_KEYS.closeJournal, GUIDE_KEYS.closeUnresolved, GUIDE_KEYS.closeStats, GUIDE_KEYS.closeSettings, GUIDE_KEYS.search].map(item => item.keys[0]), ['Y', 'J', 'U', 'S', 'G', 'F']);
});

test('every guide’s dialog and parts exist in the planner', () => {
  Object.values(GUIDE_DIALOGS).forEach(selector => assert.match(html, new RegExp(`class="modal[^"]*" ${selector.slice(1, -1)} hidden`), selector));
  // The Journal's rows are drawn by src/features/journal.js (1.39.3).
  const sources = [html, app, horizonView, stats, weekReview, insightsView, journalJs].join('\n');
  const tokens = selector => selector.match(/\.[\w-]+|\[[\w-]+/g) || [];
  Object.entries(GUIDES_BY_ID).forEach(([id, guide]) => guide.steps.forEach(step => step.variants.forEach(variant => {
    [...variant.spot, variant.when || ''].concat(guide.requires || '').flatMap(entry => [typeof entry === 'string' ? entry : entry.css, entry?.closest || '']).filter(Boolean).forEach(selector => {
      tokens(selector).forEach(token => {
        const needle = token.startsWith('.') ? token.slice(1) : token.slice(1);
        assert.ok(sources.includes(needle), `${id}/${step.id}: ${token} is in the planner`);
      });
    });
  })));
});

test('while a guide is open, its own keys work it; any other key closes it and goes on, modifiers wait', () => {
  for (const key of ['Escape', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']) assert.equal(guideKeyAction({ key }), 'own', key);
  assert.equal(guideKeyAction({ key: 'Tab', shiftKey: true }), 'own', 'Shift+Tab moves back in the card');
  assert.equal(guideKeyAction({ key: 'Escape', ctrlKey: true }), 'own');
  for (const key of ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']) assert.equal(guideKeyAction({ key }), 'wait', key);
  // Shortcuts, letters, a paste, dead keys and composing all close the guide and go on.
  for (const event of [{ key: 'y' }, { key: 'Y', shiftKey: true }, { key: 's' }, { key: 'é' }, { key: '1' }, { key: 'v', ctrlKey: true }, { key: 'v', metaKey: true }, { key: 'Dead' }, { key: 'Process' }, { key: 'Unidentified' }, { key: '^' }, { key: 'a', isComposing: true }, { key: 'Enter', isComposing: true }, { key: 'Backspace' }, { key: 'Delete' }, { key: 'F5' }, { key: 'PageDown' }, { key: 'ArrowLeft', altKey: true }, { key: 'Enter', ctrlKey: true }, { key: '@', ctrlKey: true, altKey: true }]) {
    assert.equal(guideKeyAction(event), 'pass', JSON.stringify(event));
  }
  assert.equal(guideKeyAction(), 'pass');
  // The first-run tour waits for a guide on screen rather than being dropped, and a guide no longer cancels it.
  assert.match(tourJs, /if \(active && !guiding\(\)\) return;\n      if \(active \|\| busy\(\)\) \{ waited = true; idleTimer = setTimeout\(attempt, 300\); return; \}/);
  const guideFn = /function guide\([\s\S]*?\n  \}\n/.exec(tourJs)[0];
  assert.doesNotMatch(guideFn, /clearTimeout\(idleTimer\)/);
});

test('the Close day dialog keeps its footer in view at any height, so its last tip lights a whole button', () => {
  // The dialog is as tall as its content, up to the window; its scroll area shrinks to fit inside it, margins included.
  assert.match(core, /\[data-end-day-modal\] \.modal__panel \{ height: auto; max-height: calc\(100dvh - 1\.4rem\); display: flex; flex-direction: column; \}/);
  assert.match(core, /\[data-end-day-modal\] \.modal__scroll \{\n  flex: 0 1 auto; min-height: 0; height: auto; max-height: none; overflow-x: hidden; overflow-y: auto;/);
  // The form adds no box, so the sticky footer belongs to the scroll area; short windows scroll as one.
  assert.match(core, /\[data-end-day-form\] \{ min-height: 0; display: contents; \}/);
  assert.match(core, /@media \(max-width: 620px\), \(max-height: 720px\) \{\n  \.end-day-list \{ max-height: none; overflow: visible; \}\n\}/);
  assert.doesNotMatch(core, /\[data-end-day-modal\] \.modal__scroll \{ height: calc\(100% - 50px\)/);
  const step = GUIDES_BY_ID.closeDay.steps.at(-1);
  assert.deepEqual(step.variants[0].spot, ['[data-close-day-submit]']);
});

test('the guides are wired: app, cache, the tour engine, How it works', () => {
  assert.match(app, /import \{ createFirstUse \} from '\.\/src\/features\/first-use\.js';/);
  assert.match(app, /createFirstUse\(\{ tour, isReady: \(\) => !!settings\.onboardingComplete, isFloating: \(\) => !!pipFeature\?\.isOpen\(\), getActiveModal: \(\) => activeModal \}\);/);
  assert.match(sw, /'\.\/src\/features\/first-use\.js'/);
  assert.match(sw, /'\.\/src\/features\/first-use-model\.js'/);
  // Only a dialog a person opened; anything they do while it waits puts it off; once a guide shows, it is seen.
  assert.match(firstUseJs, /navigator\.userActivation \? navigator\.userActivation\.isActive : true/);
  assert.match(firstUseJs, /const INTERACTIONS = \['keydown', 'pointerdown', 'input'\];/);
  assert.match(firstUseJs, /INTERACTIONS\.forEach\(type => document\.addEventListener\(type, cancel, true\)\);/);
  assert.match(firstUseJs, /if \(shown\) writeFlags\(markSeen\(flags, coveredBy\(id, context\)/);
  assert.match(firstUseJs, /tour\.endGuide\(modal\)/, 'a dialog that closes takes its guide with it');
  // The engine: one guide or the tour at a time, Esc closes only the guide, any other key closes it and goes on.
  assert.match(tourJs, /function guide\(\{ steps: built = \[\], scope = null, rebuild = null, onEnd = null \} = \{\}\) \{\n    if \(active \|\| !built\.length \|\| !scope\) return false;/);
  assert.match(tourJs, /const action = guiding\(\) \? guideKeyAction\(event\) : 'own';\n    if \(action === 'pass'\) \{\n      end\(\{ typing: true \}\);\n      if \(isField\(document\.activeElement\)\) event\.stopPropagation\(\);\n      return;\n    \}\n    \/\/ The planner's own shortcuts wait until the tour is over\.\n    event\.stopPropagation\(\);/, 'a key that passes is never stopped before the guide closes, nor prevented');
  assert.match(tourJs, /returnFocus\(\[focus\], \{ within: ended\.scope, typing \}\);/);
  assert.match(tourJs, /const within = guiding\(\) \? session\.scope : document;/, 'a guide lights parts of its own dialog');
  assert.match(tourJs, /root\.dataset\.kind = session\.kind;/, 'the page can tell a guide from the tour');
  assert.match(tourCss, /\.tour-card__text strong \{/, 'the same card, bold names included');
  // How it works → Tips: a switch with its state; its line says what a change does.
  const tips = /<li class="help-row help-tips" data-tips-row>[\s\S]*?<\/li>/.exec(html)?.[0] || '';
  assert.match(tips, /<input class="help-switch" type="checkbox" role="switch" data-tips-switch checked aria-labelledby="help-tips-title" aria-describedby="help-tips-note">/);
  assert.match(tips, /<strong id="help-tips-title">Tips<\/strong><span id="help-tips-note" data-tips-copy aria-live="polite">A short guide inside each dialog, the first time you open it\.<\/span>/);
  assert.match(firstUseJs, /toggle\.checked = tipsOn\(readFlags\(\)\);/);
  assert.match(firstUseJs, /writeFlags\(switchTips\(readFlags\(\), toggle\.checked, new Date\(\)\.toISOString\(\)\)\);/);
  assert.match(firstUseJs, /off: 'Off: dialogs open without tips\.'/);
  assert.doesNotMatch(html, /data-tips-reset|Show tips again/);
  assert.match(guidesCss, /\.privacy-switch,\n\.help-switch \{ appearance: none;/, 'the planner’s own switch');
});

test('How it works: each item names the planner’s parts in bold, the yearly rhythm included and nothing to buy (1.39)', () => {
  const items = [...html.matchAll(/<details class="help-faq" open><summary><h3>(\d+)\. ([^<]+)<\/h3><\/summary>([\s\S]*?)<\/details>/g)];
  assert.ok(items.length >= 12);
  items.forEach(([, number, title, body]) => assert.match(body, /<strong>/, `${number}. ${title} has bold names`));
  const year = items.find(([, , title]) => title === 'Plan, check in, look back')[3];
  ['Plan your year', 'Print the year', 'Your year in review', 'Quarter check-in', 'Insights', 'palettes'].forEach(term => assert.match(year, new RegExp(`<strong>${term}</strong>`), term));
  items.forEach(([, number, title, body]) => assert.doesNotMatch(`${title} ${body}`, /\bPlus\b|licen[cs]e|gift|unlock|upgrade|premium|price/i, `${number}. ${title}`));
});

test('How it works: two groups (1.38.1: no Teams or Partners cards), every row the same shape, actions lined up at the right (under the words, full width, on a phone); GitHub links carry the mark', () => {
  const top = /<div class="help-start">([\s\S]*?)\n {8}<\/div>\n\n {8}<div class="help-content">/.exec(html)?.[1] || '';
  assert.deepEqual([...top.matchAll(/<h3 class="help-group__title">([^<]+)<\/h3>/g)].map(match => match[1]), ['Get started', 'About this planner']);
  const rows = [...top.matchAll(/<li class="(?:help-row|help-card) ([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)];
  assert.deepEqual(rows.map(match => match[1]), ['help-tour', 'help-tips', 'help-version', 'help-privacy']);
  // Their pages aren't served while sales are paused: Help links to neither.
  assert.doesNotMatch(html, /href="\.\/(?:teams|partners)\/"/);
  rows.forEach(([, name, body]) => {
    assert.match(body, /^\s*<span class="help-row__icon" aria-hidden="true"><svg viewBox="0 0 24 24">/, `${name}: an icon`);
    assert.match(body, /<span class="help-row__text"><strong[^>]*>[^<]+(?:<span data-app-version><\/span>)?<\/strong><span[^>]*>/, `${name}: a title and one line`);
    assert.equal((body.match(/<(?:button|a|input)\b/g) || []).length, 1, `${name}: one action`);
  });
  // The tour is the main action; the rest stay quiet.
  assert.match(top, /<button class="primary-button" type="button" data-tour-open>Take the tour<\/button>/);
  assert.equal((top.match(/primary-button/g) || []).length, 1);
  // Every function keeps its hook: the tour, tips, what's new and feedback, the privacy notice.
  for (const hook of ['data-tour-open', 'data-tips-row', 'data-tips-switch', 'data-help-feedback hidden', 'data-feedback-open', 'data-privacy-entry hidden', 'data-privacy-open']) assert.ok(top.includes(hook), hook);
  assert.doesNotMatch(html + guidesCss, /class="help-feedback|\.help-feedback/, 'no more look-alike grey rows');
  assert.match(guidesCss, /\.help-row,\n\.help-card \{ display: grid; grid-template-columns: 32px minmax\(0, 1fr\) auto;/);
  assert.match(guidesCss, /\.help-row > :is\(button, a\) \{ min-width: 8\.5rem; white-space: nowrap; \}/, 'the actions share one width, at the right');
  assert.match(guidesCss, /\.help-cards \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 15rem\), 1fr\)\);/, 'two cards side by side, stacked on a phone');
  assert.match(guidesCss, /@media \(max-width: 560px\) \{\n {2}\.help-row \{ align-items: start; \}\n {2}\.help-row > :is\(button, a\) \{ grid-column: 1 \/ -1; width: 100%;/);
  assert.match(guidesCss, /\.help-group:not\(:has\(:is\(\.help-row, \.help-card\):not\(\[hidden\]\)\)\) \{ display: none; \}/, 'a group this copy hides entirely is left out');
  assert.match(guidesCss, /\.help-row:not\(\[hidden\]\) ~ \.help-row:not\(\[hidden\]\) \{ border-top: 1px solid var\(--line\); \}/, 'a line between the rows shown, never above the first');
  const header = /<a class="icon-button header-secondary" data-github-link[^>]*>\s*(<svg[^>]*><path class="icon-fill" d="([^"]+)"\/><\/svg>)/.exec(html);
  assert.ok(header, 'the header’s GitHub mark');
  const actions = /<div class="github-support__actions">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.match(actions, /data-github-link[^>]*><svg[^>]*><path class="icon-fill" d="[^"]+"\/><\/svg><span>View on GitHub<\/span><\/a>/);
  assert.match(actions, /data-github-sponsor[^>]*><svg[^>]*><path class="icon-fill" d="[^"]+"\/><\/svg><span>Sponsor on GitHub<\/span><\/a>/);
  assert.equal(actions.split(header[2]).length - 1, 2, 'the same mark as the header, on both');
  assert.match(core, /\.github-support__actions \.icon-fill \{ fill: currentColor; stroke: none; \}/);
});
