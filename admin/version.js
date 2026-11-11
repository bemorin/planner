// Which dashboard is deployed, and whether this page is it. The owner API
// reports the release it was deployed with (admin summary `version`); admin.js
// carries its own. When they differ, the browser or Cloudflare served this
// page's files from an old cache, and the dashboard says so with a Reload
// button. Pure helpers, unit-tested (tests/admin-version.test.js).

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** -1, 0 or 1 for two MAJOR.MINOR.PATCH versions; NaN when either is not one. */
export function compareVersions(a, b) {
  const left = VERSION_RE.exec(String(a ?? '').trim());
  const right = VERSION_RE.exec(String(b ?? '').trim());
  if (!left || !right) return Number.NaN;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/**
 * What the page says about the deployed version: null when it matches, or
 * when the API does not report one (an API from before 1.25.0). `retried`: the
 * page already reloaded for that version and is still not it, so the
 * remaining cache is most likely Cloudflare's.
 */
export function versionNotice(pageVersion, serverVersion, { retried = false } = {}) {
  const order = compareVersions(serverVersion, pageVersion);
  if (Number.isNaN(order) || order === 0) return null;
  const server = String(serverVersion).trim();
  const page = String(pageVersion).trim();
  return {
    kind: order > 0 ? 'newer' : 'older',
    server,
    page,
    title: order > 0 ? `A newer dashboard (${server}) is deployed.` : `The deployed dashboard is ${server}, older than this page.`,
    action: order > 0 ? 'Reload to get it.' : 'Reload to match it.',
    detail: `This page is version ${page}.`,
    hint: retried ? 'Still the old one after reloading? In Cloudflare, open your domain → Caching → Configuration and choose Purge Everything, then reload.' : ''
  };
}

/** The page address with ?v=<version>: a new address, so no cached copy of the page can answer it. */
export function reloadUrl(href, version) {
  const url = new URL(href);
  url.searchParams.set('v', String(version));
  return url.href;
}

/** The ?v= a reload added, and the address without it (put back in the address bar once read). */
export function readReloadMark(href) {
  const url = new URL(href);
  const version = url.searchParams.get('v') || '';
  url.searchParams.delete('v');
  return { version: VERSION_RE.test(version) ? version : '', cleanUrl: url.href };
}
