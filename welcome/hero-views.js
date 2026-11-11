/**
 * The hero's replica (landing): Your day, then Your year. The Day view plays,
 * Horizon fades in over it and plays, then the Day view again, while the hero
 * is on screen. The switch under the replica names what is shown, fills a thin
 * line until the next turn and lets the visitor choose; the pause button stops
 * the turns and the animation. The turns wait while the pointer is over the
 * figure, while a choice has keyboard focus, while the tab is hidden and while
 * the hero is off screen (the last two also stop the scene, which plays again
 * from its start). With reduced motion nothing moves: each view shows its
 * final frame and the switch changes it at once.
 *
 * The choices are radio buttons, so the switch also works without JavaScript
 * (landing.css, with :has). The scenes are scenes.js scenes marked
 * `data-scene-driven`, played from here; their scripts are the cues below
 * (HERO_SCRIPTS), where a pointer does what each view shows.
 *
 * No imports: the single-file preview inlines this module as it is. The pure
 * turns and cues are unit-tested (tests/landing-hero.test.js).
 */

/** The views in order, the scene each plays and how long it stays (ms): its script, then a moment on its last frame. */
export const HERO_VIEWS = Object.freeze([
  Object.freeze({ id: 'day', scene: 'day', dwell: 14000 }),
  Object.freeze({ id: 'year', scene: 'horizon', dwell: 12400 })
]);

/*
 * The two scenes, as cues in time (ms from the scene's start), played by
 * scenes.js (playCues). A cue does one thing:
 *   { at, add: 'class' }, { at, remove: 'class' }   a state class of the replica
 *   { at, point: 'selector', ms, x, y }   the pointer glides onto a target in
 *       `ms` (without `ms` it jumps there, unseen); x and y place its tip (0–1)
 *   { at, click: 'class' }   the pointer dips and a ripple spreads; the target
 *       takes its pressed class for a moment ('' when nothing presses)
 *   { at, type: n }   the replica's n-th typed text ([data-type]) is typed
 *   { at, count: 'selector', ms }   those numbers count up
 * The d- classes are the pointer's way through the scene (shown, hovering,
 * pressing, the section it opened): never part of the last frame, which
 * scenes.js shows on reset and finish without them.
 */
const PRESS = 240; // how long a click's pressed class stays (scenes.js, click)
const RIPPLE = 640; // and its ripple
const cues = list => Object.freeze(list.map(cue => Object.freeze(cue)));

