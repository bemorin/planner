import { addDaysKey } from '../lib/dates.js';

/**
 * The sample block onboarding seeds on the first planning day (app.js seedFirstBlockAfterOnboarding()): one block, an
 * hour long, at the first free slot, inviting a first click. Defined here once, so that a first connection
 * (src/sync/fresh.js) can tell it, untouched, from anything the person planned (1.40.1).
 */
export const FIRST_BLOCK_TITLE = 'Click on me to edit your first block';

/** The sample block for `day` (YYYY-MM-DD) at `startMinutes`: its id names both, so a block moved is never taken for it. */
export function firstBlock({ day, startMinutes }) {
  return {
    id: `first-block-${day}-${startMinutes}`,
    title: FIRST_BLOCK_TITLE,
    link: '',
    notes: '',
    start: startMinutes,
    duration: 60,
    startDate: day,
    endDate: addDaysKey(day, Math.floor((startMinutes + 60) / (24 * 60))),
    categoryId: '',
    linkedType: '',
    linkedId: '',
    done: false,
    completedAt: '',
    actualDuration: null,
    carriedCount: 0,
    originDay: ''
  };
}

/** Whether `block`, on `day`, is the sample exactly as onboarding wrote it: not edited, moved, resized, ticked or linked. */
export function isUntouchedFirstBlock(block, day) {
  if (!block || typeof block !== 'object' || !Number.isInteger(block.start)) return false;
  const seeded = firstBlock({ day, startMinutes: block.start });
  return Object.entries(seeded).every(([field, value]) => block[field] === value)
    && Object.keys(block).every(field => field in seeded);
}
