import { minTaskSlots, snap } from '../config.js';
import { addDaysKey } from '../lib/dates.js';
import { clamp, uid } from '../lib/utils.js';

/** Create the canonical empty state for one planner day. */
export function createBlankDay() {
  return {
    focus: '',
    priorities: [
      { id: uid('priority'), text: '', done: false, carriedCount: 0, originDay: '' },
      { id: uid('priority'), text: '', done: false, carriedCount: 0, originDay: '' },
      { id: uid('priority'), text: '', done: false, carriedCount: 0, originDay: '' }
    ],
    // Every item in the shape normalizeDayState() gives it (originDay included): a day saved, loaded and saved again
    // is the same, so Personal sync never takes a day this device only opened for a change made here.
    tasks: Array.from({ length: minTaskSlots }, () => ({ id: uid('task'), text: '', done: false, carriedCount: 0, originDay: '' })),
    notes: '',
    blocks: [],
    endedAt: '',
    carriedForward: [],
    memory: '',
    lesson: '',
    triaged: [],
    closeTransfers: []
  };
}

/**
 * Normalize persisted day data without mutating the stored object.
 *
 * The loader accepts older/partial records and restores the invariants relied on
 * by both Day and Week. Linked schedule blocks intentionally mirror the done
 * state of their task/outcome source.
 */
export function normalizeDayState(raw, dayKey) {
  const base = createBlankDay();
  if (!raw || typeof raw !== 'object') return base;

  base.focus = typeof raw.focus === 'string' ? raw.focus : '';
  base.notes = typeof raw.notes === 'string' ? raw.notes : '';
  base.endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : '';
  base.carriedForward = Array.isArray(raw.carriedForward) ? raw.carriedForward.filter(Boolean) : [];
  base.memory = typeof raw.memory === 'string' ? raw.memory : '';
  base.lesson = typeof raw.lesson === 'string' ? raw.lesson : '';
  base.triaged = Array.isArray(raw.triaged) ? raw.triaged.filter(Boolean) : [];
  base.closeTransfers = Array.isArray(raw.closeTransfers) ? raw.closeTransfers.filter(item => item && typeof item === 'object') : [];

  base.priorities = Array.from({ length: 3 }, (_, index) => {
    const priority = raw.priorities?.[index] || {};
    return {
      id: priority.id || uid('priority'),
      text: priority.text || '',
      done: !!priority.done,
      carriedCount: Math.max(0, Number(priority.carriedCount) || 0),
      originDay: /^\d{4}-\d{2}-\d{2}$/.test(priority.originDay || '') ? priority.originDay : ''
    };
  });

  base.tasks = Array.isArray(raw.tasks)
    ? raw.tasks.map(task => ({
        id: task.id || uid('task'),
        text: task.text || '',
        done: !!task.done,
        carriedCount: Math.max(0, Number(task.carriedCount) || 0),
        originDay: /^\d{4}-\d{2}-\d{2}$/.test(task.originDay || '') ? task.originDay : ''
      }))
    : [];
  while (base.tasks.length < minTaskSlots) base.tasks.push({ id: uid('task'), text: '', done: false, carriedCount: 0, originDay: '' });

  base.blocks = Array.isArray(raw.blocks)
    ? raw.blocks.map(block => {
        const start = clamp(Number(block.start) || 9 * 60, 0, 24 * 60 - 1);
        const duration = clamp(Number(block.duration) || 60, snap, 24 * 60);
        const startDate = /^\d{4}-\d{2}-\d{2}$/.test(block.startDate || '') ? block.startDate : dayKey;
        const derivedEndOffset = Math.floor((start + duration) / (24 * 60));
        const endDate = /^\d{4}-\d{2}-\d{2}$/.test(block.endDate || '')
          ? block.endDate
          : addDaysKey(startDate, Math.min(1, derivedEndOffset));
        return {
          id: block.id || uid('block'),
          title: block.title || '',
          link: typeof block.link === 'string' ? block.link : '',
          notes: typeof block.notes === 'string' ? block.notes : '',
          start,
          duration,
          startDate,
          endDate,
          categoryId: block.categoryId || '',
          linkedType: block.linkedType || '',
          linkedId: block.linkedId || '',
          done: !!block.done,
          completedAt: typeof block.completedAt === 'string' ? block.completedAt : '',
          actualDuration: Number.isFinite(Number(block.actualDuration)) && Number(block.actualDuration) > 0 ? Number(block.actualDuration) : null,
          carriedCount: Math.max(0, Number(block.carriedCount) || 0),
          originDay: /^\d{4}-\d{2}-\d{2}$/.test(block.originDay || '') ? block.originDay : ''
        };
      })
    : [];

  base.blocks.forEach(block => {
    const source = block.linkedType === 'task'
      ? base.tasks.find(item => item.id === block.linkedId)
      : block.linkedType === 'priority'
        ? base.priorities.find(item => item.id === block.linkedId)
        : null;
    if (source) block.done = !!source.done;
  });

  return base;
}
