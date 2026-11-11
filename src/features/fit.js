/**
 * Geometry helpers for the app-only fit mode.
 * CSS `zoom` changes visual pointer coordinates while schedule math remains in
 * logical pixels, so pointer calculations must normalize by the measured scale.
 */
export function visualScale(element) {
  if (!element) return 1;
  const rect = element.getBoundingClientRect?.();
  const logicalHeight = element.offsetHeight || 0;
  if (!rect || !logicalHeight) return 1;
  return Math.min(2, Math.max(0.5, rect.height / logicalHeight));
}

export function computeFitLayout({ viewportWidth, viewportHeight, enabled, naturalWidth = 1360, padding = 64, minViewport = 790 }) {
  const hasWhitespace = viewportWidth > naturalWidth + padding + 8;
  const active = Boolean(enabled && hasWhitespace && viewportWidth > minViewport);
  const available = Math.max(320, viewportWidth - padding);
  const scale = active ? Math.min(1.25, Math.max(1, available / naturalWidth)) : 1;
  return {
    hasWhitespace,
    active,
    scale,
    logicalWidth: Math.max(320, available / scale),
    logicalHeight: Math.max(320, viewportHeight / scale),
    modalMaxHeight: Math.max(280, (viewportHeight - 24) / scale)
  };
}
