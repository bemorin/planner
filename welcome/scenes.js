import { qs, qsa } from './page-kit.js';

/* ============================================================================
   Replicas that play near the viewport and pause when they leave, shared by
   the welcome pages. A replica is `[data-scene="name"]` with `data-final`
   (its classes once played); each page passes the scripts of its own scenes:

     setupScenes({ scripts: { name: { length, loop, run(t) { … } } }, motionOn, motionHooks })

   A script schedules state classes with t.add / t.remove, glides a pointer
   with t.point, types `[data-type]` text and counts `[data-count]` numbers;
   playCues does the same from a list of cues (the hero's, hero-views.js).
   Without motion (reduced motion, or the page gave up waiting), every replica
   simply shows its final frame; `motion-ok` on <html> turns on the CSS
   transitions only once the scenes are armed.

   A replica with `data-scene-driven` doesn't play by scrolling: its page
   drives it through the returned `scene(name)` (restart, stop, finish, arm),
   as the hero does with its two views (hero-views.js).
   ============================================================================ */

const html = document.documentElement;

/** A click in a replica: the pointer dips, a ripple spreads, the target presses. */
export function click(t, ms, press = '') {
  t.add('d-click', ms);
  t.remove('d-click', ms + 640);
  if (!press) return;
  t.add(press, ms);
  t.remove(press, ms + 240);
}

/** Plays a script written as cues (the hero's, hero-views.js, which says what each cue does). */
export function playCues(t, cues) {
  const typed = qsa('[data-type]', t.root);
  cues.forEach(cue => {
    if (cue.add) t.add(cue.add, cue.at);
    if (cue.remove) t.remove(cue.remove, cue.at);
    if (cue.point) t.point(cue.point, cue.at, { duration: cue.ms, x: cue.x, y: cue.y, jump: !cue.ms });
    if ('click' in cue) click(t, cue.at, cue.click);
    if ('type' in cue) t.type(typed[cue.type], cue.at);
    if (cue.count) qsa(cue.count, t.root).forEach(node => t.count(node, cue.at, cue.ms));
  });
}

// Classes a scene passes through on its way to the final frame: these, and
// every d- class (a pointer's way through the scene).
const TRANSIENT = ['s-press', 's-sync', 's-finger', 's-press-plan', 's-press-save', 's-save', 's-later', 's-tap'];
const passing = root => [...root.classList].filter(name => name.startsWith('d-') || TRANSIENT.includes(name));

// Moves a replica's pointer onto `target` (a selector inside the scene), in
// em so it stays in place if the replica is resized while it glides.
function aim(root, target, { duration = 700, x = 0.5, y = 0.5, jump = false } = {}) {
  const pointer = qs('.rp-cursor', root);
  const node = qs(target, root);
  if (!pointer || !node) return;
  const box = root.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const em = Number.parseFloat(getComputedStyle(root).fontSize) || 12;
  const left = (rect.left - box.left + rect.width * x) / em;
  const top = (rect.top - box.top + rect.height * y) / em;
  pointer.style.setProperty('--move', `${jump ? 0 : duration}ms`);
  pointer.style.setProperty('--cx', `${left.toFixed(2)}em`);
  pointer.style.setProperty('--cy', `${top.toFixed(2)}em`);
}

