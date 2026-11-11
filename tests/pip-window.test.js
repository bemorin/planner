import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PIP_UNRESOLVED,
  PIP_VIEWS,
  buildPipModel,
  normalizePipView,
  pipDateLabels,
  pipSchedule,
  pipShellMarkup,
  pipShortcut,
  pipUnresolved,
  pipViewMarkup,
  readPipSize,
  relativeDayLabel
} from '../src/features/pip-window.js';
import { pipStyles } from '../src/features/pip-styles.js';

const block = (id, start, duration, extra = {}) => ({ id, title: id, start, duration, ...extra });

function model(overrides = {}) {
  const state = {
    focus: 'Protect the morning',
    notes: '',
    priorities: [{ id: 'p1', text: 'Ship the spec', done: false }, { id: 'p2', text: '', done: false }, { id: 'p3', text: '', done: false }],
    tasks: [{ id: 't1', text: 'Reply to Paul', done: true }, { id: 't2', text: 'Book physio', done: false }, { id: 't3', text: '', done: false }],
    blocks: [block('deep', 8 * 60 + 30, 120), block('run', 12 * 60 + 15, 45)],
    ...overrides.state
  };
  return buildPipModel({ state, dayKey: '2026-10-20', todayKey: '2026-10-20', nowMinutes: 9 * 60, ...overrides.options });
}

test('views: Focus, Plan, Schedule, with the old tab name mapped to Plan', () => {
  assert.deepEqual(PIP_VIEWS, ['focus', 'plan', 'schedule']);
  assert.equal(normalizePipView('tasks'), 'plan');
  assert.equal(normalizePipView('schedule'), 'schedule');
  assert.equal(normalizePipView('nonsense'), 'focus');
  assert.equal(normalizePipView(undefined), 'focus');
});

test('relative day labels read like the header of a calendar', () => {
  assert.equal(relativeDayLabel('2026-10-20', '2026-10-20'), 'Today');
  assert.equal(relativeDayLabel('2026-10-21', '2026-10-20'), 'Tomorrow');
  assert.equal(relativeDayLabel('2026-10-19', '2026-10-20'), 'Yesterday');
  assert.equal(relativeDayLabel('2026-10-26', '2026-10-20'), 'In 6 days');
  assert.equal(relativeDayLabel('2026-10-16', '2026-10-20'), '4 days ago');
  assert.equal(relativeDayLabel('2026-11-02', '2026-10-30'), 'In 3 days');
});

test('date labels keep the year only for another year, in a short form', () => {
  const same = pipDateLabels('2026-10-21', '2026-10-20', 'en-US');
  assert.equal(same.weekday, 'Wednesday');
  assert.equal(same.title, 'October 21');
  assert.equal(same.titleShort, 'Oct 21');
  assert.equal(same.relative, 'Tomorrow');
  const other = pipDateLabels('2027-01-04', '2026-10-20', 'en-US');
  assert.match(other.title, /2027/);
  assert.match(other.title, /^Jan/);
});

test('shortcuts: arrows move days, T and N go to today, 1–3 pick a view', () => {
  assert.equal(pipShortcut({ key: 'ArrowLeft' }), 'prev');
  assert.equal(pipShortcut({ key: 'ArrowRight' }), 'next');
  assert.equal(pipShortcut({ key: 't' }), 'today');
  assert.equal(pipShortcut({ key: 'T' }), 'today');
  assert.equal(pipShortcut({ key: 'n' }), 'today');
  assert.equal(pipShortcut({ key: '1' }), 'view:focus');
  assert.equal(pipShortcut({ key: '2' }), 'view:plan');
  assert.equal(pipShortcut({ key: '3' }), 'view:schedule');
  assert.equal(pipShortcut({ key: 'ArrowRight', metaKey: true }), '');
  assert.equal(pipShortcut({ key: 't', ctrlKey: true }), '');
  assert.equal(pipShortcut({ key: 'x' }), '');
});

test('today: the live block, its progress and the next block', () => {
  const schedule = pipSchedule([block('run', 735, 45), block('deep', 510, 120)], { nowMinutes: 540, isToday: true });
  assert.equal(schedule.current.id, 'deep');
  assert.equal(schedule.next.id, 'run');
  assert.equal(schedule.progress.left, 90);
  assert.equal(schedule.progress.end, 630);
  assert.equal(schedule.progress.ratio, 0.25);
  assert.equal(schedule.nowLineIndex, -1, 'a live block carries its own progress instead of a now line');
  assert.deepEqual(schedule.entries.map(entry => [entry.block.id, entry.phase]), [['deep', 'live'], ['run', 'upcoming']]);
  assert.equal(schedule.plannedMinutes, 165);
});

