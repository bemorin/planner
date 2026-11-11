# Release checklist

Use this checklist for every release of the public repository.

- [ ] Start from the last user-validated runtime, not from an unverified refactor branch.
- [ ] Keep product changes and code-quality changes in separate commits/PRs when practical.
- [ ] Treat every push to public `main` as a release: choose the next semantic version (`MAJOR.MINOR.PATCH`) before the commit.
- [ ] Keep `package.json`, the newest `CHANGELOG.md` entry, and the service-worker cache namespace on that same semantic version.
- [ ] Use semantic versions in public release notes and cache names; keep local build identifiers local.
- [ ] Run `npm run verify` from the repository root.
- [ ] Confirm Day renders time labels, blocks, tasks/outcomes, and Notes.
- [ ] Confirm Week renders all configured planning days and existing blocks.
- [ ] Confirm Week drag, cross-day move, and bottom resize for any release touching schedule interaction.
- [ ] Confirm Search opens, returns results, and closes.
- [ ] Confirm Journal, Unresolved, Horizon, Time stats, Insights, Settings, and How it works open and close.
- [ ] For Horizon changes, confirm every section, the Add chooser, the year switcher, Plan your year, the quarter check-in and the year in review at desktop and phone widths.
- [ ] For style changes, check Light and Dark (Settings → Appearance) and the system reduced-motion setting.
- [ ] Confirm Add/Edit block works.
- [ ] Confirm Fit app to width toggles both ways.
- [ ] Confirm mobile header actions and Week sticky hour gutter for any responsive change.
- [ ] Confirm onboarding pages when onboarding code or shared modal CSS changes.
- [ ] Bump the service-worker cache with the public semantic version when shipping changed runtime assets.
- [ ] Confirm `runtime-config.js` contains no owner-specific links, and the tree no secrets or personal details (emails, phone numbers, addresses, registration numbers): those come from build variables.
- [ ] When a release changes what is collected or stored, update `legal/privacy/`, `legal/terms/` or `legal/cookies/` and their “Last updated” date.
- [ ] Confirm the public source contains no unrelated project/organization names.
- [ ] Do not commit `dist/`; generate it for deployment with `npm run build`.
