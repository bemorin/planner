import { animate } from '../src/vendor/motion.js';

/* ============================================================================
   Page motion shared by the welcome pages (/welcome/, /contact/ and the
   others): sections rise in as they reach the viewport, and the
   FAQ opens one answer at a time with a smooth height change.

   Each page needs, in <head>, the inline script that adds `js-anim` before
   first paint (see welcome/index.html) and landing.css; its own script then
   calls setupReveal({ motionOn, motionHooks }), setupFaq() and
   followMotion(motionHooks), and adds `js-ready` to <html> once it has run
   (without it, `js-anim` is removed after 4 s and the page simply shows
   everything).

   Markup: `data-reveal` (the element rises in) or `data-reveal-each` (its
   children rise in one after another); FAQ answers are `details.qa` with a
   `.qa__a` panel inside a `[data-faq]` container.
   ============================================================================ */

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
export const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const EASE_OUT = [0.22, 1, 0.36, 1];

/** True when the inline <head> script armed the entrances and motion is welcome. */
export const motionWanted = () => document.documentElement.classList.contains('js-anim') && !reduceQuery.matches;

/**
 * When the visitor turns reduced motion on (or off) while the page is open:
 * each hook hears false (or true), and the entrances stop waiting.
 */
export function followMotion(motionHooks = [], onChange = () => {}) {
  reduceQuery.addEventListener?.('change', () => {
    const on = !reduceQuery.matches;
    if (!on) document.documentElement.classList.remove('js-anim');
    onChange(on);
    motionHooks.forEach(hook => hook(on));
  });
}

/* Entrances: headings, cards and replicas rise in as they reach the viewport */

function rise(target, delay) {
  const settle = () => {
    target.style.removeProperty('opacity');
    target.style.removeProperty('transform');
  };
  try {
    animate(target, { opacity: [0, 1], transform: ['translateY(18px)', 'none'] }, { duration: 0.7, delay, ease: EASE_OUT }).finished.then(settle, settle);
  } catch (_) {
    settle();
  }
}

export function setupReveal({ motionOn = false, motionHooks = [] } = {}) {
  const nodes = qsa('[data-reveal], [data-reveal-each]');
  const showAll = () => nodes.forEach(node => node.classList.add('is-in'));
  if (!motionOn) {
    showAll();
    return;
  }
  const observer = new IntersectionObserver(entries => {
    const entering = entries.filter(entry => entry.isIntersecting).map(entry => entry.target)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    entering.forEach((node, index) => {
      observer.unobserve(node);
      const start = Math.min(index, 4) * 0.08;
      const targets = node.hasAttribute('data-reveal-each') ? [...node.children] : [node];
      node.classList.add('is-in');
      targets.forEach((target, step) => rise(target, start + Math.min(step, 8) * 0.07));
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  nodes.forEach(node => observer.observe(node));
  motionHooks.push(on => {
    if (on) return;
    observer.disconnect();
    showAll();
  });
}

/* FAQ: one answer open at a time, with a smooth height change ------------- */

export function setupFaq() {
  const items = qsa('[data-faq] details');
  if (!items.length) return;
  // Native exclusivity would close the previous answer instantly; we animate it.
  items.forEach(item => item.removeAttribute('name'));
  const running = new Map();
  const panelOf = item => qs('.qa__a', item);
  const settle = panel => {
    panel.style.removeProperty('height');
    panel.style.removeProperty('opacity');
  };
  const stop = item => {
    const controls = running.get(item);
    running.delete(item);
    try { controls?.stop(); } catch (_) { /* already settled */ }
  };
  const canAnimate = () => !reduceQuery.matches && typeof Element.prototype.animate === 'function';

  function close(item) {
    const panel = panelOf(item);
    const from = panel.getBoundingClientRect().height;
    stop(item);
    if (!canAnimate()) {
      item.classList.remove('is-closing');
      item.open = false;
      settle(panel);
      return;
    }
    item.classList.add('is-closing');
    const controls = animate(panel, { height: [`${from}px`, '0px'], opacity: [1, 0] }, { duration: 0.26, ease: [0.4, 0, 0.2, 1] });
    running.set(item, controls);
    controls.finished.then(() => {
      if (running.get(item) !== controls) return;
      running.delete(item);
      item.classList.remove('is-closing');
      item.open = false;
      settle(panel);
    }, () => {});
  }

  function open(item) {
    items.forEach(other => { if (other !== item && other.open && !other.classList.contains('is-closing')) close(other); });
    const panel = panelOf(item);
    const from = item.open ? panel.getBoundingClientRect().height : 0;
    stop(item);
    item.classList.remove('is-closing');
    item.open = true;
    if (!canAnimate()) {
      settle(panel);
      return;
    }
    const to = panel.scrollHeight;
    const controls = animate(panel, { height: [`${from}px`, `${to}px`], opacity: [from ? 1 : 0, 1] }, { duration: 0.36, ease: EASE_OUT });
    running.set(item, controls);
    controls.finished.then(() => {
      if (running.get(item) !== controls) return;
      running.delete(item);
      settle(panel);
    }, () => {});
  }

  items.forEach(item => {
    qs('summary', item).addEventListener('click', event => {
      event.preventDefault();
      if (item.open && !item.classList.contains('is-closing')) close(item);
      else open(item);
    });
    item.addEventListener('toggle', () => {
      // Opened by the browser itself (find in page): still one answer at a time.
      if (item.open && !running.has(item)) items.forEach(other => { if (other !== item && other.open && !other.classList.contains('is-closing')) close(other); });
    });
  });
}