test('today between blocks: free time and the now line before the next block', () => {
  const schedule = pipSchedule([block('a', 480, 60), block('b', 720, 30), block('c', 900, 60)], { nowMinutes: 700, isToday: true });
  assert.equal(schedule.current, null);
  assert.equal(schedule.next.id, 'b');
  assert.equal(schedule.freeMinutes, 20);
  assert.equal(schedule.nowLineIndex, 1);
  assert.deepEqual(schedule.entries.map(entry => entry.phase), ['past', 'upcoming', 'upcoming']);
  const evening = pipSchedule([block('a', 480, 60)], { nowMinutes: 1200, isToday: true });
  assert.equal(evening.nowLineIndex, 1, 'after the last block the line closes the list');
  assert.equal(evening.next, null);
});

test('overlapping live blocks: an open one leads; another day has no now', () => {
  const isDone = item => item.id === 'done-one';
  const schedule = pipSchedule([block('done-one', 500, 120), block('open-one', 520, 60)], { nowMinutes: 540, isToday: true, isDone });
  assert.equal(schedule.current.id, 'open-one');
  assert.equal(schedule.doneCount, 1);
  const tomorrow = pipSchedule([block('a', 480, 60)], { nowMinutes: 540, isToday: false });
  assert.equal(tomorrow.current, null);
  assert.equal(tomorrow.next, null);
  assert.equal(tomorrow.nowLineIndex, -1);
  assert.equal(tomorrow.entries[0].phase, '');
  assert.deepEqual(pipSchedule(null).entries, []);
});

test('Focus shows the live block, the main outcome and only open tasks', () => {
  const html = pipViewMarkup('focus', model());
  assert.match(html, /class="pip-live/);
  assert.match(html, /1h 30m left/);
  assert.match(html, /Ends 10:30/);
  assert.match(html, /Most important outcome/);
  assert.match(html, /Ship the spec/);
  assert.match(html, /Book physio/);
  assert.doesNotMatch(html, /Reply to Paul/, 'a finished task leaves the Focus list');
  assert.match(html, /1 of 2 done/);
  assert.match(html, /Keep in mind/);
});

test('Focus invites a main outcome when there is none and caps the task list', () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({ id: `t${index}`, text: `Task ${index}`, done: false }));
  const html = pipViewMarkup('focus', model({ state: { priorities: [{ id: 'p1', text: '', done: false }], tasks, focus: '' } }));
  assert.match(html, /data-pip-edit="priority:p1"/);
  assert.match(html, /3 more in Plan/);
  assert.doesNotMatch(html, /Keep in mind/);
});

test('Focus on another day summarises its schedule', () => {
  const html = pipViewMarkup('focus', model({ options: { dayKey: '2026-10-21' } }));
  assert.doesNotMatch(html, /pip-live/);
  assert.match(html, /2 blocks · 2h 45m/);
  assert.match(html, /First at 08:30/);
  assert.match(html, /data-pip-go="schedule"/);
});

test('Schedule places the now line between past and upcoming blocks', () => {
  const html = pipViewMarkup('schedule', model({ options: { nowMinutes: 11 * 60 } }));
  const line = html.indexOf('data-pip-now-line');
  assert.ok(line > html.indexOf('data-pip-card="deep"'));
  assert.ok(line < html.indexOf('data-pip-card="run"'));
  assert.match(html, /is-past/);
  assert.match(html, />11:00</);
  const empty = pipViewMarkup('schedule', model({ state: { blocks: [] } }));
  assert.match(empty, /Nothing scheduled/);
  assert.match(empty, /data-pip-add-block/);
});

