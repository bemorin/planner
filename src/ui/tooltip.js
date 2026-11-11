/**
 * App tooltips: one floating label for any `[data-tooltip]` control, shown on
 * hover (fine pointers only) and on keyboard focus, with an optional keycap
 * from `data-tooltip-key`.
 *
 * The label wraps inside a bounded box (see `.app-tooltip-float` in core.css)
 * and placeTooltip() keeps it in view: below its control when there is room,
 * otherwise above, never closer than 8px to the viewport edge. Inside a
 * scrolling area or a dialog it also stays within that visible area, so it
 * cannot spill over a dialog's edge or cover its action bar.
 *
 * placeTooltipWithin() is the stricter placement of chart readings (Insights):
 * inside nested areas — a chart's card, then the dialog's visible scroll area —
 * and never outside the last one.
 */

export const TOOLTIP_MARGIN = 8;
export const TOOLTIP_GAP = 7;

const clampTo = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

function intersect(a, b) {
  const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return box.right > box.left && box.bottom > box.top ? box : null;
}

/** The overlap of rects ({ left, top, right, bottom }; nulls are skipped), or null when they don't overlap. */
export function intersectRects(...rects) {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  return list.slice(1).reduce((box, rect) => (box ? intersect(box, rect) : null), { left: list[0].left, top: list[0].top, right: list[0].right, bottom: list[0].bottom });
}

/** A rect moved in by `by` on every side; null when nothing is left. */
export function insetRect(rect, by = 0) {
  if (!rect) return null;
  const box = { left: rect.left + by, top: rect.top + by, right: rect.right - by, bottom: rect.bottom - by };
  return box.right > box.left && box.bottom > box.top ? box : null;
}

/**
 * What shows of the page, in the coordinates of getBoundingClientRect() and
 * `position: fixed`: the visual viewport on a phone (pinch-zoomed, or with the
 * keyboard up), else the window.
 */
export function visibleViewportRect(win = globalThis) {
  const view = win.visualViewport;
  if (view && view.width > 0 && view.height > 0) return { left: view.offsetLeft || 0, top: view.offsetTop || 0, right: (view.offsetLeft || 0) + view.width, bottom: (view.offsetTop || 0) + view.height };
  return { left: 0, top: 0, right: win.innerWidth || 0, bottom: win.innerHeight || 0 };
}

/** A scrolling element's visible area: its box without borders and scrollbar. */
export function scrollPortRect(el) {
  const box = el.getBoundingClientRect();
  const left = box.left + el.clientLeft;
  const top = box.top + el.clientTop;
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
}

/**
 * Pure placement that never leaves its areas. `areas` go from the preferred
 * bounds (a chart's card, as much of it as shows) to the hard limit (the
 * dialog's visible scroll area), each inside the next; nulls are skipped.
 * Up and down, the first area with room on one side of `anchor` decides —
 * the `prefer` side when both have room — and the tooltip sits `gap` away
 * from the anchor; when no area has room, it takes the roomier side of the
 * last area, clamped inside it. Left and right, it is centred on the anchor
 * and clamped inside the first area wide enough for it (else the last one).
 */
export function placeTooltipWithin(anchor, size, areas, { gap = TOOLTIP_GAP, prefer = 'above' } = {}) {
  const list = (areas || []).filter(Boolean);
  const centered = anchor.left + (anchor.right - anchor.left) / 2 - size.width / 2;
  const at = { above: anchor.top - gap - size.height, below: anchor.bottom + gap };
  const sides = prefer === 'below' ? ['below', 'above'] : ['above', 'below'];
  if (!list.length) return { left: Math.round(centered), top: Math.round(at[sides[0]]), placement: sides[0] };
  const limit = list[list.length - 1];
  const fits = (side, area) => at[side] >= area.top && at[side] + size.height <= area.bottom;
  let placement = '';
  for (const area of list) {
    placement = sides.find(side => fits(side, area)) || '';
    if (placement) break;
  }
  if (!placement) placement = anchor.top - limit.top > limit.bottom - anchor.bottom ? 'above' : 'below';
  const across = list.find(area => size.width <= area.right - area.left) || limit;
  return {
    left: Math.round(clampTo(centered, across.left, across.right - size.width)),
    top: Math.round(clampTo(at[placement], limit.top, limit.bottom - size.height)),
    placement
  };
}

/**
 * Pure placement. `anchor` and `bounds` are rects ({ left, top, right, bottom }),
 * `size` is the tooltip's { width, height }, `viewport` is { width, height }.
 * `inDialog` makes "above" the fallback when neither side fits the bounds.
 */
