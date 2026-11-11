# Architecture

Daily Planner is intentionally a small-runtime, local-first web application. The production app uses native HTML, CSS, JavaScript modules, browser storage, and PWA APIs. There is no runtime framework and no server-side planner database.

The main engineering constraint is stronger than “keep it simple”: **a code-quality change must not silently change planner behavior**. The application has a dense interaction surface—dragging, resizing, cross-day moves, linked tasks/outcomes, close-day transfers, Horizon date ranges, responsive layouts, and local persistence—so refactors are deliberately incremental.

## Runtime map

```text
index.html
  ↓
runtime-config.js        optional owner links; blank in public source
  ↓
app.js                   application coordinator and shared interaction shell
  ├─ src/config.js
  ├─ src/domain/
  │   ├─ note-lines.js
  │   ├─ planning-calendar.js
  │   └─ schedule-time.js
  ├─ src/lib/
  │   ├─ dates.js
  │   ├─ dom.js
  │   ├─ text.js
  │   └─ utils.js
  ├─ src/state/
  │   └─ local-store.js
  ├─ src/sync/
  │   ├─ cloud.js          the provider interface both clouds answer, PKCE helpers
  │   ├─ document.js
  │   ├─ dropbox.js        Dropbox app folder, OAuth with PKCE, refresh tokens (1.38)
  │   ├─ engine.js
  │   ├─ google-drive.js
  │   ├─ hash.js
  │   ├─ key-store.js      the sealed copy's key on this device (IndexedDB, non-extractable)
  │   ├─ ledger.js
  │   ├─ merge.js
  │   ├─ protection.js     the seal between engine and cloud: create, enter, migrate a plain copy
  │   ├─ records.js
  │   ├─ recovery-store.js
  │   └─ seal.js           PBKDF2-SHA-256 + AES-256-GCM envelope of the synced copy
  ├─ src/ui/
  │   ├─ calendar-popover.js
  │   ├─ motion.js         animation presets; no-ops under reduced motion
  │   └─ theme.js          per-device System / Light / Dark preference
  ├─ src/vendor/
  │   └─ motion.js         vendored Motion (mini animate, stagger, spring)
  └─ src/features/
      ├─ fit.js
      ├─ horizon-model.js
      ├─ horizon-view.js     Horizon sections, overview ribbon, Add chooser
      ├─ personal-sync.js
      ├─ personal-sync-view.js  Personal sync's states, copy and passphrase forms (pure)
      ├─ sync-status.js     Personal sync's header alert and popover, from getState() / subscribe()
      ├─ pip-styles.js      Picture-in-Picture stylesheet (injected into the floating window)
      ├─ pip-window.js      Picture-in-Picture: Focus, Plan and Schedule, day-by-day navigation, sync with the main window
      ├─ print.js
      ├─ search.js
      ├─ stats.js
      ├─ week-review.js
      ├─ week.js
      ├─ workspace.js
      ├─ year-plan.js       Plan your year: the guided session that sets up Horizon, then prints it
      ├─ year-print.js      the year on one landscape page
      ├─ quarter-review.js  the quarterly check-in (with quarter-session.js and quarter-print.js)
      ├─ year-review.js     your year in review, on one printable page
      ├─ insights.js        Insights (insights-model.js derives, insights-view.js draws)
      └─ paint-palettes.js  the palettes of the painted year
```

`app.js` is still the coordinator for cross-feature state and lifecycle. It is intentionally divided into named sections so a reader can navigate it without relying on incidental line numbers:

1. runtime state and date helpers;
2. day state and settings persistence;
3. primary Day rendering;
4. schedule rendering and block interaction;
5. notes editors and checklist syntax;
6. block editor;
7. categories, settings, install prompt, and onboarding;
8. stats, modal primitives, popovers, and live-time behavior;
9. navigation, responsive layout, search, and storage utilities;
10. close-day workflow and carry-forward logic;
11. Horizon / Year map;
12. Journal and Unresolved work;
13. export, Picture-in-Picture, mobile shell, help, and bootstrap bindings.

Large feature extractions are only accepted one domain at a time. A refactor is not considered successful merely because it parses or builds; `npm run verify` must continue to pass before the next extraction.

## CSS ownership

`styles.css` is only a coordinator. Source styles live in domain files:

```text
styles/
├─ core.css        shell, typography, common controls, modals
├─ schedule.css    Day schedule and time blocks
├─ week.css        Week schedule
├─ stats.css       Time statistics
├─ pip.css         Picture-in-Picture trigger/support UI
├─ settings.css    settings-specific UI
├─ horizon.css     Horizon / Year map
├─ workspace.css   optional Personal / Enterprise workspace shell
├─ theme.css       dark tokens, Appearance control, motion hand-off, focus rings
└─ print.css       print-only output
```

