/**
 * CSS injected into the optional Document Picture-in-Picture window.
 *
 * The floating window is a separate document: it cannot see the planner's
 * stylesheets, so its styles travel with it as one template string (no runtime
 * CSS fetch, nothing to cache separately, no unstyled flash when it opens).
 * The tokens repeat the planner's (styles/core.css and styles/theme.css),
 * the --scrollbar-* sizes of its scrollbar included, and the window mirrors
 * the planner's resolved theme through `data-theme`.
 *
 * Every transition and animation sits in one `prefers-reduced-motion:
 * no-preference` block at the end, so reduced motion means no motion at all.
 */
const TOKENS = `
:root {
  --paper: #f6f3ed;
  --surface: #fbfaf7;
  --surface-strong: #ffffff;
  --ink: #1c1a17;
  --muted: #706a62;
  --faint: #706a62;
  --faint-mark: #8c867f;
  --line: #ddd8d0;
  --line-strong: #c7c0b6;
  --soft: #efebe4;
  --accent: #8b6b4f;
  --current: #9a5149;
  --current-ink: #fffaf4;
  --now-line: #9a5149;
  --now-ink: #fffaf4;
  --raised: 0 1px 2px rgba(28, 25, 21, .08);
  --ease: cubic-bezier(.22, 1, .36, 1);
  --scrollbar-size: 12px;
  --scrollbar-inset: 3px;
  --scrollbar-inset-active: 2px;
  --scrollbar-thumb-min: 2.5rem;
  --scrollbar-thumb: color-mix(in srgb, var(--line-strong) 62%, var(--paper));
  --scrollbar-thumb-hover: color-mix(in srgb, var(--muted) 46%, var(--paper));
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink);
  background: var(--paper);
  -webkit-text-size-adjust: 100%;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #151412;
  --surface: #1c1b18;
  --surface-strong: #24221f;
  --ink: #ece8e1;
  --muted: #a9a198;
  --faint: #9a9289;
  --faint-mark: #80796f;
  --line: #322f2a;
  --line-strong: #48433c;
  --soft: #2b2925;
  --accent: #cf9f74;
  --now-line: #d0695c;
  --now-ink: #151412;
  --raised: 0 1px 2px rgba(0, 0, 0, .35);
}
`;

const BASE = `
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: var(--paper); color: var(--ink); -webkit-font-smoothing: antialiased; }
body { overflow: hidden; }
button, input, textarea { font: inherit; color: inherit; }
button { margin: 0; padding: 0; border: 0; background: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
button:disabled { cursor: default; }
svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent); outline-offset: 2px; }
@supports not selector(::-webkit-scrollbar) { * { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; } }
*::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
*::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
*::-webkit-scrollbar-track, *::-webkit-scrollbar-track-piece, *::-webkit-scrollbar-corner { background: transparent; }
*::-webkit-scrollbar-thumb { min-height: var(--scrollbar-thumb-min); border: var(--scrollbar-inset) solid transparent; border-radius: 999px; background: var(--scrollbar-thumb); background-clip: padding-box; }
*::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:active { border-width: var(--scrollbar-inset-active); background: var(--scrollbar-thumb-hover); background-clip: padding-box; }
.pip-short { display: none; }
.pip-eyebrow { display: block; color: var(--faint); font-size: 10.5px; font-weight: 650; line-height: 1.3; letter-spacing: .07em; text-transform: uppercase; }
.pip-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; color: var(--muted); font-size: 11.5px; line-height: 1.35; font-variant-numeric: tabular-nums; }
.pip-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; }
`;

