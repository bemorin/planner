/**
 * Pure helpers for the landing page (/welcome/): the year its yearly ritual
 * is about, the small months of its printed year map, and the moments it
 * counts, for its privacy notice. No DOM here, so tests can import it
 * directly.
 */

/**
 * The moments the landing page sends, by name: its visit and a click on
 * “Open the planner” (landing.js). The privacy notices list exactly these
 * (landingMoments), so they never name a moment the page can't send.
 */
export const LANDING_COUNTED = Object.freeze(['landing_viewed', 'landing_cta_app']);

/**
 * The counted moments the landing page sends, from the API client's list
 * (LANDING_EVENTS in src/lib/planner-api.js: [[name, words], …]), in its
 * order: only those in LANDING_COUNTED, and only those the client counts.
 */
export const landingMoments = events => (Array.isArray(events) ? events : []).filter(entry => LANDING_COUNTED.includes(entry?.[0]));

/**
 * The year the yearly ritual is about (plan it, print it, look back): from
 * 1 October on the next one (October 2026 → 2027), before that this one.
 */
export function ritualYear(date = new Date()) {
  const day = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return day.getMonth() >= 9 ? day.getFullYear() + 1 : day.getFullYear();
}

/**
 * One small month of the printed year map, in weeks of seven starting on
 * `weekStartsOn` (1 = Monday): day numbers, with null before the 1st and
 * after the last day.
 */
export function monthWeeks(year, month, weekStartsOn = 1) {
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (new Date(year, month, 1).getDay() - weekStartsOn + 7) % 7;
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/** The plain words of each counted moment, once each, in order (for the privacy notice). */
export const countedMoments = events => [...new Set((Array.isArray(events) ? events : []).map(entry => String(entry?.[1] || '').trim()).filter(Boolean))];