Dark mode is token-based: `theme.css` redefines the `:root` colour tokens for `prefers-color-scheme: dark` (unless the visitor chose Light) and for an explicit `data-theme="dark"`. Both are scoped to `@media screen`, so printed pages keep the light print stylesheet. New components should use the tokens rather than literal colours.

The production build concatenates them in the order declared by `styles.css`. That order is part of the current cascade contract and should not be changed casually.

The screen cascade intentionally uses a single `!important`: `[hidden] { display: none !important; }`, which protects the semantic `hidden` contract from component rules. The remaining `!important` declarations live in `print.css`, where they isolate deterministic print output from the interactive screen cascade. New screen styles should not introduce additional `!important` declarations.

## Data model

Planner data is stored locally first. The working planner records live in `localStorage`; optional recovery snapshots use IndexedDB; optional Personal sync mirrors the current Personal sync document, sealed with the person's passphrase (1.38), to their own Google Drive app-data space or Dropbox app folder.

- `daily-planner:settings` stores categories, visible hours, planning days, onboarding state, Unresolved work, and Horizon data.
- `daily-planner:YYYY-MM-DD` stores one day.

A day contains, in broad terms:

```text
focus
priorities[3]
tasks[]
notes
blocks[]
endedAt
carriedForward[]
memory
lesson
triaged[]
closeTransfers[]
```

Normalization happens when data is loaded so older local records can continue to work as fields evolve.


## Personal sync invariants

Personal sync does not turn Google Drive into the runtime database. The local planner remains usable before, during, and after sync.

