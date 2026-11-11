import { animate, spring, stagger } from '../vendor/motion.js';

/**
 * Motion presets for the planner.
 *
 * The planner only animates where movement explains something: a dialog
 * arriving, a section changing, an item joining a list, a panel expanding.
 * Every helper is a no-op when the visitor prefers reduced motion or when the
 * browser lacks the Web Animations API, so callers never need to branch.
 *
 * Helpers resolve once the animation settles and then clear the inline styles
 * they wrote, which keeps the CSS cascade the single source of resting state.
 */

const EASE_OUT = [0.22, 1, 0.36, 1];
const EASE_IN = [0.4, 0, 1, 1];
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion() {
  return !!reducedQuery?.matches;
}

function syncRootFlag() {
  // CSS transitions outrank WAAPI animations in the cascade, so components that
  // Motion animates drop their CSS transition while this flag is present.
  document.documentElement.classList.toggle('has-motion', !prefersReducedMotion());
}

if (typeof document !== 'undefined') {
  syncRootFlag();
  reducedQuery?.addEventListener?.('change', syncRootFlag);
}

function canAnimate(target) {
  if (prefersReducedMotion()) return false;
  const list = Array.isArray(target) ? target : [target];
  return list.length > 0 && list.every(el => el && typeof el.animate === 'function' && el.isConnected);
}

function clear(target, props) {
  (Array.isArray(target) ? target : [target]).forEach(el => props.forEach(prop => el?.style?.removeProperty(prop)));
}

function run(target, keyframes, options, cleanup = Object.keys(keyframes), onSettled = null) {
  const settle = ok => {
    try { onSettled?.(); } catch (_) {}
    clear(target, cleanup);
    return ok;
  };
  if (!canAnimate(target)) return Promise.resolve(settle(false));
  try {
    const controls = animate(target, keyframes, options);
    return Promise.resolve(controls.finished).then(() => settle(true), () => settle(false));
  } catch (_) {
    return Promise.resolve(settle(false));
  }
}

const isNarrow = () => typeof innerWidth === 'number' && innerWidth <= 790;

/** Drop any inline animation state so the CSS resting state applies again. */
export function resetMotion(el) {
  clear(el, ['opacity', 'transform', 'transform-origin', 'height']);
}

/** Dialog entrance: a soft spring on desktop, a bottom-sheet rise on phones. */
export function modalEnter(panel) {
  clear(panel, ['opacity', 'transform']);
  const from = isNarrow() ? 'translateY(26px)' : 'translateY(12px) scale(.975)';
  return run(panel, { opacity: [0, 1], transform: [from, 'none'] }, { type: spring, bounce: 0.12, duration: 0.42 });
}

/** Dialog exit is shorter than its entrance so closing never feels sticky. */
export function modalExit(panel) {
  const to = isNarrow() ? 'translateY(18px)' : 'translateY(6px) scale(.985)';
  return run(panel, { opacity: [1, 0], transform: ['none', to] }, { duration: 0.14, ease: EASE_IN }, []);
}

/** Popovers grow from their anchor edge. */
export function popoverEnter(popover, { above = false } = {}) {
  const from = `translateY(${above ? 5 : -5}px) scale(.97)`;
  popover.style.transformOrigin = above ? '50% 100%' : '50% 0%';
  return run(popover, { opacity: [0, 1], transform: [from, 'none'] }, { type: spring, bounce: 0, duration: 0.24 }, ['opacity', 'transform', 'transform-origin']);
}

/** A replaced panel (tab, section, view) settles into place. */
export function panelEnter(el, { direction = 0, distance = 10 } = {}) {
  const from = direction ? `translateX(${direction * distance}px)` : `translateY(${distance * 0.7}px)`;
  return run(el, { opacity: [0, 1], transform: [from, 'none'] }, { duration: 0.28, ease: EASE_OUT });
}

/** Sequenced entrance for a set of cards or rows. */
export function staggerEnter(nodes, { distance = 8, gap = 0.035, max = 12 } = {}) {
  const list = [...(nodes || [])].filter(Boolean).slice(0, max);
  if (!list.length) return Promise.resolve(false);
  return run(list, { opacity: [0, 1], transform: [`translateY(${distance}px)`, 'none'] }, { duration: 0.32, ease: EASE_OUT, delay: stagger(gap) });
}

/** A new item joins a list. */
export function itemEnter(el) {
  return run(el, { opacity: [0, 1], transform: ['translateY(6px) scale(.97)', 'none'] }, { type: spring, bounce: 0.2, duration: 0.38 });
}

/** An item leaves before the list re-renders without it. */
export function itemExit(el) {
  return run(el, { opacity: [1, 0], transform: ['none', 'scale(.96)'] }, { duration: 0.16, ease: EASE_IN }, []);
}

/**
 * Something was re-laid out in place (a preview rescaled, a ruler relabelled):
 * it glides from its previous values to the ones the caller has just written
 * inline. Opacity is handed back to the CSS once the move settles.
 */
export function morph(el, from, to) {
  const keyframes = {};
  Object.keys(to).forEach(key => {
    if (from[key] !== undefined && from[key] !== '' && String(from[key]) !== String(to[key])) keyframes[key] = [from[key], to[key]];
  });
  if (!Object.keys(keyframes).length) return Promise.resolve(false);
  return run(el, keyframes, { duration: 0.42, ease: EASE_OUT }, ['opacity']);
}

/** Brief confirmation pulse for something that just completed. */
export function pulse(el) {
  return run(el, { transform: ['scale(1)', 'scale(1.08)', 'scale(1)'] }, { duration: 0.32, ease: EASE_OUT });
}

/**
 * Expand or collapse an element to its natural height. `onSettled` runs right
 * before the inline height is released, so a caller can commit the resting
 * (open or collapsed) class without a one-frame flash.
 */
export function toggleHeight(el, open, onSettled = null) {
  if (!el) { onSettled?.(); return Promise.resolve(false); }
  const natural = el.scrollHeight;
  const keyframes = open
    ? { height: ['0px', `${natural}px`], opacity: [0, 1] }
    : { height: [`${natural}px`, '0px'], opacity: [1, 0] };
  return run(el, keyframes, { type: spring, bounce: 0, duration: open ? 0.34 : 0.22 }, ['height', 'opacity'], onSettled);
}

/**
 * Slide a selection indicator to a target element. The indicator is absolutely
 * positioned inside the same offset parent as its targets.
 */
export function slideIndicator(indicator, target, { animateMove = true } = {}) {
  if (!indicator || !target) return Promise.resolve(false);
  const next = { left: `${target.offsetLeft}px`, top: `${target.offsetTop}px`, width: `${target.offsetWidth}px`, height: `${target.offsetHeight}px` };
  const previous = { left: indicator.style.left, top: indicator.style.top, width: indicator.style.width, height: indicator.style.height };
  Object.assign(indicator.style, next);
  indicator.dataset.ready = 'true';
  if (!animateMove || !previous.width) return Promise.resolve(false);
  const keyframes = {};
  Object.keys(next).forEach(key => { if (previous[key] && previous[key] !== next[key]) keyframes[key] = [previous[key], next[key]]; });
  if (!Object.keys(keyframes).length) return Promise.resolve(false);
  return run(indicator, keyframes, { type: spring, bounce: 0.16, duration: 0.4 }, []);
}
