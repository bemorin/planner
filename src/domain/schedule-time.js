import { addDaysKey, ymdKey } from '../lib/dates.js';
import { clamp } from '../lib/utils.js';

export function elapsedMinutesForDate(block, dayDate, now = new Date()) {
  const today = ymdKey(now);
  const current = ymdKey(dayDate);
  if (current < today) return block.duration;
  if (current > today) return 0;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes <= block.start) return 0;
  return clamp(nowMinutes - block.start, 0, block.duration);
}

export function durationLabel(minutes) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function padHour(hour) {
  return hour === 24 ? '24' : pad2(hour);
}

export function time(minutes) {
  const safe = clamp(Math.round(minutes), 0, 24 * 60);
  if (safe === 24 * 60) return '24:00';
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

export function clockTime(minutes) {
  const wrapped = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

export function parseTimeValue(raw) {
  const clean = String(raw || '').trim().replace('.', ':');
  let hour;
  let minute;
  if (/^\d{1,2}$/.test(clean)) {
    hour = Number(clean);
    minute = 0;
  } else if (/^\d{3,4}$/.test(clean)) {
    const padded = clean.padStart(4, '0');
    hour = Number(padded.slice(0, 2));
    minute = Number(padded.slice(2));
  } else {
    const match = clean.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return null;
    hour = Number(match[1]);
    minute = Number(match[2]);
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function blockEndDateKey(block, fallbackDateKey) {
  if (block?.endDate) return block.endDate;
  const startDate = block?.startDate || fallbackDateKey;
  return addDaysKey(startDate, Math.floor(((block?.start || 0) + (block?.duration || 0)) / (24 * 60)));
}

export function blockTimeRange(block, fallbackDateKey) {
  const startDate = block?.startDate || fallbackDateKey;
  const endDate = blockEndDateKey(block, fallbackDateKey);
  const end = (block?.start || 0) + (block?.duration || 0);
  const suffix = endDate !== startDate ? ' +1d' : '';
  return `${clockTime(block?.start || 0)}–${clockTime(end)}${suffix}`;
}
