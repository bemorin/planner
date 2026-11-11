# Changelog

All notable changes to Daily Planner are recorded here. Versions follow `major.minor.patch`; a feature release bumps the minor number.

## 1.39.3 — 2026-11-11

A roomier Journal that stays fast however long your history, prints that keep to their page, and a clear notice when this browser runs out of space for your planner.

- **The Journal is wider on a computer.** It has a width of its own, between the other dialogs and Insights: the date has a little more room, Best memory and Lesson learned read as sentences, and a long entry shows up to three lines, in the same quiet rows under column labels that stay in place. On phones, the column labels now read “Best memory · Lesson learned” over each day’s memory and lesson.
- **The Journal opens at once, however many days you have closed,** and Newer and Older turn the page at once. It keeps up when your plans change while it is open (a sync, an import, an edit), and keyboard focus stays where it was. A search result for a memory or a lesson now opens the Journal on the page that holds that day.
- **A busy day prints on its page.** With many tasks or long lines, the day sheet now steps down instead of running off the bottom: a smaller notes box, tighter rows, then the tasks in two columns, and “+3 more tasks” as a last resort. A long note ends with an ellipsis inside its box.
- **Year in review:** a best streak of 100 days or more no longer runs into its label on the printed page.
- **When this browser runs out of space, the planner says so.** A change the browser refuses to save is no longer lost in silence: a notice in the header says “This browser is out of space for your planner. Your latest change wasn’t saved.”, and it goes by itself once a change is saved again. Its Export backup includes the change that wasn’t saved. How it works → Data on this device shows about how full the planner’s storage is, and from 80% it suggests exporting a backup (in the header too, once a day).
- **Personal sync:** when this browser has no room for changes from your other devices, sync now says so and fetches them again at the next sync, instead of sending this device’s older version over them.

## 1.39.2 — 2026-11-11

Two fixes.

- **How it works: Get started takes the full width.** On a wide screen, Get started (Tour and Tips) no longer sits in the left half above a full-width About this planner: each group is a list of rows across the dialog, one under the other, with every action lined up at the right, Take the tour as wide as What’s new and Read the notice. The guide below still reads row by row, and on phones each row’s button still takes the full width.
- **Menus close on a second click.** Clicking the button of an open menu or picker now closes it, and the next click opens it again, instead of playing its opening animation again: Week starts on, Displayed hours (From, To), a block’s category, start and end, the date pickers, the category colours, Time stats’ help and the menus in Horizon. A list drawn over its button (the time menus, a block’s category) puts the current choice right over it, so that second click leaves the value as it was. Escape and a click outside close them as before, and focus returns to the button; its expanded state is announced on the button itself, not on the time field around it, and the Week starts on, category and first-run hour lists now say their name.

## 1.39.1 — 2026-11-11

A calmer Settings dialog.

- **Settings fits on the screen.** On a wide screen its sections sit in three columns, read in order: Appearance and the time the planner shows (Displayed hours, Planning week), Categories & projects, then Your devices with Personal sync directly under it. Privacy closes the dialog in one row. With a typical set of categories, everything is in view at 1280×800 and above without scrolling; when there is more, the whole dialog scrolls, never one column. On phones it stays one column, with Your devices now next to Personal sync.
- **Categories & projects is one list.** Each row shows the whole name, edited in place, with quiet Archive and Delete buttons. Type a name in the last row and press Enter to add a category in the next distinct colour. Archived categories wait in a folded “Archived (n)” list, with Restore.
- The dialog is now called **Settings**, and says that changes are saved as you make them.

## 1.39.0 — 2026-11-11

The first open-source release. Daily Planner is free for everyone, under the MIT licence.

- **Everything is free.** Plan your year with the misogi, the quarterly check-ins, your year in review, Insights and the painted-year palettes are now ordinary parts of the planner, with no account, no licence and no lock.
- **Plans carry over as they are.** Settings, days, Horizon, check-ins, reviews and the chosen palette load unchanged from 1.38, on every device and through personal sync. Old purchase-related keys are removed from the device once, quietly.
- **Open source.** The code is MIT (`LICENSE`). The name and the logo are not part of that licence (`TRADEMARKS.md`). New `README.md`, `CONTRIBUTING.md` and `SECURITY.md`, and a `migrations/schema.sql` for a fresh install of the server's database.
- **Support it on GitHub Sponsors.** Once, after ten closed days, the planner celebrates them with a short animation and a recap counted on the device (outcomes done, hours planned, tasks done), then asks for support: Sponsor on GitHub, Share Daily Planner, or Not now. It appears only when a sponsor page is configured, and shows its final state at once with reduced motion.
- **How it works** reads left to right on wide screens (1 2 / 3 4 …), in the same order for Tab and screen readers. On phones, each card's main button takes the full width.
- **Year in review on phones:** the Print button has a name for screen readers, and the painted year scrolls with the keyboard.
- **Contact** sends questions to a dedicated route, `/api/contact`.
- **Server:** the website's server keeps only what the free planner uses: feedback, contact questions, the sync waitlist, usage counts, CSP reports, email and the owner's dashboard. Addresses of features that no longer exist answer 410 (Gone), and old page addresses redirect to the welcome page.

**Self-hosting:** see `README.md` and `docs/configuration.md` for the build, the variables and the database.

## Earlier versions

Versions 1.0 to 1.38 were developed privately before the code was opened. Highlights: the daily plan with outcomes, tasks and a schedule; the week view; Horizon (year planning, the misogi, quarterly check-ins, year in review); Insights; the journal and time stats; a floating window; print and export; personal sync through your own Google Drive or Dropbox, sealed with a passphrase; and a local-first design where plans stay on the device.