function createScene(root, scripts) {
  const script = scripts[root.dataset.scene];
  if (!script) return null;
  const finals = (root.dataset.final || '').split(/\s+/).filter(Boolean);
  const typed = qsa('[data-type]', root);
  typed.forEach(node => { node.dataset.text = node.textContent; });
  const counters = qsa('[data-count]', root);
  let timers = [];
  let state = 'final';
  let playing = false;

  const later = (ms, fn) => { timers.push(window.setTimeout(fn, ms)); };
  const clear = () => { timers.forEach(id => window.clearTimeout(id)); timers = []; };

  const api = {
    root,
    add: (cls, ms) => later(ms, () => root.classList.add(cls)),
    remove: (cls, ms) => later(ms, () => root.classList.remove(cls)),
    point: (target, ms, options) => later(ms, () => aim(root, target, options)),
    type(node, ms) {
      if (!node) return;
      const text = node.dataset.text || '';
      const speed = Number(node.dataset.speed) || 42;
      later(ms, () => node.classList.add('is-typing'));
      for (let index = 1; index <= text.length; index += 1) later(ms + index * speed, () => { node.textContent = text.slice(0, index); });
      later(ms + text.length * speed + 700, () => node.classList.remove('is-typing'));
    },
    count(node, ms, duration) {
      if (!node) return;
      const to = Number(node.dataset.count) || 0;
      const from = Number(node.dataset.from) || 0;
      const steps = Math.max(1, Math.min(Math.abs(to - from), Math.round(duration / 40)));
      for (let step = 1; step <= steps; step += 1) later(ms + (duration * step) / steps, () => { node.textContent = String(Math.round(from + ((to - from) * step) / steps)); });
    }
  };

  const pointers = qsa('.rp-cursor', root);

  function reset() {
    root.classList.remove(...finals, ...passing(root));
    pointers.forEach(node => node.removeAttribute('style'));
    typed.forEach(node => { node.textContent = ''; node.classList.remove('is-typing'); });
    counters.forEach(node => { node.textContent = node.dataset.from || '0'; });
    state = 'reset';
  }

  function finish() {
    clear();
    root.classList.remove(...passing(root), 'is-playing');
    pointers.forEach(node => node.removeAttribute('style'));
    root.classList.add(...finals, 'is-armed');
    typed.forEach(node => { node.textContent = node.dataset.text; node.classList.remove('is-typing'); });
    counters.forEach(node => { node.textContent = node.dataset.count; });
    state = 'final';
    playing = false;
  }

  function run(once = false) {
    clear();
    state = 'running';
    script.run(api);
    if (script.loop && !once) {
      later(script.length, () => {
        reset();
        later(900, () => run());
      });
    } else {
      later(script.length || 6000, () => { state = 'final'; });
    }
  }

  return {
    root,
    loop: !!script.loop,
    arm() {
      clear();
      playing = false;
      root.classList.remove('is-playing');
      reset();
      root.classList.add('is-armed');
    },
    finish,
    play() {
      if (playing || (!script.loop && state === 'final')) return;
      playing = true;
      root.classList.add('is-playing');
      if (state === 'reset') run();
      else {
        // Coming back after a pause: hold the current frame briefly, then replay.
        later(1400, () => {
          reset();
          later(900, run);
        });
      }
    },
    stop() {
      if (!playing) return;
      playing = false;
      clear();
      root.classList.remove('is-playing');
    },
    // Driven scenes: from the first frame, once, ending on the final frame. A
    // scene caught mid-way goes back to its first frame and waits a moment.
    restart() {
      clear();
      playing = true;
      root.classList.add('is-playing');
      if (state === 'reset') {
        run(true);
        return;
      }
      reset();
      later(900, () => run(true));
    }
  };
}

/**
 * Arms every `[data-scene]` of the page that has a script, plays each while
 * it is on screen (driven ones excepted), and shows final frames when motion
 * is off or turns off. Returns { scene(name) }: a scene's controls, or null.
 */
export function setupScenes({ scripts = {}, motionOn = false, motionHooks = [] } = {}) {
  const scenes = qsa('[data-scene]').map(root => createScene(root, scripts)).filter(Boolean);
  const found = { scene: name => scenes.find(scene => scene.root.dataset.scene === name) || null };
  if (!scenes.length) return found;
  const watched = scenes.filter(scene => !scene.root.hasAttribute('data-scene-driven'));
  const visible = new Set();
  let observer = null;

  const enable = () => {
    scenes.forEach(scene => scene.arm());
    // Let the armed (pre-animation) state settle without transitions first.
    void document.body.offsetHeight;
    html.classList.add('motion-ok');
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const scene = watched.find(item => item.root === entry.target);
        if (!scene) return;
        if (entry.isIntersecting) {
          visible.add(scene);
          if (!document.hidden) scene.play();
          if (!scene.loop) observer.unobserve(scene.root);
        } else {
          visible.delete(scene);
          if (scene.loop) scene.stop();
        }
      });
    }, { threshold: 0.3 });
    watched.forEach(scene => observer.observe(scene.root));
  };

  const disable = () => {
    observer?.disconnect();
    observer = null;
    visible.clear();
    html.classList.remove('motion-ok');
    scenes.forEach(scene => scene.finish());
  };

  if (motionOn) enable();
  else disable();

  motionHooks.push(on => { if (on) enable(); else disable(); });

  document.addEventListener('visibilitychange', () => {
    if (!observer) return;
    visible.forEach(scene => { if (document.hidden) scene.stop(); else scene.play(); });
  });

  return found;
}
