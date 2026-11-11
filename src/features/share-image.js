import { durationLabel } from '../domain/schedule-time.js';
import { dateFromKey } from '../lib/dates.js';

/**
 * Share images: your week or your year as a PNG, drawn on a canvas on this
 * device. Nothing here touches the network or storage.
 *
 * The model builders are pure (unit-tested); drawShareImage() paints a model
 * onto a 2D context at the exact output size, so exports are never scaled.
 * Private text (a line you wrote, your Misogi) is drawn only when the options
 * say so explicitly — normalizeShareOptions() turns anything else off.
 */

export const SHARE_SITE = 'planner.bemorin.com';

export const SHARE_FORMATS = Object.freeze([
  { id: 'square', label: 'Square', hint: 'Feeds', width: 1080, height: 1080 },
  { id: 'story', label: 'Story', hint: 'Stories', width: 1080, height: 1920 },
  { id: 'landscape', label: 'Landscape', hint: 'Links and posts', width: 1200, height: 630 }
]);

export const SHARE_LOOKS = Object.freeze([
  { id: 'paper', label: 'Paper' },
  { id: 'ink', label: 'Ink' }
]);

export const shareFormat = id => SHARE_FORMATS.find(format => format.id === id) || SHARE_FORMATS[0];

// The app's light and dark tokens (styles/core.css, styles/theme.css).
const LOOKS = {
  paper: { bg: '#f6f3ed', card: '#ffffff', ink: '#1c1a17', muted: '#706a62', faint: '#9a948d', line: '#ddd8d0', lineStrong: '#c7c0b6', soft: '#efebe4', milestone: '#b97a46', glow: 0.11, tile: '#171611', glyph: '#f4f0e7' },
  ink: { bg: '#151412', card: '#24221f', ink: '#ece8e1', muted: '#a9a198', faint: '#80796f', line: '#322f2a', lineStrong: '#48433c', soft: '#2b2925', milestone: '#dcaa76', glow: 0.15, tile: '#f4f0e7', glyph: '#171611' }
};

// The painted-year palettes, light and dark (kept in step with styles/year.css by a test).
export const SHARE_PAINTS = Object.freeze({
  terracotta: { paper: { paint: '#a5522e' }, ink: { paint: '#e3916a' } },
  ocean: { paper: { paint: '#2b6a99' }, ink: { paint: '#6db0de' } },
  forest: { paper: { paint: '#3b7552' }, ink: { paint: '#80c095' } },
  plum: { paper: { paint: '#7b4a8b' }, ink: { paint: '#c69bd8' } },
  graphite: { paper: { paint: '#454b54', level1: ['#454b54', 0.44] }, ink: { paint: '#b8bec8', level1: ['#b8bec8', 0.4] } },
  sunset: { paper: { paint: '#b9355f', level1: ['#eda23a', 0.52], level2: '#e2704c', joker: '#5b7ea3' }, ink: { paint: '#ee7d9c', level1: ['#f5a524', 0.62], level2: '#e9805e', joker: '#90b2d4' } }
});

const HEX = /^#[0-9a-f]{6}$/i;

const toRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

/** sRGB mix, like CSS color-mix(in srgb, a weight, b). */
export function mixHex(a, b, weight = 0.5) {
  if (!HEX.test(a) || !HEX.test(b)) return HEX.test(a) ? a : b;
  const w = Math.min(1, Math.max(0, Number(weight) || 0));
  const [ra, ga, ba] = toRgb(a);
  const [rb, gb, bb] = toRgb(b);
  return `#${[ra * w + rb * (1 - w), ga * w + gb * (1 - w), ba * w + bb * (1 - w)].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

const alpha = (hex, value) => {
  const [r, g, b] = toRgb(HEX.test(hex) ? hex : '#000000');
  return `rgba(${r}, ${g}, ${b}, ${value})`;
};

/** Every colour an image needs, for a palette and a look. */
export function shareColors(paintId = 'terracotta', lookId = 'paper') {
  const look = LOOKS[lookId] || LOOKS.paper;
  const paints = SHARE_PAINTS[paintId] || SHARE_PAINTS.terracotta;
  const own = paints[lookId === 'ink' ? 'ink' : 'paper'];
  const paint = own.paint;
  // On ink the lighter levels get a little more paint, so one closed day still reads at a glance.
  const lift = lookId === 'ink' ? 0.12 : 0;
  const level1 = own.level1 ? mixHex(own.level1[0], look.card, own.level1[1] + lift) : mixHex(paint, look.card, 0.34 + lift);
  const level2 = own.level2 || mixHex(paint, look.card, 0.66 + lift / 2);
  const joker = own.joker || look.milestone;
  return {
    ...look,
    paint,
    levels: [look.line, level1, level2, paint],
    joker,
    jokerFill: mixHex(joker, look.card, 0.22),
    missed: mixHex(look.line, look.soft, 0.55),
    rest: mixHex(look.lineStrong, look.bg, 0.8),
    beforeLine: mixHex(look.line, look.bg, 0.5),
    futureLine: mixHex(look.line, look.bg, 0.8),
    other: look.faint
  };
}

/** Private text is opt-in: only a literal `true` turns it on. */
export function normalizeShareOptions(options = {}) {
  const format = shareFormat(options.format).id;
  const look = options.look === 'ink' ? 'ink' : 'paper';
  const paint = SHARE_PAINTS[options.paint] ? options.paint : 'terracotta';
  const line = options.includeLine === true ? cleanText(options.line) : '';
  const misogi = options.includeMisogi === true;
  return { format, look, paint, includeLine: !!line, line, includeMisogi: misogi, locale: options.locale };
}

export const cleanText = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Text fitting (pure: `measure` returns a width for a string)
// ---------------------------------------------------------------------------

/** The text, or as much of it as fits followed by an ellipsis. */
export function fitText(text, maxWidth, measure) {
  const value = cleanText(text);
  if (!value || measure(value) <= maxWidth) return value;
  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${chars.slice(0, mid).join('').trimEnd()}…`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  if (!low) return '';
  // Prefer ending on a whole word when one ends close to the cut.
  const kept = chars.slice(0, low).join('');
  const space = kept.lastIndexOf(' ');
  const cut = space >= kept.length * 0.6 ? kept.slice(0, space) : kept;
  return `${cut.replace(/[\s,;:–—-]+$/, '')}…`;
}