const SHELL = `
.pip-shell { height: 100vh; height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.pip-header { position: relative; z-index: 5; display: grid; gap: 10px; padding: 12px 14px 11px; border-bottom: 1px solid var(--line); background: var(--paper); }
.pip-header__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.pip-date-wrap { position: relative; flex: 1 1 auto; min-width: 0; }
.pip-date { display: grid; gap: 2px; max-width: 100%; margin: -3px -6px; padding: 3px 6px; border-radius: 9px; color: var(--ink); text-align: left; }
.pip-date:hover { background: var(--soft); }
.pip-date__eyebrow { display: flex; gap: 6px; min-width: 0; overflow: hidden; color: var(--faint); font-size: 10.5px; font-weight: 650; letter-spacing: .07em; line-height: 1.3; text-transform: uppercase; white-space: nowrap; }
.pip-date__eyebrow > span { flex: none; }
.pip-date__rel { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.pip-date__rel::before { content: "·"; margin-right: 6px; color: var(--faint-mark); }
.pip-date__rel.is-today { color: var(--now-line); }
.pip-date__title { display: flex; align-items: center; gap: 3px; min-width: 0; }
.pip-date__title strong { min-width: 0; overflow: hidden; font-size: 18px; font-weight: 700; letter-spacing: -.03em; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.pip-date__title svg { width: 15px; height: 15px; color: var(--faint-mark); }
.pip-nav { flex: none; display: flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--surface) 70%, transparent); }
.pip-nav button { height: 32px; display: grid; place-items: center; border-radius: 999px; color: var(--muted); }
.pip-nav button:hover { background: var(--soft); color: var(--ink); }
.pip-nav button:active { transform: scale(.94); }
.pip-nav__arrow { width: 32px; }
.pip-nav__now { padding: 0 11px; font-size: 12px; font-weight: 650; letter-spacing: -.01em; }
.pip-nav__now.is-away { background: var(--surface-strong); color: var(--ink); box-shadow: var(--raised), inset 0 0 0 1px var(--line); }
.pip-views { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 2px; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--surface) 70%, transparent); }
.pip-views__indicator { position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc((100% - 4px) / 3); border-radius: 999px; background: var(--surface-strong); box-shadow: var(--raised), inset 0 0 0 1px var(--line); transform: translateX(calc(var(--pip-view-index, 0) * 100%)); pointer-events: none; }
.pip-views button { position: relative; z-index: 1; min-width: 0; min-height: 30px; overflow: hidden; border-radius: 999px; color: var(--muted); font-size: 12px; font-weight: 650; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
.pip-views button:hover, .pip-views button[aria-pressed="true"] { color: var(--ink); }
.pip-scroll { min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.pip-view { display: grid; gap: 18px; min-width: 0; padding: 14px 14px 22px; }
.pip-view > * { min-width: 0; }
`;

