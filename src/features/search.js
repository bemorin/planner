/**
 * Search only user-authored planner content.
 * Labels such as "Schedule" and "Outcome" are intentionally presentation-only
 * and never participate in matching.
 */
export function searchPlannerDays({ query, days, categories = [], blockTimeRange, limit = 60 }) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return [];

  const results = [];
  const categoryName = id => categories.find(category => category.id === id)?.name || '';
  const add = (day, kind, id, label, text, meta = '') => {
    const authored = String(text || '');
    if (!authored.toLocaleLowerCase().includes(needle)) return;
    results.push({ day, kind, id, label, text: authored, meta });
  };

  for (const [day, dayState] of days) {
    if (dayState.focus?.trim()) add(day, 'focus', '', 'Keep in mind', dayState.focus);

    dayState.priorities.forEach((item, index) => {
      if (!item.text?.trim()) return;
      add(
        day,
        'priority',
        item.id,
        index === 0 ? 'Most important outcome' : 'Other important outcome',
        item.text,
        item.done ? 'Done' : 'Open'
      );
    });

    dayState.tasks.forEach(item => {
      if (!item.text?.trim()) return;
      add(day, 'task', item.id, 'Task', item.text, item.done ? 'Done' : 'Open');
    });

    dayState.blocks.forEach(block => {
      if (!block.title?.trim()) return;
      const category = categoryName(block.categoryId);
      add(day, 'block', block.id, 'Schedule', block.title, `${blockTimeRange(block)}${category ? ` · ${category}` : ''}`);
    });

    if (dayState.notes?.trim()) add(day, 'notes', '', 'Notes', dayState.notes);
    if (dayState.memory?.trim()) add(day, 'memory', '', 'Memory', dayState.memory);
    if (dayState.lesson?.trim()) add(day, 'lesson', '', 'Lesson', dayState.lesson);

    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

export function searchSnippet(text, max = 132) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
