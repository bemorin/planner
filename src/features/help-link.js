/**
 * /?help: the planner opens with “How it works” (the Help dialog) on screen.
 * The Contact page's “Help in the planner” leads here.
 *
 * Read once, as the planner loads (app.js, on the frame first-run setup is
 * handled), then taken out of the address
 * (history.replaceState) so a reload, a bookmark or the installed app's
 * next start opens the planner as usual.
 *
 * - A first run: first-run setup shows, then the planner tour, which ends on
 *   “How it works” itself. Help is not added on top of either: it would only
 *   make a newcomer close one more dialog before the tour.
 * - Otherwise Help opens, on the same frame, before the planner's
 *   entrance plays its first frame: the entrance finds a dialog open and
 *   steps aside (src/features/app-entrance.js), the planner simply appears.
 */

export const HELP_PARAM = 'help';

/** True when the address asks for How it works on launch (?help, with or without a value). */
export function asksForHelp(search = '') {
  try { return new URLSearchParams(search || '').has(HELP_PARAM); } catch (_) { return false; }
}

/** The address without ?help, as a path for history.replaceState (the rest of the query and the hash stay). */
export function addressWithoutHelp(href) {
  const url = new URL(href);
  url.searchParams.delete(HELP_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * What /?help does on this launch: 'help' (Help opens), 'setup' (first-run
 * setup comes first, then the tour: no Help) or 'none' (no ?help).
 */
export function helpOnLaunch(search, { firstRun = false } = {}) {
  if (!asksForHelp(search)) return 'none';
  return firstRun ? 'setup' : 'help';
}

/**
 * Handles ?help once, as the planner loads: takes it out of the address and,
 * when helpOnLaunch says so, calls `open` (which opens the Help dialog).
 * Returns what helpOnLaunch decided.
 */
export function openHelpFromAddress({ open, firstRun = false, location = globalThis.location, history = globalThis.history } = {}) {
  const outcome = helpOnLaunch(location?.search || '', { firstRun });
  if (outcome === 'none') return outcome;
  try { history.replaceState(history.state, '', addressWithoutHelp(location.href)); } catch (_) {}
  if (outcome === 'help') open?.();
  return outcome;
}
