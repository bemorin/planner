/**
 * “Colours for your painted year” (landing, the yearly ritual): a painted year
 * that takes the colours of the swatch under the pointer, the one with
 * keyboard focus, or the last one pressed. Terracotta is the planner's own
 * first palette, where the card starts. When motion is welcome, the card shows
 * each palette once as it comes into view, until the visitor tries one. The
 * colours themselves live in landing.css (`[data-palette="…"]`), in step with
 * styles/year.css.
 *
 * No imports: the single-file preview inlines this module as it is. The pure
 * helpers are unit-tested (tests/landing-palette.test.js).
 */

/** Same ids and names as src/features/paint-palettes.js, in the same order. */
export const SWATCHES = Object.freeze([
  Object.freeze({ id: 'terracotta', name: 'Terracotta' }),
  Object.freeze({ id: 'ocean', name: 'Ocean' }),
  Object.freeze({ id: 'forest', name: 'Forest' }),
  Object.freeze({ id: 'plum', name: 'Plum' }),
  Object.freeze({ id: 'graphite', name: 'Graphite' }),
  Object.freeze({ id: 'sunset', name: 'Sunset' })
]);

/** The palette the card starts on, and comes back to: the planner's first, Terracotta. */
export const FIRST_SWATCH = SWATCHES[0].id;

/** A swatch by id, or the first one. */
export const swatchById = id => SWATCHES.find(swatch => swatch.id === id) || SWATCHES[0];

/**
 * Keyboard moves along the swatches: arrows step (and wrap), Home and End jump
 * to the ends. -1 for any other key, so the key keeps its usual meaning.
 */
export function swatchStep(key, index, count) {
  if (!(count > 0)) return -1;
  const from = Math.min(Math.max(Number(index) || 0, 0), count - 1);
  if (key === 'ArrowRight' || key === 'ArrowDown') return (from + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (from - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}

/** What the painted year shows: the swatch under the pointer, else the focused one, else the pressed one. */
export const shownSwatch = ({ hover = '', focus = '', chosen = '' } = {}) => swatchById(hover || focus || chosen).id;

/** The tour: every other palette once, in order after `from`, ending back on `from`. */
export function tourOrder(from = FIRST_SWATCH) {
  const start = Math.max(0, SWATCHES.findIndex(swatch => swatch.id === from));
  return SWATCHES.map((_, step) => SWATCHES[(start + step + 1) % SWATCHES.length].id);
}

const TOUR_STEP = 1500;

/**
 * Wires the card. `motion()` says whether motion is welcome right now; the
 * tour runs only then. Returns { choose, stop } (for tests and the console).
 */
export function createPaletteCard(card, { motion = () => false } = {}) {
  const buttons = card ? [...card.querySelectorAll('[data-swatch]')] : [];
  if (!buttons.length) return null;
  const name = card.querySelector('[data-palette-name]');
  const state = { hover: '', focus: '', chosen: FIRST_SWATCH };
  let timer = 0;
  let touched = false;
  let toured = false;

  function show() {
    const swatch = swatchById(shownSwatch(state));
    if (card.dataset.palette !== swatch.id) card.dataset.palette = swatch.id;
    if (name) name.textContent = swatch.name;
  }

  // One tab stop for the group: the pressed swatch, or the one the arrows moved to.
  function rove(id) {
    buttons.forEach(button => { button.tabIndex = button.dataset.swatch === id ? 0 : -1; });
  }

  function choose(id) {
    state.chosen = swatchById(id).id;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.swatch === state.chosen)));
    rove(state.chosen);
    show();
  }

  function stop() {
    window.clearTimeout(timer);
    timer = 0;
  }

  // Any sign of interest ends the tour for good: the visitor drives from then on.
  function takeOver() {
    if (touched) return;
    touched = true;
    if (timer) {
      stop();
      choose(FIRST_SWATCH);
    }
  }

  function tour() {
    if (touched || toured || timer || !motion()) return;
    const order = tourOrder(state.chosen);
    let step = 0;
    const next = () => {
      if (touched) { stop(); return; }
      if (!motion()) { stop(); choose(FIRST_SWATCH); return; }
      choose(order[step]);
      step += 1;
      if (step < order.length) timer = window.setTimeout(next, TOUR_STEP);
      else { timer = 0; toured = true; }
    };
    timer = window.setTimeout(next, 600);
  }

  buttons.forEach((button, index) => {
    const id = button.dataset.swatch;
    button.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      takeOver();
      state.hover = id;
      show();
    });
    button.addEventListener('pointerleave', () => {
      if (state.hover !== id) return;
      state.hover = '';
      show();
    });
    button.addEventListener('focus', () => {
      takeOver();
      state.focus = id;
      show();
    });
    button.addEventListener('blur', event => {
      if (!buttons.includes(event.relatedTarget)) rove(state.chosen);
      if (state.focus !== id) return;
      state.focus = '';
      show();
    });
    button.addEventListener('click', () => {
      takeOver();
      choose(id);
    });
    button.addEventListener('keydown', event => {
      const next = swatchStep(event.key, index, buttons.length);
      if (next < 0) return;
      event.preventDefault();
      rove(buttons[next].dataset.swatch);
      buttons[next].focus();
    });
  });

  choose(FIRST_SWATCH);

  if ('IntersectionObserver' in window) {
    const preview = card.querySelector('[data-palette-preview]') || card;
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) tour();
      else if (timer) {
        // Scrolled away mid-tour: back to the start, ready to play again.
        stop();
        choose(FIRST_SWATCH);
      }
    }, { threshold: 0.6 }).observe(preview);
  }

  return { choose, stop };
}
