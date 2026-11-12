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
  │   ├─ local-store.js    never throws; reports every write's result (onWrite)
  │   ├─ day-store.js      local-store's calls over two homes: recent days in localStorage, older ones in IndexedDB (1.40)
  │   ├─ day-archive.js    the older days' IndexedDB (`daily-planner-archive`), and its twin in memory for tests
  │   ├─ day-placement.js  which days move, the fixed-width manifest, how two copies of a day relate (pure)
  │   └─ storage-health.js refused writes until one lands; how full storage is against the browser's quota
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
      ├─ journal.js         the Journal: a light index of the saved days, built once per opening, 40 rows a page
      ├─ storage-alert.js   the header notice when a save is refused or storage is 80% full; Data on this device's line
      ├─ storage-recovery.js  Data on this device: its figures, a Download for each snapshot and earlier copy kept aside
      ├─ archive-keeper.js  when older days load and move: idle, after Close day, at once after a refused save
      ├─ personal-sync.js
      ├─ personal-sync-view.js  Personal sync's states, copy and passphrase forms (pure)
      ├─ sync-status.js     Personal sync's header alert and popover, from getState() / subscribe()
      ├─ pip-styles.js      Picture-in-Picture stylesheet (injected into the floating window)
      ├─ pip-window.js      Picture-in-Picture: Focus, Plan and Schedule, day-by-day navigation, sync with the main window
      ├─ print.js           Day and Week sheets; a long Day plan steps down to stay on its page (fitDayPlan)
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

Planner data is stored locally first. The working planner records live in `localStorage`; once room is needed, older days move to IndexedDB `daily-planner-archive` as the identical string (1.40, below); recovery snapshots use IndexedDB; optional Personal sync mirrors the current Personal sync document, sealed with the person's passphrase (1.38), to their own Google Drive app-data space or Dropbox app folder.

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

### When local storage is full (1.39.3)

`localStorage` refuses a write once the origin's quota is reached. Quotas count keys and values together in UTF-16 code units (2 bytes a character): Chromium allows 10 MiB an origin (5,242,880 characters, measured), Safari 5 MiB (2,621,440). A typical day is about 2.5K characters, a rich one about 6.4K, `daily-planner:settings` with two years of Horizon about 25K.

