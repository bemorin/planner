export const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export function atNoon(input) {
  const copy = new Date(input);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

export function ymdKey(input) {
  const date = new Date(input);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateFromKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  return atNoon(new Date(year || 1970, Math.max(0, (month || 1) - 1), day || 1));
}

export function addDaysKey(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return ymdKey(date);
}

export function daysBetweenKeys(fromKey, toKey) {
  return Math.round((dateFromKey(toKey) - dateFromKey(fromKey)) / 86400000);
}