/** Greedy word wrap into at most `maxLines`; the last line ends in an ellipsis when text is left over. */
export function wrapText(text, maxWidth, measure, maxLines = 2) {
  const words = cleanText(text).split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) { current = candidate; index += 1; continue; }
    if (!current) {
      // A single word wider than the line: break it.
      const piece = fitText(word, maxWidth, value => measure(value.replace(/…$/, '')));
      const kept = piece.replace(/…$/, '') || Array.from(word)[0];
      lines.push(kept);
      words[index] = word.slice(kept.length);
      if (!words[index]) index += 1;
    } else {
      lines.push(current);
      current = '';
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) { lines.push(current); current = ''; }
  const rest = [current, ...words.slice(index)].filter(Boolean).join(' ');
  if (rest && lines.length) lines[lines.length - 1] = fitText(`${lines[lines.length - 1]} ${rest}`, maxWidth, measure);
  return lines;
}

/** Like wrapText(), but lines of even length: the narrowest width that keeps the same number of lines. */
export function balanceText(text, maxWidth, measure, maxLines = 2) {
  const lines = wrapText(text, maxWidth, measure, maxLines);
  const whole = cleanText(text);
  if (lines.length < 2 || lines.join(' ') !== whole) return lines;
  let low = 0;
  let high = maxWidth;
  for (let step = 0; step < 14; step += 1) {
    const mid = (low + high) / 2;
    const trial = wrapText(whole, mid, measure, maxLines);
    if (trial.length === lines.length && trial.join(' ') === whole) high = mid;
    else low = mid;
  }
  return wrapText(whole, high, measure, maxLines);
}

// ---------------------------------------------------------------------------
// Models (pure)
// ---------------------------------------------------------------------------

/** One painted square's look, from a progress-model cell. */
export function shareCellState(cell = {}) {
  if (cell.closed) return 'closed';
  if (cell.today) return 'today';
  if (cell.future) return 'future';
  if (cell.before) return 'before';
  if (cell.joker) return 'joker';
  if (cell.planning) return 'missed';
  return 'rest';
}

const shareCell = cell => ({ key: cell.key, state: shareCellState(cell), level: cell.closed ? Math.min(3, Math.max(1, Number(cell.level) || 1)) : 0 });