export function placeTooltip(anchor, size, viewport, { bounds = null, inDialog = false, gap = TOOLTIP_GAP, margin = TOOLTIP_MARGIN } = {}) {
  const view = { left: margin, top: margin, right: viewport.width - margin, bottom: viewport.height - margin };
  const area = (bounds && intersect(view, bounds)) || view;
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = box => below >= box.top && below + size.height <= box.bottom;
  const fitsAbove = box => above >= box.top && above + size.height <= box.bottom;
  const order = inDialog ? ['above', 'below'] : ['below', 'above'];
  let placement = fitsBelow(area) ? 'below' : fitsAbove(area) ? 'above' : '';
  if (!placement) placement = order.find(side => (side === 'below' ? fitsBelow(view) : fitsAbove(view))) || '';
  if (!placement) placement = view.bottom - anchor.bottom >= anchor.top - view.top ? 'below' : 'above';
  const top = clampTo(placement === 'below' ? below : above, view.top, view.bottom - size.height);
  const horizontal = size.width <= area.right - area.left ? area : view;
  const centered = anchor.left + (anchor.right - anchor.left) / 2 - size.width / 2;
  const left = clampTo(centered, horizontal.left, horizontal.right - size.width);
  return { left: Math.round(left), top: Math.round(top), placement };
}

/** A wrapped label keeps its balanced lines but the box hugs the widest one. */
function hugLines(label) {
  const range = document.createRange();
  range.selectNodeContents(label);
  const lines = [...range.getClientRects()].filter(rect => rect.width > 0);
  if (lines.length < 2) return;
  label.style.width = `${Math.ceil(Math.max(...lines.map(rect => rect.width))) + 1}px`;
}

const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };

/** The visible area a control lives in: its nearest scroll port, within its dialog. */
function visibleArea(target) {
  const panel = target.closest('.modal__panel');
  let area = panel ? rectOf(panel) : null;
  for (let el = target.parentElement; el && el !== panel && el !== document.body; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const scrollPort = rectOf(el);
    area = area ? intersect(area, scrollPort) || area : scrollPort;
    break;
  }
  return { area, inDialog: !!panel };
}

export function createAppTooltips({ getActiveModal = () => null } = {}) {
  let node = null;
  let current = null;
  let suppressUntil = 0;
  // Escape dismisses the label; it stays away until the pointer or focus leaves that control.
  let dismissed = null;

  function hide() {
    current = null;
    node?.remove();
    node = null;
  }

  function show(target) {
    if (Date.now() < suppressUntil || target === dismissed) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const activeModal = getActiveModal();
    // A popover over the dialog (a date picker) is on top too: its controls keep their labels.
    if (activeModal && !activeModal.contains(target) && !target.closest?.('.app-popover')) return;
    if (!target?.dataset?.tooltip || target.disabled || target.getAttribute('aria-expanded') === 'true') return;
    if (current === target) return;
    hide();
    current = target;
    const tip = document.createElement('div');
    tip.className = 'app-tooltip-float';
    tip.setAttribute('role', 'tooltip');
    const label = document.createElement('span');
    // A dash never starts a wrapped line.
    label.textContent = target.dataset.tooltip.replace(/ ([—–]) /g, '\u00a0$1 ');
    tip.append(label);
    if (target.dataset.tooltipKey) {
      const key = document.createElement('kbd');
      key.textContent = target.dataset.tooltipKey;
      tip.append(key);
    }
    document.body.append(tip);
    hugLines(label);
    const size = tip.getBoundingClientRect();
    const { area, inDialog } = visibleArea(target);
    const place = placeTooltip(rectOf(target), { width: size.width, height: size.height }, { width: innerWidth, height: innerHeight }, { bounds: area, inDialog });
    tip.dataset.placement = place.placement;
    tip.style.left = `${place.left}px`;
    tip.style.top = `${place.top}px`;
    requestAnimationFrame(() => tip.classList.add('is-visible'));
    node = tip;
  }

  function bind(doc = document) {
    // Any action dismisses its tooltip at once and keeps it away for a moment.
    doc.addEventListener('pointerdown', event => { if (event.target.closest?.('button, a, [role="button"]')) { suppressUntil = Date.now() + 700; hide(); } }, true);
    doc.addEventListener('mouseover', event => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target && !target.contains(event.relatedTarget)) show(target);
    });
    doc.addEventListener('mouseout', event => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target && !target.contains(event.relatedTarget)) { if (target === dismissed) dismissed = null; hide(); }
    });
    doc.addEventListener('focusin', event => { const target = event.target.closest?.('[data-tooltip]'); if (target) show(target); });
    doc.addEventListener('focusout', event => { const target = event.target.closest?.('[data-tooltip]'); if (target) { if (target === dismissed) dismissed = null; hide(); } });
    // Escape hides the label without moving the pointer or focus (WCAG 1.4.13); the
    // key still reaches the page, so the same press also closes a dialog or popover.
    doc.addEventListener('keydown', event => { if (event.key === 'Escape' && node) { dismissed = current; hide(); } }, true);
    doc.addEventListener('scroll', hide, true);
  }

  return { show, hide, bind };
}