Local mutations always commit to `localStorage` first. When Google Drive is connected, dirty records are batched and uploaded opportunistically after a short idle pause, with a maximum wait so work does not remain unsynced indefinitely — but only while a usable Google access token already exists (kept on the device until it runs out, an hour after it was given: `daily-planner-sync:google-access`, never in a backup, an export or the synced copy). Automatic sync never calls Google Identity Services `requestAccessToken()` and therefore never opens OAuth UI. Returning to the app, regaining connectivity, closing the day, and **Sync now** (with a usable token) are additional sync points. **Connect** / **Reconnect** (and the header alert's **Reconnect and save**, `src/features/sync-status.js`) are the only interactive authorization gestures. Each calls `requestAccessToken()` within the tap, before anything is awaited, once Google Identity Services has loaded. The script starts loading when the person shows intent (Google Drive chosen in Settings, its Connect button pressed or focused) or opens Settings while connected, never before; a load that failed offline is not retried until the `online` event. A tap that comes while it still loads asks for Google's window as soon as it has loaded, which a browser may block: the planner then asks calmly for one more tap, which opens it at once. There is no continuous polling and no write-after-every-edit to Drive.

The first protocol uses stable top-level record boundaries:

```text
settings
day:YYYY-MM-DD
```

For each record, the client keeps the content hash last confirmed on both sides. A sync compares that base hash with the current local and remote hashes. Local-only changes are pushed, remote-only changes are pulled, identical changes are accepted, and divergent concurrent changes stop as a conflict instead of silently picking a winner.

Those bases belong to one copy (1.38). The sealed document carries a random `copyId`, made anew when a copy is first sealed or started over (**Forgot it?**) and kept by a change of passphrase; the ledger stores the one its bases were agreed on with. A device that finds another copy resets its bases first, as a switch of cloud does, so whatever differs stops as a conflict the person settles and only identical records are agreed on silently (`sameCopy()` in `src/sync/ledger.js`).

Deletions are represented as tombstones in the local sync ledger so a deleted day cannot reappear merely because another device still has an older copy. Before remote changes are applied, the client attempts to keep a small rolling recovery snapshot in IndexedDB.

Google Drive and Dropbox (1.38) are only transport adapters with the same small interface (`src/sync/cloud.js`: `readText()` / `writeText()` of one file, `hasUsableToken()`, `clearToken()`, and their sign-in). The seal (`src/sync/protection.js`) turns that file into the sync document the engine merges, so the engine is provider-independent and OneDrive or another Personal transport can join later. Dropbox signs in by a visit to its page that comes back to the planner with `?code=…&state=…` (PKCE, no secret), and keeps a refresh token on the device, so its automatic sync never needs a tap. Details: [`docs/PERSONAL_SYNC.md`](docs/PERSONAL_SYNC.md).

## Schedule invariants

Day and Week are two views over the same schedule data. They must not maintain independent copies of blocks.

Important invariants:

- block times are stored in minutes from midnight;
- movement and resizing snap to the planner interval;
- blocks can cross midnight through `startDate` / `endDate`;
- linked tasks/outcomes stay synchronized with their scheduled block;
- moving a Week block to another day persists it into the destination day state;
- current-time visuals are presentation state, not persisted state.

## Horizon invariants

Horizon separates **calendar scope** from **tracking scope**.

A Winning Habit belongs to an entire quarter visually, even when tracking starts after the first day of that quarter. The quarter bounds therefore remain fixed while statistics use `habitStartedAt` as the tracking start.

Misogi, Mini-adventures, and Key dates use date or date-range data but remain distinct domain objects.

## Close-day invariants

Close day is a transition, not a destructive cleanup operation.

For each unresolved candidate, the user can:

- schedule it on a date;
- keep it in Unresolved without a date;
- drop it from active work.

Transfers created by a close are recorded so reopening the day can reverse that close before another close is performed.

## Rendering and persistence

The app currently uses direct DOM rendering rather than a virtual DOM. This keeps runtime weight extremely low but makes ordering important:

1. normalize/load state;
2. render the affected view;
3. bind or refresh view-local interactions;
4. persist only user state, never transient UI state.

Feature modules receive explicit callbacks/context from `app.js` rather than importing mutable application state directly. New modules should follow the same rule.

## Motion policy

Motion is a presentation layer, never a state transition. `src/ui/motion.js` exposes a handful of presets (dialog enter/exit, popover, panel change, list item enter/exit, height toggle, indicator slide). Each one resolves when the animation settles, clears the inline styles it wrote, and does nothing when the system prefers reduced motion or the browser lacks the Web Animations API. While Motion is active the root carries `has-motion`, which removes the CSS transitions of the components it animates (CSS transitions outrank Web Animations in the cascade). Animate only where movement explains something — arrival, change of place, addition or removal — and keep exits shorter than entrances.

## Horizon view

`src/features/horizon-view.js` renders only the active Horizon section and binds its interactions; `app.js` still owns year-data normalization, persistence and the shared Horizon popovers, and passes them in through an explicit context object. `buildHorizonModel()` is a pure derivation (events, upcoming items, per-section progress) and is unit-tested.

## Progress, setup and owner API

`src/features/progress-model.js` is a pure derivation of the painted year, the streak (planning days only, two jokers a month, today pending until closed) and the trophies from saved days and Horizon data; it is unit-tested and memoised briefly by `app.js`. `progress-view.js` renders it for Horizon, the Overview card and the Close-day summary.

First-run setup (`onboarding.js`), the install dialog (`install.js`), the sync guide and its waitlist for account sync (`sync-guide.js`), versioned feedback (`feedback.js`, asked once per feature release with the notes in `whats-new.js`) and the sponsor moment (`sponsor-moment.js`, once after ten closed days when `GITHUB_SPONSOR_URL` is set, with a recap counted on the device) are self-contained features that receive their dependencies from `app.js`. `day-summary.js` computes, without touching the DOM, what the Day · Week · Horizon navigation and the phone Plan · Schedule · Horizon tabs (`view-switch.js`), the week heads and the phone week agenda (`week-agenda.js`) say about each day. Every menu in the planner is one listbox component (`src/ui/listbox.js`); a second click on the button of any open popover closes it (`src/ui/popover-trigger.js`), and the public pages' top bar opens its section links as a menu below 960px (`welcome/top-menu.js`).

The yearly ritual is part of the planner for everyone, with no gate: Plan your year (`year-plan.js`, which sets up Horizon in a guided session and ends with `year-print.js`), the quarterly check-in (`quarter-review.js`, `quarter-session.js`, `quarter-print.js`), your year in review (`year-review.js`), Insights (`insights.js`) and the palettes of the painted year (`paint-palettes.js`). They live inside Horizon and Stats, read the same saved days and Horizon data, and keep what they write in the planner's settings, so backups and Personal sync carry it. Keys that earlier versions kept for a paid add-on are removed once, quietly, when the planner starts (`src/state/retired-keys.js`).

`src/lib/planner-api.js` is the only client of the optional owner API and does nothing while `PLANNER_API_URL` is blank. The API itself lives in `server/planner-api.js` (a fetch-style router with a pluggable store: anonymous counts, feedback and reviews, the Contact page's questions, the waitlist, CSP reports and the owner's routes), served by `functions/api/[[path]].js` on Cloudflare Pages with D1 (`server/d1-store.js`, whose fresh-install schema is `migrations/schema.sql`) and by `scripts/serve.mjs` locally with a JSON file. The owner dashboard is static (`admin/`); it exchanges the admin token and an optional TOTP code for a signed 8-hour session (`server/admin-auth.js`) and reads the API with it. `src/features/privacy.js` builds the Privacy notice from the configuration, so it appears exactly when something is sent. The public pages — the landing page (`welcome/`), the Contact page (`contact/`) and the legal pages (`legal/`) — are separate static pages that import `src/config.js`, `src/lib/planner-api.js`, the vendored Motion and two small helpers (`src/lib/text.js`, `src/ui/dialog-focus.js`), and nothing else from the planner; the landing page's project links (source code, GitHub Sponsors) show only when the runtime configuration sets them. See [`docs/FEEDBACK_AND_WAITLIST.md`](./docs/FEEDBACK_AND_WAITLIST.md).

## Safety boundaries

User-authored text inserted into HTML templates must pass through the existing escaping helpers. URLs are normalized before being exposed as links.

Every response of the site carries the security headers of `_headers` (its `/*` rule, 1.35): a Content-Security-Policy that runs scripts only from the site itself, Google's sign-in (`accounts.google.com`, loaded on Connect) and Cloudflare Web Analytics' beacon, plus the few inline `<head>` scripts by their SHA-256 hash; requests go only to the site, the Drive API, Google's sign-in, Dropbox's API and file transfers (1.38) and Cloudflare's analytics. No inline event handler, `javascript:` address or `eval` can run; styles may be inline. Frames: Google's sign-in only, and the site is framed by itself only (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`). HSTS for two years (subdomains, no preload), `nosniff`, `strict-origin-when-cross-origin`, a Permissions-Policy without camera, microphone, geolocation, payment or USB, and `Cross-Origin-Opener-Policy: same-origin-allow-popups` so Google's sign-in window reports back.

`scripts/check.mjs` recomputes the hash of every inline script that runs in every published page (`scripts/csp.mjs`; JSON-LD is data) and fails unless `script-src` lists exactly those: change a head script and its hash in the same commit. `scripts/serve.mjs` sends the same rules (`scripts/headers.mjs`), so a page breaks locally exactly as it would in production. A new outside service needs its address in the policy first. Head scripts that send an old address on (`/welcome/?ask=…`, `/admin` → `/admin/`) build it with `new URL(…, location.href)` and follow it only on the same origin.

The public runtime configuration deliberately contains no owner-specific social or repository URLs. Production builds may inject them through environment variables without changing source files. Optional `CLOUD_API_URL`, `GOOGLE_CLIENT_ID` and `PLANNER_API_URL` values may also be injected. When the Google client ID is absent, Personal sync renders nothing and makes no Google request; when the cloud API URL is absent, the workspace feature makes no organization request; when the planner API URL is absent, no count, waitlist or feedback request is made.

## Build and release verification

```bash
npm run verify
```

runs, in order:

1. static lint guards and JavaScript parsing;
2. repository formatting checks;
3. repository/module/license checks, and the CSP's script hashes against the published pages;
4. unit tests for pure/domain logic;
5. a no-regression quality gate against the validated runtime baseline;
6. the production build;
7. a Chromium smoke test that boots the actual application modules in a browser engine and exercises Day, Week, the core modals, Fit mode, Export, Week drag/resize, and the post-close weekly review.

The smoke test is dependency-free but requires Chrome or Chromium. Set `CHROME_BIN` when the browser is not in a standard location.

The build (`scripts/build.mjs`) publishes the site only, as `scripts/published.mjs` lists it: the root pages and icons, `THIRD_PARTY_NOTICES.md` (the legal notice links to it), `assets/`, `admin/`, `welcome/`, `contact/`, `legal/` and `src/`, plus the `runtime-config.js` and the one `styles.css` it writes, `_headers` and `_redirects`. The repository's documents — `docs/`, this file, the README, CONTRIBUTING, SECURITY, the CHANGELOG and LICENSE — stay on GitHub (1.35).

## Refactoring policy

A code-quality PR should obey three rules:

1. **one extraction at a time**;
2. **no mixed UX changes** unless the PR is explicitly a product change;
3. **behavioral equivalence is a deliverable**, not an assumption.

The current cleanup strategy is to shrink the coordinator only through small pure/domain extractions with explicit inputs and tests. Event binding, modal lifecycle, and cross-feature orchestration stay in `app.js` until a feature boundary can be extracted without changing initialization order.

Current examples are planning-calendar rules, schedule-time formatting, and note-line parsing. Each was moved independently and covered by unit tests before the next extraction.

## Cloud service boundary

Shared, organization-level functionality is intentionally outside the Personal planner runtime: if it is ever built, a separate service owns the server-side organization model, authentication and shared organization data. Personal sync is different: the client synchronizes directly with the user's own cloud storage through a provider adapter, without routing Personal planner data through any Daily Planner server. The client boundary remains deliberately small: if `/v1/me` exposes organizations, the UI can reveal a workspace selector; Personal remains the default private planner and organization selection never reuses Personal data as shared data.

The proposed boundary is described in [`docs/CLOUD_BOUNDARY.md`](./docs/CLOUD_BOUNDARY.md).