const FOCUS = `
.pip-section { display: grid; gap: 8px; min-width: 0; }
.pip-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; padding: 0 2px; }
.pip-head h2 { margin: 0; min-width: 0; font-size: 12px; font-weight: 650; letter-spacing: -.005em; }
.pip-head > span { flex: none; color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.pip-list { display: grid; gap: 6px; min-width: 0; }
.pip-quiet { margin: 0; padding: 0 2px; color: var(--muted); font-size: 12px; }
.pip-intent { display: grid; gap: 3px; padding: 1px 0 1px 11px; border-left: 2px solid var(--line-strong); }
.pip-intent p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-line; }
.pip-day { display: grid; gap: 6px; min-width: 0; }
.pip-live { position: relative; display: grid; gap: 8px; min-width: 0; padding: 12px 12px 12px 15px; overflow: hidden; border-radius: 12px; background: var(--current); color: var(--current-ink); box-shadow: inset 0 0 0 1px color-mix(in srgb, #743a35 58%, transparent), 0 6px 18px rgba(69, 36, 33, .14); cursor: pointer; }
.pip-live::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--block-color); }
.pip-live__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 650; }
.pip-live__label { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; }
.pip-live__label i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.pip-live__top time { font-variant-numeric: tabular-nums; opacity: .86; }
.pip-live__main { display: grid; grid-template-columns: minmax(0, 1fr) 20px; gap: 12px; align-items: start; }
.pip-live__title { min-width: 0; color: inherit; font-size: 16px; font-weight: 650; line-height: 22px; letter-spacing: -.015em; text-align: left; overflow-wrap: anywhere; }
.pip-live__title > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.pip-live__main input { margin-top: 1px; }
.pip-live__meta { margin: -3px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font-size: 11.5px; opacity: .88; }
.pip-live .pip-dot { outline: 1px solid color-mix(in srgb, white 70%, transparent); }
.pip-live__foot { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
.pip-live__foot strong { font-weight: 650; }
.pip-live__foot span { opacity: .82; }
.pip-live__notes { margin: 0; padding: 7px 9px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; border-radius: 8px; background: color-mix(in srgb, #fffaf4 14%, transparent); font-size: 11.5px; line-height: 1.4; overflow-wrap: anywhere; }
.pip-live.done .pip-live__title > span { text-decoration: line-through; text-decoration-thickness: 1px; opacity: .8; }
.pip-progress { height: 4px; overflow: hidden; border-radius: 99px; background: color-mix(in srgb, currentColor 22%, transparent); }
.pip-progress span { display: block; height: 100%; border-radius: inherit; background: currentColor; transform: scaleX(var(--p, 0)); transform-origin: left center; }
.pip-free { position: relative; display: grid; gap: 2px; width: 100%; min-width: 0; padding: 12px 14px; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink); text-align: left; }
.pip-free strong { font-size: 16px; font-weight: 650; line-height: 1.3; letter-spacing: -.015em; overflow-wrap: anywhere; }
.pip-free__line { display: block; color: var(--muted); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.pip-free--link { padding-right: 38px; }
.pip-free--link svg { position: absolute; top: 50%; right: 12px; width: 16px; height: 16px; margin-top: -8px; color: var(--faint-mark); }
.pip-free--link:hover { background: var(--surface-strong); }
.pip-free--link:hover svg { color: var(--ink); }
.pip-next { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: start; width: 100%; min-width: 0; padding: 10px 12px 10px 15px; overflow: hidden; border-radius: 10px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink); text-align: left; }
.pip-next::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--block-color); }
.pip-next:hover { background: var(--surface-strong); }
.pip-next__when { display: grid; gap: 1px; padding-top: 1px; }
.pip-next__when strong { font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; }
.pip-next__body { display: grid; gap: 2px; min-width: 0; }
.pip-next__body > strong { font-size: 13.5px; font-weight: 620; line-height: 1.35; overflow-wrap: anywhere; }
.pip-row { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 11px; align-items: start; min-width: 0; padding: 10px 12px; border-radius: 10px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); cursor: pointer; }
.pip-row:hover { background: var(--surface-strong); }
.pip-row.is-mit { background: color-mix(in srgb, var(--accent) 7%, var(--surface-strong)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, var(--line)); }
.pip-row__text { min-width: 0; font-size: 13.5px; font-weight: 560; line-height: 20px; overflow-wrap: anywhere; }
.pip-row.is-mit .pip-row__text { font-size: 14.5px; font-weight: 620; }
.pip-row__text time, .pip-edit__main time { display: block; color: var(--muted); font-size: 11px; font-weight: 500; line-height: 1.4; font-variant-numeric: tabular-nums; }
.pip-row__text > span { display: block; }
.pip-row.done .pip-row__text { color: var(--muted); }
.pip-row.done .pip-row__text > span { text-decoration: line-through; text-decoration-thickness: 1px; }
.pip-prompt { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 12px; border: 1px dashed var(--line-strong); border-radius: 10px; color: var(--muted); font-size: 13px; line-height: 1.4; text-align: left; }
.pip-prompt svg { width: 16px; height: 16px; }
.pip-prompt:hover { background: var(--surface); color: var(--ink); }
.pip-more { justify-self: start; display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 8px; margin-left: -2px; border-radius: 8px; color: var(--muted); font-size: 12px; font-weight: 600; }
.pip-more svg { width: 15px; height: 15px; }
.pip-more:hover { background: var(--soft); color: var(--ink); }
`;

