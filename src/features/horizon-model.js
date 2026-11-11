import { atNoon, dateFromKey, ymdKey } from '../lib/dates.js';

export function rangeLabel(startKey, endKey = '', options = {}) {
  if (!startKey) return options.empty || 'Add dates';
  const start = dateFromKey(startKey);
  const end = endKey ? dateFromKey(endKey) : null;
  const startDay = start.getDate();
  const startMonth = start.toLocaleDateString(undefined, { month: 'short' });
  if (!end || endKey === startKey) return `${startDay} ${startMonth}`;
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) return `${startDay}–${end.getDate()} ${startMonth}`;
  return `${startDay} ${startMonth}–${end.getDate()} ${end.toLocaleDateString(undefined, { month: 'short' })}`;
}

export function horizonCountdown(startKey, endKey = '', done = false, todayInput = new Date()) {
  if (done) return 'Done';
  if (!startKey) return 'Add dates';
  const today = atNoon(todayInput);
  const start = dateFromKey(startKey);
  const end = endKey ? dateFromKey(endKey) : start;
  const startDiff = Math.round((start - today) / 86400000);
  const endDiff = Math.round((end - today) / 86400000);
  if (startDiff > 1) return `in ${startDiff} days`;
  if (startDiff === 1) return 'tomorrow';
  if (startDiff === 0) return 'today';
  if (endDiff >= 0) return 'under way';
  const ago = Math.abs(endDiff);
  return ago === 1 ? '1 day ago' : `${ago} days ago`;
}

export function rangeOverlapsMonth(startKey, endKey, year, month) {
  if (!startKey) return false;
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
  return startKey <= monthEnd && (endKey || startKey) >= monthStart;
}

export function dayInRange(dayKey, startKey, endKey = '') {
  return !!startKey && dayKey >= startKey && dayKey <= (endKey || startKey);
}

export const habitQuarterForMonth = month => Math.floor(month / 3);
export const habitChecked = (data, dayKey, index) => Array.isArray(data.habitChecks?.[dayKey]) && data.habitChecks[dayKey].includes(index);

export function habitQuarterBounds(year, index) {
  return {
    start: atNoon(new Date(year, index * 3, 1)),
    end: atNoon(new Date(year, index * 3 + 3, 0))
  };
}

export function habitActivityStats(data, index, year, todayInput = new Date()) {
  const bounds = habitQuarterBounds(year, index);
  const configuredStart = data.habitStartedAt?.[index] ? dateFromKey(data.habitStartedAt[index]) : bounds.start;
  const trackingStart = configuredStart > bounds.start ? configuredStart : bounds.start;
  const today = atNoon(todayInput);
  const quarterDays = Math.round((bounds.end - bounds.start) / 86400000) + 1;
  const quarterDay = today < bounds.start ? 0 : today > bounds.end ? quarterDays : Math.round((today - bounds.start) / 86400000) + 1;
  let effectiveEnd = bounds.end;
  if (year > today.getFullYear() || (year === today.getFullYear() && trackingStart > today)) effectiveEnd = new Date(trackingStart.getTime() - 86400000);
  else if (year === today.getFullYear() && today < bounds.end) effectiveEnd = today;
  const days = [];
  if (effectiveEnd >= trackingStart) {
    for (let day = atNoon(trackingStart); day <= effectiveEnd; day.setDate(day.getDate() + 1)) {
      const key = ymdKey(day);
      days.push({ key, date: atNoon(day), done: habitChecked(data, key, index) });
    }
  }
  const done = days.filter(day => day.done).length;
  const missed = Math.max(0, days.length - done);
  let current = 0;
  let longest = 0;
  for (const day of days) {
    current = day.done ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return {
    start: bounds.start,
    trackingStart,
    end: bounds.end,
    days,
    done,
    missed,
    longest,
    percent: days.length ? Math.round(done / days.length * 100) : 0,
    elapsed: days.length,
    quarterDay,
    quarterDays
  };
}

/**
 * Horizon in a few words, for the phone's Horizon tab (pure). `model` is
 * buildHorizonModel() of the current year: "Today" when something on the year
 * starts today, else the next start ("Next 14 Nov"), else the days left in the
 * year ("71 days left"). Periods already under way don't hide what comes next.
 */
export function horizonTabLine(model) {
  if (!model?.isCurrentYear) return '';
  const upcoming = Array.isArray(model.upcoming) ? model.upcoming : [];
  if (upcoming.some(event => event.startDate === model.todayKey)) return 'Today';
  const next = upcoming.find(event => event.startDate > model.todayKey);
  if (next) return `Next ${rangeLabel(next.startDate)}`;
  const left = model.daysInYear - model.dayOfYear;
  return left > 0 ? `${left} ${left === 1 ? 'day' : 'days'} left` : 'Last day of the year';
}
