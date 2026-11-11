import { durationLabel, time } from '../domain/schedule-time.js';

/**
 * Plain-words summaries of a day's plan and schedule — the phone's Plan /
 * Schedule switch, the Day view's "Plan" heading, the week agenda and the
 * week's day headers all say the same thing. Pure and unit-tested.
 */

const filled = item => !!String(item?.text || '').trim();
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Outcomes and tasks that have text, and how many of them are done. */
export function planCounts(day) {
  const outcomes = (day?.priorities || []).filter(filled);
  const tasks = (day?.tasks || []).filter(filled);
  const outcomesDone = outcomes.filter(item => item.done).length;
  const tasksDone = tasks.filter(item => item.done).length;
  return { outcomes: outcomes.length, outcomesDone, tasks: tasks.length, tasksDone, total: outcomes.length + tasks.length, done: outcomesDone + tasksDone };
}

/** "2 of 6 done", "All 6 done", "Done", or "Nothing planned". */
export function planLine(counts) {
  if (!counts?.total) return 'Nothing planned';
  if (counts.done === counts.total) return counts.total === 1 ? 'Done' : `All ${counts.total} done`;
  return `${counts.done} of ${counts.total} done`;
}

/** Adds up planCounts() of several days (the week). */
export function sumCounts(list) {
  return list.reduce((sum, counts) => {
    Object.keys(sum).forEach(key => { sum[key] += Number(counts?.[key]) || 0; });
    return sum;
  }, { outcomes: 0, outcomesDone: 0, tasks: 0, tasksDone: 0, total: 0, done: 0 });
}

/** "2/3 outcomes · 1 task" — the compact line under a week day header. */
export function planCompact(counts) {
  const parts = [];
  if (counts.outcomes) parts.push(`${counts.outcomesDone}/${counts.outcomes} ${counts.outcomes === 1 ? 'outcome' : 'outcomes'}`);
  if (counts.tasks) parts.push(plural(counts.tasks, 'task'));
  return parts.join(' · ') || 'Nothing planned';
}

const sortedBlocks = blocks => [...(blocks || [])].filter(block => Number.isFinite(Number(block?.start))).sort((a, b) => a.start - b.start);

/**
 * The schedule in a few words: "Now until 11:00" or "Next 17:30" today,
 * otherwise "4 blocks", or "Empty". `nowMinutes` is only used when `today`.
 */
export function scheduleLine(blocks, { today = false, nowMinutes = 0 } = {}) {
  const list = sortedBlocks(blocks);
  if (!list.length) return 'Empty';
  if (today) {
    const current = list.find(block => block.start <= nowMinutes && nowMinutes < block.start + block.duration);
    if (current) return `Now until ${time(current.start + current.duration)}`;
    const next = list.find(block => block.start > nowMinutes);
    if (next) return `Next ${time(next.start)}`;
  }
  return plural(list.length, 'block');
}

/** "3 blocks · 4h 30m" for the agenda. */
export function blocksLine(blocks) {
  const list = sortedBlocks(blocks);
  if (!list.length) return '';
  const minutes = list.reduce((sum, block) => sum + (Number(block.duration) || 0), 0);
  return `${plural(list.length, 'block')} · ${durationLabel(minutes)}`;
}

/** What the week agenda and the week day headers show for one day. */
export function agendaDay(day, { key = '', todayKey = '' } = {}) {
  const outcomes = (day?.priorities || []).map(item => ({ text: String(item?.text || '').trim(), done: !!item?.done }));
  const mit = outcomes[0]?.text ? outcomes[0] : null;
  return {
    key,
    today: !!key && key === todayKey,
    past: !!key && !!todayKey && key < todayKey,
    closed: !!day?.endedAt,
    mit,
    others: outcomes.slice(1).filter(item => item.text),
    counts: planCounts(day),
    blocks: sortedBlocks(day?.blocks).length,
    blocksLine: blocksLine(day?.blocks)
  };
}

/**
 * The two lines of the phone's Plan / Schedule switch (and the Day view's
 * "Plan" heading) for the days shown: one day, or the planning days of a week.
 * Today's schedule says what is on now or next; otherwise the block count.
 */
export function viewSummaries(days, { todayKey = '', nowMinutes = 0 } = {}) {
  const counts = sumCounts(days.map(entry => planCounts(entry.state)));
  const today = days.find(entry => entry.key && entry.key === todayKey);
  const todayLine = today ? scheduleLine(today.state?.blocks, { today: true, nowMinutes }) : '';
  const total = days.reduce((sum, entry) => sum + sortedBlocks(entry.state?.blocks).length, 0);
  const schedule = /^(?:Now|Next) /.test(todayLine) ? todayLine : total ? plural(total, 'block') : 'Empty';
  return { plan: planLine(counts), schedule, counts };
}
