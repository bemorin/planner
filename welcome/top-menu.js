/* ============================================================================
   The top bar's menu, below 960px (welcome/page-kit.js setupTopBar).

   On a phone or a tablet the bar keeps the brand and its button, and its
   section links don't fit: a Menu button, last in the bar, opens those same
   links (the bar's own <nav>) as a panel under it, over a light scrim. On a
   desktop the links sit in the bar and the button is hidden, so nothing is
   ever said twice.

   While it is open, as in a dialog: focus moves to the first link and Tab
   stays among the links and the button; the arrow keys, Home and End move
   between the links; Escape, the button, a tap outside, choosing a link or
   the window growing to the desktop bar close it; the page under it neither
   scrolls nor answers a screen reader. It fades in and out, and simply
   appears and goes with reduced motion. Without JavaScript the button never
   shows (its room is kept, so nothing moves when it does; the brand and the
   footer still lead on).
   ============================================================================ */

const DESKTOP = '(min-width: 960px)';
const REDUCE = '(prefers-reduced-motion: reduce)';
// As long as the panel's fade out in landing.css (.top__nav transition).
const FADE_MS = 160;

/** Where Tab goes next among `count` stops from `index` (-1 when focus is elsewhere), wrapping around. */
export function trappedIndex(index, count, backwards = false) {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return backwards ? count - 1 : 0;
  return (index + (backwards ? count - 1 : 1)) % count;
}

/** Where an arrow key, Home or End moves among `count` links from `index`; -1 for any other key. */
export function arrowIndex(key, index, count) {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  return -1;
}

export function setupTopMenu(top) {
  const button = top?.querySelector('[data-top-menu]');
  const nav = button && document.getElementById(button.getAttribute('aria-controls') || '');
  if (!nav || !top.contains(nav)) return null;
  const root = document.documentElement;
  const desktop = window.matchMedia(DESKTOP);
  const reduce = window.matchMedia(REDUCE);
  const links = () => [...nav.querySelectorAll('a[href]')];
  let open = false;
  let settle = 0;
  let quieted = [];

  // Everything on the page but the bar, out of reach while the menu is open.
  const quiet = on => {
    quieted.forEach(node => { node.inert = false; });
    quieted = on ? [...document.body.children].filter(node => node !== top && !node.contains(top) && !node.inert && !['SCRIPT', 'TEMPLATE'].includes(node.tagName)) : [];
    quieted.forEach(node => { node.inert = true; });
  };

  function show() {
    if (open || desktop.matches) return;
    open = true;
    window.clearTimeout(settle);
    root.style.setProperty('--scrollbar-gap', `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    root.classList.add('has-menu');
    top.classList.add('is-menu-open');
    button.setAttribute('aria-expanded', 'true');
    quiet(true);
    links()[0]?.focus({ preventScroll: true });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onOutside, true);
    // One frame in the open state first, so the panel fades in from it.
    requestAnimationFrame(() => { if (open) top.classList.add('is-menu-shown'); });
  }

  function hide({ restoreFocus = false, instant = false } = {}) {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    button.setAttribute('aria-expanded', 'false');
    quiet(false);
    root.classList.remove('has-menu');
    root.style.removeProperty('--scrollbar-gap');
    top.classList.remove('is-menu-shown');
    const done = () => { if (!open) top.classList.remove('is-menu-open'); };
    window.clearTimeout(settle);
    if (instant || reduce.matches) done();
    else settle = window.setTimeout(done, FADE_MS);
    if (restoreFocus) button.focus({ preventScroll: true });
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      hide({ restoreFocus: true });
      return;
    }
    if (event.key === 'Tab') {
      const stops = [button, ...links()];
      event.preventDefault();
      stops[trappedIndex(stops.indexOf(document.activeElement), stops.length, event.shiftKey)]?.focus();
      return;
    }
    const items = links();
    const next = arrowIndex(event.key, items.indexOf(document.activeElement), items.length);
    if (next < 0) return;
    event.preventDefault();
    items[next].focus();
  }

  // The scrim belongs to the bar (.top::after): a tap on it, or on the bar
  // outside the button and the links, closes the menu without reaching the page.
  function onOutside(event) {
    if (nav.contains(event.target) || button.contains(event.target)) return;
    hide({ restoreFocus: nav.contains(document.activeElement) });
  }

  button.addEventListener('click', () => {
    if (open) hide({ restoreFocus: true });
    else show();
  });
  // A link leads on, to a part of this page or to another page: the menu has done its job.
  nav.addEventListener('click', event => {
    if (open && event.target.closest('a[href]')) hide({ instant: true });
  });
  const onDesktop = () => { if (desktop.matches) hide({ instant: true }); };
  if (desktop.addEventListener) desktop.addEventListener('change', onDesktop);
  // Back to a page kept in memory: never with its menu still open.
  window.addEventListener('pagehide', () => hide({ instant: true }));
  button.classList.add('is-ready');
  return { show, hide, get open() { return open; } };
}