test('Plan keeps every item editable, aligned on its first line, with a way to add a task', () => {
  const html = pipViewMarkup('plan', model());
  assert.equal((html.match(/data-pip-text="/g) || []).length, 6);
  assert.match(html, /data-pip-focus/);
  assert.match(html, /data-pip-notes/);
  assert.doesNotMatch(html, /data-pip-add-task/, 'an empty task slot is already there');
  const full = pipViewMarkup('plan', model({ state: { tasks: [{ id: 't1', text: 'One', done: false }] } }));
  assert.match(full, /data-pip-add-task/);
  assert.match(html, /data-pip-schedule="priority:p2"[^>]*disabled/, 'an empty item cannot be scheduled');
});

test('Unresolved lists past items to decide on and Later, most carried first, eight at most', () => {
  const needs = [
    { kind: 'task', item: { text: 'Book physio', carriedCount: 1 }, originDay: '2026-10-19' },
    { kind: 'block', block: { title: 'Draft the newsletter', carriedCount: 0 }, originDay: '2026-10-16' },
    { kind: 'priority', item: { text: '   ', carriedCount: 4 }, originDay: '2026-10-15' }
  ];
  const later = [{ text: 'Renew passport', carriedCount: 3 }, { text: 'Call the bank' }];
  const list = pipUnresolved({ needs, later });
  assert.equal(list.total, 4, 'an item without text is left out');
  assert.deepEqual(list.items.map(item => [item.text, item.kind, item.count]), [
    ['Renew passport', 'Later', 3], ['Book physio', 'Needs attention', 1], ['Draft the newsletter', 'Needs attention', 0], ['Call the bank', 'Later', 0]
  ]);
  const many = pipUnresolved({ later: Array.from({ length: 11 }, (_, index) => ({ text: `Item ${index}` })) });
  assert.equal(PIP_UNRESOLVED, 8);
  assert.deepEqual([many.total, many.items.length], [11, 8]);
  assert.deepEqual(pipUnresolved(), { total: 0, items: [] });
});

test('Plan ends with Unresolved, folded unless opened, and the other views leave it out', () => {
  const unresolved = pipUnresolved({ needs: [{ kind: 'task', item: { text: '<b>Book</b> physio', carriedCount: 2 } }], later: Array.from({ length: 9 }, (_, index) => ({ text: `Later ${index}` })) });
  const plan = pipViewMarkup('plan', model({ options: { unresolved } }));
  assert.match(plan, /<details class="pip-unresolved" data-pip-unresolved>/, 'folded by default');
  assert.ok(plan.indexOf('data-pip-unresolved') > plan.indexOf('data-pip-notes'), 'at the bottom of Plan');
  assert.match(plan, /<span class="pip-unresolved__title">Unresolved<\/span><span class="pip-unresolved__count">10<\/span>/);
  assert.equal((plan.match(/<li>/g) || []).length, 8);
  assert.match(plan, /Needs attention · carried 2×/);
  assert.match(plan, /2 more in the planner’s Unresolved/);
  assert.doesNotMatch(plan, /<b>Book/, 'escaped');
  assert.match(pipViewMarkup('plan', model({ options: { unresolved, unresolvedOpen: true } })), /data-pip-unresolved open>/);
  assert.doesNotMatch(pipViewMarkup('plan', model({ options: { unresolved: pipUnresolved({}) } })), /pip-unresolved/, 'nothing unresolved, no section');
  assert.doesNotMatch(pipViewMarkup('focus', model({ options: { unresolved } })), /pip-unresolved/);
  assert.doesNotMatch(pipViewMarkup('schedule', model({ options: { unresolved } })), /pip-unresolved/);
});

test('without Document Picture-in-Picture, floating mode is hidden rather than an error', async () => {
  const [app, html] = await Promise.all([readFile(new URL('../app.js', import.meta.url), 'utf8'), readFile(new URL('../index.html', import.meta.url), 'utf8')]);
  assert.doesNotMatch(app, /alert\('Floating mode/, 'no blocking alert');
  assert.match(app, /const pipSupported = !!window\.documentPictureInPicture;/);
  assert.match(app, /qsa\('\[data-pip\], \[data-pip-hint\]'\)\.forEach\(node => \{ node\.hidden = !pipSupported; \}\)/);
  assert.match(app, /i: \(\) => \{ if \(pipSupported\) pipFeature\.toggle\(\); \}/);
  assert.match(html, /<div data-pip-hint><span>Floating mode<\/span><kbd>I<\/kbd><\/div>/, 'the Help shortcut can be hidden');
  const faq = /<h3>9\. Floating mode & print<\/h3>[\s\S]*?<\/details>/.exec(html)?.[0] || '';
  for (const view of ['Focus', 'Plan', 'Schedule']) assert.match(faq, new RegExp(`<strong>${view}</strong>`), view);
});

test('markup escapes what people type', () => {
  const html = pipViewMarkup('schedule', model({ state: { blocks: [block('x', 540, 30, { title: '<img src=x onerror=alert(1)>' })] } }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  const plan = pipViewMarkup('plan', model({ state: { focus: '</textarea><b>bold</b>' } }));
  assert.doesNotMatch(plan, /<b>bold/);
});

test('shell: one header with three views and the day navigation', () => {
  const html = pipShellMarkup('schedule');
  assert.equal((html.match(/data-pip-view="/g) || []).length, 3);
  assert.match(html, /data-pip-view="schedule" aria-pressed="true"/);
  assert.match(html, /--pip-view-index:2/);
  assert.match(html, /aria-label="Previous planning day"/);
  assert.match(html, /aria-label="Next planning day"/);
  assert.match(html, /data-pip-now/);
});

test('remembered window size is used only when sensible', () => {
  assert.deepEqual(readPipSize('{"width":420,"height":640}'), { width: 420, height: 640 });
  assert.deepEqual(readPipSize('{"width":20,"height":640}'), { width: 380, height: 580 });
  assert.deepEqual(readPipSize('not json'), { width: 380, height: 580 });
  assert.deepEqual(readPipSize(null), { width: 380, height: 580 });
});

test('floating window styles: wrapping text, sized fields, motion only when welcome', () => {
  const css = pipStyles();
  assert.doesNotMatch(css, /!important/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /field-sizing: content/);
  assert.match(css, /\.pip-scroll \{[^}]*overflow-x: hidden/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  const [still, motion] = css.split('@media (prefers-reduced-motion: no-preference)');
  assert.ok(motion, 'motion lives in one no-preference block');
  assert.doesNotMatch(still, /transition|animation/);
  assert.ok(css.split('\n').every(line => line.length <= 400), 'readable lines');
});