export const HERO_SCRIPTS = Object.freeze({
  // Your day: the focus is typed; the pointer comes up the plan and ticks the
  // most important outcome; a block lands on the schedule. Then it closes the
  // day: two open items decided, a memory written, and only then is the day's
  // square painted.
  day: Object.freeze({
    length: 14000,
    cues: cues([
      { at: 300, type: 0 },
      { at: 950, point: '.rp-plan', x: 0.62, y: 0.99 },
      { at: 1000, add: 'd-cursor' },
      { at: 1050, point: '.rp-row--mit .rp-check', ms: 850, x: 0.46, y: 0.52 },
      { at: 2050, click: 'd-tick' },
      { at: 2050, add: 's-mit' },
      { at: 2300, add: 's-block' },
      { at: 2500, point: '.rp-closebtn', ms: 1350, x: 0.42, y: 0.62 },
      { at: 3850, add: 'd-hover' },
      { at: 4150, click: 'd-press' },
      { at: 4450, remove: 'd-hover' },
      { at: 4450, add: 'd-modal' },
      { at: 5100, point: '.rp-mi--save .rp-mc--save', ms: 700 },
      { at: 5850, click: '' },
      { at: 5850, add: 'd-save' },
      { at: 6350, point: '.rp-mi--forget .rp-mc--forget', ms: 560 },
      { at: 7000, click: '' },
      { at: 7000, add: 'd-forget' },
      { at: 7550, point: '.rp-modal .rp-field', ms: 620, x: 0.16, y: 0.55 },
      { at: 8250, click: '' },
      { at: 8350, type: 1 },
      { at: 9650, point: '.rp-modal .rp-primary', ms: 640, x: 0.5, y: 0.58 },
      { at: 10400, click: 'd-submit' },
      { at: 10700, remove: 'd-modal' },
      { at: 10700, remove: 'd-cursor' },
      { at: 11050, add: 's-closed' },
      { at: 11200, remove: 'd-save' },
      { at: 11200, remove: 'd-forget' },
      { at: 11700, count: '[data-count]', ms: 300 }
    ])
  }),
  // Your year, Horizon: the year fills in; the pointer presses Add and a key
  // date lands on the map. It opens Mini-adventures in the rail (in a narrow
  // window, the tabs above) and ticks the weekend in Lisbon as lived. Back on
  // the Overview, it ticks the last milestone of the Misogi, whose bar fills,
  // and steps aside.
  horizon: Object.freeze({
    length: 11000,
    cues: cues([
      { at: 150, add: 's-in' },
      { at: 1050, point: '.rp-hz-map', x: 0.9, y: 0.94 },
      { at: 1100, add: 'd-cursor' },
      { at: 1200, point: '.rp-hz-add', ms: 900, x: 0.56, y: 0.62 },
      { at: 1950, add: 'd-over-add' },
      { at: 2350, click: 'd-add' },
      { at: 2600, remove: 'd-over-add' },
      { at: 2600, add: 's-key' },
      { at: 2940, count: '[data-at="key"]', ms: 120 },
      { at: 3350, point: '.rp-hz-sec--adv', ms: 850, x: 0.42, y: 0.56 },
      { at: 4050, add: 'd-over-adv' },
      { at: 4400, click: 'd-go-adv' },
      { at: 4500, add: 'd-adv' },
      { at: 4500, remove: 'd-over-adv' },
      { at: 5150, point: '.rp-adv--lived .rp-check', ms: 750, x: 0.48, y: 0.52 },
      { at: 6100, click: 'd-tick-lived' },
      { at: 6100, add: 's-lived' },
      { at: 6200, count: '[data-at="lived"]', ms: 120 },
      { at: 6950, point: '.rp-hz-sec--ov', ms: 800, x: 0.42, y: 0.56 },
      { at: 7600, add: 'd-over-ov' },
      { at: 7950, click: 'd-go-ov' },
      { at: 8050, remove: 'd-adv' },
      { at: 8050, remove: 'd-over-ov' },
      { at: 8600, point: '.rp-hz-item--step .rp-check', ms: 800, x: 0.48, y: 0.52 },
      { at: 9600, click: 'd-tick-step' },
      { at: 9600, add: 's-step' },
      { at: 9750, count: '[data-at="step"]', ms: 120 },
      { at: 10200, point: '.rp-hz-item--step', ms: 700, x: 0.62, y: 2.2 },
      { at: 10300, remove: 'd-cursor' }
    ])
  })
});

const inOrder = script => [...script.cues].sort((a, b) => a.at - b.at);

/** The replica's classes `ms` into a script: its state, and a click's pressed class for a moment. */
export function sceneClasses(script, ms) {
  const on = new Set();
  inOrder(script).forEach(cue => {
    if (cue.at > ms) return;
    if (cue.add) on.add(cue.add);
    if (cue.remove) on.delete(cue.remove);
    if (cue.click) {
      if (ms < cue.at + PRESS) on.add(cue.click);
      else on.delete(cue.click);
    }
  });
  return on;
}

/** Every click of a script: when, on what (the pointer's last target), and whether the pointer was shown and at rest there. */
export function sceneClicks(script) {
  const ordered = inOrder(script);
  return ordered.filter(cue => 'click' in cue).map(cue => {
    const glide = ordered.filter(item => item.point && item.at <= cue.at).pop();
    return {
      at: cue.at,
      press: cue.click,
      target: glide?.point || '',
      still: !!glide && glide.at + (glide.ms || 0) <= cue.at,
      shown: sceneClasses(script, cue.at).has('d-cursor')
    };
  });
}

