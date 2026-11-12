/**
 * Unresolved: what past days left unfinished and nobody decided on yet (Plan, Save, Forget, or carried on by
 * closing the day). The planner's list, the floating window's and the week review's count all come from here.
 *
 * 1.39.4: the saved days are read once per list (they were read again for each candidate, which took minutes with
 * years of history), and whether a candidate was already carried on is looked up in an index built in the same pass.
 * The list is the same, in the same order. Pure.
 */

/** Whether a candidate (`priority:<id>`, `task:<id>`, `block:<id>`) was decided on in its day: saved, forgotten or moved. */
export function candidateTriaged(dayState, key) {
  return (dayState.triaged || []).some(value => value === `${key}:later` || value === `${key}:drop` || value.startsWith(`${key}@`));
}

/** A saved day's candidates: outcomes and tasks with text, not done, and blocks of their own, not done, none decided on. */
export function candidatesForSavedDay(dayKey, dayState) {
  const candidates = [];
  const linked = (type, id) => dayState.blocks.find(block => block.linkedType === type && block.linkedId === id) || null;
  dayState.priorities.forEach((item, index) => {
    const key = `priority:${item.id}`;
    if (!item.text.trim() || item.done || candidateTriaged(dayState, key)) return;
    candidates.push({ key, kind: 'priority', item, index, block: linked('priority', item.id), originDay: dayKey });
  });
  dayState.tasks.forEach((item, index) => {
    const key = `task:${item.id}`;
    if (!item.text.trim() || item.done || candidateTriaged(dayState, key)) return;
    candidates.push({ key, kind: 'task', item, index, block: linked('task', item.id), originDay: dayKey });
  });
  dayState.blocks.forEach(block => {
    if (block.linkedType && block.linkedId) return;
    const key = `block:${block.id}`;
    if (block.done || candidateTriaged(dayState, key)) return;
    candidates.push({ key, kind: 'block', block, originDay: dayKey });
  });
  return candidates;
}

const textKey = text => String(text ?? '').trim().toLocaleLowerCase();

/**
 * Where each day's work went: for an origin day and a text (trimmed, lower case), the latest day that holds a copy
 * carried from it (`carriedCount` above 0), and whether Later holds it.
 */
function carriedIndex(days, openWork) {
  const latest = new Map();
  const saved = new Map();
  const note = (map, originDay, text, value) => {
    if (!originDay) return;
    let texts = map.get(originDay);
    if (!texts) map.set(originDay, (texts = new Map()));
    const key = textKey(text);
    if (value === true || !(texts.get(key) >= value)) texts.set(key, value);
  };
  for (const [dayKey, dayState] of days) {
    for (const item of [...(dayState.priorities || []), ...(dayState.tasks || [])]) if (Number(item.carriedCount) > 0) note(latest, item.originDay, item.text, dayKey);
    for (const block of dayState.blocks || []) if (Number(block.carriedCount) > 0) note(latest, block.originDay, block.title, dayKey);
  }
  for (const item of openWork || []) note(saved, item.originDay, item.text, true);
  return {
    /** Whether `candidate`, from `sourceDay`, was saved for later or carried to a later day already. */
    transferred(candidate, sourceDay) {
      const text = (candidate.kind === 'block' ? candidate.block?.title : candidate.item?.text || '').trim().toLocaleLowerCase();
      if (!text) return false;
      if (saved.get(sourceDay)?.get(text)) return true;
      const day = latest.get(sourceDay)?.get(text);
      return !!day && day > sourceDay;
    }
  };
}

/**
 * The Unresolved list from `days` ([key, day] pairs, as src/state/saved-days.js reads them): the candidates of every
 * day before `todayKey` not carried on or saved for later (`openWork`, the settings' Later list), newest day first.
 */
export function needsAttention(days, { todayKey, openWork = [] } = {}) {
  const index = carriedIndex(days, openWork);
  const entries = [];
  for (const [dayKey, dayState] of days) {
    if (dayKey >= todayKey) continue;
    for (const candidate of candidatesForSavedDay(dayKey, dayState)) if (!index.transferred(candidate, dayKey)) entries.push(candidate);
  }
  return entries.sort((a, b) => b.originDay.localeCompare(a.originDay));
}