function uniqueLines(lines) {
  const seen = new Set();
  return (lines || []).map(cleanText).filter(line => {
    const key = line.toLocaleLowerCase();
    if (!line || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The week as an image: its planning days painted, main outcomes, streak and
 * where the scheduled time went. `cells` are progress-model cells (one per
 * planning day); `lines` are the lessons written this week (offered, never
 * drawn unless chosen).
 */
export function buildWeekShareModel({ cells = [], mainDone = 0, mainTotal = 0, categories = [], scheduledMinutes = 0, streak = 0, lines = [] } = {}) {
  const days = cells.map(shareCell);
  const closed = days.filter(day => day.state === 'closed').length;
  const possible = days.filter(day => !['before', 'future'].includes(day.state)).length;
  const top = categories
    .filter(item => Number(item.minutes) > 0)
    .slice(0, 5)
    .map(item => ({ name: cleanText(item.name) || 'Uncategorized', color: HEX.test(item.color) ? item.color : '', minutes: Math.round(Number(item.minutes)) }));
  const listed = top.reduce((sum, item) => sum + item.minutes, 0);
  const totalMinutes = Math.max(listed, Math.round(Number(scheduledMinutes) || 0));
  if (totalMinutes > listed) top.push({ name: 'Other', color: '', minutes: totalMinutes - listed, other: true });
  return {
    kind: 'week',
    firstKey: days[0]?.key || '',
    lastKey: days[days.length - 1]?.key || '',
    days,
    closed,
    possible: Math.max(possible, closed),
    mainDone: Math.max(0, Number(mainDone) || 0),
    mainTotal: Math.max(0, Number(mainTotal) || 0),
    categories: top,
    totalMinutes,
    streak: Math.max(0, Math.floor(Number(streak) || 0)),
    lines: uniqueLines(lines),
    empty: closed === 0
  };
}

/** The year as an image, from buildProgressModel(); `misogi` is offered, never drawn unless chosen. */
export function buildYearShareModel(progress, { misogi = '', misogiDone = false } = {}) {
  const year = Number(progress?.year) || new Date().getFullYear();
  const todayKey = String(progress?.todayKey || '');
  const months = (progress?.months || []).map(month => ({ month: month.month, closed: Number(month.closed) || 0, days: (month.days || []).map(shareCell) }));
  const closed = Math.max(0, Number(progress?.closed) || 0);
  const isCurrentYear = todayKey.slice(0, 4) === String(year);
  return {
    kind: 'year',
    year,
    todayKey,
    isCurrentYear,
    months,
    closed,
    closeRate: Math.max(0, Math.min(100, Number(progress?.closeRate) || 0)),
    planningElapsed: Math.max(0, Number(progress?.planningElapsed) || 0),
    bestStreak: Math.max(0, Number(progress?.streak?.yearBest) || 0),
    currentStreak: isCurrentYear ? Math.max(0, Number(progress?.streak?.current) || 0) : 0,
    mitDone: Math.max(0, Number(progress?.metrics?.mitDone) || 0),
    misogi: cleanText(misogi),
    misogiDone: !!(cleanText(misogi) && misogiDone),
    empty: closed === 0
  };
}

/** Whether a model has anything worth sharing (at least one closed day). */
export const canShare = model => !!model && !model.empty && model.closed > 0;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** “October 19 – 23, 2026” in the reader's locale. */
export function weekRangeLabel(firstKey, lastKey, locale) {
  if (!firstKey) return '';
  const first = dateFromKey(firstKey);
  const last = dateFromKey(lastKey || firstKey);
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  try {
    const format = new Intl.DateTimeFormat(locale, options);
    return firstKey === lastKey || typeof format.formatRange !== 'function' ? format.format(first) : format.formatRange(first, last);
  } catch (_) {
    return `${first.toDateString()} – ${last.toDateString()}`;
  }
}

/** The line under the year's headline. */
export function yearSubline(model, locale) {
  const parts = [];
  if (model.planningElapsed) parts.push(`${model.closeRate}% of planning days`);
  if (model.isCurrentYear && model.todayKey) {
    let through = model.todayKey;
    try { through = dateFromKey(model.todayKey).toLocaleDateString(locale, { month: 'long', day: 'numeric' }); } catch (_) {}
    parts.push(`through ${through}`);
  }
  const text = parts.join(', ');
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : '';
}

/** Plain-words description of an image (the preview's accessible name). */
export function describeShare(model, options = {}) {
  const opts = normalizeShareOptions(options);
  if (!model) return '';
  if (model.kind === 'year') {
    const bits = [`${plural(model.closed, 'day')} closed in ${model.year}`];
    if (model.bestStreak) bits.push(`best streak ${plural(model.bestStreak, 'day')}`);
    if (opts.includeMisogi && model.misogi) bits.push(`Misogi: ${model.misogi}`);
    return `Your ${model.year}, painted day by day: ${bits.join(', ')}.`;
  }
  const bits = [`${model.closed} of ${plural(model.possible, 'day')} closed`];
  if (model.mainTotal) bits.push(`${model.mainDone} of ${model.mainTotal} main outcomes`);
  if (model.streak) bits.push(`a ${model.streak}-day streak`);
  if (model.totalMinutes) bits.push(`${durationLabel(model.totalMinutes)} scheduled`);
  if (opts.includeLine) bits.push(`and the line “${opts.line}”`);
  return `Your week of ${weekRangeLabel(model.firstKey, model.lastKey, opts.locale)}: ${bits.join(', ')}.`;
}

/** daily-planner-week-2026-10-19.png, daily-planner-2026-story.png … */
export function shareFileName(model, format = 'square') {
  const suffix = format === 'square' ? '' : `-${shareFormat(format).id}`;
  if (model?.kind === 'year') return `daily-planner-${model.year}${suffix}.png`;
  return `daily-planner-week-${model?.firstKey || 'week'}${suffix}.png`;
}

// ---------------------------------------------------------------------------
// Drawing (browser only)
// ---------------------------------------------------------------------------

const CAP = 0.727; // cap height of Inter (and close to the system UI fonts that stand in for it)
// The planner's mark (favicon.svg): the sun on a horizon, stroked on a 64 grid.
const MARK = 'M12 38h40M20 38a12 12 0 0 1 24 0M32 17.5v4.5M17.5 23.5l3.2 3.2M46.5 23.5l-3.2 3.2M22.5 46h19';
const ICONS = {
  flame: 'M12 21c3.6 0 6-2.4 6-5.6 0-3.9-3.1-5.7-3.9-9.4-2 1.4-2.9 3.3-2.9 5.1-1-.7-1.7-1.9-1.9-3.1C7.4 9.6 6 11.9 6 15.4 6 18.6 8.4 21 12 21Z',
  mountain: 'M2.5 19.5h19M4.5 19.5l6-10.5 4.2 7.2M12.8 13.2l2.6-4.2 5.1 10.5',
  target: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z'
};

function painter(ctx, family, colors) {
  const tracks = 'letterSpacing' in ctx;
  const font = (size, weight) => { ctx.font = `${weight} ${Math.round(size * 100) / 100}px ${family}`; };
  const spacing = value => { if (tracks) ctx.letterSpacing = `${Math.round(value * 100) / 100}px`; };
  function measure(text, size, weight = 400, track = 0) {
    font(size, weight);
    const value = String(text);
    if (tracks) {
      spacing(track * size);
      const width = ctx.measureText(value).width - track * size;
      spacing(0);
      return width;
    }
    return ctx.measureText(value).width + (track > 0 ? track * size * Math.max(0, Array.from(value).length - 1) : 0);
  }
  /** Draw one line with its cap height starting at `top`; returns the drawn width. */
  function text(value, x, top, { size, weight = 400, color = colors.ink, align = 'left', track = 0 } = {}) {
    const str = String(value);
    const width = measure(str, size, weight, track);
    let left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    const baseline = top + size * CAP;
    font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (tracks || track <= 0) {
      spacing(track * size);
      ctx.fillText(str, left, baseline);
      spacing(0);
    } else {
      for (const char of Array.from(str)) {
        ctx.fillText(char, left, baseline);
        left += ctx.measureText(char).width + track * size;
      }
    }
    return width;
  }
  const measurer = (size, weight, track = 0) => value => measure(value, size, weight, track);
  return { ctx, colors, measure, text, measurer };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawIcon(ctx, name, x, y, size, color, { fill = '', width = 1.8 } = {}) {
  if (typeof Path2D !== 'function') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  const path = new Path2D(ICONS[name]);
  if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

function drawCell(ctx, colors, cell, x, y, size) {
  const r = Math.max(2, size * 0.17);
  const inset = width => { roundRect(ctx, x + width / 2, y + width / 2, size - width, size - width, Math.max(1, r - width / 2)); ctx.lineWidth = width; };
  switch (cell.state) {
    case 'closed':
      roundRect(ctx, x, y, size, size, r);
      ctx.fillStyle = colors.levels[cell.level] || colors.paint;
      ctx.fill();
      break;
    case 'joker':
      roundRect(ctx, x, y, size, size, r);
      ctx.fillStyle = colors.jokerFill;
      ctx.fill();
      inset(Math.max(1.5, size * 0.075));
      ctx.strokeStyle = colors.joker;
      ctx.stroke();
      break;
    case 'missed':
      roundRect(ctx, x, y, size, size, r);
      ctx.fillStyle = colors.missed;
      ctx.fill();
      break;
    case 'rest':
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, Math.max(1.5, size * 0.085), 0, Math.PI * 2);
      ctx.fillStyle = colors.rest;
      ctx.fill();
      break;
    case 'today':
      roundRect(ctx, x, y, size, size, r);
      ctx.fillStyle = alpha(colors.paint, 0.08);
      ctx.fill();
      inset(Math.max(1.5, size * 0.075));
      ctx.strokeStyle = colors.paint;
      ctx.stroke();
      break;
    default:
      inset(Math.max(1, size * 0.05));
      ctx.strokeStyle = cell.state === 'before' ? colors.beforeLine : colors.futureLine;
      ctx.stroke();
  }
}

function drawBackground(p, width, height) {
  const { ctx, colors } = p;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);
  const reach = Math.max(width, height);
  const glow = ctx.createRadialGradient(width * 0.95, -height * 0.04, 0, width * 0.95, -height * 0.04, reach * 0.78);
  glow.addColorStop(0, alpha(colors.paint, colors.glow));
  glow.addColorStop(0.55, alpha(colors.paint, colors.glow * 0.28));
  glow.addColorStop(1, alpha(colors.paint, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

/** The Daily Planner mark and the address, along the bottom. Returns its height. */
function drawFooter(p, x, bottom, width, s) {
  const { ctx, colors } = p;
  const mark = 46 * s;
  const top = bottom - mark;
  ctx.fillStyle = colors.line;
  ctx.fillRect(x, top - 34 * s, width, Math.max(1, 1.5 * s));
  roundRect(ctx, x, top, mark, mark, mark * 15 / 64);
  ctx.fillStyle = colors.tile;
  ctx.fill();
  if (typeof Path2D === 'function') {
    ctx.save();
    ctx.translate(x, top);
    ctx.scale(mark / 64, mark / 64);
    ctx.strokeStyle = colors.glyph;
    ctx.lineWidth = 3.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(MARK));
    ctx.restore();
  }
  const nameSize = 27 * s;
  p.text('Daily Planner', x + mark + 16 * s, top + (mark - nameSize * CAP) / 2, { size: nameSize, weight: 700, track: -0.02 });
  const siteSize = 24 * s;
  p.text(SHARE_SITE, x + width, top + (mark - siteSize * CAP) / 2, { size: siteSize, weight: 600, color: colors.muted, align: 'right', track: -0.005 });
  return mark + 34 * s;
}

function eyebrow(p, value, x, top, size, color, align = 'left') {
  return p.text(String(value).toLocaleUpperCase(), x, top, { size, weight: 700, color, track: 0.12, align });
}

/** Largest size (down to `min`) at which `words` wrap into `maxLines` without breaking a word. */
function fitHeadline(p, value, width, { max, min, maxLines, weight = 700, track = -0.04 }) {
  for (let size = max; size >= min; size -= 2) {
    const measure = p.measurer(size, weight, track);
    const words = cleanText(value).split(' ');
    if (words.some(word => measure(word) > width)) continue;
    const lines = balanceText(value, width, measure, maxLines);
    if (lines.join(' ') === cleanText(value)) return { size, lines };
  }
  const measure = p.measurer(min, weight, track);
  return { size: min, lines: wrapText(value, width, measure, maxLines) };
}

/** Headline lines, where words listed in `accent` take the paint colour. */
function drawHeadline(p, head, x, top, { lineHeight = 1.02, accent = [], weight = 700, track = -0.04 } = {}) {
  const { colors } = p;
  const space = p.measure(' ', head.size, weight, 0);
  head.lines.forEach((line, index) => {
    let left = x;
    const lineTop = top + index * head.size * lineHeight;
    line.split(' ').forEach(word => {
      const color = accent.includes(word) ? colors.paint : colors.ink;
      left += p.text(word, left, lineTop, { size: head.size, weight, color, track }) + space;
    });
  });
  return (head.lines.length - 1) * head.size * lineHeight + head.size * CAP;
}

const lineBlock = (count, size, lineHeight) => (count ? (count - 1) * size * lineHeight + size * CAP : 0);

// --- Week pieces --------------------------------------------------------------

function weekdayLabel(key, locale) {
  try { return dateFromKey(key).toLocaleDateString(locale, { weekday: 'short' }); } catch (_) { return ''; }
}

function stripMetrics(count, width, { cellMax, gap }) {
  const n = Math.max(1, count);
  const cell = Math.floor(Math.min(cellMax, (width - gap * (n - 1)) / n));
  return { cell, gap };
}

function drawStrip(p, model, x, top, width, t, opts, draw = true) {
  const { cell, gap } = stripMetrics(model.days.length, width, t);
  const height = cell + t.labelGap + t.label * CAP;
  if (!draw) return height;
  model.days.forEach((day, index) => {
    const left = x + index * (cell + gap);
    drawCell(p.ctx, p.colors, day, left, top, cell);
    const name = weekdayLabel(day.key, opts.locale);
    const nameWidth = p.text(name, left, top + cell + t.labelGap, { size: t.label, weight: 600, color: p.colors.ink, track: -0.005 });
    p.text(String(dateFromKey(day.key).getDate()), left + nameWidth + t.label * 0.32, top + cell + t.labelGap, { size: t.label, weight: 500, color: p.colors.faint });
  });
  return height;
}

function weekStats(model) {
  const stats = [{ label: 'Days closed', value: String(model.closed), suffix: `/${model.possible}` }];
  if (model.mainTotal) stats.push({ label: 'Main outcomes', value: String(model.mainDone), suffix: `/${model.mainTotal}` });
  if (model.streak) stats.push({ label: 'Streak', value: String(model.streak), suffix: model.streak === 1 ? ' day' : ' days', icon: 'flame' });
  return stats;
}

function drawStats(p, stats, x, top, width, t, draw = true) {
  const height = t.statLabel * CAP + t.statGap + t.stat * CAP;
  if (!draw) return height;
  const { ctx, colors } = p;
  const columns = t.columns || stats.length;
  const colWidth = width / columns;
  stats.forEach((stat, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const rowTop = top + row * (height + (t.statRowGap || 0));
    const left = x + col * colWidth + (col ? t.colPad : 0);
    if (col) {
      ctx.fillStyle = colors.line;
      ctx.fillRect(x + col * colWidth, rowTop - t.stat * 0.06, Math.max(1, t.stat / 40), height + t.stat * 0.12);
    }
    eyebrow(p, stat.label, left, rowTop, t.statLabel, colors.faint);
    let cursor = left;
    const valueTop = rowTop + t.statLabel * CAP + t.statGap;
    if (stat.icon) {
      const iconSize = t.stat * 0.78;
      drawIcon(ctx, stat.icon, cursor - iconSize * 0.08, valueTop + t.stat * CAP - iconSize * 0.9, iconSize, colors.paint, { fill: alpha(colors.paint, 0.16), width: 2 });
      cursor += iconSize * 0.92;
    }
    cursor += p.text(stat.value, cursor, valueTop, { size: t.stat, weight: 700, color: stat.icon ? colors.paint : colors.ink, track: -0.035 });
    const suffixSize = t.stat * 0.42;
    p.text(stat.suffix, cursor + (stat.suffix.startsWith(' ') ? 0 : t.stat * 0.04), valueTop + t.stat * CAP - suffixSize * CAP, { size: suffixSize, weight: 600, color: colors.faint, track: -0.01 });
  });
  return height;
}

/** Categories to list, folding what does not fit into “Other”. */
function legendItems(model, capacity) {
  const items = model.categories.slice();
  if (items.length <= capacity) return items;
  const kept = items.slice(0, capacity - 1);
  const minutes = items.slice(capacity - 1).reduce((sum, item) => sum + item.minutes, 0);
  return [...kept, { name: 'Other', color: '', minutes, other: true }];
}

const categoryColor = (p, item) => (item.other || !item.color ? p.colors.other : (p.colors.bg === LOOKS.ink.bg ? mixHex(item.color, p.colors.ink, 0.82) : item.color));

function drawTime(p, model, x, top, width, t, draw = true) {
  const { ctx, colors } = p;
  const capacity = t.legendStyle === 'rows' ? t.legendRows : t.legendRows * t.legendColumns;
  const items = legendItems(model, capacity);
  const headHeight = Math.max(t.timeLabel, t.timeTotal) * CAP;
  let height = headHeight + t.barGap;
  if (t.legendStyle === 'rows') height += items.length * (t.legend * CAP + t.rowBarGap + t.rowBar) + (items.length - 1) * t.rowGap;
  else height += t.bar + t.legendGap + lineBlock(Math.ceil(items.length / t.legendColumns), t.legend, t.legendLine / t.legend);
  if (!draw) return height;
  eyebrow(p, 'Where the time went', x, top + (headHeight - t.timeLabel * CAP), t.timeLabel, colors.faint);
  p.text(durationLabel(model.totalMinutes), x + width, top + (headHeight - t.timeTotal * CAP), { size: t.timeTotal, weight: 700, align: 'right', track: -0.02 });
  let cursor = top + headHeight + t.barGap;
  const total = Math.max(1, model.totalMinutes);
  if (t.legendStyle === 'rows') {
    const hoursWidth = Math.max(...items.map(item => p.measure(durationLabel(item.minutes), t.legend, 500)));
    items.forEach(item => {
      const color = categoryColor(p, item);
      const dot = t.legend * 0.36;
      ctx.beginPath();
      ctx.arc(x + dot, cursor + (t.legend * CAP) / 2, dot, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      const nameX = x + dot * 2 + t.legend * 0.5;
      p.text(fitText(item.name, width - (nameX - x) - hoursWidth - t.legend, p.measurer(t.legend, 600, -0.01)), nameX, cursor, { size: t.legend, weight: 600, track: -0.01 });
      p.text(durationLabel(item.minutes), x + width, cursor, { size: t.legend, weight: 500, color: colors.muted, align: 'right' });
      const barTop = cursor + t.legend * CAP + t.rowBarGap;
      roundRect(ctx, x, barTop, width, t.rowBar, t.rowBar / 2);
      ctx.fillStyle = colors.missed;
      ctx.fill();
      roundRect(ctx, x, barTop, Math.max(t.rowBar, width * (item.minutes / total)), t.rowBar, t.rowBar / 2);
      ctx.fillStyle = color;
      ctx.fill();
      cursor = barTop + t.rowBar + t.rowGap;
    });
    return height;
  }
  // One stacked bar, then a legend in columns.
  ctx.save();
  roundRect(ctx, x, cursor, width, t.bar, t.bar / 2);
  ctx.clip();
  ctx.fillStyle = colors.missed;
  ctx.fillRect(x, cursor, width, t.bar);
  const seam = Math.max(2, t.bar * 0.16);
  let left = x;
  model.categories.forEach((item, index) => {
    const w = width * (item.minutes / total);
    ctx.fillStyle = categoryColor(p, item);
    ctx.fillRect(left, cursor, Math.max(0, w - (index < model.categories.length - 1 ? seam : 0)), t.bar);
    left += w;
  });
  ctx.restore();
  cursor += t.bar + t.legendGap;
  const colWidth = width / t.legendColumns;
  const gutter = t.legend * 1.4;
  items.forEach((item, index) => {
    const col = index % t.legendColumns;
    const row = Math.floor(index / t.legendColumns);
    const left = x + col * colWidth + (col ? gutter / 2 : 0);
    const right = x + (col + 1) * colWidth - (col < t.legendColumns - 1 ? gutter / 2 : 0);
    const rowTop = cursor + row * t.legendLine;
    const dot = t.legend * 0.3;
    ctx.beginPath();
    ctx.arc(left + dot, rowTop + (t.legend * CAP) / 2, dot, 0, Math.PI * 2);
    ctx.fillStyle = categoryColor(p, item);
    ctx.fill();
    const hours = durationLabel(item.minutes);
    const hoursWidth = p.measure(hours, t.legend, 500);
    const nameX = left + dot * 2 + t.legend * 0.45;
    p.text(fitText(item.name, right - nameX - hoursWidth - t.legend * 0.6, p.measurer(t.legend, 600, -0.01)), nameX, rowTop, { size: t.legend, weight: 600, track: -0.01 });
    p.text(hours, right, rowTop, { size: t.legend, weight: 500, color: colors.muted, align: 'right' });
  });
  return height;
}

function quoteLines(p, line, width, t) {
  return balanceText(`“${cleanText(line)}”`, width - t.quoteIndent, p.measurer(t.quote, 500, -0.012), t.quoteLines);
}

function drawQuote(p, line, x, top, width, t, draw = true) {
  const lines = quoteLines(p, line, width, t);
  if (lines.length && !/”$/.test(lines[lines.length - 1])) lines[lines.length - 1] = lines[lines.length - 1].replace(/…$/, '…”');
  const labelHeight = t.quoteLabel ? t.quoteLabel * CAP + t.quoteLabelGap : 0;
  const textHeight = lineBlock(lines.length, t.quote, t.quoteLineHeight);
  const height = labelHeight + textHeight;
  if (!draw) return height;
  const { ctx, colors } = p;
  if (t.quoteLabel) eyebrow(p, 'Worth keeping', x + t.quoteIndent, top, t.quoteLabel, colors.faint);
  const textTop = top + labelHeight;
  roundRect(ctx, x, top - t.quote * 0.12, Math.max(3, t.quote * 0.12), height + t.quote * 0.3, t.quote * 0.06);
  ctx.fillStyle = colors.paint;
  ctx.fill();
  // The opening quote hangs in the margin so the lines align on their first letter.
  const hang = p.measure('“', t.quote, 500, -0.012);
  lines.forEach((value, index) => p.text(value, x + t.quoteIndent - (index === 0 ? hang : 0), textTop + index * t.quote * t.quoteLineHeight, { size: t.quote, weight: 500, track: -0.012 }));
  return height;
}

// --- Year pieces ----------------------------------------------------------------

function gridMetrics(width, t) {
  const cellsWidth = width - t.monthCol - t.countCol;
  const cell = Math.floor((cellsWidth - 30 * t.cellGap) / 31);
  return { cell, cellsWidth: cell * 31 + 30 * t.cellGap };
}

function drawYearGrid(p, model, x, top, width, t, opts, draw = true) {
  const { cell } = gridMetrics(width, t);
  const rowGap = t.rowGap ?? t.cellGap;
  const height = 12 * cell + 11 * rowGap;
  if (!draw) return height;
  const { colors } = p;
  const cellsLeft = x + t.monthCol;
  model.months.forEach((month, row) => {
    const rowTop = top + row * (cell + rowGap);
    let name = '';
    try { name = new Date(model.year, month.month, 1).toLocaleDateString(opts.locale, { month: 'short' }).replace(/\.$/, ''); } catch (_) {}
    const labelTop = rowTop + (cell - t.gridLabel * CAP) / 2;
    eyebrow(p, name, x, labelTop, t.gridLabel, colors.faint);
    month.days.forEach((day, index) => drawCell(p.ctx, colors, day, cellsLeft + index * (cell + t.cellGap), rowTop, cell));
    if (month.closed) p.text(String(month.closed), x + width, labelTop, { size: t.gridLabel, weight: 600, color: colors.muted, align: 'right' });
  });
  return height;
}

function drawYearLegend(p, x, top, t, draw = true) {
  const height = t.legendCell;
  if (!draw) return height;
  const { colors } = p;
  const size = t.legendCell;
  [1, 2, 3].forEach(level => drawCell(p.ctx, colors, { state: 'closed', level }, x + (level - 1) * (size + size * 0.3), top, size));
  p.text('One square for every day closed', x + 3 * size + 2 * size * 0.3 + size * 0.7, top + (size - t.legendText * CAP) / 2, { size: t.legendText, weight: 500, color: colors.muted });
  return height;
}

function yearStats(model) {
  const stats = [];
  stats.push({ label: 'Best streak', value: String(model.bestStreak), suffix: model.bestStreak === 1 ? ' day' : ' days', icon: 'flame' });
  if (model.currentStreak) stats.push({ label: 'Current streak', value: String(model.currentStreak), suffix: model.currentStreak === 1 ? ' day' : ' days' });
  if (model.mitDone) stats.push({ label: 'Main outcomes', value: String(model.mitDone), suffix: ' done' });
  else if (model.planningElapsed) stats.push({ label: 'Planning days', value: `${model.closeRate}`, suffix: '%' });
  return stats;
}

function misogiLines(p, model, width, t) {
  return balanceText(model.misogi, width - t.misogiIndent, p.measurer(t.misogi, 600, -0.02), t.misogiLines);
}

function drawMisogi(p, model, x, top, width, t, draw = true) {
  const lines = misogiLines(p, model, width, t);
  const height = t.misogiLabel * CAP + t.misogiGap + lineBlock(lines.length, t.misogi, 1.22);
  if (!draw) return height;
  const { ctx, colors } = p;
  const iconSize = t.misogiIcon;
  drawIcon(ctx, 'mountain', x, top - iconSize * 0.18, iconSize, colors.paint, { width: 1.9 });
  eyebrow(p, model.misogiDone ? 'Misogi · accomplished' : 'Misogi', x + t.misogiIndent, top, t.misogiLabel, colors.paint);
  lines.forEach((line, index) => p.text(line, x + t.misogiIndent, top + t.misogiLabel * CAP + t.misogiGap + index * t.misogi * 1.22, { size: t.misogi, weight: 600, track: -0.02 }));
  return height;
}

// --- Layouts ------------------------------------------------------------------------

/**
 * Stack blocks between `top` and `bottom`, gaps between `min` and `max`; returns false when they don't fit.
 * Room left over once the gaps are at their widest goes a third above the blocks and two thirds below,
 * so a short image sits at its optical centre instead of hanging from the top.
 */
function stack(blocks, top, bottom, { min, max, force = false }) {
  const list = blocks.filter(Boolean);
  const content = list.reduce((sum, block) => sum + block.height, 0);
  const free = bottom - top - content;
  if (!force && list.length > 1 && free < min * (list.length - 1)) return false;
  const gap = list.length > 1 ? Math.max(0, Math.min(max, free / (list.length - 1))) : 0;
  const spare = Math.max(0, free - gap * (list.length - 1));
  let cursor = top + spare / 3;
  list.forEach(block => { block.draw(cursor); cursor += block.height + gap; });
  return true;
}

const WEEK_TYPE = {
  square: { s: 1, pad: 88, top: 96, bottom: 84, eyebrow: 22, eyebrowGap: 34, head: [90, 64], headLines: 2, dateGap: 30, date: 30, cellMax: 176, gap: 18, label: 22, labelGap: 16, statLabel: 18, statGap: 22, stat: 64, colPad: 30, timeLabel: 18, timeTotal: 24, barGap: 26, bar: 18, legendGap: 28, legend: 23, legendLine: 40, legendRows: 3, legendColumns: 2, quoteLabel: 18, quoteLabelGap: 20, quote: 31, quoteLines: 3, quoteLineHeight: 1.36, quoteIndent: 30, gaps: { min: 36, max: 62 } },
  story: { s: 1.12, pad: 88, top: 220, bottom: 240, eyebrow: 26, eyebrowGap: 42, head: [140, 96], headLines: 2, dateGap: 40, date: 36, cellMax: 176, gap: 18, label: 26, labelGap: 20, statLabel: 20, statGap: 26, stat: 84, colPad: 30, timeLabel: 20, timeTotal: 30, barGap: 40, legendStyle: 'rows', legend: 30, rowBarGap: 16, rowBar: 12, rowGap: 30, legendRows: 5, quoteLabel: 20, quoteLabelGap: 24, quote: 40, quoteLines: 4, quoteLineHeight: 1.34, quoteIndent: 36, gaps: { min: 48, max: 92 } }
};

function weekColumn(p, model, opts, format) {
  const base = WEEK_TYPE[format.id];
  const { width: W, height: H } = format;
  const footerBottom = H - base.bottom;
  const x = base.pad;
  const width = W - base.pad * 2;
  drawBackground(p, W, H);
  const footer = drawFooter(p, x, footerBottom, width, base.s);
  const bottom = footerBottom - footer - base.gaps.min;
  const dateText = weekRangeLabel(model.firstKey, model.lastKey, opts.locale);
  // Each density gives up a little room until everything fits.
  for (let density = 0; density < 6; density += 1) {
    const t = { ...base };
    if (density >= 1) { t.quoteLines = Math.max(2, base.quoteLines - 1); t.legendRows = Math.max(2, base.legendRows - 1); }
    if (density >= 2) { t.head = [Math.round(base.head[0] * 0.88), base.head[1]]; t.legendRows = Math.max(2, base.legendRows - 2); }
    if (density >= 3) { t.cellMax = Math.round(base.cellMax * 0.76); t.quoteLabel = 0; }
    if (density >= 4) { t.stat = Math.round(base.stat * 0.86); t.legendRows = Math.max(1, t.legendRows - 1); t.quoteLines = 2; }
    if (density >= 5) { t.cellMax = Math.round(base.cellMax * 0.6); t.legendRows = 1; t.quoteLines = 1; }
    const head = fitHeadline(p, 'The week is closed.', width, { max: t.head[0], min: t.head[1], maxLines: t.headLines });
    const headerHeight = t.eyebrow * CAP + t.eyebrowGap + lineBlock(head.lines.length, head.size, 1.02) + t.dateGap + t.date * CAP;
    const stats = weekStats(model);
    const blocks = [
      { height: headerHeight, draw: top => {
        eyebrow(p, 'Weekly review', x, top, t.eyebrow, p.colors.paint);
        const headTop = top + t.eyebrow * CAP + t.eyebrowGap;
        const used = drawHeadline(p, head, x, headTop);
        p.text(dateText, x, headTop + used + t.dateGap, { size: t.date, weight: 500, color: p.colors.muted, track: -0.01 });
      } },
      { height: drawStrip(p, model, x, 0, width, t, opts, false), draw: top => drawStrip(p, model, x, top, width, t, opts) },
      { height: drawStats(p, stats, x, 0, width, t, false), draw: top => drawStats(p, stats, x, top, width, t) },
      model.categories.length ? { height: drawTime(p, model, x, 0, width, t, false), draw: top => drawTime(p, model, x, top, width, t) } : null,
      opts.includeLine ? { height: drawQuote(p, opts.line, x, 0, width, t, false), draw: top => drawQuote(p, opts.line, x, top, width, t) } : null
    ];
    const measured = blocks.filter(Boolean);
    const content = measured.reduce((sum, block) => sum + block.height, 0);
    if (density < 5 && bottom - base.top - content < t.gaps.min * (measured.length - 1)) continue;
    stack(measured, base.top, bottom, { ...t.gaps, force: true });
    return;
  }
}

/** Blocks one after another with a fixed gap, as a single block. */
function column(blocks, gap) {
  const list = blocks.filter(Boolean);
  const height = list.reduce((sum, block) => sum + block.height, 0) + gap * Math.max(0, list.length - 1);
  return { height, draw: top => { let cursor = top; list.forEach(block => { block.draw(cursor); cursor += block.height + gap; }); } };
}

function weekLandscape(p, model, opts, format) {
  const { width: W, height: H } = format;
  const pad = 60;
  drawBackground(p, W, H);
  const footer = drawFooter(p, pad, H - 50, W - pad * 2, 0.7);
  const top = 56;
  const bottom = H - 50 - footer - 30;
  const leftWidth = 478;
  const rightX = pad + leftWidth + 76;
  const rightWidth = W - pad - rightX;
  const t = { eyebrow: 16, eyebrowGap: 22, dateGap: 20, date: 21, cellMax: 90, gap: 12, label: 16, labelGap: 12, statLabel: 13, statGap: 16, stat: 46, colPad: 20, timeLabel: 13, timeTotal: 17, barGap: 18, bar: 13, legendGap: 18, legend: 16, legendLine: 27, legendRows: 2, legendColumns: 2, quoteLabel: 0, quote: 19, quoteLines: 2, quoteLineHeight: 1.36, quoteIndent: 20 };
  const head = fitHeadline(p, 'The week is closed.', leftWidth, { max: 64, min: 44, maxLines: 2 });
  const dateText = weekRangeLabel(model.firstKey, model.lastKey, opts.locale);
  const headerHeight = t.eyebrow * CAP + t.eyebrowGap + lineBlock(head.lines.length, head.size, 1.02) + t.dateGap + t.date * CAP;
  const left = column([
    { height: headerHeight, draw: y => {
      eyebrow(p, 'Weekly review', pad, y, t.eyebrow, p.colors.paint);
      const headTop = y + t.eyebrow * CAP + t.eyebrowGap;
      const used = drawHeadline(p, head, pad, headTop);
      p.text(dateText, pad, headTop + used + t.dateGap, { size: t.date, weight: 500, color: p.colors.muted, track: -0.01 });
    } },
    { height: drawStrip(p, model, pad, 0, leftWidth, t, opts, false), draw: y => drawStrip(p, model, pad, y, leftWidth, t, opts) }
  ], 40);
  const stats = weekStats(model);
  const rightColumn = () => column([
    { height: drawStats(p, stats, rightX, 0, rightWidth, t, false), draw: y => drawStats(p, stats, rightX, y, rightWidth, t) },
    model.categories.length ? { height: drawTime(p, model, rightX, 0, rightWidth, t, false), draw: y => drawTime(p, model, rightX, y, rightWidth, t) } : null,
    opts.includeLine ? { height: drawQuote(p, opts.line, rightX, 0, rightWidth, t, false), draw: y => drawQuote(p, opts.line, rightX, y, rightWidth, t) } : null
  ], 34);
  let right = rightColumn();
  if (right.height > bottom - top) { t.legendRows = 1; t.quoteLines = 1; right = rightColumn(); }
  // Both columns share a top edge; the pair sits in the middle of the space above the footer.
  const start = top + Math.max(0, (bottom - top - Math.max(left.height, right.height)) / 2);
  left.draw(start);
  right.draw(start + 2);
}

const YEAR_TYPE = {
  square: { s: 1, pad: 88, top: 96, bottom: 84, eyebrow: 22, eyebrowGap: 34, head: [92, 60], headLines: 2, sublineGap: 28, subline: 29, monthCol: 62, countCol: 44, cellGap: 4, rowGap: 6, gridLabel: 17, legendCell: 20, legendText: 19, legendGap: 22, statLabel: 18, statGap: 22, stat: 62, colPad: 30, misogiIcon: 34, misogiIndent: 48, misogiLabel: 18, misogiGap: 18, misogi: 30, misogiLines: 2, gaps: { min: 36, max: 64 } },
  story: { s: 1.12, pad: 80, top: 220, bottom: 240, eyebrow: 26, eyebrowGap: 42, head: [150, 100], headLines: 2, sublineGap: 38, subline: 36, monthCol: 70, countCol: 50, cellGap: 4, rowGap: 7, gridLabel: 20, legendCell: 24, legendText: 23, legendGap: 26, statLabel: 21, statGap: 26, stat: 88, colPad: 34, misogiIcon: 42, misogiIndent: 58, misogiLabel: 21, misogiGap: 22, misogi: 40, misogiLines: 3, gaps: { min: 48, max: 96 } }
};

function yearHeadline(model) {
  return { text: `${model.closed} ${model.closed === 1 ? 'day' : 'days'} closed.`, accent: [String(model.closed)] };
}

function yearColumn(p, model, opts, format) {
  const base = YEAR_TYPE[format.id];
  const { width: W, height: H } = format;
  const x = base.pad;
  const width = W - base.pad * 2;
  drawBackground(p, W, H);
  const footerBottom = H - base.bottom;
  const footer = drawFooter(p, x, footerBottom, width, base.s);
  const bottom = footerBottom - footer - base.gaps.min;
  const headline = yearHeadline(model);
  const subline = yearSubline(model, opts.locale);
  const showMisogi = opts.includeMisogi && !!model.misogi;
  for (let density = 0; density < 4; density += 1) {
    const t = { ...base, rowGap: base.rowGap };
    if (density >= 1) { t.misogiLines = Math.max(1, base.misogiLines - 1); t.head = [Math.round(base.head[0] * 0.86), base.head[1]]; }
    if (density >= 2) { t.legendCell = 0; t.stat = Math.round(base.stat * 0.86); }
    if (density >= 3) { t.rowGap = base.cellGap; t.misogiLines = 1; }
    const head = fitHeadline(p, headline.text, width, { max: t.head[0], min: t.head[1], maxLines: t.headLines });
    const headerHeight = t.eyebrow * CAP + t.eyebrowGap + lineBlock(head.lines.length, head.size, 1.02) + (subline ? t.sublineGap + t.subline * CAP : 0);
    const stats = yearStats(model);
    const statsRows = Math.ceil(stats.length / (t.columns || stats.length));
    const statsHeight = drawStats(p, stats, x, 0, width, t, false) * statsRows + (statsRows - 1) * (t.statRowGap || 0);
    const gridHeight = drawYearGrid(p, model, x, 0, width, t, opts, false) + (t.legendCell ? t.legendGap + t.legendCell : 0);
    const blocks = [
      { height: headerHeight, draw: top => {
        eyebrow(p, `${model.year} · painted day by day`, x, top, t.eyebrow, p.colors.paint);
        const headTop = top + t.eyebrow * CAP + t.eyebrowGap;
        const used = drawHeadline(p, head, x, headTop, { accent: headline.accent });
        if (subline) p.text(subline, x, headTop + used + t.sublineGap, { size: t.subline, weight: 500, color: p.colors.muted, track: -0.01 });
      } },
      { height: gridHeight, draw: top => {
        const used = drawYearGrid(p, model, x, top, width, t, opts);
        if (t.legendCell) drawYearLegend(p, x + t.monthCol, top + used + t.legendGap, t);
      } },
      { height: statsHeight, draw: top => drawStats(p, stats, x, top, width, t) },
      showMisogi ? { height: drawMisogi(p, model, x, 0, width, t, false), draw: top => drawMisogi(p, model, x, top, width, t) } : null
    ].filter(Boolean);
    const content = blocks.reduce((sum, block) => sum + block.height, 0);
    if (density < 3 && bottom - base.top - content < t.gaps.min * (blocks.length - 1)) continue;
    stack(blocks, base.top, bottom, { ...t.gaps, force: true });
    return;
  }
}

function yearLandscape(p, model, opts, format) {
  const { width: W, height: H } = format;
  const pad = 60;
  drawBackground(p, W, H);
  const footer = drawFooter(p, pad, H - 50, W - pad * 2, 0.7);
  const top = 58;
  const bottom = H - 50 - footer - 30;
  const leftWidth = 330;
  const gridX = pad + leftWidth + 56;
  const gridWidth = W - pad - gridX;
  const t = { eyebrow: 15, eyebrowGap: 20, sublineGap: 16, subline: 18, monthCol: 42, countCol: 30, cellGap: 3, rowGap: 4, gridLabel: 12, legendCell: 14, legendText: 14, legendGap: 16, statLabel: 12, statGap: 14, stat: 38, colPad: 18, misogiIcon: 24, misogiIndent: 34, misogiLabel: 12, misogiGap: 12, misogi: 18, misogiLines: 2 };
  const headline = yearHeadline(model);
  const head = fitHeadline(p, headline.text, leftWidth, { max: 64, min: 40, maxLines: 2 });
  const subLines = balanceText(yearSubline(model, opts.locale), leftWidth, p.measurer(t.subline, 500, -0.01), 2);
  const headerHeight = t.eyebrow * CAP + t.eyebrowGap + lineBlock(head.lines.length, head.size, 1.02) + (subLines.length ? t.sublineGap + lineBlock(subLines.length, t.subline, 1.35) : 0);
  const stats = yearStats(model).slice(0, 2);
  const showMisogi = opts.includeMisogi && !!model.misogi;
  const left = [
    { height: headerHeight, draw: y => {
      eyebrow(p, `${model.year} · painted day by day`, pad, y, t.eyebrow, p.colors.paint);
      const headTop = y + t.eyebrow * CAP + t.eyebrowGap;
      const used = drawHeadline(p, head, pad, headTop, { accent: headline.accent });
      subLines.forEach((line, index) => p.text(line, pad, headTop + used + t.sublineGap + index * t.subline * 1.35, { size: t.subline, weight: 500, color: p.colors.muted, track: -0.01 }));
    } },
    { height: drawStats(p, stats, pad, 0, leftWidth, t, false), draw: y => drawStats(p, stats, pad, y, leftWidth, t) },
    showMisogi ? { height: drawMisogi(p, model, pad, 0, leftWidth, t, false), draw: y => drawMisogi(p, model, pad, y, leftWidth, t) } : null
  ].filter(Boolean);
  if (!stack(left, top, bottom, { min: 22, max: 44 })) stack(left, top, bottom, { min: 12, max: 44, force: true });
  const gridHeight = drawYearGrid(p, model, gridX, 0, gridWidth, t, opts, false);
  const blockHeight = gridHeight + t.legendGap + t.legendCell;
  const gridTop = Math.max(top, top + (bottom - top - blockHeight) / 2);
  drawYearGrid(p, model, gridX, gridTop, gridWidth, t, opts);
  drawYearLegend(p, gridX + t.monthCol, gridTop + gridHeight + t.legendGap, t);
}

/**
 * Paint `model` at the format's full size. `ctx.canvas` must already have that size.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} model buildWeekShareModel() or buildYearShareModel()
 * @param {object} options format, look, paint, includeLine + line, includeMisogi, fontFamily, locale
 */
export function drawShareImage(ctx, model, options = {}) {
  const opts = normalizeShareOptions(options);
  const format = shareFormat(opts.format);
  const family = options.fontFamily || 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const p = painter(ctx, family, shareColors(opts.paint, opts.look));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, format.width, format.height);
  if (model?.kind === 'year') (format.id === 'landscape' ? yearLandscape : yearColumn)(p, model, opts, format);
  else (format.id === 'landscape' ? weekLandscape : weekColumn)(p, model, opts, format);
  ctx.restore();
  return format;
}
