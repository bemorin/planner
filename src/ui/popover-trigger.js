/**
 * A second click on the trigger of an open popover closes it (1.39.2).
 *
 * The planner's popovers (the dropdown lists of src/ui/listbox.js, the date
 * pickers of src/ui/calendar-popover.js, the colour, info and Horizon popovers
 * of app.js) share one layer: app.js's showPopover() and closePopover(). Its
 * outside-click handler leaves the trigger alone, and every opener starts by
 * closing what is open, so a second click on Week starts on drew the same list
 * anew and played its opening animation again instead of closing it.
 *
 * Now a capture listener on the document sees that click first. On the trigger
 * of the open popover (or of one under it: a date picker opened from inside
 * another popover), it closes that popover and any over it, gives the trigger
 * focus, and stops the click there, so the opener never runs; the next click
 * opens it again. A click inside the popover, or anywhere else, goes on as
 * before (the app's outside-click handler closes it). aria-expanded is set on
 * the trigger, not on a wrapper round it (a time field), by showPopover() and
 * closePopover().
 */

/**
 * The control that opens a popover anchored on `anchor`, and carries its
 * aria-expanded: the anchor when it is a button, else the menu button inside it
 * (the ⌄ of a time field), else what had focus inside it, else the anchor.
 */
export function popoverTrigger(anchor, opener = null) {
  if (!anchor) return null;
  if (anchor.matches?.('button, [role="button"]')) return anchor;
  return anchor.querySelector?.('button[aria-haspopup]')
    || (opener && anchor.contains?.(opener) ? opener : null)
    || anchor.querySelector?.('button')
    || anchor;
}

/**
 * The open popover whose trigger `target` is, or is inside (pure). `open` is the
 * popover on top, { el, anchor, trigger?, parent? }, its parent the one it was
 * opened from. Null when nothing is open, when `target` is inside the popover on
 * top (its own controls), or when it is elsewhere.
 */
export function triggerLayer(open, target) {
  if (!target) return null;
  for (let layer = open, depth = 0; layer && depth < 12; layer = layer.parent, depth += 1) {
    if (layer.el?.contains?.(target)) return null;
    const trigger = layer.trigger || layer.anchor;
    if (trigger?.contains?.(target)) return layer;
  }
  return null;
}

/**
 * Wires the toggle on `doc`. `getOpen()` returns the popover on top (or null),
 * `close()` closes the popover on top. Returns a function that unwires it.
 */
export function closeOnTriggerClick(doc, { getOpen, close }) {
  const onClick = event => {
    const layer = triggerLayer(getOpen(), event.target);
    if (!layer) return;
    event.stopPropagation();
    // The popovers over it close with it (a date picker opened from it), then it does.
    for (let guard = 0, top = getOpen(); top && guard < 12; guard += 1, top = getOpen()) {
      close();
      if (top === layer) break;
    }
    (layer.trigger || layer.anchor)?.focus?.({ preventScroll: true });
  };
  doc?.addEventListener?.('click', onClick, true);
  return () => doc?.removeEventListener?.('click', onClick, true);
}
