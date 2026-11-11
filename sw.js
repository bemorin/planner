const CACHE = 'daily-planner-1.39.0';
const CORE = [
  './', './index.html', './styles.css', './runtime-config.js', './app.js', './manifest.webmanifest',
  './favicon.svg', './favicon.ico', './apple-touch-icon.png', './pwa-192.png', './pwa-512.png',
  './src/config.js', './src/domain/note-lines.js', './src/domain/planning-calendar.js', './src/domain/schedule-time.js', './src/lib/dom.js', './src/lib/dates.js', './src/lib/text.js', './src/lib/utils.js',
  './src/features/day-swipe.js', './src/features/fit.js', './src/features/horizon-model.js', './src/features/horizon-view.js', './src/features/pip-date-picker.js', './src/features/pip-styles.js', './src/features/pip-window.js', './src/features/print.js', './src/features/search.js', './src/features/settings-schedule.js', './src/features/stats.js', './src/features/week-review.js', './src/features/week.js', './src/features/workspace.js', './src/features/personal-sync.js', './src/features/personal-sync-view.js', './src/features/sync-status.js',
  './src/features/progress-model.js', './src/features/progress-view.js', './src/features/onboarding.js', './src/features/install.js', './src/features/sponsor-moment.js', './src/features/sync-guide.js', './src/features/feedback.js', './src/features/privacy.js', './src/features/category-manager.js', './src/features/year-print.js', './src/features/year-plan.js', './src/features/year-review.js', './src/features/quarter-review.js', './src/features/quarter-session.js', './src/features/quarter-print.js', './src/features/paint-palettes.js', './src/features/whats-new.js', './src/features/tour.js', './src/features/tour-model.js', './src/features/first-use.js', './src/features/first-use-model.js', './src/features/day-summary.js', './src/features/view-switch.js', './src/features/app-entrance.js', './src/features/opening-seal.js', './src/first-visit.js', './src/features/help-link.js', './src/features/back-button.js', './src/features/week-agenda.js', './src/features/share-image.js', './src/features/share-dialog.js', './src/features/insights.js', './src/features/insights-model.js', './src/features/insights-view.js', './src/lib/planner-api.js',
  './src/state/local-store.js', './src/state/browser-storage.js', './src/state/day-state.js', './src/state/settings-state.js', './src/state/planner-backup.js', './src/state/retired-keys.js', './src/sync/cloud.js', './src/sync/document.js', './src/sync/dropbox.js', './src/sync/engine.js', './src/sync/google-drive.js', './src/sync/hash.js', './src/sync/key-store.js', './src/sync/ledger.js', './src/sync/merge.js', './src/sync/protection.js', './src/sync/records.js', './src/sync/recovery-store.js', './src/sync/scheduler.js', './src/sync/seal.js', './src/ui/calendar-popover.js', './src/ui/dialog-focus.js', './src/ui/back-stack.js', './src/ui/listbox.js', './src/ui/motion.js', './src/ui/theme.js', './src/ui/tooltip.js', './legal/legal-details.js', './src/vendor/motion.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Offline, a navigation that isn't in the cache: the planner's own address
// (this worker's scope, its index.html, with any query: ?help, ?start…)
// opens the planner from its offline copy. Any other page of the site that was
// never opened here (/welcome/, /contact/, /legal/…) gets
// offlinePage(), never the planner's index.html at the wrong address.
function opensPlanner(url, scope) {
  const root = new URL(scope).pathname;
  return url.pathname === root || url.pathname === `${root}index.html`;
}

// A small page of its own: the planner's paper and ink, light or dark as the
// device is, a way back to the planner and a way to try again.
function offlinePage(scope) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>You’re offline · Daily Planner</title>
<style>
:root { --paper: #f6f3ed; --ink: #1c1a17; --muted: #706a62; --line: #c7c0b6; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --paper: #151412; --ink: #ece8e1; --muted: #a9a198; --line: #48433c; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--paper); color: var(--ink); font: 16px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 420px; }
p { margin: 0 0 12px; color: var(--muted); }
.eyebrow { margin-bottom: 8px; font-size: .78rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
h1 { margin: 0 0 12px; font-size: 1.45rem; font-weight: 650; line-height: 1.25; letter-spacing: -.01em; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
a { display: inline-flex; align-items: center; min-height: 40px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font-size: .9rem; font-weight: 600; text-decoration: none; }
a.primary { border-color: var(--ink); background: var(--ink); color: var(--paper); }
a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
</head>
<body>
<main>
<p class="eyebrow">Daily Planner</p>
<h1>You’re offline</h1>
<p>This page needs a connection, and this device hasn’t kept a copy of it yet.</p>
<p>Your planner works without one: everything you plan is saved in this browser.</p>
<div class="actions"><a class="primary" href="${scope}">Open your planner</a><a href="">Try again</a></div>
</main>
</body>
</html>
`;
  return new Response(html, { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Never touched: the API (feedback, waitlist, counts) and the owner dashboard.
const UNTOUCHED = ['/api/', '/admin/'];

// What may be kept for offline use: same-origin answers without a query. An
// address with one may carry something meant to be read once (a sign-in's
// answer, say): never stored here. Offline, such a navigation still finds its
// page without the query.
function keepable(url) {
  return !url.search && !UNTOUCHED.some(path => url.pathname.includes(path));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (UNTOUCHED.some(path => url.pathname.includes(path))) return;

  event.respondWith(
    fetch(request).then(response => {
      // Cloned now, before the page reads the body: a clone made later finds it used.
      if (response.ok && keepable(url)) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const scope = self.registration.scope;
        return (opensPlanner(url, scope) && await caches.match('./index.html')) || offlinePage(scope);
      }
      throw new Error('Offline and not cached');
    })
  );
});
