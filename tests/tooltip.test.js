import test from 'node:test';
import assert from 'node:assert/strict';
import { insetRect, intersectRects, placeTooltip, placeTooltipWithin, visibleViewportRect, TOOLTIP_GAP, TOOLTIP_MARGIN } from '../src/ui/tooltip.js';

const viewport = { width: 1440, height: 900 };
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

test('a tooltip sits centred below its control when there is room', () => {
  const place = placeTooltip(rect(600, 100, 40, 30), { width: 120, height: 24 }, viewport);
  assert.equal(place.placement, 'below');
  assert.equal(place.top, 130 + TOOLTIP_GAP);
  assert.equal(place.left, 620 - 60);
});

test('it flips above near the bottom of the viewport', () => {
  const place = placeTooltip(rect(600, 860, 40, 30), { width: 120, height: 24 }, viewport);
  assert.equal(place.placement, 'above');
  assert.equal(place.top, 860 - TOOLTIP_GAP - 24);
});

test('it never comes closer than the margin to a viewport edge', () => {
  const right = placeTooltip(rect(1420, 100, 16, 16), { width: 260, height: 38 }, viewport);
  assert.equal(right.left, viewport.width - TOOLTIP_MARGIN - 260);
  const left = placeTooltip(rect(2, 100, 16, 16), { width: 260, height: 38 }, viewport);
  assert.equal(left.left, TOOLTIP_MARGIN);
  const phone = placeTooltip(rect(350, 400, 30, 30), { width: 260, height: 38 }, { width: 390, height: 844 });
  assert.ok(phone.left >= TOOLTIP_MARGIN && phone.left + 260 <= 390 - TOOLTIP_MARGIN);
});

test('inside a dialog it stays within the visible area and prefers above when there is no room below', () => {
  // Close day: the last row's Forget button sits just above the dialog's action bar.
  const list = rect(418, 417, 600, 328);
  const forget = rect(958, 705, 48, 34);
  const place = placeTooltip(forget, { width: 244, height: 25 }, viewport, { bounds: list, inDialog: true });
  assert.equal(place.placement, 'above');
  assert.ok(place.top >= list.top && place.top + 25 <= forget.top, 'above the button, inside the list');
  assert.ok(place.left + 244 <= list.right, 'does not cross the dialog edge');
  assert.ok(place.left >= list.left);
});

test('when the area is too small for either side, dialogs fall back to above and pages to below', () => {
  const tiny = rect(100, 300, 400, 40);
  const anchor = rect(200, 305, 30, 30);
  assert.equal(placeTooltip(anchor, { width: 120, height: 24 }, viewport, { bounds: tiny, inDialog: true }).placement, 'above');
  assert.equal(placeTooltip(anchor, { width: 120, height: 24 }, viewport, { bounds: tiny }).placement, 'below');
});

test('a tooltip wider than its area is clamped to the viewport instead', () => {
  const narrow = rect(300, 0, 100, 900);
  const place = placeTooltip(rect(340, 200, 20, 20), { width: 200, height: 24 }, viewport, { bounds: narrow });
  assert.equal(place.left, 250);
});

// Chart readings (Insights): inside the chart's card, then the dialog's visible scroll area, never outside it.
// The geometry is the Stats dialog at 1440 × 900: its scroll area and the heatmap card, each moved in by 4px.
const port = { left: 228, top: 58, right: 1212, bottom: 878 };
const heatCard = { left: 683, top: 396, right: 1194, bottom: 710 };
const reading = { width: 193, height: 50 };

test('rect helpers: overlaps skip nulls, and a rect moved in too far is gone', () => {
  assert.deepEqual(intersectRects(rect(0, 0, 100, 100), null, rect(50, 20, 100, 100)), { left: 50, top: 20, right: 100, bottom: 100 });
  assert.equal(intersectRects(rect(0, 0, 10, 10), rect(20, 20, 10, 10)), null);
  assert.equal(intersectRects(), null);
  assert.deepEqual(insetRect(rect(10, 10, 100, 50), 4), { left: 14, top: 14, right: 106, bottom: 56 });
  assert.equal(insetRect(rect(10, 10, 6, 6), 4), null);
  assert.equal(insetRect(null, 4), null);
});

test('what shows of the page follows a phone’s visual viewport (zoomed in, or under the keyboard)', () => {
  assert.deepEqual(visibleViewportRect({ visualViewport: { offsetLeft: 40, offsetTop: 300, width: 180, height: 370 }, innerWidth: 360, innerHeight: 740 }), { left: 40, top: 300, right: 220, bottom: 670 });
  assert.deepEqual(visibleViewportRect({ innerWidth: 1440, innerHeight: 900 }), { left: 0, top: 0, right: 1440, bottom: 900 });
  assert.deepEqual(visibleViewportRect({ visualViewport: { width: 0, height: 0 }, innerWidth: 390, innerHeight: 844 }), { left: 0, top: 0, right: 390, bottom: 844 });
});

