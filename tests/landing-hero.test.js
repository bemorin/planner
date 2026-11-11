import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HERO_SCRIPTS, HERO_VIEWS, HOLDS, rotationLeft, rotationPlays, rotationRunning, rotationSeen, rotationStart, rotationStep, sceneClasses, sceneClicks, sceneEnd } from '../welcome/hero-views.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');

const [DAY, YEAR] = HERO_VIEWS;
const step = (state, ...events) => events.reduce((current, event) => rotationStep(current, event), state);

test('the hero shows your day, then your year, each for its own time, and starts again', () => {
  assert.deepEqual(HERO_VIEWS.map(view => [view.id, view.scene]), [['day', 'day'], ['year', 'horizon']]);
  const start = rotationStart();
  assert.deepEqual(start, { view: 'day', elapsed: 0, auto: true, motion: true, holds: [], cue: '' });
  assert.equal(rotationRunning(start), true);
  assert.equal(rotationLeft(start), DAY.dwell);

  const part = rotationStep(start, { type: 'tick', ms: 4000 });
  assert.equal(part.view, 'day');
  assert.equal(part.elapsed, 4000);
  assert.equal(part.cue, '');
  assert.equal(rotationLeft(part), DAY.dwell - 4000);

  const year = rotationStep(part, { type: 'tick', ms: DAY.dwell - 4000 });
  assert.equal(year.view, 'year');
  assert.equal(year.elapsed, 0, 'the next view starts its own time');
  assert.equal(year.cue, 'switch');
  assert.equal(rotationLeft(year), YEAR.dwell);

  const back = rotationStep(year, { type: 'tick', ms: YEAR.dwell + 500 });
  assert.equal(back.view, 'day', 'and back to the day');
  assert.equal(back.cue, 'switch');
  assert.equal(rotationStep(back, { type: 'tick', ms: -50 }).elapsed, 0, 'time never runs backwards');
  assert.equal(rotationStep(back, { type: 'tick' }).elapsed, 0);
});

test('choosing a view shows it now and gives it its whole time', () => {
  const later = rotationStep(rotationStart(), { type: 'tick', ms: 9000 });
  const chosen = rotationStep(later, { type: 'choose', view: 'year' });
  assert.equal(chosen.view, 'year');
  assert.equal(chosen.elapsed, 0);
  assert.equal(chosen.cue, 'switch');
  assert.equal(chosen.auto, true, 'the turns go on');
  const same = rotationStep(chosen, { type: 'choose', view: 'year' });
  assert.equal(same.cue, '', 'the view already shown: nothing happens');
  assert.equal(rotationStep(chosen, { type: 'choose', view: 'week' }).view, 'year', 'an unknown view is ignored');
});

test('the pointer over the replica or keyboard focus on a choice holds the turn, and the scene plays on', () => {
  const start = rotationStep(rotationStart(), { type: 'tick', ms: 3000 });
  for (const reason of ['hover', 'focus']) {
    const held = rotationStep(start, { type: 'hold', reason, on: true });
    assert.equal(held.cue, '', `${reason}: the scene isn't touched`);
    assert.equal(rotationRunning(held), false);
    assert.equal(rotationPlays(held), true);
    const still = rotationStep(held, { type: 'tick', ms: 60000 });
    assert.equal(still.view, 'day', `${reason}: no turn while held`);
    assert.equal(still.elapsed, 3000, `${reason}: the time left is kept`);
    const free = rotationStep(still, { type: 'hold', reason, on: false });
    assert.equal(rotationRunning(free), true);
    assert.equal(free.elapsed, 3000, `${reason}: it goes on from where it was`);
  }
  const both = step(start, { type: 'hold', reason: 'hover', on: true }, { type: 'hold', reason: 'focus', on: true }, { type: 'hold', reason: 'hover', on: false });
  assert.equal(rotationRunning(both), false, 'every reason has to end');
  assert.deepEqual(both.holds, ['focus']);
  assert.deepEqual(rotationStep(both, { type: 'hold', reason: 'focus', on: true }).holds, ['focus'], 'a reason counts once');
  assert.deepEqual(rotationStep(start, { type: 'hold', reason: 'hover', on: false }).holds, [], 'ending what never started changes nothing');
});

