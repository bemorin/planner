/**
 * Floating window: the planner's Document Picture-in-Picture companion.
 *
 * A small always-on-top window that keeps one planning day in view while the
 * person works in other apps. It always shows a day, whatever range the main
 * window shows, so its arrows move one planning day at a time. The main window
 * follows the same date and keeps its own range: Day stays on that day, Week
 * shows the week that holds it. Both windows edit the same in-memory day, so a
 * tick in one is drawn in the other straight away.
 *
 * Three views share one header: Focus (what is under way, what comes next, the
 * main outcome and the open tasks), Plan (everything editable, then what is
 * still unresolved from other days, folded away) and Schedule (the day's blocks
 * as a timeline). The shell is built once; renders replace
 * the view panel only, keep the focused field and its caret, and move in the
 * direction of travel unless the visitor prefers reduced motion.
 *
 * The model, labels, shortcuts and markup are pure and exported for tests.
 */
import { pipStyles } from './pip-styles.js';
import { openPipDatePicker } from './pip-date-picker.js';
import { navigationDirection } from './day-swipe.js';
import { searchSnippet } from './search.js';
import { esc, escAttr } from '../lib/text.js';
import { clamp } from '../lib/utils.js';
import { dateFromKey, daysBetweenKeys } from '../lib/dates.js';
import { clockTime, durationLabel } from '../domain/schedule-time.js';

