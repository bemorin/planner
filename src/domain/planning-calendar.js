import { atNoon } from '../lib/dates.js';
import { clamp } from '../lib/utils.js';

export function detectedWeekStart(language = globalThis.navigator?.language || 'en') {
  try {
    const locale = new Intl.Locale(language);
    const info = locale.weekInfo || locale.getWeekInfo?.();
    const first = Number(info?.firstDay);
    return Number.isFinite(first) ? first % 7 : 1;
  } catch (_) {
    return 1;
  }
}

export function activeWeekdays(settings = {}) {
  const configured = Array.isArray(settings.planningDays)
    ? [...new Set(settings.planningDays.map(Number).filter(day => day >= 0 && day <= 6))]
    : [];
  if (configured.length) return configured;

  const start = clamp(Number(settings.weekStartDay ?? 1), 0, 6);
  const end = clamp(Number(settings.weekEndDay ?? 5), 0, 6);
  const days = [start];
  let cursor = start;
  while (cursor !== end && days.length < 7) {
    cursor = (cursor + 1) % 7;
    days.push(cursor);
  }
  return days;
}

export function isPlanningDay(inputDate, settings) {
  return activeWeekdays(settings).includes(atNoon(inputDate).getDay());
}

export function nextPlanningDateFrom(inputDate, settings, { includeCurrent = false } = {}) {
  const date = atNoon(new Date(inputDate));
  if (includeCurrent && isPlanningDay(date, settings)) return date;

  for (let index = 0; index < 14; index += 1) {
    date.setDate(date.getDate() + 1);
    if (isPlanningDay(date, settings)) return atNoon(date);
  }
  return date;
}

export function previousPlanningDateFrom(inputDate, settings, { includeCurrent = false } = {}) {
  const date = atNoon(new Date(inputDate));
  if (includeCurrent && isPlanningDay(date, settings)) return date;

  for (let index = 0; index < 14; index += 1) {
    date.setDate(date.getDate() - 1);
    if (isPlanningDay(date, settings)) return atNoon(date);
  }
  return date;
}

export function firstPlanningSlotAfter(inputDate, settings, { startMinutes = 0, endMinutes = 24 * 60 } = {}) {
  const now = new Date(inputDate);
  const day = atNoon(now);
  const start = clamp(Number(startMinutes) || 0, 0, 24 * 60 - 1);
  const end = clamp(Number(endMinutes) || 24 * 60, start + 1, 24 * 60);

  if (isPlanningDay(day, settings)) {
    const nextFullHour = (now.getHours() + 1) * 60;
    const candidate = Math.max(start, nextFullHour);
    if (candidate < end) return { date: day, startMinutes: candidate };
  }

  return { date: nextPlanningDateFrom(day, settings), startMinutes: start };
}

export function planningWeekStart(inputDate, settings = {}) {
  const date = atNoon(new Date(inputDate));
  const start = clamp(Number(settings.weekStartsOn ?? 1), 0, 6);
  const delta = (date.getDay() - start + 7) % 7;
  date.setDate(date.getDate() - delta);
  return date;
}

export function planningWeekDates(inputDate, settings = {}) {
  const start = planningWeekStart(inputDate, settings);
  const active = new Set(activeWeekdays(settings));
  const days = [];

  for (let index = 0; index < 7; index += 1) {
    const date = atNoon(start);
    date.setDate(date.getDate() + index);
    if (active.has(date.getDay())) days.push(date);
  }

  return days.length ? days : [atNoon(inputDate)];
}
