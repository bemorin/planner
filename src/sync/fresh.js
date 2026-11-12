import { defaultCategories } from '../config.js';
import { isBlankDay } from '../state/day-placement.js';
import { isUntouchedFirstBlock } from '../state/first-block.js';

/**
 * What a browser holds of its own, for a first connection (1.40.1): after Reset local data, or on a new device, the
 * planner opens as new and onboarding saves its settings. Its first sync must not stop on a conflict over them, nor
 * offer to send them over the copy's: there is nothing of the person's here yet.
 *
 * - A day is the person's when it holds anything (src/state/day-placement.js isBlankDay()): a blank day saved as the
 *   planner opened is nothing, and so is a day holding only onboarding's sample block, untouched (not edited, moved,
 *   resized or ticked: src/state/first-block.js). Once the person changes the sample or adds anything, it is theirs.
 * - Settings are fresh when absent, or when they hold only what the defaults and onboarding set: the hours, the
 *   planning days and the week's start may be anything; no day was ever closed, nothing waits in Later, no year has a
 *   plan (no text anywhere in it), and the categories are the default ones (same ids, names and colours), none archived.
 */

const hasText = value => {
  if (typeof value === 'string') return !!value.trim();
  if (Array.isArray(value)) return value.some(hasText);
  if (value && typeof value === 'object') return Object.values(value).some(hasText);
  return false;
};

/** Whether `settings` (as stored: an object, or its JSON) holds nothing beyond the defaults and onboarding's choices. */
export function freshSettings(settings) {
  let value = settings;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return false; } }
  if (value == null) return true;
  if (typeof value !== 'object') return false;
  if (Number(value.closeDayCount) > 0) return false;
  if (Array.isArray(value.openWork) && value.openWork.some(item => hasText(item?.text))) return false;
  if (value.horizon && hasText(value.horizon)) return false;
  if (value.categories !== undefined) {
    const list = Array.isArray(value.categories) ? value.categories : [];
    if (list.length !== defaultCategories.length) return false;
    const same = list.every((category, index) => {
      const fallback = defaultCategories[index];
      return category && category.id === fallback.id && category.name === fallback.name && category.color === fallback.color && !category.archived;
    });
    if (!same) return false;
  }
  return true;
}

/** Whether a saved day (`value`, as stored, for `day`) holds nothing of the person's: blank, or onboarding's sample alone, untouched. */
export function nothingDay(value, day) {
  if (isBlankDay(value)) return true;
  let parsed = value;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (_) { return false; } }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.blocks) || parsed.blocks.length !== 1) return false;
  return isUntouchedFirstBlock(parsed.blocks[0], day) && isBlankDay({ ...parsed, blocks: [] });
}

/**
 * Whether this browser has nothing of its own to sync, from its sync records ({ recordId: { value, deletedAt } }):
 * no day that holds anything, and fresh settings. A first connection from such a browser takes the copy.
 */
export function freshRecords(records = {}) {
  for (const [recordId, record] of Object.entries(records || {})) {
    if (!record || record.deletedAt) continue;
    if (recordId === 'settings') { if (!freshSettings(record.value)) return false; continue; }
    if (recordId.startsWith('day:') && !nothingDay(record.value, recordId.slice(4))) return false;
  }
  return true;
}

/** Whether the day store holds a day of the person's (the conflict card's safe choice depends on it). */
export function hasOwnDays(store) {
  for (const key of store?.keys?.('daily-planner:') || []) {
    if (!/^daily-planner:\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (!nothingDay(store.get(key), key.slice(-10))) return true;
  }
  return false;
}
