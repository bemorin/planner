import { defaultCategories, palette } from '../config.js';
import { clamp, uid } from '../lib/utils.js';

// Colours and ids end up in style and data attributes, so anything that is not a
// plain hex colour or a simple id (an edited backup, a hand-written sync file)
// is replaced rather than trusted.
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CATEGORY_ID_RE = /^[\w.:-]{1,80}$/;

function categoriesFrom(raw) {
  const list = Array.isArray(raw?.categories) ? raw.categories.filter(category => category && typeof category === 'object') : [];
  if (list.length) {
    return list.map((category, index) => ({
      id: typeof category.id === 'string' && CATEGORY_ID_RE.test(category.id) ? category.id : uid('category'),
      name: String(category.name || '') || 'Category',
      color: typeof category.color === 'string' && HEX_COLOR_RE.test(category.color.trim()) ? category.color.trim() : palette[index % palette.length].value,
      archived: !!category.archived,
      archivedAt: typeof category.archivedAt === 'string' ? category.archivedAt : ''
    }));
  }
  return defaultCategories.map(category => ({ ...category, archived: false, archivedAt: '' }));
}

export function createDefaultSettings({ detectedWeekStart = 1, currentYear = new Date().getFullYear() } = {}) {
  return {
    categories: categoriesFrom(null),
    startHour: 8,
    endHour: 18,
    expandedView: false,
    fitDefaultV8: true,
    weekStartDay: 1,
    weekEndDay: 5,
    weekStartsOn: 1,
    weekStartsOnExplicit: false,
    planningDays: [1, 2, 3, 4, 5],
    onboardingComplete: false,
    closeDayCount: 0,
    installPromptShown: false,
    sponsorPromptShown: false,
    openWork: [],
    horizon: { years: {} },
    horizonStartYear: currentYear
  };
}

export function normalizePlannerSettings(raw, { detectedWeekStart = 1, currentYear = new Date().getFullYear() } = {}) {
  if (!raw || typeof raw !== 'object') return createDefaultSettings({ detectedWeekStart, currentYear });

  const startHour = clamp(Number(raw.startHour ?? 6), 0, 23);
  const endHour = clamp(Number(raw.endHour ?? 22), startHour + 1, 24);

  return {
    categories: categoriesFrom(raw),
    startHour,
    endHour,
    expandedView: raw.fitDefaultV8 ? raw.expandedView !== false : true,
    fitDefaultV8: true,
    weekStartDay: clamp(Number(raw.weekStartDay ?? 1), 0, 6),
    weekEndDay: clamp(Number(raw.weekEndDay ?? 5), 0, 6),
    weekStartsOn: raw.weekStartsOnExplicit
      ? clamp(Number(raw.weekStartsOn ?? 1), 0, 6)
      : clamp(Number(raw.weekStartDay ?? 1), 0, 6),
    weekStartsOnExplicit: !!raw.weekStartsOnExplicit,
    planningDays: Array.isArray(raw.planningDays) && raw.planningDays.length
      ? [...new Set(raw.planningDays.map(Number).filter(day => day >= 0 && day <= 6))]
      : null,
    onboardingComplete: raw.onboardingComplete !== false,
    closeDayCount: Math.max(0, Number(raw.closeDayCount) || 0),
    installPromptShown: !!raw.installPromptShown,
    sponsorPromptShown: !!raw.sponsorPromptShown,
    openWork: Array.isArray(raw.openWork)
      ? raw.openWork.map(item => ({
          id: item.id || uid('open'),
          text: String(item.text || ''),
          kind: item.kind || 'task',
          originDay: item.originDay || '',
          carriedCount: Math.max(0, Number(item.carriedCount) || 0),
          block: item.block && typeof item.block === 'object' ? item.block : null
        })).filter(item => item.text.trim())
      : [],
    horizon: raw.horizon && typeof raw.horizon === 'object' ? raw.horizon : { years: {} },
    horizonStartYear: Math.max(2000, Number(raw.horizonStartYear) || currentYear)
  };
}
