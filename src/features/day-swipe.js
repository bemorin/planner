const DEFAULT_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input[type=checkbox]',
  'input[type=radio]',
  'select',
  '[contenteditable="true"]',
  '.time-block',
  '.week-time-block'
].join(',');

/**
 * Which way a move between two days (or two week starts) travels, as the day
 * arrows and swipes do: 1 forward in time, -1 back, 0 when nothing changes.
 * Keys are `YYYY-MM-DD`, so they compare in calendar order.
 */
export function navigationDirection(fromKey, toKey) {
  const from = String(fromKey || '');
  const to = String(toKey || '');
  if (!from || !to || from === to) return 0;
  return to > from ? 1 : -1;
}

export function swipeDirection(deltaX, deltaY, { minDistance = 64, axisRatio = 1.25 } = {}) {
  const horizontal = Math.abs(Number(deltaX) || 0);
  const vertical = Math.abs(Number(deltaY) || 0);
  if (horizontal < minDistance || horizontal < vertical * axisRatio) return 0;
  return deltaX < 0 ? 1 : -1;
}

export function createDaySwipeNavigation({
  element,
  isEnabled,
  onShift,
  interactiveSelector = DEFAULT_INTERACTIVE_SELECTOR,
  minDistance = 64,
  axisRatio = 1.25
}) {
  if (!element) return { destroy() {} };

  let gesture = null;
  const shouldIgnoreTarget = target => !!target?.closest?.(interactiveSelector);
  const reset = () => { gesture = null; };

  const onTouchStart = event => {
    if (!isEnabled() || event.touches.length !== 1 || shouldIgnoreTarget(event.target)) return;
    const touch = event.touches[0];
    gesture = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = event => {
    if (!gesture) return;
    const touch = Array.from(event.changedTouches || []).find(item => item.identifier === gesture.identifier);
    if (!touch) { reset(); return; }
    const direction = swipeDirection(touch.clientX - gesture.x, touch.clientY - gesture.y, { minDistance, axisRatio });
    reset();
    if (!direction || !isEnabled()) return;
    if (event.cancelable) event.preventDefault();
    onShift(direction);
  };

  element.addEventListener('touchstart', onTouchStart, { passive: true });
  element.addEventListener('touchend', onTouchEnd, { passive: false });
  element.addEventListener('touchcancel', reset, { passive: true });

  return {
    destroy() {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', reset);
    }
  };
}
