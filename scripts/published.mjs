/**
 * What the site publishes. scripts/build.mjs copies these into dist/ (and
 * writes runtime-config.js and the one styles.css there); scripts/check.mjs
 * checks the inline scripts of their pages against the CSP in _headers.
 *
 * The repository's own documents are not published: docs/, the README,
 * ARCHITECTURE, CONTRIBUTING, SECURITY, TRADEMARKS, the CHANGELOG and LICENSE
 * are read on GitHub (the build variable DAILY_PLANNER_GITHUB_URL links there),
 * never served by the site, and neither is .github/ (the repository's
 * workflows). THIRD_PARTY_NOTICES.md is, as the legal notice links to it (the
 * Motion licence it reproduces must travel with the vendored copy).
 *
 * The Teams and partners pages (teams/, partners/, partners/statement/) are
 * gone since 1.39, when Daily Planner became free: _redirects sends their
 * addresses to /welcome/ for good, and no published page links to them
 * (tests/published.test.js, scripts/smoke.mjs).
 */

/** Files at the root of the repository, copied as they are. */
export const PUBLISHED_FILES = ['index.html', 'app.js', 'sw.js', 'manifest.webmanifest', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'THIRD_PARTY_NOTICES.md'];

/** Folders copied whole. */
export const PUBLISHED_FOLDERS = ['assets', 'admin', 'welcome', 'contact', 'legal', 'src'];

/** Pages the site had and no longer has (1.39): their addresses are redirects (_redirects). */
export const RETIRED_FOLDERS = Object.freeze(['teams', 'partners']);

/** Kept out of dist/ on purpose (tests/published.test.js; scripts/smoke.mjs checks the build). */
export const UNPUBLISHED = ['docs', 'migrations', '.github', 'README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'TRADEMARKS.md', 'CHANGELOG.md', 'LICENSE', 'OWNER_NOTES.md'];

// API routes that share a name with a retired page are not links to it: /api/teams (the Contact page's former
// address for questions, kept for one release) and a client's own call to it.
const API_NAMES = [/\/api\/teams\b/g, /\$\{PLANNER_API_URL\}\/teams\b/g];

/**
 * Every address in `text` that leads to a retired page: ./teams/, ../partners/, /teams,
 * https://planner.bemorin.com/partners/statement/, /welcome/teams/… — never a module named after one
 * (teams-model.js), an API route, or a word. Used by tests/published.test.js on what the build publishes, and
 * by scripts/smoke.mjs on dist/ itself.
 */
export function retiredReferences(text, folders = RETIRED_FOLDERS) {
  if (!folders.length) return [];
  let rest = String(text ?? '');
  for (const pattern of API_NAMES) rest = rest.replace(pattern, '');
  const names = folders.join('|');
  const address = new RegExp(`(?<![\\w-]/)(?<![\\w.-])(?:\\.{1,2}/)*/?(?:welcome/)?(?:${names})/|(?<![\\w.-])/(?:welcome/)?(?:${names})(?![\\w-])|\\.(?:com|dev|test|localhost)(?::\\d+)?/(?:welcome/)?(?:${names})(?![\\w-])`, 'g');
  return [...rest.matchAll(address)].map(match => match[0]);
}