test('a hidden tab or the hero off screen stops the scene; back in view it plays again from its start', () => {
  const running = step(rotationStart(), { type: 'choose', view: 'year' }, { type: 'tick', ms: 4000 });
  for (const reason of ['hidden', 'offscreen']) {
    const away = rotationStep(running, { type: 'hold', reason, on: true });
    assert.equal(away.cue, 'freeze', reason);
    assert.equal(rotationSeen(away), false);
    assert.equal(rotationPlays(away), false);
    const back = rotationStep(away, { type: 'hold', reason, on: false });
    assert.equal(back.cue, 'restart', reason);
    assert.equal(back.elapsed, 0, `${reason}: its whole time again`);
    assert.equal(back.view, 'year', `${reason}: the same view`);
  }
  // Both at once: the scene starts again only when both are over.
  const twice = step(running, { type: 'hold', reason: 'offscreen', on: true }, { type: 'hold', reason: 'hidden', on: true });
  assert.equal(twice.cue, '', 'already stopped');
  const half = rotationStep(twice, { type: 'hold', reason: 'hidden', on: false });
  assert.equal(half.cue, '');
  assert.equal(rotationStep(half, { type: 'hold', reason: 'offscreen', on: false }).cue, 'restart');
  // The page starts off screen until the observer says otherwise.
  const first = rotationStart({ holds: ['offscreen', '', 'nope'] });
  assert.deepEqual(first.holds, ['offscreen']);
  assert.equal(rotationStep(first, { type: 'hold', reason: 'offscreen', on: false }).cue, 'restart', 'the day plays as soon as the hero is seen');
  assert.equal(rotationStep(first, { type: 'hold', reason: 'later', on: true }).holds.length, 1, 'unknown reasons are ignored');
  assert.deepEqual(HOLDS, ['hover', 'focus', 'hidden', 'offscreen']);
});

test('pause stops the turns and the scene on its last frame; play starts the scene again', () => {
  const start = rotationStep(rotationStart(), { type: 'tick', ms: 5000 });
  const paused = rotationStep(start, { type: 'toggle' });
  assert.equal(paused.auto, false);
  assert.equal(paused.cue, 'finish');
  assert.equal(rotationRunning(paused), false);
  assert.equal(rotationPlays(paused), false);
  assert.equal(rotationStep(paused, { type: 'tick', ms: 60000 }).view, 'day', 'no turn while paused');
  const chosen = rotationStep(paused, { type: 'choose', view: 'year' });
  assert.equal(chosen.cue, 'switch', 'the choice still works, on its last frame');
  assert.equal(rotationPlays(chosen), false);
  assert.equal(rotationStep(paused, { type: 'hold', reason: 'offscreen', on: true }).cue, '', 'nothing to stop');
  assert.equal(step(paused, { type: 'hold', reason: 'offscreen', on: true }, { type: 'hold', reason: 'offscreen', on: false }).cue, '', 'nothing to start');
  const played = rotationStep(chosen, { type: 'toggle' });
  assert.equal(played.auto, true);
  assert.equal(played.cue, 'restart');
  assert.equal(played.elapsed, 0);
  assert.equal(rotationRunning(played), true);
  const unseen = step(paused, { type: 'hold', reason: 'hidden', on: true }, { type: 'toggle' });
  assert.equal(unseen.cue, '', 'played while hidden: it starts once seen');
  assert.equal(rotationStep(unseen, { type: 'hold', reason: 'hidden', on: false }).cue, 'restart');
});