const PLAN = `
.pip-field { display: grid; gap: 6px; min-width: 0; }
.pip-field label { padding: 0 2px; }
.pip-field textarea, .pip-edit textarea { display: block; width: 100%; min-width: 0; margin: 0; border: 0; outline: 0; resize: none; overflow: hidden; background: transparent; color: var(--ink); line-height: 20px; overflow-wrap: anywhere; field-sizing: content; }
.pip-field textarea { min-height: 40px; padding: 9px 12px; border-radius: 10px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); font-size: 13.5px; font-weight: 560; }
.pip-field textarea:focus { background: var(--surface-strong); box-shadow: inset 0 0 0 1px var(--line-strong); }
.pip-field--notes textarea { min-height: 92px; font-weight: 450; }
textarea::placeholder { color: var(--faint); opacity: 1; font-weight: 450; }
.pip-edit { display: grid; grid-template-columns: 20px minmax(0, 1fr) 30px; gap: 0 11px; align-items: start; min-width: 0; padding: 4px 5px 4px 12px; border-radius: 10px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }
.pip-edit:focus-within { background: var(--surface-strong); box-shadow: inset 0 0 0 1px var(--line-strong); }
.pip-edit.is-mit { background: color-mix(in srgb, var(--accent) 7%, var(--surface-strong)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, var(--line)); }
.pip-edit > input { margin-top: 8px; }
.pip-edit__main { min-width: 0; }
.pip-edit textarea { min-height: 36px; padding: 8px 0; font-size: 13.5px; font-weight: 560; }
.pip-edit.is-mit textarea { font-size: 14.5px; font-weight: 620; }
.pip-edit__main time { margin: -5px 0 7px; }
.pip-edit.done textarea { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1px; }
.pip-edit.is-empty > input { opacity: .55; }
.pip-icon { width: 30px; height: 30px; margin-top: 3px; display: grid; place-items: center; border-radius: 8px; color: var(--faint-mark); }
.pip-icon svg { width: 17px; height: 17px; }
.pip-icon:hover { background: var(--soft); color: var(--ink); }
.pip-icon:disabled { opacity: 0; pointer-events: none; }
.pip-unresolved { min-width: 0; border-radius: 12px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }
.pip-unresolved > summary { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 10px 0 12px; border-radius: 12px; cursor: pointer; list-style: none; -webkit-user-select: none; user-select: none; }
.pip-unresolved > summary::-webkit-details-marker { display: none; }
.pip-unresolved > summary:hover { background: var(--soft); }
.pip-unresolved[open] > summary { border-radius: 12px 12px 0 0; }
.pip-unresolved__title { font-size: 12px; font-weight: 650; letter-spacing: -.005em; }
.pip-unresolved__count { color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.pip-unresolved > summary svg { width: 15px; height: 15px; margin-left: auto; color: var(--faint-mark); }
.pip-unresolved[open] > summary svg { transform: rotate(180deg); }
.pip-unresolved__list { margin: 0; padding: 0 12px 2px; list-style: none; }
.pip-unresolved__list li { display: grid; gap: 1px; min-width: 0; padding: 8px 0 9px; border-top: 1px solid var(--line); }
.pip-unresolved__text { min-width: 0; font-size: 13px; font-weight: 560; line-height: 1.38; overflow-wrap: anywhere; }
.pip-unresolved__meta { color: var(--muted); font-size: 11px; line-height: 1.35; }
.pip-unresolved__more { margin: 0; padding: 7px 12px 10px; border-top: 1px solid var(--line); color: var(--faint); font-size: 11.5px; }
`;

