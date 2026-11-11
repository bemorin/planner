// Small chart pieces for the owner dashboard, drawn as inline SVG or plain
// HTML with no library. One series, one hue: bars use --trend-bar, the period
// still running uses the softer --trend-partial, and every value is also in
// a table view. Labels go in with textContent, never as markup.

const SVG_NS = 'http://www.w3.org/2000/svg';
const BAR_MAX = 24;
const PLOT_HEIGHT = 190;
const AXIS_BAND = 34;
const TOP_ROOM = 22;

const svg = (name, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
};

/** Round axis steps (1, 2, 2.5, 5 × 10ⁿ) and the ticks from 0 to just above `max`. */
export function niceTicks(max, target = 4) {
  if (!(max > 0)) return { step: 1, top: 1, ticks: [0, 1] };
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(value => value >= raw);
  const whole = step >= 1 ? Math.max(1, Math.round(step)) : step;
  const top = Math.ceil(max / whole) * whole;
  const ticks = [];
  for (let value = 0; value <= top + whole / 2; value += whole) ticks.push(Math.round(value * 1000) / 1000);
  return { step: whole, top, ticks };
}

/** A column with a 4px rounded data end and a square base. */
function columnPath(x, y, width, height) {
  const radius = Math.min(4, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${bottom}Z`;
}

/** Twelve-ish mini columns: earlier periods recede, the current one wears the accent. */
export function sparklineHtml(values) {
  const max = Math.max(0, ...values.map(value => Number(value) || 0));
  return `<span class="trend-spark" aria-hidden="true">${values.map((value, index) => {
    const height = max ? Math.max(value > 0 ? 6 : 0, Math.round((Number(value) || 0) / max * 100)) : 0;
    return `<i class="${index === values.length - 1 ? 'is-current' : ''}" style="height:${height}%"></i>`;
  }).join('')}</span>`;
}

/**
 * A column chart sized to its host, redrawn when the host's width changes.
 * rows: [{ label, value, partial?, tipTitle, tipLines? }]; format(value) for
 * labels and tooltips, formatAxis(value) for the y ticks.
 * Hover or arrow keys (after Tab) move a tooltip from column to column.
 */
export function columnChart(host, { rows, format, formatAxis = format, label }) {
  host.classList.add('trend-chart');
  host.replaceChildren();
  const frame = document.createElement('div');
  frame.className = 'trend-chart__frame';
  frame.tabIndex = 0;
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', `${label}. Use the left and right arrow keys to read each value; the table view lists them all.`);
  const tip = document.createElement('div');
  tip.className = 'trend-tip';
  tip.hidden = true;
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  host.append(frame, tip, live);

  let active = -1;
  let columns = [];
  let lastWidth = 0;

  function showTip(index, { announce = false } = {}) {
    if (index < 0 || index >= rows.length) { hideTip(); return; }
    active = index;
    columns.forEach((column, position) => column.group.classList.toggle('is-active', position === index));
    const row = rows[index];
    const value = document.createElement('strong');
    value.textContent = format(row.value);
    const title = document.createElement('span');
    title.textContent = row.tipTitle || row.label;
    tip.replaceChildren(value, title, ...(row.tipLines || []).map(line => {
      const extra = document.createElement('small');
      extra.textContent = line;
      return extra;
    }));
    tip.hidden = false;
    const column = columns[index];
    const hostBox = host.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    const centre = frameBox.left - hostBox.left + column.centre;
    const left = Math.max(0, Math.min(hostBox.width - tipBox.width, centre - tipBox.width / 2));
    const top = Math.max(0, frameBox.top - hostBox.top + column.top - tipBox.height - 8);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    if (announce) live.textContent = `${row.tipTitle || row.label}: ${format(row.value)}${row.tipLines?.length ? `, ${row.tipLines.join(', ')}` : ''}`;
  }

  function hideTip() {
    active = -1;
    tip.hidden = true;
    columns.forEach(column => column.group.classList.remove('is-active'));
  }

  function draw() {
    const width = Math.max(260, Math.floor(frame.clientWidth || host.clientWidth || 600));
    lastWidth = width;
    const max = Math.max(0, ...rows.map(row => Number(row.value) || 0));
    const { top, ticks } = niceTicks(max);
    const tickLabels = ticks.map(value => formatAxis(value));
    const left = Math.min(72, 12 + Math.max(...tickLabels.map(text => text.length)) * 7);
    const right = 6;
    const plotWidth = width - left - right;
    const band = plotWidth / rows.length;
    const barWidth = Math.max(4, Math.min(BAR_MAX, Math.floor(band * 0.62)));
    const height = TOP_ROOM + PLOT_HEIGHT + AXIS_BAND;
    const y = value => TOP_ROOM + PLOT_HEIGHT - (top ? (Number(value) || 0) / top * PLOT_HEIGHT : 0);
    const chart = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'trend-chart__svg', 'aria-hidden': 'true', focusable: 'false' });
    // The planner sizes every svg as an icon; a chart sets its own size.
    chart.style.width = `${width}px`;
    chart.style.height = `${height}px`;

    ticks.forEach((value, index) => {
      const lineY = Math.round(y(value)) + 0.5;
      chart.append(svg('line', { x1: left, x2: width - right, y1: lineY, y2: lineY, class: index ? 'trend-chart__grid' : 'trend-chart__base' }));
      const text = svg('text', { x: left - 8, y: lineY + 4, 'text-anchor': 'end', class: 'trend-chart__tick' });
      text.textContent = tickLabels[index];
      chart.append(text);
    });

    // Thin out the x labels when they would collide; always keep the last one.
    const longest = Math.max(...rows.map(row => String(row.label).length));
    const every = Math.max(1, Math.ceil((longest * 6.4 + 8) / band));
    columns = rows.map((row, index) => {
      const group = svg('g', { class: `trend-chart__col${row.partial ? ' is-partial' : ''}` });
      const centre = left + band * index + band / 2;
      const valueY = y(row.value);
      const barHeight = TOP_ROOM + PLOT_HEIGHT - valueY;
      if (barHeight >= 0.5) group.append(svg('path', { d: columnPath(centre - barWidth / 2, valueY, barWidth, barHeight), class: 'trend-chart__bar' }));
      if ((rows.length - 1 - index) % every === 0) {
        const text = svg('text', { x: centre, y: TOP_ROOM + PLOT_HEIGHT + 18, 'text-anchor': 'middle', class: 'trend-chart__label' });
        text.textContent = row.label;
        group.append(text);
      }
      // The whole band is the hover target, not just the painted column.
      const hit = svg('rect', { x: left + band * index, y: 0, width: band, height: TOP_ROOM + PLOT_HEIGHT, class: 'trend-chart__hit' });
      hit.addEventListener('pointerenter', () => showTip(index));
      hit.addEventListener('pointermove', () => { if (active !== index) showTip(index); });
      group.append(hit);
      chart.append(group);
      return { group, centre, top: barHeight >= 0.5 ? valueY : TOP_ROOM + PLOT_HEIGHT };
    });

    // Direct label on the last column only: the period running now. When it is
    // wider than its band it would sit over the neighbouring column, so the
    // tooltip and the table view carry it instead.
    const last = rows.length - 1;
    const label = last >= 0 ? format(rows[last].value) : '';
    if (label && label.length * 7 <= band - 4) {
      const text = svg('text', { x: columns[last].centre, y: columns[last].top - 7, 'text-anchor': 'middle', class: 'trend-chart__value' });
      text.textContent = label;
      chart.append(text);
    }
    chart.addEventListener('pointerleave', hideTip);
    frame.replaceChildren(chart);
  }

  frame.addEventListener('keydown', event => {
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (!(event.key in keys)) { if (event.key === 'Escape') hideTip(); return; }
    event.preventDefault();
    const step = keys[event.key];
    const next = step === -Infinity ? 0 : step === Infinity ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (active < 0 ? rows.length - 1 : active + step)));
    showTip(next, { announce: true });
  });
  frame.addEventListener('focus', () => { if (active < 0 && frame.matches(':focus-visible')) showTip(rows.length - 1, { announce: true }); });
  frame.addEventListener('blur', hideTip);

  draw();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (Math.abs(Math.floor(frame.clientWidth) - lastWidth) > 1) { hideTip(); draw(); }
  }) : null;
  observer?.observe(frame);
  return { destroy() { observer?.disconnect(); } };
}
