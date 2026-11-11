# Contributing

Thank you for helping with Daily Planner. It has a deliberately small runtime and a large interaction surface, and contributions are welcome when they preserve that character: calm, local-first, and simple to read.

By contributing, you agree that your contribution is released under the project's [MIT licence](./LICENSE).

## Issues

- **Bugs:** say what happened, what you expected, the browser and screen size when relevant, and the smallest sequence of steps that reproduces it. A screenshot or a short recording helps; a backup file with your real plans doesn't belong in an issue.
- **Ideas:** describe the problem you want solved before the feature you have in mind. The planner stays small on purpose, so not every good idea will fit.
- **Security problems:** please don't open a public issue. Follow [`SECURITY.md`](./SECURITY.md).

## Pull requests

1. Open an issue first for anything larger than a small fix, so we can agree on the approach before you spend time on it.
2. Keep one change per pull request. A refactor and a product change go in separate pull requests.
3. Add or strengthen a test when the behaviour can be expressed reliably.
4. Run the gates below, and say in the pull request what you verified by hand.
5. Explain the change, and any limitation that remains.

For interaction-heavy changes, also check the affected flow by hand at desktop and phone widths, in light and dark, with the keyboard, and with reduced motion. Drag and drop, resizing, dialog focus and responsive layouts are hard to prove from unit tests alone.

## The gates

Every pull request must pass them, as CI does:

```bash
TZ=UTC node --test tests/*.test.js
npm run lint
npm run format:check
npm run check
npm run quality
npm run verify
```

`npm run verify` runs the checks, the tests, the quality gate, the production build and a Chromium smoke test against that build. Set `CHROME_BIN` when Chrome or Chromium isn't in a standard place.

Two of them catch things that are easy to miss:

- `npm run check` fails when a module the planner imports is missing from `sw.js` (the offline copy), or when an inline `<script>` in a published page changed without its SHA-256 hash in the Content-Security-Policy of `_headers`. Change a head script and its hash in the same commit.
- `npm run quality` holds the line on `app.js` (its size and number of functions) and on the number of `!important` declarations. New behaviour belongs in its own module.

## No framework

The planner is plain HTML, CSS and JavaScript modules, with no framework, no bundler and no runtime dependency. This is a design decision, not an oversight: the sources run as they are, the whole app stays small enough to read, and nothing breaks because a dependency moved.

So please don't add a framework, a build step for the sources, or a runtime package. Prefer native browser APIs and the project's own primitives (`src/ui/`, `src/lib/`). The one vendored library, Motion, is rebuilt with `npm run vendor:motion` and listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md); a new one needs a strong reason, discussed in an issue first.

## Code style

- Follow the code around you: ES modules, two-space indentation, single quotes, semicolons, LF line endings and a final newline.
- Escape user-written text before it goes into HTML templates, with the existing helpers.
- Use the colour tokens (`var(--ink)`, `var(--surface)`, …) instead of literal colours, so light and dark stay in step.
- Don't add `!important` as a routine fix for specificity.
- Animate through the presets in `src/ui/motion.js`, only where movement explains a change, and never make state depend on an animation finishing. Respect `prefers-reduced-motion`.
- Keep everything usable with the keyboard and a screen reader.
- Keep user data local unless a feature explicitly needs otherwise, and keep stored data compatible: a backup from an older version must still import.
- Keep Day and Week as two views over the same schedule data.
- Never commit owner-specific URLs, credentials, secrets or anyone's personal details. Deployment values come from environment variables at build time; tests and docs use `example.com` and fictional phone numbers.

### Copy

The interface is in English, in sentence case, calm and plain: no hype, no emoji. Use curly apostrophes and quotes (’ “ ”). In a single-quoted JavaScript string, a straight apostrophe ends the string, so write the curly one.

## Where code goes

Put logic in the narrowest existing domain that owns it:

- generic date logic → `src/lib/dates.js`;
- persistence → `src/state/`;
- feature-specific pure or domain logic → `src/features/`;
- a reusable UI primitive → `src/ui/`;
- Day schedule styles → `styles/schedule.css`; Week → `styles/week.css`; Horizon → `styles/horizon.css`;
- theme tokens, motion hand-off and focus rings → `styles/theme.css`.

`app.js` coordinates shared state and the lifecycle across features; new isolated behaviour should not be added there by default. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before a larger change.

## Refactors

Refactor incrementally: extract one coherent domain, verify it, then stop. A refactor that produces a smaller file but changes initialisation order, event binding, the CSS cascade or persistence is a regression, even when the screen looks the same. Large “cleanup” pull requests that mix architecture and product changes will be asked to split.