const SCHEDULE = `
.pip-timeline { display: grid; gap: 6px; min-width: 0; margin: 0; padding: 0; list-style: none; }
.pip-slot { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 9px; align-items: start; min-width: 0; }
.pip-slot__time { display: grid; gap: 1px; padding-top: 9px; text-align: right; font-variant-numeric: tabular-nums; }
.pip-slot__time strong { font-size: 12px; font-weight: 650; line-height: 1.3; }
.pip-slot__time span { color: var(--faint); font-size: 11px; line-height: 1.3; }
.pip-slot__card { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 20px; gap: 10px; align-items: start; min-width: 0; padding: 9px 11px 9px 14px; overflow: hidden; border-radius: 10px; background: color-mix(in srgb, var(--block-color) 7%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--block-color) 14%, var(--line)); cursor: pointer; }
.pip-slot__card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--block-color); }
.pip-slot__card:hover { background: color-mix(in srgb, var(--block-color) 10%, var(--surface-strong)); }
.pip-slot__body { display: grid; gap: 3px; min-width: 0; }
.pip-slot__title { min-width: 0; color: var(--ink); font-size: 13.5px; font-weight: 620; line-height: 20px; text-align: left; overflow-wrap: anywhere; }
.pip-slot.is-past .pip-slot__card, .pip-slot.is-past .pip-slot__time { opacity: .62; }
.pip-slot.done .pip-slot__title { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1px; }
.pip-slot.is-current .pip-slot__time strong { color: var(--now-line); }
.pip-slot.is-current .pip-slot__card { background: var(--current); color: var(--current-ink); box-shadow: inset 0 0 0 1px color-mix(in srgb, #743a35 58%, transparent), 0 4px 13px rgba(69, 36, 33, .12); }
.pip-slot.is-current .pip-slot__title, .pip-slot.is-current .pip-meta { color: var(--current-ink); }
.pip-slot.is-current .pip-progress { margin-top: 5px; }
.pip-slot.is-current .pip-dot { outline: 1px solid color-mix(in srgb, white 70%, transparent); }
.pip-nowline { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 9px; align-items: center; height: 16px; }
.pip-nowline span { justify-self: end; padding: 1px 5px; border-radius: 99px; background: var(--now-line); color: var(--now-ink); font-size: 10px; font-weight: 700; line-height: 1.35; font-variant-numeric: tabular-nums; }
.pip-nowline::after { content: ""; height: 1.5px; border-radius: 2px; background: var(--now-line); }
.pip-empty { display: grid; gap: 6px; justify-items: center; padding: 26px 16px; border: 1px dashed var(--line-strong); border-radius: 12px; color: var(--muted); text-align: center; }
.pip-empty strong { color: var(--ink); font-size: 14px; font-weight: 650; }
.pip-empty p { margin: 0; font-size: 12px; line-height: 1.45; }
.pip-button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; margin-top: 6px; padding: 0 14px 0 11px; border-radius: 999px; background: var(--ink); color: var(--paper); font-size: 12px; font-weight: 650; }
.pip-button svg { width: 15px; height: 15px; }
.pip-button:hover { opacity: .88; }
`;

const CONTROLS = `
input[type="checkbox"] { appearance: none; position: relative; width: 20px; height: 20px; flex: none; margin: 0; border: 1.5px solid var(--line-strong); border-radius: 6px; background: var(--surface-strong); cursor: pointer; }
input[type="checkbox"]::before { content: ""; position: absolute; inset: -9px; }
input[type="checkbox"]::after { content: ""; position: absolute; left: 5px; top: 1.5px; width: 4.6px; height: 9.4px; border: solid var(--surface-strong); border-width: 0 1.7px 1.7px 0; opacity: 0; transform: rotate(45deg) scale(.4); }
input[type="checkbox"]:hover { border-color: var(--muted); }
input[type="checkbox"]:checked { border-color: var(--ink); background: var(--ink); }
input[type="checkbox"]:checked::after { opacity: 1; transform: rotate(45deg) scale(1); }
.pip-live input[type="checkbox"], .pip-slot.is-current input[type="checkbox"] { border-color: color-mix(in srgb, #fffaf4 72%, transparent); background: color-mix(in srgb, #fffaf4 8%, transparent); }
.pip-live input[type="checkbox"]:checked, .pip-slot.is-current input[type="checkbox"]:checked { border-color: #fffaf4; background: #fffaf4; }
.pip-live input[type="checkbox"]::after, .pip-slot.is-current input[type="checkbox"]::after { border-color: var(--current); }
.pip-date-picker { position: absolute; z-index: 40; left: -6px; top: calc(100% + 10px); width: min(272px, calc(100vw - 20px)); padding: 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-strong); box-shadow: 0 14px 34px rgba(24, 21, 17, .16); }
.pip-date-picker__head { display: grid; grid-template-columns: 32px minmax(0, 1fr) 32px; align-items: center; gap: 4px; margin-bottom: 6px; }
.pip-date-picker__head strong { font-size: 12.5px; font-weight: 650; text-align: center; }
.pip-date-picker__head button { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; color: var(--muted); }
.pip-date-picker__head button:hover { background: var(--soft); color: var(--ink); }
.pip-date-picker__head button:disabled { opacity: .3; }
.pip-date-picker__head svg { width: 16px; height: 16px; }
.pip-date-picker__weekdays, .pip-date-picker__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.pip-date-picker__weekdays { margin-bottom: 2px; }
.pip-date-picker__weekdays span { display: grid; place-items: center; height: 22px; color: var(--faint); font-size: 10px; font-weight: 700; }
.pip-date-picker__grid button { height: 32px; border-radius: 8px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.pip-date-picker__grid button:hover { background: var(--soft); color: var(--ink); }
.pip-date-picker__grid button.is-today { color: var(--now-line); font-weight: 700; }
.pip-date-picker__grid button.is-outside { color: var(--faint); }
.pip-date-picker__grid button.is-selected { background: var(--ink); color: var(--paper); font-weight: 650; }
.pip-date-picker__grid button:disabled { opacity: .22; }
`;