test('reduced motion: nothing turns or plays, the choice still switches, and motion can come back', () => {
  const still = rotationStart({ motion: false });
  assert.equal(rotationRunning(still), false);
  assert.equal(rotationPlays(still), false);
  assert.equal(rotationStep(still, { type: 'tick', ms: 60000 }).view, 'day');
  assert.equal(rotationStep(still, { type: 'toggle' }).cue, '', 'no pause without motion');
  const chosen = rotationStep(still, { type: 'choose', view: 'year' });
  assert.equal(chosen.cue, 'switch');
  assert.equal(rotationStep(chosen, { type: 'hold', reason: 'offscreen', on: true }).cue, '');
  const moving = rotationStep(chosen, { type: 'motion', on: true });
  assert.equal(moving.cue, 'restart');
  assert.equal(moving.auto, true);
  assert.equal(rotationRunning(moving), true);
  // Paused by the visitor, then reduced motion on and off again: still paused, on its last frame.
  const paused = step(rotationStart(), { type: 'tick', ms: 3000 }, { type: 'toggle' }, { type: 'motion', on: false });
  assert.equal(paused.auto, false);
  const back = rotationStep(paused, { type: 'motion', on: true });
  assert.equal(back.auto, false, 'the pause is kept');
  assert.equal(back.motion, true);
  assert.equal(back.cue, 'finish', 'the scene stands on its last frame');
  assert.equal(rotationRunning(back), false);
  assert.equal(rotationPlays(back), false);
  assert.equal(rotationStep(back, { type: 'tick', ms: 60000 }).view, 'day', 'no turn');
  assert.equal(rotationStep(back, { type: 'toggle' }).cue, 'restart', 'play still starts it');
  const off = rotationStep(rotationStep(rotationStart(), { type: 'tick', ms: 2000 }), { type: 'motion', on: false });
  assert.equal(off.cue, 'finish');
  assert.equal(off.motion, false);
  assert.equal(off.elapsed, 0);
  assert.equal(rotationStep(off, { type: 'motion', on: false }).cue, '', 'no change, no cue');
});

test('each view stays long enough for its scene to end, and the scenes it plays have scripts', async () => {
  for (const view of HERO_VIEWS) {
    const script = HERO_SCRIPTS[view.scene];
    assert.ok(script?.length > 0 && script.cues.length > 0, `${view.scene} has a script`);
    assert.ok(sceneEnd(script) <= script.length, `${view.scene}: everything it sets in motion is over by its end`);
    assert.ok(view.dwell >= script.length, `${view.id}: its time covers its script`);
    assert.ok(view.dwell - sceneEnd(script) >= 1200, `${view.id}: a moment on its last frame before the turn`);
  }
  // The day's last change (its streak) comes well before its turn ends.
  assert.deepEqual(HERO_SCRIPTS.day.cues.at(-1), { at: 11700, count: '[data-count]', ms: 300 });
  assert.ok(DAY.dwell - 12000 >= 1200, 'a moment on the painted month');
  const landing = await read('welcome/landing.js');
  assert.match(landing, /import \{ HERO_SCRIPTS, setupHeroViews \} from '\.\/hero-views\.js';/);
  assert.match(landing, /import \{ playCues, setupScenes \} from '\.\/scenes\.js';/);
  for (const name of ['day', 'horizon']) {
    assert.match(landing, new RegExp(`\\n  ${name}: \\{ length: HERO_SCRIPTS\\.${name}\\.length,[^\\n]*run: t => playCues\\(t, HERO_SCRIPTS\\.${name}\\.cues\\) \\},`), `${name} plays its cues`);
  }
  assert.match(landing, /const scenes = setupScenes\(\{ scripts: SCRIPTS, motionOn, motionHooks \}\);\s*setupHeroViews\(qs\('\[data-hero-views\]'\), \{ scene: scenes\.scene, motionOn, motionHooks \}\);/);
  const scenes = await read('welcome/scenes.js');
  assert.match(scenes, /const watched = scenes\.filter\(scene => !scene\.root\.hasAttribute\('data-scene-driven'\)\);/, 'driven scenes are not played by scrolling');
  assert.match(scenes, /watched\.forEach\(scene => observer\.observe\(scene\.root\)\);/);
  assert.match(scenes, /return found;/);
  const module = await read('welcome/hero-views.js');
  assert.doesNotMatch(module, /^import /m, 'no imports: the preview inlines it as it is');
});

test('cues: the classes at a moment, each click, and when a script is over', () => {
  const script = {
    length: 3000,
    cues: [
      { at: 900, click: 'd-press' },
      { at: 100, add: 'd-cursor' },
      { at: 0, point: '.a', x: 0.5 },
      { at: 200, point: '.b', ms: 600 },
      { at: 900, add: 's-on' },
      { at: 1200, point: '.c', ms: 500 },
      { at: 1500, click: '' },
      { at: 1600, remove: 'd-cursor' },
      { at: 1700, count: '[data-count]', ms: 300 }
    ]
  };
  assert.deepEqual([...sceneClasses(script, 0)], []);
  assert.deepEqual([...sceneClasses(script, 950)].sort(), ['d-cursor', 'd-press', 's-on'], 'pressed for a moment');
  assert.deepEqual([...sceneClasses(script, 900 + 240)].sort(), ['d-cursor', 's-on'], 'then not');
  assert.deepEqual([...sceneClasses(script, 5000)], ['s-on'], 'the pointer gone');
  assert.deepEqual(sceneClicks(script), [
    { at: 900, press: 'd-press', target: '.b', still: true, shown: true },
    { at: 1500, press: '', target: '.c', still: false, shown: true }
  ], 'the second click comes while the pointer still moves');
  assert.equal(sceneEnd(script), 2140, 'the last ripple (1500 + 640) outlasts the count (2000)');
  assert.equal(sceneEnd({ cues: [] }), 0);
});

