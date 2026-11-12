import { GITHUB_SPONSOR_URL, PROJECT_GITHUB_URL } from '../config.js';

/**
 * What this feature release changes for the people who use the planner —
 * shown once per release with the feedback prompt, and whenever feedback is
 * opened from Help or the menu. Keep it to 3–5 short, concrete lines, and
 * update `version` (major.minor) with each feature release (or name the release in QUIET_RELEASES); small fixes
 * (1.22.1, 1.22.2…) keep the same note and are never asked about again.
 */

const https = value => /^https:\/\/[^\s"'<>]+$/.test(String(value || '').trim());

/**
 * The 1.39 lines for this copy: the code on GitHub is named only when
 * PROJECT_GITHUB_URL is set, and GitHub Sponsors only when GITHUB_SPONSOR_URL
 * is, so every line stays true wherever the planner is deployed.
 */
export function whatsNewItems({ repo = PROJECT_GITHUB_URL, sponsor = GITHUB_SPONSOR_URL } = {}) {
  return Object.freeze([
    'Everything is free now: Plan your year, the quarterly check-ins, your year in review, Insights and the palettes are part of the planner for everyone.',
    https(repo) ? 'Daily Planner is open source (MIT), with its code on GitHub.' : 'Daily Planner is open source (MIT).',
    'Your plans, check-ins and colours carry over as they are, with nothing to set up again.',
    ...(https(sponsor) ? ['You can support it on GitHub Sponsors.'] : [])
  ]);
}

export const WHATS_NEW = Object.freeze({
  version: '1.39',
  items: whatsNewItems()
});

/**
 * Feature releases with no note of their own, because nearly nobody sees what they change: WHATS_NEW stays an
 * earlier release's, which feedback.js then never shows on them, and asks about as that release (feedbackRelease():
 * nobody who answered about it is asked again about a release they can't see). 1.40 moves older
 * days to this browser's database once room is needed, which nobody with less than about two years of plans meets.
 */
export const QUIET_RELEASES = Object.freeze(['1.40']);