export const PIP_VIEWS = ['focus', 'plan', 'schedule'];
const VIEW_LABELS = { focus: 'Focus', plan: 'Plan', schedule: 'Schedule' };
// Device conveniences, outside the planner's `daily-planner:` data namespace.
const VIEW_KEY = 'daily-planner-ui:pip-view';
const SIZE_KEY = 'daily-planner-ui:pip-size';
const UNRESOLVED_KEY = 'daily-planner-ui:pip-unresolved';
const DEFAULT_SIZE = { width: 380, height: 580 };
const FOCUS_TASKS = 5;
export const PIP_UNRESOLVED = 8;
// Reading every saved day for Unresolved is not free: renders within this time reuse the list.
const UNRESOLVED_TTL = 10000;
const UNTITLED = 'Untitled block';

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M12 12v5M9.5 14.5h5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4ZM13.8 6.2l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function normalizePipView(value) {
  if (value === 'tasks') return 'plan';
  return PIP_VIEWS.includes(value) ? value : 'focus';
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago", from `YYYY-MM-DD` keys. */
export function relativeDayLabel(dayKey, todayKey) {
  const diff = daysBetweenKeys(todayKey, dayKey);
  if (!Number.isFinite(diff)) return '';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

/** Keyboard shortcuts of the floating window (the caller skips text fields). */
export function pipShortcut(event = {}) {
  if (event.metaKey || event.ctrlKey || event.altKey) return '';
  const key = String(event.key || '').toLowerCase();
  return {
    arrowleft: 'prev',
    arrowright: 'next',
    t: 'today',
    n: 'today',
    1: 'view:focus',
    2: 'view:plan',
    3: 'view:schedule'
  }[key] || '';
}

/**
 * The selected day's schedule as the floating window reads it. Only today has
 * a "now": a live block, the next one, the gap before it and where the now line
 * sits (before the first block still to start, when no block is under way).
 */
export function pipSchedule(blocks, { nowMinutes = 0, isToday = false, isDone = block => !!block?.done } = {}) {
  const list = (Array.isArray(blocks) ? blocks : []).filter(block => block && Number.isFinite(Number(block.start)));
  const sorted = [...list].sort((a, b) => (a.start - b.start) || (b.duration - a.duration));
  const endOf = block => block.start + Math.max(0, Number(block.duration) || 0);
  const live = isToday ? sorted.filter(block => nowMinutes >= block.start && nowMinutes < endOf(block)) : [];
  const current = live.find(block => !isDone(block)) || live[0] || null;
  const next = isToday ? sorted.find(block => block.start > nowMinutes) || null : null;
  const entries = sorted.map(block => ({
    block,
    done: !!isDone(block),
    phase: !isToday ? '' : block === current ? 'live' : endOf(block) <= nowMinutes ? 'past' : block.start <= nowMinutes ? 'live' : 'upcoming'
  }));
  const upcomingIndex = sorted.findIndex(block => block.start > nowMinutes);
  return {
    entries,
    current,
    next,
    plannedMinutes: sorted.reduce((sum, block) => sum + Math.max(0, Number(block.duration) || 0), 0),
    doneCount: entries.filter(entry => entry.done).length,
    progress: current ? {
      ratio: clamp((nowMinutes - current.start) / Math.max(1, current.duration), 0, 1),
      left: Math.max(0, endOf(current) - nowMinutes),
      end: endOf(current)
    } : null,
    freeMinutes: isToday && !current && next ? next.start - nowMinutes : 0,
    nowLineIndex: isToday && !current && sorted.length ? (upcomingIndex === -1 ? sorted.length : upcomingIndex) : -1
  };
}

const defaultRange = block => `${clockTime(block.start)}–${clockTime(block.start + block.duration)}`;

/**
 * What is still unresolved beyond the selected day, as the planner's
 * Unresolved dialog holds it: items from past days that need a decision
 * (`needs`, the planner's candidates) and items saved for later (`later`, its
 * open work). The most carried come first; `limit` are listed, `total` counts all.
 */
export function pipUnresolved({ needs = [], later = [] } = {}, limit = PIP_UNRESOLVED) {
  const count = value => Math.max(0, Number(value) || 0);
  const rows = [
    ...(Array.isArray(needs) ? needs : []).map(entry => ({
      text: String((entry?.kind === 'block' ? entry.block?.title : entry?.item?.text) || '').trim(),
      count: count(entry?.item?.carriedCount ?? entry?.block?.carriedCount),
      kind: 'Needs attention'
    })),
    ...(Array.isArray(later) ? later : []).map(item => ({ text: String(item?.text || '').trim(), count: count(item?.carriedCount), kind: 'Later' }))
  ].filter(row => row.text);
  return { total: rows.length, items: rows.sort((a, b) => b.count - a.count).slice(0, Math.max(0, limit)) };
}

/** Everything one render of the floating window reads, from planner state. */
export function buildPipModel({
  state,
  dayKey,
  todayKey,
  nowMinutes = 0,
  categoryFor = () => null,
  isBlockDone = block => !!block?.done,
  linkedBlock = () => null,
  blockTimeRange = defaultRange,
  unresolved = null,
  unresolvedOpen = false
}) {
  const isToday = dayKey === todayKey;
  const item = type => (entry, index) => ({ item: entry, index, type, linked: linkedBlock(type, entry.id) });
  return {
    dayKey,
    todayKey,
    isToday,
    isPast: dayKey < todayKey,
    nowMinutes,
    focus: String(state?.focus || ''),
    notes: String(state?.notes || ''),
    schedule: pipSchedule(state?.blocks, { nowMinutes, isToday, isDone: isBlockDone }),
    priorities: (state?.priorities || []).map(item('priority')),
    tasks: (state?.tasks || []).map(item('task')),
    categoryFor,
    blockTimeRange,
    unresolved: unresolved && unresolved.total ? unresolved : null,
    unresolvedOpen: !!unresolvedOpen
  };
}

const filled = entry => !!String(entry.item.text || '').trim();
const ref = entry => `${entry.type}:${entry.item.id}`;
const doneCount = list => `${list.filter(entry => entry.item.done).length} of ${list.length} done`;

function checkbox(attrs, checked, label) {
  return `<input type="checkbox" ${attrs} ${checked ? 'checked' : ''} aria-label="${escAttr(label)}">`;
}

function blockMeta(model, block, extra = '') {
  const category = model.categoryFor(block.categoryId);
  const dot = category ? `<i class="pip-dot" style="background:${escAttr(category.color)}" aria-hidden="true"></i><span>${esc(category.name)}</span><span aria-hidden="true">·</span>` : '';
  return `${dot}<span>${durationLabel(block.duration)}</span>${extra}`;
}

function blockColor(model, block) {
  return escAttr(model.categoryFor(block.categoryId)?.color || '#716b64');
}

function progressBar(progress, label) {
  const percent = Math.round(progress.ratio * 100);
  return `<div class="pip-progress" role="progressbar" aria-label="${escAttr(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="--p:${progress.ratio.toFixed(3)}"></span></div>`;
}

function liveCard(model) {
  const { current: block, progress } = model.schedule;
  const done = model.schedule.entries.find(entry => entry.block === block)?.done;
  const title = block.title || UNTITLED;
  return `<article class="pip-live${done ? ' done' : ''}" style="--block-color:${blockColor(model, block)}" data-pip-card="${escAttr(block.id)}">
    <div class="pip-live__top"><span class="pip-live__label"><i aria-hidden="true"></i>Now</span><time>${esc(model.blockTimeRange(block))}</time></div>
    <div class="pip-live__main">
      <button class="pip-live__title" type="button" title="${escAttr(title)}" data-pip-open-block="${escAttr(block.id)}" data-pip-key="open:${escAttr(block.id)}"><span>${esc(title)}</span></button>
      ${checkbox(`data-pip-block-done="${escAttr(block.id)}" data-pip-key="block:${escAttr(block.id)}"`, done, `Mark “${title}” done`)}
    </div>
    <p class="pip-live__meta">${blockMeta(model, block)}</p>
    ${progressBar(progress, 'Time elapsed in this block')}
    <div class="pip-live__foot"><strong>${done ? 'Done' : `${durationLabel(progress.left)} left`}</strong><span>Ends ${clockTime(progress.end)}</span></div>
    ${block.notes ? `<p class="pip-live__notes">${esc(searchSnippet(block.notes, 180))}</p>` : ''}
  </article>`;
}

function nextRow(model, block, { showIn = true } = {}) {
  const until = block.start - model.nowMinutes;
  const extra = showIn ? `<span aria-hidden="true">·</span><span>in ${durationLabel(until)}</span>` : '';
  return `<button class="pip-next" type="button" style="--block-color:${blockColor(model, block)}" data-pip-open-block="${escAttr(block.id)}" data-pip-key="next:${escAttr(block.id)}">
    <span class="pip-next__when"><span class="pip-eyebrow">Next</span><strong>${clockTime(block.start)}</strong></span>
    <span class="pip-next__body"><strong>${esc(block.title || UNTITLED)}</strong><span class="pip-meta">${blockMeta(model, block, extra)}</span></span>
  </button>`;
}

function dayCard(model) {
  const { schedule } = model;
  const count = schedule.entries.length;
  if (model.isToday) {
    if (schedule.current) return `${liveCard(model)}${schedule.next ? nextRow(model, schedule.next) : ''}`;
    if (schedule.next) {
      return `<article class="pip-free"><span class="pip-eyebrow">Now</span><strong>Free until ${clockTime(schedule.next.start)}</strong><span class="pip-free__line">${durationLabel(schedule.freeMinutes)} before your next block.</span></article>${nextRow(model, schedule.next, { showIn: false })}`;
    }
    const line = count ? `${schedule.doneCount} of ${count} block${count === 1 ? '' : 's'} done today.` : 'Add blocks in the planner to see them here.';
    return `<article class="pip-free"><span class="pip-eyebrow">Now</span><strong>${count ? 'Nothing else scheduled today' : 'Nothing scheduled today'}</strong><span class="pip-free__line">${line}</span></article>`;
  }
  if (!count) return `<article class="pip-free"><span class="pip-eyebrow">Schedule</span><strong>Nothing scheduled</strong><span class="pip-free__line">${model.isPast ? 'No blocks were planned for this day.' : 'Blocks you add in the planner appear here.'}</span></article>`;
  const first = schedule.entries[0].block;
  const summary = `${count} block${count === 1 ? '' : 's'} · ${durationLabel(schedule.plannedMinutes)}`;
  const line = model.isPast
    ? `${schedule.doneCount} of ${count} done.`
    : `First at ${clockTime(first.start)}: ${esc(first.title || UNTITLED)}`;
  return `<button class="pip-free pip-free--link" type="button" data-pip-go="schedule" data-pip-key="go:schedule"><span class="pip-eyebrow">Schedule</span><strong>${summary}</strong><span class="pip-free__line">${line}</span>${ICONS.next}</button>`;
}

function focusRow(entry, linkedRange, { mit = false } = {}) {
  const text = entry.item.text;
  return `<label class="pip-row${mit ? ' is-mit' : ''}${entry.item.done ? ' done' : ''}" data-pip-row="${escAttr(ref(entry))}">
    ${checkbox(`data-pip-done="${escAttr(ref(entry))}" data-pip-key="done:${escAttr(ref(entry))}"`, entry.item.done, `Mark “${text}” done`)}
    <span class="pip-row__text"><span>${esc(text)}</span>${linkedRange ? `<time>${esc(linkedRange)}</time>` : ''}</span>
  </label>`;
}

function section(title, meta, body, extraClass = '') {
  return `<section class="pip-section${extraClass}"><div class="pip-head"><h2>${title}</h2>${meta ? `<span>${meta}</span>` : ''}</div>${body}</section>`;
}

function intent(model) {
  if (!model.focus.trim()) return '';
  return `<section class="pip-intent" aria-label="Keep in mind"><span class="pip-eyebrow">Keep in mind</span><p>${esc(model.focus)}</p></section>`;
}

function focusView(model) {
  const range = entry => (entry.linked ? model.blockTimeRange(entry.linked) : '');
  const [mit, ...others] = model.priorities;
  const otherOutcomes = others.filter(filled);
  const tasks = model.tasks.filter(filled);
  const openTasks = tasks.filter(entry => !entry.item.done);
  const parts = [intent(model), `<div class="pip-day">${dayCard(model)}</div>`];
  if (mit) {
    const body = filled(mit)
      ? focusRow(mit, range(mit), { mit: true })
      : `<button class="pip-prompt" type="button" data-pip-edit="${escAttr(ref(mit))}" data-pip-key="edit:${escAttr(ref(mit))}">${ICONS.plus}<span>Name the one result that would make this day count</span></button>`;
    parts.push(section('Most important outcome', '', body));
  }
  if (otherOutcomes.length) parts.push(section('Other outcomes', doneCount(otherOutcomes), `<div class="pip-list">${otherOutcomes.map(entry => focusRow(entry, range(entry))).join('')}</div>`));
  if (tasks.length) {
    const shown = openTasks.slice(0, FOCUS_TASKS);
    const more = openTasks.length - shown.length;
    const body = shown.length
      ? `<div class="pip-list">${shown.map(entry => focusRow(entry, range(entry))).join('')}</div>${more > 0 ? `<button class="pip-more" type="button" data-pip-go="plan" data-pip-key="go:plan">${more} more in Plan</button>` : ''}`
      : '<p class="pip-quiet">Every task is done.</p>';
    parts.push(section(model.isToday || !model.isPast ? 'Next tasks' : 'Open tasks', doneCount(tasks), body));
  }
  return parts.join('');
}

function editRow(model, entry, placeholder, label, { mit = false } = {}) {
  const key = ref(entry);
  const text = entry.item.text || '';
  const empty = !text.trim();
  const scheduleLabel = entry.linked ? 'Edit the scheduled block' : `Schedule this ${entry.type === 'task' ? 'task' : 'outcome'}`;
  return `<div class="pip-edit${mit ? ' is-mit' : ''}${entry.item.done ? ' done' : ''}${empty ? ' is-empty' : ''}" data-pip-row="${escAttr(key)}">
    ${checkbox(`data-pip-done="${escAttr(key)}" data-pip-key="done:${escAttr(key)}"`, entry.item.done, empty ? `Mark ${label.toLowerCase()} done` : `Mark “${text}” done`)}
    <div class="pip-edit__main">
      <textarea rows="1" maxlength="220" data-pip-text="${escAttr(key)}" data-pip-key="text:${escAttr(key)}" placeholder="${escAttr(placeholder)}" aria-label="${escAttr(label)}">${esc(text)}</textarea>
      ${entry.linked ? `<time>${esc(model.blockTimeRange(entry.linked))}</time>` : ''}
    </div>
    <button class="pip-icon" type="button" data-pip-schedule="${escAttr(key)}" data-pip-key="schedule:${escAttr(key)}" aria-label="${escAttr(scheduleLabel)}" title="${entry.linked ? 'Edit schedule' : 'Schedule'}" ${empty ? 'disabled' : ''}>${entry.linked ? ICONS.edit : ICONS.calendar}</button>
  </div>`;
}

/** Plan's last part: what is still unresolved from other days, folded unless opened. */
function unresolvedPart(model) {
  const { unresolved } = model;
  if (!unresolved?.items.length) return '';
  const more = unresolved.total - unresolved.items.length;
  const rows = unresolved.items.map(item => `<li><span class="pip-unresolved__text">${esc(item.text)}</span><span class="pip-unresolved__meta">${esc(item.kind)}${item.count ? ` · carried ${item.count}×` : ''}</span></li>`).join('');
  return `<details class="pip-unresolved" data-pip-unresolved${model.unresolvedOpen ? ' open' : ''}>
    <summary data-pip-key="unresolved"><span class="pip-unresolved__title">Unresolved</span><span class="pip-unresolved__count">${unresolved.total}</span>${ICONS.down}</summary>
    <ul class="pip-unresolved__list">${rows}</ul>
    ${more > 0 ? `<p class="pip-unresolved__more">${more} more in the planner’s Unresolved</p>` : ''}
  </details>`;
}

function planView(model) {
  const [mit, ...others] = model.priorities;
  const tasks = model.tasks;
  const filledTasks = tasks.filter(filled);
  const hasBlankTask = tasks.some(entry => !filled(entry));
  const field = (id, attr, label, value, placeholder, extra = '') => `<section class="pip-field${extra}"><label class="pip-eyebrow" for="${id}">${label}</label><textarea id="${id}" rows="${extra ? 4 : 1}" ${attr} data-pip-key="${id}" placeholder="${escAttr(placeholder)}">${esc(value)}</textarea></section>`;
  return [
    field('pip-focus', 'data-pip-focus', 'Keep in mind', model.focus, 'e.g. Don’t let urgency drive the decision'),
    mit ? section('Most important outcome', '', editRow(model, mit, 'e.g. Send the final proposal', 'Most important outcome', { mit: true })) : '',
    others.length ? section('Other outcomes', '', `<div class="pip-list">${others.map((entry, index) => editRow(model, entry, index === 0 ? 'Another outcome worth moving forward' : 'One more, if it truly matters', 'Other outcome')).join('')}</div>`) : '',
    section('Tasks', filledTasks.length ? doneCount(filledTasks) : '', `<div class="pip-list">${tasks.map(entry => editRow(model, entry, 'Concrete action', 'Task')).join('')}</div>${hasBlankTask ? '' : `<button class="pip-more pip-more--add" type="button" data-pip-add-task data-pip-key="add-task">${ICONS.plus}Add a task</button>`}`),
    field('pip-notes', 'data-pip-notes', 'Notes', model.notes, 'Anything worth keeping from today…', ' pip-field--notes'),
    unresolvedPart(model)
  ].join('');
}

function slot(model, entry) {
  const { block, phase, done } = entry;
  const live = phase === 'live' && block === model.schedule.current;
  const title = block.title || UNTITLED;
  const end = block.start + block.duration;
  const extra = live && model.schedule.progress ? `<span aria-hidden="true">·</span><span>${done ? 'done' : `${durationLabel(model.schedule.progress.left)} left`}</span>` : '';
  return `<li class="pip-slot${phase ? ` is-${phase}` : ''}${live ? ' is-current' : ''}${done ? ' done' : ''}" style="--block-color:${blockColor(model, block)}">
    <span class="pip-slot__time"><strong>${clockTime(block.start)}</strong><span>${clockTime(end)}</span></span>
    <div class="pip-slot__card" data-pip-card="${escAttr(block.id)}">
      <span class="pip-slot__body">
        <button class="pip-slot__title" type="button" data-pip-open-block="${escAttr(block.id)}" data-pip-key="open:${escAttr(block.id)}">${esc(title)}</button>
        <span class="pip-meta">${blockMeta(model, block, extra)}</span>
        ${live && model.schedule.progress ? progressBar(model.schedule.progress, 'Time elapsed in this block') : ''}
      </span>
      ${checkbox(`data-pip-block-done="${escAttr(block.id)}" data-pip-key="block:${escAttr(block.id)}"`, done, `Mark “${title}” done`)}
    </div>
  </li>`;
}

function scheduleView(model) {
  const { schedule } = model;
  if (!schedule.entries.length) {
    return `<div class="pip-empty"><strong>Nothing scheduled</strong><p>${model.isPast ? 'No blocks were planned for this day.' : 'Give the day a shape: add a block in the planner.'}</p>${model.isPast ? '' : `<button class="pip-button" type="button" data-pip-add-block data-pip-key="add-block">${ICONS.plus}Add a block</button>`}</div>`;
  }
  const nowLine = `<li class="pip-nowline" data-pip-now-line><span>${clockTime(model.nowMinutes)}</span></li>`;
  const rows = schedule.entries.map(entry => slot(model, entry));
  if (schedule.nowLineIndex >= 0) rows.splice(schedule.nowLineIndex, 0, nowLine);
  const count = schedule.entries.length;
  const meta = `${count} block${count === 1 ? '' : 's'} · ${durationLabel(schedule.plannedMinutes)}${schedule.doneCount ? ` · ${schedule.doneCount} done` : ''}`;
  return section('Schedule', meta, `<ol class="pip-timeline">${rows.join('')}</ol>`);
}

/** The markup of one view of the floating window. */
export function pipViewMarkup(view, model) {
  const name = normalizePipView(view);
  if (name === 'plan') return planView(model);
  if (name === 'schedule') return scheduleView(model);
  return focusView(model);
}

/** The persistent frame: date, day navigation and the view switch. */
export function pipShellMarkup(view = 'focus') {
  const active = normalizePipView(view);
  const buttons = PIP_VIEWS.map((name, index) => `<button type="button" data-pip-view="${name}" aria-pressed="${name === active}" title="${VIEW_LABELS[name]} (${index + 1})">${VIEW_LABELS[name]}</button>`).join('');
  return `<div class="pip-shell">
    <header class="pip-header">
      <div class="pip-header__row">
        <div class="pip-date-wrap">
          <button class="pip-date" type="button" data-pip-date aria-label="Choose a date" title="Choose a date">
            <span class="pip-date__eyebrow" data-pip-eyebrow></span>
            <span class="pip-date__title"><strong data-pip-title aria-live="polite"></strong>${ICONS.down}</span>
          </button>
        </div>
        <nav class="pip-nav" aria-label="Day">
          <button class="pip-nav__arrow" type="button" data-pip-prev aria-label="Previous planning day" title="Previous planning day (←)">${ICONS.prev}</button>
          <button class="pip-nav__now" type="button" data-pip-now aria-label="Go to now" title="Go to now (T)">Now</button>
          <button class="pip-nav__arrow" type="button" data-pip-next aria-label="Next planning day" title="Next planning day (→)">${ICONS.next}</button>
        </nav>
      </div>
      <div class="pip-views" role="group" aria-label="View" data-pip-views style="--pip-view-index:${PIP_VIEWS.indexOf(active)}"><span class="pip-views__indicator" aria-hidden="true"></span>${buttons}</div>
    </header>
    <main class="pip-scroll" data-pip-scroll><div class="pip-view" role="region" aria-label="${VIEW_LABELS[active]}" data-pip-panel></div></main>
  </div>`;
}

/** Long and short header labels for a day (the short ones serve narrow windows). */
export function pipDateLabels(dayKey, todayKey, locale) {
  const day = dateFromKey(dayKey);
  const year = day.getFullYear() !== dateFromKey(todayKey).getFullYear() ? 'numeric' : undefined;
  return {
    weekday: day.toLocaleDateString(locale, { weekday: 'long' }),
    weekdayShort: day.toLocaleDateString(locale, { weekday: 'short' }),
    // Another year keeps the short month so the year still fits beside the arrows.
    title: day.toLocaleDateString(locale, { month: year ? 'short' : 'long', day: 'numeric', year }),
    titleShort: day.toLocaleDateString(locale, { month: 'short', day: 'numeric', year }),
    relative: relativeDayLabel(dayKey, todayKey)
  };
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

function readPreference(storage, key) {
  try { return storage?.getItem(key) || ''; } catch (_) { return ''; }
}

function writePreference(storage, key, value) {
  try { storage?.setItem(key, value); } catch (_) {}
}

export function readPipSize(raw) {
  try {
    const value = JSON.parse(raw || 'null');
    const width = Math.round(Number(value?.width));
    const height = Math.round(Number(value?.height));
    if (width >= 240 && width <= 1200 && height >= 200 && height <= 1600) return { width, height };
  } catch (_) {}
  return { ...DEFAULT_SIZE };
}

export function createPipFeature(ctx) {
  const storage = ctx.storage === undefined ? globalThis.localStorage : ctx.storage;
  let win = null;
  let view = normalizePipView(readPreference(storage, VIEW_KEY));
  let unresolvedOpen = readPreference(storage, UNRESOLVED_KEY) === 'open';
  let unresolvedCache = null;
  let lastDayKey = '';
  let quiet = false;
  let holdUntil = 0;
  let holdTimer = 0;
  let sizeTimer = 0;

  const isOpen = () => !!win && !win.closed;
  const q = selector => win?.document.querySelector(selector) || null;
  const reducedMotion = () => [win, globalThis].some(scope => !!scope?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const editing = () => !!win?.document.activeElement?.matches?.('textarea, input:not([type="checkbox"])');

  function close() {
    if (isOpen()) win.close();
    win = null;
  }

  async function open() {
    if (isOpen()) { win.focus(); return; }
    if (ctx.canOpen && !ctx.canOpen()) return;
    const api = globalThis.documentPictureInPicture;
    if (!api) { ctx.unsupported?.(); return; }
    try { win = await api.requestWindow(readPipSize(readPreference(storage, SIZE_KEY))); } catch (_) { win = null; return; }
    const doc = win.document;
    doc.title = 'Daily Planner · Floating';
    doc.documentElement.lang = document.documentElement.lang || 'en';
    doc.head.innerHTML = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${pipStyles()}</style>`;
    ctx.mirrorTheme?.(doc);
    doc.body.innerHTML = pipShellMarkup(view);
    doc.addEventListener('click', onClick);
    doc.addEventListener('change', onChange);
    doc.addEventListener('input', onInput);
    doc.addEventListener('keydown', onKeydown);
    // `toggle` does not bubble: listen while it goes down to the Unresolved fold.
    doc.addEventListener('toggle', onToggle, true);
    win.addEventListener('resize', onResize);
    const opened = win;
    win.addEventListener('pagehide', () => { if (win === opened) win = null; });
    lastDayKey = '';
    unresolvedCache = null;
    render();
    revealNow();
    ctx.onOpen?.();
  }

  function toggle() {
    if (isOpen()) close(); else open();
  }

  function syncTheme() {
    if (isOpen()) ctx.mirrorTheme?.(win.document);
  }

  // A tick shows its check before a finished task leaves the Focus list.
  function holdRendering(ms) {
    clearTimeout(holdTimer);
    holdUntil = Date.now() + ms;
    holdTimer = setTimeout(() => { holdUntil = 0; render(); }, ms);
  }

  function releaseHold() {
    clearTimeout(holdTimer);
    holdUntil = 0;
  }

  function render({ tick = false } = {}) {
    if (!isOpen() || quiet || Date.now() < holdUntil) return;
    const state = ctx.getState();
    const panel = q('[data-pip-panel]');
    if (!state || !panel) return;
    const doc = win.document;
    const now = new Date();
    const todayKey = ctx.ymd(now);
    const dayKey = ctx.ymd(ctx.getDate());
    const direction = lastDayKey && lastDayKey !== dayKey ? navigationDirection(lastDayKey, dayKey) : 0;
    renderHeader(dayKey, todayKey, direction);
    // A periodic refresh never pulls a field from under the caret or closes the calendar.
    if (tick && (editing() || q('[data-pip-date-picker]'))) return;
    const model = buildPipModel({
      state,
      dayKey,
      todayKey,
      nowMinutes: now.getHours() * 60 + now.getMinutes(),
      categoryFor: ctx.categoryFor,
      isBlockDone: ctx.isBlockDone,
      linkedBlock: ctx.linkedBlock,
      blockTimeRange: ctx.blockTimeRange,
      unresolved: view === 'plan' ? unresolvedNow() : null,
      unresolvedOpen
    });
    const active = doc.activeElement;
    const focusKey = active?.dataset?.pipKey || '';
    const selection = focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    panel.innerHTML = pipViewMarkup(view, model);
    panel.dataset.view = view;
    panel.setAttribute('aria-label', VIEW_LABELS[view]);
    if (focusKey) {
      const target = panel.querySelector(`[data-pip-key="${CSS.escape(focusKey)}"]`);
      if (target) {
        target.focus({ preventScroll: true });
        if (selection) { try { target.setSelectionRange(...selection); } catch (_) {} }
      }
    }
    growFields();
    if (dayKey !== lastDayKey) {
      const changed = !!lastDayKey;
      lastDayKey = dayKey;
      if (changed) {
        q('[data-pip-scroll]').scrollTop = 0;
        revealNow();
        animate(panel, direction, 18);
      }
    }
  }

  /** Unresolved for Plan, read at most every few seconds (it reads every saved day). */
  function unresolvedNow() {
    if (!ctx.unresolved) return null;
    const now = Date.now();
    if (!unresolvedCache || now - unresolvedCache.at > UNRESOLVED_TTL) {
      let value = null;
      try { value = pipUnresolved(ctx.unresolved() || {}); } catch (_) { value = null; }
      unresolvedCache = { at: now, value };
    }
    return unresolvedCache.value;
  }

  function onToggle(event) {
    const fold = event.target;
    if (!fold?.matches?.('[data-pip-unresolved]') || fold.open === unresolvedOpen) return;
    unresolvedOpen = fold.open;
    writePreference(storage, UNRESOLVED_KEY, unresolvedOpen ? 'open' : '');
  }

  function renderHeader(dayKey, todayKey, direction) {
    const labels = pipDateLabels(dayKey, todayKey);
    const title = q('[data-pip-title]');
    const eyebrow = q('[data-pip-eyebrow]');
    const nowButton = q('[data-pip-now]');
    if (!title || !eyebrow || !nowButton) return;
    const titleHtml = `<span class="pip-long">${esc(labels.title)}</span><span class="pip-short">${esc(labels.titleShort)}</span>`;
    if (title.innerHTML !== titleHtml) {
      title.innerHTML = titleHtml;
      animate(title, direction, 8);
    }
    eyebrow.innerHTML = `<span class="pip-long">${esc(labels.weekday)}</span><span class="pip-short">${esc(labels.weekdayShort)}</span><span class="pip-date__rel${dayKey === todayKey ? ' is-today' : ''}">${esc(labels.relative)}</span>`;
    q('[data-pip-date]').setAttribute('aria-label', `Choose a date. Showing ${labels.weekday}, ${labels.title} (${labels.relative.toLowerCase()})`);
    nowButton.classList.toggle('is-away', dayKey !== todayKey);
  }

  function animate(el, direction, distance) {
    if (!direction || !el?.animate || reducedMotion()) return;
    el.getAnimations?.().forEach(animation => animation.cancel());
    el.animate([
      { opacity: 0, transform: `translateX(${direction * distance}px)` },
      { opacity: 1, transform: 'none' }
    ], { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  }

  // Today's Schedule opens on what is happening now.
  function revealNow() {
    if (!isOpen() || view !== 'schedule') return;
    const target = q('.pip-slot.is-current') || q('[data-pip-now-line]');
    const scroller = q('[data-pip-scroll]');
    if (!target || !scroller) return;
    const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    // Already in the upper half: keep the heading in view. Otherwise lead with a glimpse of what came before.
    if (offset < scroller.clientHeight * 0.5) return;
    scroller.scrollTo({ top: Math.max(0, offset - 48), behavior: 'auto' });
  }

  // Chromium sizes fields to their text (field-sizing); older engines measure.
  function growFields() {
    if (!isOpen() || win.CSS?.supports?.('field-sizing', 'content')) return;
    win.document.querySelectorAll('.pip-view textarea').forEach(field => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    });
  }

  function setView(next, { focusKey = '' } = {}) {
    const name = normalizePipView(next);
    const from = PIP_VIEWS.indexOf(view);
    const changed = name !== view;
    view = name;
    writePreference(storage, VIEW_KEY, view);
    const group = q('[data-pip-views]');
    group?.style.setProperty('--pip-view-index', String(PIP_VIEWS.indexOf(view)));
    group?.querySelectorAll('[data-pip-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pipView === view)));
    if (changed) {
      releaseHold();
      if (view === 'plan') unresolvedCache = null;
      render();
      const scroller = q('[data-pip-scroll]');
      if (scroller) scroller.scrollTop = 0;
      revealNow();
      animate(q('[data-pip-panel]'), Math.sign(PIP_VIEWS.indexOf(view) - from), 12);
    }
    if (focusKey) {
      const target = q(`[data-pip-key="${CSS.escape(focusKey)}"]`);
      target?.focus({ preventScroll: false });
      try { target?.setSelectionRange?.(target.value.length, target.value.length); } catch (_) {}
    }
  }

  function closePicker() {
    q('[data-pip-date-picker]')?.remove();
  }

  function stepDay(direction) {
    closePicker();
    releaseHold();
    ctx.stepDay(direction);
    render();
  }

  function goToNow() {
    closePicker();
    releaseHold();
    ctx.goToNow();
    render();
    revealNow();
  }

  // Edits go to the planner without redrawing the field being typed in.
  function quietly(fn) {
    quiet = true;
    try { fn(); } finally { quiet = false; }
  }

  function parseRef(value) {
    const [type, ...rest] = String(value || '').split(':');
    return { type, id: rest.join(':') };
  }

  function onClick(event) {
    const target = event.target;
    const button = target.closest('button');
    if (button?.disabled) return;
    if (target.closest('[data-pip-prev]')) { stepDay(-1); return; }
    if (target.closest('[data-pip-next]')) { stepDay(1); return; }
    if (target.closest('[data-pip-now]')) { goToNow(); return; }
    const dateButton = target.closest('[data-pip-date]');
    if (dateButton) {
      if (q('[data-pip-date-picker]')) { closePicker(); return; }
      openPipDatePicker({
        doc: win.document,
        anchor: dateButton,
        selectedKey: ctx.ymd(ctx.getDate()),
        weekStartsOn: ctx.weekStartsOn?.(),
        minKey: ctx.minDateKey || '',
        focusSelected: event.detail === 0,
        onSelect: key => { releaseHold(); ctx.goToDate(key); render(); dateButton.focus({ preventScroll: true }); }
      });
      return;
    }
    const viewButton = target.closest('[data-pip-view], [data-pip-go]');
    if (viewButton) { setView(viewButton.dataset.pipView || viewButton.dataset.pipGo); return; }
    const edit = target.closest('[data-pip-edit]');
    if (edit) { setView('plan', { focusKey: `text:${edit.dataset.pipEdit}` }); return; }
    const schedule = target.closest('[data-pip-schedule]');
    if (schedule) { const { type, id } = parseRef(schedule.dataset.pipSchedule); ctx.scheduleItem(type, id); return; }
    if (target.closest('[data-pip-add-task]')) {
      const id = ctx.addTask();
      if (id) setView('plan', { focusKey: `text:task:${id}` });
      return;
    }
    if (target.closest('[data-pip-add-block]')) { ctx.addBlock(); return; }
    if (target.closest('input, label')) return;
    const open = target.closest('[data-pip-open-block]') || target.closest('[data-pip-card]');
    if (open) ctx.openBlock(open.dataset.pipOpenBlock || open.dataset.pipCard);
  }

  function onChange(event) {
    const input = event.target;
    if (input.type !== 'checkbox') return;
    const done = input.checked;
    const row = input.closest('.pip-row, .pip-edit, .pip-slot, .pip-live');
    row?.classList.toggle('done', done);
    // Let the check land before a finished task leaves the Focus list (no wait without motion).
    if (view === 'focus' && done && !reducedMotion()) {
      holdRendering(650);
      if (row?.dataset.pipRow?.startsWith('task:') && row.animate) {
        row.style.overflow = 'hidden';
        row.animate([
          { opacity: 1, height: `${row.offsetHeight}px` },
          { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px' }
        ], { duration: 220, delay: 400, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
      }
    }
    if (input.dataset.pipBlockDone) { ctx.toggleBlock(input.dataset.pipBlockDone, done); return; }
    if (input.dataset.pipDone) { const { type, id } = parseRef(input.dataset.pipDone); ctx.toggleItem(type, id, done); }
  }

  function onInput(event) {
    const field = event.target;
    if (field.dataset.pipText) {
      const { type, id } = parseRef(field.dataset.pipText);
      const row = field.closest('.pip-edit');
      const empty = !field.value.trim();
      row?.classList.toggle('is-empty', empty);
      const scheduleButton = row?.querySelector('[data-pip-schedule]');
      if (scheduleButton) scheduleButton.disabled = empty;
      quietly(() => ctx.editItem(type, id, field.value));
    } else if (field.matches('[data-pip-focus]')) {
      quietly(() => ctx.editFocus(field.value));
    } else if (field.matches('[data-pip-notes]')) {
      quietly(() => ctx.editNotes(field.value));
    } else {
      return;
    }
    growFields();
  }

  function onKeydown(event) {
    const target = event.target;
    if (event.key === 'Escape') {
      if (q('[data-pip-date-picker]')) { event.preventDefault(); closePicker(); q('[data-pip-date]')?.focus(); return; }
      if (editing()) { target.blur(); return; }
    }
    if (target.matches?.('textarea[data-pip-text]') && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      // Items are one line that wraps: Enter moves on to the next one.
      event.preventDefault();
      const fields = [...win.document.querySelectorAll('textarea[data-pip-text]')];
      const next = fields[fields.indexOf(target) + 1];
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); } else target.blur();
      return;
    }
    if (editing() || q('[data-pip-date-picker]')) return;
    const action = pipShortcut(event);
    if (!action) return;
    event.preventDefault();
    if (action === 'prev') stepDay(-1);
    else if (action === 'next') stepDay(1);
    else if (action === 'today') goToNow();
    else if (action.startsWith('view:')) setView(action.slice(5));
  }

  function onResize() {
    growFields();
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      if (isOpen()) writePreference(storage, SIZE_KEY, JSON.stringify({ width: win.innerWidth, height: win.innerHeight }));
    }, 400);
  }

  return { open, close, toggle, render, syncTheme, isOpen };
}