- `src/state/local-store.js` never throws into the planner: a refused write returns `false` and is reported to `onWrite({ key, ok, error, tracked })` (`tracked: false` for a sync pull's writes).
- `src/state/storage-health.js` turns those results into what the person must hear: a change was refused (a day, the settings, another `daily-planner:` key) and none has landed since. A day's refused change that is no longer on screen (another day opened, a sync, an import) keeps it up until the next change lands. When a write lands, `app.js` writes what is still refused and held in memory (the day on screen, the settings) once more. Only Personal sync's “changed” mark refused, the change itself saved, is told apart (`syncMarkRefused`). It changes state once, never at each refused keystroke.
- `src/features/storage-alert.js` shows it as a header pill and popover in the style of Personal sync's alert, with Export backup and Data on this device, and writes the line in How it works → Data on this device. Saving that never worked in this browser (blocked, or no room at all, as in some private windows) is left to the startup dialog: no notice, no meter. Export backup lays the day on screen and the settings in memory over what storage holds (`buildPlannerBackup(store, { live })`), so a refused change is in the file.
- How full storage is: every key, in characters, against `storageBudget()`: Chromium's quota where `navigator.vendor` says Chromium, Safari's elsewhere (the smaller, and the only one known for the others), shown as “about”. `navigator.storage.estimate()` can't be used: it reports the origin's quota for IndexedDB and the caches, not localStorage's. It is measured as How it works opens, and for the header's warning at most once a minute when the browser is idle (and once more as saves land again), never per save. From 80% Data on this device warns, and the header once a day (`daily-planner-ui:storage-warned`) until opened.
- Personal sync: `src/sync/ledger.js` `recordMutation` returns `false` when its mark is refused and holds it, counted as a change waiting, until it is written with the next one; a held mark whose record is synced or forgotten meanwhile is dropped. A day marked less than 30 seconds earlier keeps its mark, so typing doesn't rewrite the ledger at each keystroke. `src/sync/engine.js` leaves a pulled record the browser refuses to store un-applied, names it in `refused`, and pulls it again next time; Personal sync says so on its card and in its header alert.
- Changes that span several keys are written all or nothing, where things go first (1.39.4, `src/state/day-move.js` `writeInOrder()`): a block moved to another day (the Week drag, the block editor), Close day (the days items are carried to, then the settings that hold Later, then the closed day), and Unresolved's Plan (the target day, then the day or the Later list it leaves) and Save (Later, then the day). When the browser refuses one write, each write made before it gets its previous string back, so an item is never on no day, nor on two. They go through `createPlannerWrites()`: while they and their rollback run, the retry of refused saves (`retryRefused()` in `app.js`, which stores what memory holds) is held off, and it runs once after everything landed; their marks for Personal sync are held and written once the whole change landed, and a key put back is written untracked with its mark dropped (`undoMark()`), so a day that didn't exist leaves no tombstone. The day on screen, and Close day's closed day and settings, are edited as copies and shown only once everything landed; the refused write raises the header notice, which stays, and the block editor, Close day and Unresolved say in their own words that nothing moved.
- Import (`importPlannerBackup()` in `src/state/planner-backup.js`, 1.39.4) writes the settings, then the days newest first, and counts what it stored. It keeps room free while it writes, held by a placeholder key (`daily-planner-ui:import-room`) and given back however it ends (a leftover goes at the next start, and with Reset local data): 5% of `storageBudget()` at least, plus about 64 characters a stored day for Personal sync's marks. Once that room is reached, or a day is refused, it stops: the older days count as not imported, and `importReport()` says how many were and weren't, in the import's own alert, never as success. The writes of an import (and of Reset local data) go through `inBulk()` in `app.js`: the ledger marks them in one write (`deferMarks()`), Personal sync hears of them once, and what the import couldn't store is not told as “Not saved”, which is for the person's own changes.

### Years of history (1.39.4)

The readers that need every saved day stay quick however long the history: a 10,000-day history is about 26M characters, more than localStorage holds today, and 1.40 moves older days to IndexedDB (step 0 of that design measures them: `node scripts/perf-history.mjs`, over the synthetic days of `tests/support/history.js`).

- `src/state/saved-days.js` keeps every saved day parsed and normalised, keyed by its date and the very string stored, so a day is parsed again only once that string changed (an edit, a sync pull, another tab, an import): Search at each keystroke, Unresolved, the floating window and the week review read it. What it hands out is shared between readers: read it, never change it.
- `src/features/unresolved.js` reads the days once per list and finds what was already carried on in an index built in the same pass (1.39.3 read every day again for each candidate).
- The sync ledger (`daily-planner-sync:ledger`) is parsed only when its string differs from the one it last read or wrote, and what it parsed is never changed in place (every change makes new objects; `read()` hands it out, read-only). One sync reads it once (`session()`), and writes what it agreed on in one go: the pulls applied, before the copy is written (a third read, so a tab closed meanwhile leaves them agreed on), then what was sent. Its entries are compact within format 1: `dirtyAt` and `deletedAt` only when set, and no `syncedAt` (written by earlier releases, never read), about 103 characters a synced day instead of 174; every 1.39 release reads a missing field as it read null (`tests/sync-ledger.test.js` runs 1.39.3's frozen code on them, `tests/support/sync-1.39.3/`).

### Older days in IndexedDB (1.40)

One day store, two homes (`src/state/day-store.js`). Recent days stay in `localStorage`, as before; older days move, only when room is needed, to IndexedDB `daily-planner-archive` (store `days`, `{ day, json, chars, movedAt }`), as the very string localStorage held. The store keeps local-store's synchronous calls, so Journal, Search, Insights, Progress, the reviews, Horizon, backups and Personal sync read every day without a change: their openers wait once for `store.ready()` (`afterHistory()` in `app.js`). Someone who never needs a move has no manifest, and no IndexedDB is ever opened: 1.40 behaves exactly as 1.39.4.

- **Four rules.** (1) localStorage wins: a day in both homes is the localStorage copy, every write goes to localStorage synchronously, and an archived day that is written moves back (its archived copy goes). (2) Moving is not a change: no mutation, no ledger mark, no tombstone, no Journal refresh; the strings, so the sync hashes, are identical. (3) A move is put → verify → manifest → compare-and-delete (`moveDays()`): one strict IndexedDB transaction per batch (250 days or 600K characters at most), read back string for string in another, then the manifest advanced, then each day removed from localStorage only if its value is still exactly the string archived. Stopped anywhere, both homes hold equal copies or the archive holds a verified one, and the next pass resumes. (4) A day that may be archived but isn't loaded yet is read-only (`pending()`): its writes return `false` without `onWrite`, and the Day/Week view is inert with “Opening this day…” (`src/features/archive-keeper.js`), and so is the floating window (`src/features/pip-window.js`), so a blank read is never saved over a real day. The archive becomes readable in one synchronous step (memory filled, status `ready`, reconciliation, the planner told and the day drawn again), so no save lands between. Refused writes keep returning `false`: the engine's `refused` and `src/state/day-move.js` depend on it.
- **The manifest** `daily-planner-store:archive` (outside `daily-planner:`: never backed up, synced, or removed by a 1.39 Reset) says “every day before `before` that isn't in localStorage is in the archive”, with `days` (counted in the archive after each change, never added up), `chars` and `gen` (raised each time days are added, so other tabs read the archive again). It is fixed-width JSON (spaces pad the numbers), so it is rewritten in place and never needs more room. Without it nothing is taken as archived, and nothing in the database is ever cleared for that: days found there without a manifest (a first move in a browser full to its last characters, stopped between the removal of its first day and the manifest's write) are adopted, at the first pass or, when localStorage is half full or more, as the planner opens, where `indexedDB.databases()` can say there is a database (below half full, or without that call, as in Firefox before 126, nothing is opened, so created, at a start: the first pass adopts). Only Reset clears it; one that couldn't leaves `daily-planner-store:reset` for the next start to finish, checked again inside the lock, and while it is unfinished no pass, pull or import places a day in the database, so its leftovers are never adopted, shown or synced.
- **When days move** (`src/features/archive-keeper.js`, `src/state/day-placement.js` `planMoves()`): at idle once the planner shows, and after each Close day, when localStorage is at 50% or more of Safari's 2,621,440 characters, oldest first, down to 40%; never today, future days, the last 62 days or the days on screen. At once after a refused save (an emergency pass): the header says “Saving…” meanwhile (up to 3 s for the lock), then the refused change is saved again; when even that can't make room, “Not saved” as before, with “This browser can't make more room for your planner here. Export a backup now, so nothing is lost.” The first pass in a browser takes a recovery snapshot of everything (`before-archive`), the latest of which the recovery store keeps outside its five-snapshot limit. Installed, the planner asks for persistent storage (`navigator.storage.persist()`), never in a tab. `ARCHIVE_MOVES = false` stops new moves.
- **One step at a time on the archive, never under an older tab.** Everything that changes the archive or relies on it holding still runs alone across tabs, one after the other in each tab (`exclusive()` in the store): a pass, a pull's and an import's put and placement, a sync's local side (its records read, its pulls applied: `src/sync/engine.js`), Reset, Restore, and the queued drops and copies kept aside. It holds the exclusive Web Lock `daily-planner:archive` or, where Web Locks are missing, a lease `daily-planner-store:lease` (fixed width, rewritten in place, so once written it can be taken with storage full; released, never removed). Idle passes take it only if free; an emergency pass waits up to 3 s, says “Saving…”, and if still busy moves days once the other step is done. Each 1.40 tab holds the shared lock `daily-planner:tab`; the service worker answers `{ type: 'planner-windows' }` with the planner windows it sees (controlled or not) and its version (`sw.js`). More windows than tab locks means a tab of an older release is open, and idle passes wait; so they do until a 1.40+ worker controls the page (the offline copy could bring back older code). On localhost, where `registerPwa()` unregisters workers, neither is asked.
- **Loading and other tabs.** The archive loads once the planner shows, at idle, or at once when something asks (`ready()`): batched `getAll` of 1,000, held in memory (about 23–45 MB at 10,000 days). Status: `none`, `loading`, `ready`, `unavailable` (IndexedDB failed this session: older days read-only, sync paused, export named `…-recent-days.json`), `lost` (days missing: fewer records than the manifest counts, or a day the sync ledger knows absent from both homes). Lost, no missing day is taken for deleted: those days stay read-only, automatic sync waits, and Sync now (`restoreMissing`) brings back what the copy has; once that sync is stored whole, or the person chooses Carry on without them in Data on this device, what is still missing is let go (`settle()`: its ledger entries are forgotten, so a later sync pulls it back instead of deleting it from the copy). An import alone settles nothing, unless nothing is missing after it. Another tab's pass advances the manifest (its `gen`) before removing anything, and each removal reaches this tab as a `storage` event whose `oldValue` is the archived string; this tab then reads the archive again, and until it has, the day is pending here, never blank. A removal that took an edit made since (it landed between the other tab's compare and its delete) is put back by the tab that made it. A `storage` event writing a day this tab holds archived is reconciled at once, as at load. An archived day deleted in another tab fires no event of its own: its tombstone in the ledger (`dayMarks()`) and the recounted manifest say so.
- **Reconciliation** after load, for a day in both homes: the same string (a pass stopped before its removals) stays for the next pass; a localStorage copy sharing a priority, task or block id with the archived one, or an empty archived one, wins and the archived copy goes; a blank written blind over it (an older tab opened the day as empty and saved it) goes, and the day is the archived one again (a change, so it syncs), under the lock and only once the archive is seen to hold the day still (another 1.40 tab may have applied that blank from a sync and kept the day aside: the blank then stands, as there), the day pending meanwhile; a day is kept aside only while the write over it is still there; a sync's local side and a pass reconcile what localStorage holds first, under the lock, so neither reads a blank another tab wrote before its `storage` event arrives, and a pass never puts a day over an archived one it wasn't made from; anything else written blind keeps the archived version aside in store `displaced` (`{ day, json, displacedAt, reason }`, never pruned), said once in the header (“An earlier version of … was kept aside.”, `daily-planner-ui:aside-seen`) and in Data on this device, with a Download and a Restore (`restoreAside()`, which keeps the version there now aside in its place, and keeps the copy restored too, marked `restoredAt`: the older tab that wrote over it may still be open and save again; a copy kept aside goes only with Reset). While the roll call sees a tab of an older release, a line next to Restore says it may save over the day again. An archived day the ledger says was deleted is deleted.
- **Import, pulls, export, Reset.** `importDays()` sends the backup's older days, once localStorage would pass 40% with every imported day's mark counted in, straight to the archive (put, verified) and the rest through `importPlannerBackup()`; every day imported is a change, and what wasn't stored is reported. The engine applies pulls through `placeMany()`: recent days and those that fit stay in localStorage, the rest go to the archive verified, untracked, and anything not stored lands in `refused`. Export runs after `ready()` and includes every day (format 13). Reset (`clearAll()`) removes every day in either home with its tombstone (older days this tab couldn't read included, those the ledger knows), then the manifest, then the archive's days and copies kept aside: the database emptied, else deleted (`indexedDB.deleteDatabase`), else left for the next start (`daily-planner-store:reset`), which the header says (“Reset not finished”); and the `before-archive` snapshot.
- **What the person sees.** The storage bar still measures localStorage alone (`storageChars()`), what can refuse a save. Data on this device counts every saved day and the older ones in the database, the site's size from `estimate()` (which includes the offline copy, so it is never the bar), and says when older days are kept there, can't be read, or are missing (`src/features/storage-recovery.js`, `src/features/storage-alert.js`).

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

A close is written all or nothing, the days items are carried to first and the closed day last (1.39.4): when storage refuses any of it, nothing is closed or carried, and the day stays open with every item where it was.

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