/** When the last thing a script sets in motion is over (ms): a glide, a count, a ripple. */
export function sceneEnd(script) {
  return Math.max(0, ...script.cues.map(cue => cue.at + (cue.point || cue.count ? cue.ms || 0 : 0) + ('click' in cue ? RIPPLE : 0)));
}

/** What makes the turns wait. The last two also stop the scene: nobody can see it. */
export const HOLDS = Object.freeze(['hover', 'focus', 'hidden', 'offscreen']);
const UNSEEN = ['hidden', 'offscreen'];

const dwellOf = (view, views) => (views.find(item => item.id === view) || views[0]).dwell;

/** The first state: the first view, its time not started. */
export function rotationStart({ motion = true, holds = [] } = {}, views = HERO_VIEWS) {
  return { view: views[0].id, elapsed: 0, auto: true, motion: !!motion, holds: HOLDS.filter(reason => holds.includes(reason)), cue: '' };
}

/** The clock runs: motion welcome, not paused, nothing holding it. */
export const rotationRunning = state => !!(state.motion && state.auto && !state.holds.length);

/** Nothing hides the replica (the tab is visible and the hero on screen). */
export const rotationSeen = state => !state.holds.some(reason => UNSEEN.includes(reason));

/** The current scene plays (rather than standing still on a frame). */
export const rotationPlays = state => !!(state.motion && state.auto && rotationSeen(state));

/** Time left before the next view (ms). */
export const rotationLeft = (state, views = HERO_VIEWS) => Math.max(0, dwellOf(state.view, views) - state.elapsed);

/**
 * One step of the turns. Events:
 *   { type: 'tick', ms }           time passed; counts only while the clock runs
 *   { type: 'choose', view }       the visitor picked a view
 *   { type: 'hold', reason, on }   a reason to wait starts or ends (HOLDS)
 *   { type: 'toggle' }             the pause button
 *   { type: 'motion', on }         motion welcome again (on) or reduced motion turned on;
 *                                  a paused hero stays paused
 * The new state's `cue` is what the page does now: 'switch' (show `view`:
 * its scene from the start, or its last frame when nothing plays),
 * 'restart' (the scene again from its start), 'freeze' (the scene stops
 * where it is), 'finish' (the scene on its last frame) or ''.
 */
export function rotationStep(state, event = {}, views = HERO_VIEWS) {
  const next = { ...state, holds: [...state.holds], cue: '' };
  if (event.type === 'tick') {
    if (!rotationRunning(state)) return next;
    const elapsed = state.elapsed + Math.max(0, Number(event.ms) || 0);
    if (elapsed < dwellOf(state.view, views)) return { ...next, elapsed };
    const index = views.findIndex(item => item.id === state.view);
    return { ...next, view: views[(index + 1) % views.length].id, elapsed: 0, cue: 'switch' };
  }
  if (event.type === 'choose') {
    if (event.view === state.view || !views.some(item => item.id === event.view)) return next;
    return { ...next, view: event.view, elapsed: 0, cue: 'switch' };
  }
  if (event.type === 'hold') {
    if (!HOLDS.includes(event.reason) || !!event.on === state.holds.includes(event.reason)) return next;
    const after = { ...next, holds: HOLDS.filter(reason => (reason === event.reason ? !!event.on : state.holds.includes(reason))) };
    if (!UNSEEN.includes(event.reason) || !state.motion || !state.auto) return after;
    if (rotationSeen(state) && !rotationSeen(after)) return { ...after, cue: 'freeze' };
    if (!rotationSeen(state) && rotationSeen(after)) return { ...after, elapsed: 0, cue: 'restart' };
    return after;
  }
  if (event.type === 'toggle') {
    if (!state.motion) return next;
    if (state.auto) return { ...next, auto: false, elapsed: 0, cue: 'finish' };
    return { ...next, auto: true, elapsed: 0, cue: rotationSeen(state) ? 'restart' : '' };
  }
  if (event.type === 'motion') {
    const on = !!event.on;
    if (on === state.motion) return next;
    if (!on) return { ...next, motion: false, elapsed: 0, cue: 'finish' };
    // Motion back: a hero the visitor paused stays paused, on its last frame.
    if (!state.auto) return { ...next, motion: true, elapsed: 0, cue: 'finish' };
    return { ...next, motion: true, elapsed: 0, cue: rotationSeen(state) ? 'restart' : '' };
  }
  return next;
}

