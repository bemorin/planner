export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Whether a box's content overflows it, down or across (a pixel of rounding aside). */
export const overflows = element => !!element && (element.scrollHeight - element.clientHeight > 1 || element.scrollWidth - element.clientWidth > 1);

/**
 * A scroll area keyboard users can scroll too (WCAG 2.1.1): while its content
 * overflows, it takes focus (tabindex 0) as a region named `label` (a string,
 * or a function for a name that changes); once everything fits, it is a plain
 * box again, out of the tab order. Only what it set itself is taken back.
 * Returns whether it scrolls.
 */
export function syncScrollRegion(element, label) {
  if (!element) return false;
  const overflowing = overflows(element);
  const marked = element.hasAttribute('data-scroll-region');
  if (overflowing) {
    const name = String((typeof label === 'function' ? label() : label) || '').trim();
    if (element.getAttribute('tabindex') !== '0') element.setAttribute('tabindex', '0');
    if (element.getAttribute('role') !== 'region') element.setAttribute('role', 'region');
    if (name && element.getAttribute('aria-label') !== name) element.setAttribute('aria-label', name);
    if (!marked) element.setAttribute('data-scroll-region', '');
  } else if (marked) {
    ['tabindex', 'role', 'aria-label', 'data-scroll-region'].forEach(name => element.removeAttribute(name));
  }
  return overflowing;
}

/**
 * Keeps syncScrollRegion up to date while the area or its content changes
 * size (a new step, another year, a narrower window). Returns a function that
 * stops watching.
 */
export function watchScrollRegion(element, label) {
  if (!element) return () => {};
  const sync = () => syncScrollRegion(element, label);
  sync();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(sync);
  observer.observe(element);
  [...element.children].forEach(child => observer.observe(child));
  return () => observer.disconnect();
}