const RESPONSIVE = `
@media (max-width: 340px) {
  .pip-long { display: none; }
  .pip-short { display: inline; }
  .pip-header { padding: 10px 10px 9px; gap: 9px; }
  .pip-view { gap: 16px; padding: 12px 10px 20px; }
  .pip-nav__arrow { width: 30px; }
  .pip-nav__now { padding: 0 9px; }
  .pip-slot, .pip-nowline { grid-template-columns: 36px minmax(0, 1fr); gap: 7px; }
  .pip-row, .pip-free, .pip-next { padding-left: 11px; padding-right: 11px; }
  .pip-next, .pip-live { padding-left: 13px; }
}
@media (max-height: 560px) {
  .pip-live__notes { display: none; }
  .pip-live__title > span { -webkit-line-clamp: 3; }
}
@media (max-height: 420px) {
  .pip-header { gap: 8px; padding-top: 8px; padding-bottom: 8px; }
  .pip-date__title strong { font-size: 16px; }
  .pip-nav button { height: 30px; }
  .pip-views button { min-height: 28px; }
  .pip-view { gap: 14px; padding-top: 11px; }
}
@media (max-height: 380px) {
  .pip-view[data-view="focus"] .pip-intent { display: none; }
  .pip-live { gap: 6px; padding-top: 10px; padding-bottom: 10px; }
  .pip-live__title > span { -webkit-line-clamp: 2; }
}
`;

const MOTION = `
@media (prefers-reduced-motion: no-preference) {
  .pip-nav button, .pip-views button, .pip-icon, .pip-more, .pip-prompt, .pip-date, .pip-date-picker button, .pip-unresolved > summary { transition: background-color .14s ease, color .14s ease, transform .15s var(--ease), opacity .14s ease; }
  .pip-unresolved > summary svg { transition: transform .22s var(--ease); }
  .pip-views__indicator { transition: transform .32s var(--ease); }
  .pip-row, .pip-edit, .pip-next, .pip-free, .pip-slot__card, .pip-field textarea { transition: background-color .16s ease, box-shadow .16s ease, opacity .2s ease; }
  .pip-row__text, .pip-slot__title, .pip-edit textarea { transition: color .2s ease; }
  .pip-progress span { transition: transform .6s var(--ease); }
  input[type="checkbox"] { transition: background-color .16s ease, border-color .16s ease, transform .18s var(--ease); }
  input[type="checkbox"]::after { transition: opacity .13s ease, transform .2s var(--ease); }
  input[type="checkbox"]:active { transform: scale(.9); }
  .pip-live__label i { animation: pip-breathe 2.6s ease-in-out infinite; }
  @keyframes pip-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
}
`;

export function pipStyles() {
  return [TOKENS, BASE, CONTROLS, SHELL, FOCUS, PLAN, SCHEDULE, RESPONSIVE, MOTION].join('');
}
