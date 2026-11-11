# Changelog

All notable changes to Daily Planner are recorded here. Versions follow `major.minor.patch`; a feature release bumps the minor number.

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