test('your day: the pointer ticks the most important outcome as it fills, then closes the day, and is gone at the end', () => {
  const day = HERO_SCRIPTS.day;
  const clicks = sceneClicks(day);
  for (const click of clicks) {
    assert.ok(click.shown, `${click.target}: the pointer is shown`);
    assert.ok(click.still, `${click.target}: and at rest on it`);
  }
  assert.deepEqual(clicks.map(click => click.target), ['.rp-row--mit .rp-check', '.rp-closebtn', '.rp-mi--save .rp-mc--save', '.rp-mi--forget .rp-mc--forget', '.rp-modal .rp-field', '.rp-modal .rp-primary']);
  const [tick, close] = clicks;
  assert.equal(tick.press, 'd-tick', 'the box dips');
  assert.ok(day.cues.some(cue => cue.add === 's-mit' && cue.at === tick.at), 'ticked as it is clicked');
  assert.ok(!sceneClasses(day, tick.at - 1).has('s-mit') && sceneClasses(day, tick.at).has('s-mit'));
  assert.ok(tick.at >= 1800 && tick.at <= 2300, 'about when the scene always ticked it, once the focus is typed');
  assert.equal(close.press, 'd-press');
  assert.ok(!sceneClasses(day, close.at).has('d-modal') && sceneClasses(day, close.at + 300).has('d-modal'), 'Close day opens its sheet');
  // The pointer comes in after the first frame, and is gone before the day is painted.
  const shown = day.cues.filter(cue => cue.add === 'd-cursor');
  assert.equal(shown.length, 1);
  const jump = day.cues.filter(cue => cue.point && cue.at <= shown[0].at).pop();
  assert.ok(jump && !jump.ms, 'it is placed unseen, then appears');
  assert.ok(!sceneClasses(day, day.cues.find(cue => cue.add === 's-closed').at).has('d-cursor'));
  assert.deepEqual([...sceneClasses(day, day.length)].sort(), ['s-block', 's-closed', 's-mit'], 'the last frame: data-final, no d- class');
});

test('your year: the pointer presses Add, opens Mini-adventures and ticks one lived, then ticks the last milestone back on the Overview', () => {
  const year = HERO_SCRIPTS.horizon;
  const clicks = sceneClicks(year);
  for (const click of clicks) {
    assert.ok(click.shown, `${click.target}: the pointer is shown`);
    assert.ok(click.still, `${click.target}: and at rest on it`);
  }
  assert.deepEqual(clicks.map(click => [click.target, click.press]), [
    ['.rp-hz-add', 'd-add'],
    ['.rp-hz-sec--adv', 'd-go-adv'],
    ['.rp-adv--lived .rp-check', 'd-tick-lived'],
    ['.rp-hz-sec--ov', 'd-go-ov'],
    ['.rp-hz-item--step .rp-check', 'd-tick-step']
  ]);
  const [add, open, lived, back, step] = clicks;
  const at = ms => sceneClasses(year, ms);
  assert.ok(!at(add.at).has('s-key') && at(add.at + 400).has('s-key'), 'the key date lands once Add is pressed');
  assert.ok(!at(open.at).has('d-adv') && at(open.at + 300).has('d-adv'), 'the section opens once its tab is pressed');
  assert.ok(at(lived.at).has('d-adv') && at(lived.at).has('s-lived') && !at(lived.at - 1).has('s-lived'), 'ticked in its section, as it is clicked');
  assert.ok(at(back.at).has('d-adv') && !at(back.at + 300).has('d-adv'), 'back on the Overview');
  assert.ok(!at(step.at).has('d-adv') && at(step.at).has('s-step') && !at(step.at - 1).has('s-step'), 'the milestone, on the Overview');
  assert.ok(!at(year.length).has('d-cursor'), 'the pointer steps aside and goes');
  assert.deepEqual([...at(year.length)].sort(), ['s-in', 's-key', 's-lived', 's-step'], 'the last frame: the Overview, all done');
  // Each move is a glide, never a jump while the pointer shows.
  for (const cue of year.cues.filter(item => item.point)) assert.ok(cue.ms > 0 || !at(cue.at).has('d-cursor'), cue.point);
});