test('a chart reading sits above its mark, centred, a small gap away', () => {
  const cell = rect(900, 520, 34, 24);
  const place = placeTooltipWithin(cell, reading, [heatCard, port]);
  assert.equal(place.placement, 'above');
  assert.equal(place.top, 520 - TOOLTIP_GAP - 50);
  assert.equal(place.left, Math.round(917 - 193 / 2));
  assert.equal(placeTooltipWithin(cell, reading, [heatCard, port], { prefer: 'below' }).top, 544 + TOOLTIP_GAP);
});

test('a cell in a corner of the heatmap keeps its reading inside the card, never across its edge or the dialog’s', () => {
  const corners = [rect(728, 467, 34, 24), rect(1148, 467, 34, 24), rect(728, 625, 34, 24), rect(1148, 625, 34, 24)];
  for (const cell of corners) {
    const place = placeTooltipWithin(cell, reading, [heatCard, port]);
    assert.ok(place.left >= heatCard.left && place.left + reading.width <= heatCard.right, `left/right ${JSON.stringify(place)}`);
    assert.ok(place.top >= heatCard.top && place.top + reading.height <= heatCard.bottom, `top/bottom ${JSON.stringify(place)}`);
    const clear = place.top + reading.height <= cell.top - TOOLTIP_GAP || place.top >= cell.bottom + TOOLTIP_GAP;
    assert.ok(clear, 'never over the cell it reads');
  }
  // The right-hand column: flush with the card's inner edge, where the old placement crossed into the dialog's margin.
  assert.equal(placeTooltipWithin(corners[1], reading, [heatCard, port]).left, heatCard.right - reading.width);
});

test('scrolled so the card’s top is out of view, a top-row cell gets its reading below', () => {
  const visibleCard = intersectRects(rect(683, -20, 511, 314), port);
  const cell = rect(1148, 62, 34, 24);
  const place = placeTooltipWithin(cell, reading, [visibleCard, port]);
  assert.equal(place.placement, 'below');
  assert.equal(place.top, 86 + TOOLTIP_GAP);
  assert.ok(place.top + reading.height <= visibleCard.bottom);
});

test('with no room in what shows of the card, the reading uses the scroll area but stays in line with the card', () => {
  // A phone, 360 px: only the last row of the heatmap still shows at the top of the dialog.
  const phonePort = { left: 17, top: 61, right: 343, bottom: 711 };
  const visibleCard = intersectRects({ left: 30, top: -137, right: 331, bottom: 136 }, phonePort);
  const cell = rect(66, 100, 38, 20);
  const place = placeTooltipWithin(cell, { width: 169, height: 50 }, [visibleCard, phonePort]);
  assert.equal(place.placement, 'below');
  assert.equal(place.top, 120 + TOOLTIP_GAP);
  assert.equal(place.left, visibleCard.left, 'aligned with the card, not the dialog edge');
});

test('a reading wider than its card is clamped to the scroll area instead', () => {
  const narrow = { left: 300, top: 100, right: 450, bottom: 600 };
  const place = placeTooltipWithin(rect(420, 400, 20, 20), { width: 220, height: 50 }, [narrow, port]);
  assert.equal(place.placement, 'above');
  assert.ok(place.left >= port.left && place.left + 220 <= port.right);
  assert.equal(place.left, Math.round(430 - 110));
});

test('when nothing has room, the reading takes the roomier side and still never leaves the last area', () => {
  const short = { left: 100, top: 100, right: 400, bottom: 190 };
  const below = placeTooltipWithin(rect(380, 110, 30, 20), { width: 140, height: 60 }, [short]);
  assert.equal(below.placement, 'below');
  assert.deepEqual([below.left, below.top], [400 - 140, 190 - 60]);
  const above = placeTooltipWithin(rect(110, 160, 30, 20), { width: 140, height: 60 }, [null, short]);
  assert.equal(above.placement, 'above');
  assert.deepEqual([above.left, above.top], [100, 100]);
  // A mark scrolled out of view: the reading waits at the nearest edge of the scroll area.
  const gone = placeTooltipWithin(rect(600, 990, 30, 20), reading, [null, port]);
  assert.equal(gone.top, port.bottom - reading.height);
});

test('without any area the reading is simply centred above its mark', () => {
  assert.deepEqual(placeTooltipWithin(rect(100, 300, 40, 20), { width: 120, height: 40 }, []), { left: 60, top: 300 - TOOLTIP_GAP - 40, placement: 'above' });
});