// How long a switch takes (landing.css: the view coming in waits 140 ms, then
// fades in and its content settles over 760 ms); then the view going out hides.
const SETTLE = 920;

/**
 * Wires the figure (`[data-hero-views]`). `scene(name)` gives a driven
 * scene's controls (setupScenes); `motionOn` says whether motion is welcome
 * now and `motionHooks` hears when that changes. Returns { state, choose, toggle }.
 */
export function setupHeroViews(figure, { scene = () => null, motionOn = false, motionHooks = [] } = {}) {
  if (!figure) return null;
  const views = HERO_VIEWS.filter(view => figure.querySelector(`[data-hero-view="${view.id}"]`));
  if (views.length < 2) return null;
  const panes = new Map(views.map(view => [view.id, figure.querySelector(`[data-hero-view="${view.id}"]`)]));
  const scenes = new Map(views.map(view => [view.id, scene(view.scene)]));
  const choices = [...figure.querySelectorAll('[data-hero-choice]')];
  const group = choices[0]?.closest('[role="radiogroup"]') || null;
  const pause = figure.querySelector('[data-hero-pause]');
  const pauseLabel = figure.querySelector('[data-hero-pause-label]');
  const fill = figure.querySelector('[data-hero-fill]');
  const stage = figure.querySelector('.hero-stage') || figure;
  const watch = 'IntersectionObserver' in window;
  // The caption is one node, the first (on screen from first paint), whose
  // text follows the view: a turn shows no new text, so the page's Largest
  // Contentful Paint stays the first one. The others stay hidden and only
  // keep the box at the tallest caption's height (landing.css). Without the
  // script, CSS shows the caption of the checked choice instead.
  const captionNodes = [...figure.querySelectorAll('[data-hero-caption]')];
  const caption = captionNodes[0] || null;
  const captions = new Map(captionNodes.map(node => [node.dataset.heroCaption, node.textContent]));

  let state = rotationStart({ motion: motionOn, holds: [watch ? 'offscreen' : '', document.hidden ? 'hidden' : ''] }, views);
  let since = 0;
  let timer = 0;
  let settleTimer = 0;
  let line = null;

  // Takes a hidden view back to its first frame at once: its transitions are
  // off while it resets (landing.css, .is-resetting), so none runs unseen.
  function rearm(pane, replica) {
    if (!replica) return;
    pane.classList.add('is-resetting');
    replica.arm();
    // The first frame's styles apply now, without transitions; then they are back for its turn.
    void pane.offsetWidth;
    pane.classList.remove('is-resetting');
  }

  // The caption says what is shown; with motion, it fades in with the view.
  function showCaption(id, animate) {
    const text = captions.get(id);
    if (!caption || text == null || caption.textContent === text) return;
    caption.textContent = text;
    if (animate && typeof caption.animate === 'function') caption.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 140, easing: 'ease', fill: 'backwards' });
  }

  // Shows a view: the one coming in fades in over the one going out, which
  // then hides and goes back to its first frame, ready for its next turn.
  function show(id, animate) {
    window.clearTimeout(settleTimer);
    figure.dataset.view = id;
    choices.forEach(input => { input.checked = input.value === id; });
    showCaption(id, animate);
    panes.forEach((pane, key) => {
      const was = pane.classList.contains('is-shown') || pane.classList.contains('is-entering');
      pane.classList.remove('is-entering', 'is-leaving');
      pane.classList.toggle('is-shown', key === id);
      if (animate && key === id && !was) pane.classList.add('is-entering');
      if (animate && key !== id && was) pane.classList.add('is-leaving');
    });
    const settle = () => {
      panes.forEach((pane, key) => {
        pane.classList.remove('is-entering', 'is-leaving');
        if (key !== id && state.motion) rearm(pane, scenes.get(key));
      });
    };
    if (animate) settleTimer = window.setTimeout(settle, SETTLE);
    else settle();
  }

  function play(id) {
    const current = scenes.get(id);
    if (!current) return;
    if (rotationPlays(state)) current.restart();
    else if (state.motion) current.finish();
  }

  function render(cue, before) {
    if (cue === 'switch') {
      scenes.get(before.view)?.stop();
      show(state.view, state.motion);
      play(state.view);
    } else if (cue === 'restart') scenes.get(state.view)?.restart();
    else if (cue === 'freeze') scenes.get(state.view)?.stop();
    else if (cue === 'finish' && state.motion) scenes.get(state.view)?.finish();
  }

  // The thin line under the current choice: how much of its time has gone.
  function syncLine() {
    if (!fill || typeof fill.animate !== 'function') return;
    const dwell = dwellOf(state.view, views);
    if (!line || line.view !== state.view) {
      line?.run.cancel();
      line = { view: state.view, run: fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: dwell, easing: 'linear', fill: 'both' }) };
    }
    line.run.currentTime = Math.min(state.elapsed, dwell);
    if (rotationRunning(state)) line.run.play();
    else line.run.pause();
  }

  function sync() {
    figure.classList.toggle('is-moving', state.motion);
    figure.classList.toggle('is-paused', state.motion && !state.auto);
    figure.classList.toggle('is-turning', state.motion && state.auto);
    if (pauseLabel) pauseLabel.textContent = state.auto ? 'Pause the animation' : 'Play the animation';
    syncLine();
  }

  function commit(next) {
    const before = state;
    state = next;
    if (next.cue) render(next.cue, before);
  }

  // Every event first counts the time gone since the clock last started.
  function apply(event) {
    window.clearTimeout(timer);
    timer = 0;
    if (since) {
      const ms = performance.now() - since;
      since = 0;
      commit(rotationStep(state, { type: 'tick', ms }, views));
    }
    if (event) commit(rotationStep(state, event, views));
    if (rotationRunning(state)) {
      since = performance.now();
      timer = window.setTimeout(() => apply(null), rotationLeft(state, views) + 4);
    }
    sync();
  }

  choices.forEach(input => input.addEventListener('change', () => { if (input.checked) apply({ type: 'choose', view: input.value }); }));
  pause?.addEventListener('click', () => apply({ type: 'toggle' }));

  const hover = on => event => { if (event.pointerType !== 'touch') apply({ type: 'hold', reason: 'hover', on }); };
  figure.addEventListener('pointerenter', hover(true));
  figure.addEventListener('pointerleave', hover(false));

  // Keyboard focus on a choice holds the turns; a click (no visible focus) doesn't.
  group?.addEventListener('focusin', event => { if (event.target.matches(':focus-visible')) apply({ type: 'hold', reason: 'focus', on: true }); });
  group?.addEventListener('focusout', event => { if (!group.contains(event.relatedTarget)) apply({ type: 'hold', reason: 'focus', on: false }); });

  document.addEventListener('visibilitychange', () => apply({ type: 'hold', reason: 'hidden', on: document.hidden }));
  if (watch) {
    new IntersectionObserver(([entry]) => apply({ type: 'hold', reason: 'offscreen', on: !entry.isIntersecting }), { threshold: 0.3 }).observe(stage);
  }
  motionHooks.push(on => apply({ type: 'motion', on }));

  figure.classList.add('is-live');
  show(state.view, false);
  apply(null);

  return {
    state: () => ({ ...state }),
    choose: view => apply({ type: 'choose', view }),
    toggle: () => apply({ type: 'toggle' })
  };
}