test('the hero’s pointer: one in each replica, every target in its markup, every state styled, all of it outside the last frame', async () => {
  const page = await read('welcome/index.html');
  const hero = /<section class="hero"[\s\S]*?<\/section>/.exec(page)[0];
  const day = /<div class="rp rp--day[\s\S]*?(?=<div class="hero-view hero-view--year")/.exec(hero)[0];
  const year = /<div class="rp rp--horizon[\s\S]*?(?=<div class="hero-switch">)/.exec(hero)[0];
  const cursor = '<span class="rp-cursor"><i class="rp-cursor__ripple"></i><svg class="rp-cursor__arrow" viewBox="0 0 24 24"><path d="M4.5 2.5v16.6l4.3-4.2 2.9 6.6 3-1.3-2.9-6.5h6.1Z"/></svg></span>';
  for (const [name, markup] of [['day', day], ['horizon', year]]) {
    assert.equal(markup.split(cursor).length - 1, 1, `${name}: the same pointer, once`);
    const classes = new Set([...markup.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
    for (const cue of HERO_SCRIPTS[name].cues.filter(item => item.point)) {
      for (const [, cls] of cue.point.matchAll(/\.([\w-]+)/g)) assert.ok(classes.has(cls), `${name}: ${cue.point}`);
    }
  }
  // Horizon: the rail's two sections, and Mini-adventures as the planner shows it.
  assert.match(year, /<span class="rp-hz-pill"><\/span>\s*<span class="rp-hz-sec rp-hz-sec--ov"[^>]*>[\s\S]*?<b>Overview<\/b>/);
  assert.match(year, /<span class="rp-hz-sec rp-hz-sec--adv"[^>]*>[\s\S]*?<b>Mini-adventures<\/b>/);
  assert.equal((year.match(/class="rp-hz-sec[ "]/g) || []).length, 7, 'seven sections, as in the planner');
  assert.doesNotMatch(year, /is-on/, 'the open section follows the scene (d-adv), Overview without it');
  assert.match(year, /<div class="rp-hz-main">\s*<div class="rp-hz-ov">[\s\S]*<div class="rp-hz-adv" style="--k:var\(--adventure\)">/);
  assert.equal((year.match(/<span class="rp-adv[ "]/g) || []).length, 6, 'six mini-adventures');
  assert.equal((year.match(/rp-adv--lived/g) || []).length, 1);
  assert.match(year, /<span class="rp-adv rp-adv--lived">[\s\S]*?Planned[\s\S]*?Lived[\s\S]*?Weekend in Lisbon/);
  // Every d- state the scenes go through has a style, and scenes.js clears them all.
  const css = await read('welcome/landing.css');
  const states = new Set(Object.values(HERO_SCRIPTS).flatMap(script => script.cues.flatMap(cue => [cue.add, cue.remove, cue.click]).filter(cls => cls?.startsWith('d-'))));
  for (const cls of states) assert.ok(css.includes(`.${cls} `) || css.includes(`.${cls}.`), cls);
  assert.match(css, /\.rp\.d-cursor \.rp-cursor \{ opacity: 1; \}/, 'the pointer shows in either view');
  assert.match(css, /\.motion-ok \.rp\.d-click \.rp-cursor__ripple \{ animation:/);
  for (const name of ['day', 'horizon']) {
    const finals = new RegExp(`data-scene="${name}" data-final="([^"]+)"`).exec(hero)[1].split(' ');
    for (const cls of finals) assert.ok(!cls.startsWith('d-'), `${name}: ${cls}`);
  }
  const scenes = await read('welcome/scenes.js');
  assert.match(scenes, /const passing = root => \[\.\.\.root\.classList\]\.filter\(name => name\.startsWith\('d-'\) \|\| TRANSIENT\.includes\(name\)\);/);
  assert.match(scenes, /root\.classList\.remove\(\.\.\.finals, \.\.\.passing\(root\)\);/, 'reset');
  assert.match(scenes, /root\.classList\.remove\(\.\.\.passing\(root\), 'is-playing'\);/, 'finish');
  assert.match(scenes, /export function playCues\(t, cues\) \{/);
});

test('Mini-adventures takes the Overview’s place without changing the box: over it, and the narrow window gets the planner’s tabs', async () => {
  const css = await read('welcome/landing.css');
  assert.match(css, /\.rp-hz-main \{ position: relative;/);
  assert.match(css, /\.rp-hz-adv \{ position: absolute; inset: 0;[^}]*opacity: 0;/, 'over the Overview, which sets the size');
  assert.match(css, /\.rp--horizon\.d-adv \.rp-hz-adv \{ opacity: 1; transform: none; \}/);
  assert.match(css, /\.rp--horizon\.d-adv \.rp-hz-ov \{ opacity: 0;/);
  assert.match(css, /\.rp--horizon\.d-adv \.rp-hz-pill \{ transform: translateY\(6\.4em\); \}/, 'the open section’s card slides to the third section');
  const narrow = /\/\* Narrower, the rail becomes the tabs[\s\S]*?@container \(max-width: 520px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  assert.match(narrow, /\.rp--horizon \.rp-hz-nav \{ display: flex;/, 'the tabs above the section');
  assert.match(narrow, /\.rp--horizon \.rp-hz-pill,/);
  assert.doesNotMatch(css, /\.rp--horizon \.rp-hz-nav \{ display: none; \}/);
});

test('the hero: two replicas in one box, a labelled choice, a pause, a caption for each', async () => {
  const page = await read('welcome/index.html');
  const hero = /<section class="hero"[\s\S]*?<\/section>/.exec(page)[0];
  assert.match(hero, /<h1 id="hero-title" class="rise-title" aria-label="Plan what matters\. Close the day\. Keep the year in view\.">/, 'the heading is unchanged, its words rising (tests/rise-title.test.js)');
  assert.match(hero, /<figure class="hero__visual" data-hero-views>\s*<div class="rp-scale hero-stage">\s*<div class="hero-view hero-view--day is-shown" data-hero-view="day">/);
  assert.match(hero, /<div class="hero-view hero-view--year" data-hero-view="year">/);
  // Both replicas are pictures for sighted visitors, played by the hero.
  assert.match(hero, /data-scene="day" data-final="s-mit s-block s-closed" data-scene-driven data-first-frame aria-hidden="true"/, 'the day keeps its first frame before the script');
  assert.match(hero, /data-scene="horizon" data-final="s-in s-key s-lived s-step" data-scene-driven aria-hidden="true"/);
  assert.equal((hero.match(/data-first-frame/g) || []).length, 1, 'only the day is shown on first paint');
  // The choice: native radio buttons in a labelled group, the day first.
  assert.match(hero, /<div class="hero-switch__views" role="radiogroup" aria-label="What the planner shows">/);
  const choices = [...hero.matchAll(/<label class="hero-switch__view"><input type="radio" name="hero-view" value="(\w+)"( checked)? autocomplete="off" data-hero-choice>[\s\S]*?<span>([^<]+)<\/span><\/label>/g)].map(match => [match[1], !!match[2], match[3]]);
  assert.deepEqual(choices, [['day', true, 'Your day'], ['year', false, 'Your year']]);
  assert.deepEqual(choices.map(choice => choice[0]), HERO_VIEWS.map(view => view.id));
  assert.match(hero, /<span class="hero-switch__thumb" aria-hidden="true"><i class="hero-switch__fill" data-hero-fill><\/i><\/span>/);
  assert.match(hero, /<button class="hero-switch__pause" type="button" data-hero-pause>[\s\S]*?<span class="sr-only" data-hero-pause-label>Pause the animation<\/span><\/button>/);
  assert.match(hero, /<figcaption class="hero-captions">\s*<span data-hero-caption="day">A day in the planner:[^<]+<\/span>\s*<span data-hero-caption="year">Horizon, the year in the planner:[^<]+<\/span>\s*<\/figcaption>/);
  // Every icon the hero uses is in the page's sprite.
  const symbols = new Set([...page.matchAll(/<symbol id="([^"]+)"/g)].map(match => match[1]));
  for (const id of new Set([...hero.matchAll(/<use href="#([^"]+)"/g)].map(match => match[1]))) assert.ok(symbols.has(id), `#${id}`);
  for (const id of ['i-day', 'i-heart', 'i-pause', 'i-play']) assert.ok(symbols.has(id), id);
  // Counted numbers start from what the scene shows first.
  for (const [, to, from] of hero.matchAll(/data-count="(\d+)" data-from="(\d+)" data-at="\w+">(\d+)</g)) assert.ok(Number(to) > Number(from));
});

test('hero styles: the views share a box, the switch works without the script, motion only behind motion-ok', async () => {
  const css = await read('welcome/landing.css');
  assert.match(css, /\.hero-view \{ z-index: 0; grid-area: 1 \/ 1;/, 'one cell, each view stacked on its own');
  assert.match(css, /\.hero__visual:not\(\.is-live\):has\(\[data-hero-choice\]\[value="year"\]:checked\) :is\(\.hero-view--day, \[data-hero-caption="day"\]\) \{ visibility: hidden; \}/);
  assert.match(css, /\.hero__visual\.is-live \.hero-view\.is-shown \{ z-index: 1; visibility: visible; \}/);
  assert.match(css, /\.motion-ok \.hero-view\.is-entering \{ animation: hero-view-in/);
  assert.match(css, /\.js-anim \.hero-switch__pause,\n\.hero__visual\.is-moving \.hero-switch__pause \{ display: grid; \}/, 'the pause shows from first paint when motion is welcome');
  assert.match(css, /\.hero-switch__view:has\(input:focus-visible\) \{ outline: 2\.5px solid var\(--focus\);/, 'visible focus');
  // Every transition or animation of the Horizon replica waits for motion-ok.
  const horizon = /\/\* Hero: Horizon -+ \*\/([\s\S]*?)\/\* Close day -+ \*\//.exec(css)[1];
  for (const rule of horizon.split('\n').filter(line => /\b(transition|animation):/.test(line))) assert.match(rule.trim(), /^\.motion-ok /, rule);
});

test('the welcome pages use the planner’s scrollbar, without the browser’s arrows', async () => {
  const css = await read('welcome/landing.css');
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\) \{\n {2}html,\n {2}\* \{ scrollbar-width: thin; scrollbar-color: var\(--scrollbar-thumb\) transparent; \}\n\}/, 'standard properties only where ::-webkit-scrollbar is unknown');
  const outside = css.replace(/@supports not selector\(::-webkit-scrollbar\) \{[\s\S]*?\n\}/, '');
  assert.doesNotMatch(outside, /scrollbar-(?:width|color):/, 'set anywhere else, Chromium would ignore the parts below and draw arrows');
  assert.match(css, /\*::-webkit-scrollbar-button \{ display: none; width: 0; height: 0; \}/);
  assert.match(css, /\*::-webkit-scrollbar-thumb:hover,\n\*::-webkit-scrollbar-thumb:active \{\n {2}border-width: var\(--scrollbar-inset-active\);\n {2}background: var\(--scrollbar-thumb-hover\);/);
  assert.match(css, /--scrollbar-thumb: color-mix\(in srgb, var\(--line-strong\) 62%, var\(--paper\)\);/, 'the planner’s colours (styles/core.css)');
  assert.match(css, /--scrollbar-size: 12px;/, 'and its sizes (tests/scrollbar-style.test.js)');
  for (const page of ['welcome/index.html', 'contact/index.html']) {
    assert.match(await read(page), /<link rel="stylesheet" href="(?:\.\.\/(?:welcome\/)?)?(?:\.\/)?landing\.css">/, page);
  }
});

test('the caption is painted at once and stays one node: a turn changes its text, never adds a Largest Contentful Paint', async () => {
  const css = await read('welcome/landing.css');
  // The stage and the switch rise in; the caption, out of the rise-in, is on screen from first paint.
  assert.match(css, /\.hero__visual > :not\(\.hero-captions\) \{ animation: rise-in 820ms/);
  assert.match(css, /\.hero__visual > :not\(\.hero-captions\) \{ animation-duration: 1000ms; animation-delay: 180ms; \}/);
  assert.doesNotMatch(css, /\.hero__visual \{[^}]*animation/, 'the figure itself (with its caption) does not fade in');
  // With the script, no caption is shown or hidden: the first one gets each view's text.
  assert.doesNotMatch(css, /\.hero__visual\.is-live[^{]*\[data-hero-caption/, 'no caption toggles once live');
  assert.match(css, /\.hero-captions \[data-hero-caption="year"\] \{ visibility: hidden; \}|\.hero-view--year,\n\.hero-captions \[data-hero-caption="year"\] \{ visibility: hidden; \}/, 'the others keep the box at the tallest caption, hidden');
  const module = await read('welcome/hero-views.js');
  assert.match(module, /const caption = captionNodes\[0\] \|\| null;/);
  assert.match(module, /caption\.textContent = text;/);
  assert.match(module, /caption\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/, 'with motion it fades in with the view, on the same node');
  assert.doesNotMatch(module, /caption[A-Za-z]*\.(?:hidden|style\.visibility)/);
});

test('a view going out is reset to its first frame with its transitions off, so none runs unseen', async () => {
  const module = await read('welcome/hero-views.js');
  const rearm = /function rearm\(pane, replica\) \{([\s\S]*?)\n {2}\}/.exec(module)?.[1] || '';
  assert.ok(rearm.includes('replica.arm()') && rearm.indexOf("pane.classList.add('is-resetting')") < rearm.indexOf('replica.arm()'), 'transitions off first');
  assert.ok(rearm.indexOf('replica.arm()') < rearm.indexOf('void pane.offsetWidth') && rearm.indexOf('void pane.offsetWidth') < rearm.indexOf("pane.classList.remove('is-resetting')"), 'the reset styles apply before transitions are back');
  assert.match(module, /if \(key !== id && state\.motion\) rearm\(pane, scenes\.get\(key\)\);/);
  const css = await read('welcome/landing.css');
  // More specific than any replica transition (at most four classes), pseudo-elements included.
  assert.match(css, /\.motion-ok \.hero__visual\.is-live \.hero-view\.is-resetting \*,\n\.motion-ok \.hero__visual\.is-live \.hero-view\.is-resetting \*::before,\n\.motion-ok \.hero__visual\.is-live \.hero-view\.is-resetting \*::after \{ transition: none; \}/);
  // Every transition the two hero replicas can run (the other scenes' own rules aside).
  const selectors = [...css.matchAll(/^\s*(\.motion-ok [^{]*)\{[^}]*\btransition:/gm)].flatMap(match => match[1].split(/,(?![^(]*\))/)).map(selector => selector.trim());
  // (The panes' own entrance and exit run on visible panes, before any reset.)
  const hero = selectors.filter(selector => /\.rp(?:\b|-)/.test(selector) && !/\.rp--(?!day\b|horizon\b)[\w-]+/.test(selector) && !/\.(?:yp|mg)-|\.hero-/.test(selector));
  assert.ok(hero.length > 20, `${hero.length} replica transitions found`);
  for (const selector of hero) {
    const classes = (selector.match(/[.:][\w-]+/g) || []).length;
    assert.ok(classes <= 4 || /is-resetting/.test(selector), `${selector} would beat the reset`);
  }
});

test('narrower than the switch’s rise, Horizon fills the whole box: no empty band above the switch', async () => {
  const css = await read('welcome/landing.css');
  assert.match(css, /@container hero-visual \(min-width: 520px\) \{\n {2}\.hero-switch \{ margin-top: calc\(18px - 3\.6 \* /, 'wide: the switch rises into the room under the windows');
  assert.match(css, /\.rp--horizon \{ padding: 0 0 3\.6em; \}/, 'the same room as the Day view, kept free when the switch rises into it');
  const narrow = /@container hero-visual \(max-width: 519\.98px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  assert.match(narrow, /\.rp--horizon \{ padding-bottom: 0; \}/, 'narrow: its window takes that room');
  assert.match(narrow, /\.rp--horizon \.rp-hz-map \{ flex: 1 1 auto;/, 'shared between the year at a glance and the tiles');
  assert.match(narrow, /\.hero-view\.is-leaving \.rp--horizon \.rp-window \{ opacity: 0; \}/, 'going out, the taller window fades');
  assert.match(css, /\.hero-view > \.rp \{ flex: 1 1 auto; display: flex; flex-direction: column; \}/);
  assert.match(css, /\.hero-view \.rp-window \{ flex: 1 1 auto; \}/);
});
