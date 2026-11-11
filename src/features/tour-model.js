/**
 * The planner tour, as data: which steps a screen gets, what each one says,
 * which keys it teaches, and where its card and spotlight go. Pure and
 * unit-tested; src/features/tour.js puts it on the page.
 *
 * Layouts follow the planner's own breakpoints: "phone" is the bottom-bar
 * layout (max-width: 790px), "desktop" everything wider. Shortcuts are shown
 * by the same rule as Help's shortcut list — hidden at max-width 760px and on
 * touch-only screens — so a tablet with a keyboard still sees them.
 *
 * Step words name the parts of the screen in bold with `**…**`, exactly as
 * the interface labels them (tests/tour.test.js checks): richText() turns
 * that into plain parts the page builds as text and <strong>, never HTML.
 */

/** "Close **Print** now" → [{ text: 'Close ', strong: false }, { text: 'Print', strong: true }, …]. A lone `**` stays as typed. */
export function richText(text) {
  const source = String(text ?? '');
  const parts = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index), strong: false });
    parts.push({ text: match[1], strong: true });
    last = pattern.lastIndex;
  }
  if (last < source.length) parts.push({ text: source.slice(last), strong: false });
  return parts;
}

/** The words without their bold marks (what a screen reader announces). */
export function plainText(text) {
  return richText(text).map(part => part.text).join('');
}

/** The names a step sets in bold. */
export function boldTerms(text) {
  return richText(text).filter(part => part.strong).map(part => part.text);
}

/**
 * Every shortcut the tour teaches, in one place. `codes` are the keys in
 * app.js's keydown map (lower case), `controls` the header buttons whose
 * `data-tooltip-key` shows the same key; tests/tour.test.js checks both, and
 * that How it works lists every key.
 */
export const SHORTCUTS = Object.freeze({
  view: { keys: ['V'], label: 'Day or week', codes: ['v'], controls: ['[data-view-option="week"]'] },
  days: { keys: ['←', '→'], label: 'Previous or next day', codes: ['arrowleft', 'arrowright'], controls: ['[data-prev]', '[data-next]'] },
  now: { keys: ['N'], label: 'Back to now', codes: ['n'], controls: ['[data-today]'] },
  addBlock: { keys: ['T'], label: 'Add a block', codes: ['t'], controls: ['[data-schedule-add]'] },
  closeDay: { keys: ['D'], label: 'Close or reopen the day', codes: ['d'], controls: [] },
  horizon: { keys: ['Y'], label: 'Open or close Horizon', codes: ['y'], controls: ['[data-view-option="horizon"]'] },
  horizonSections: { keys: ['1–7'], label: 'Its sections, once open', codes: [], controls: [] },
  journal: { keys: ['J'], label: 'Journal', codes: ['j'], controls: ['[data-journal-open]'] },
  unresolved: { keys: ['U'], label: 'Unresolved', codes: ['u'], controls: ['[data-open-work-open]'] },
  stats: { keys: ['S'], label: 'Time stats', codes: ['s'], controls: ['[data-stats-open]'] },
  search: { keys: ['F'], label: 'Search', codes: ['f'], controls: ['[data-search-open]'] },
  floating: { keys: ['I'], label: 'Floating mode', codes: ['i'], controls: ['[data-pip]'], requires: '[data-pip]' },
  print: { keys: ['P'], label: 'Print', codes: ['p'], controls: ['[data-print]'] },
  settings: { keys: ['G'], label: 'Settings', codes: ['g'], controls: ['[data-settings-open]'] },
  help: { keys: ['H'], label: 'How it works', codes: ['h'], controls: ['[data-help-open]'] }
});

export const TOUR_MEDIA = Object.freeze({
  phone: '(max-width: 790px)',
  noKeys: '(max-width: 760px), (hover: none) and (pointer: coarse)',
  touch: '(hover: none), (pointer: coarse)'
});

/** The planner's layout and input, from `matches(query)` (window.matchMedia in the page). */
export function tourEnvironment(matches) {
  return { layout: matches(TOUR_MEDIA.phone) ? 'phone' : 'desktop', keys: !matches(TOUR_MEDIA.noKeys), touch: matches(TOUR_MEDIA.touch) };
}

const OUTCOMES = {
  id: 'outcomes',
  pane: 'plan',
  variants: [{
    spot: ['.focus', '.priority-section', '[data-secondary-priorities]'],
    join: true,
    name: 'Keep in mind and the outcomes',
    title: 'Start with outcomes',
    body: () => '**Keep in mind** holds one intention for the day. Below it, the **Most important outcome** — the one result that would make today count — and up to two **Other important outcomes** worth moving forward.'
  }]
};

const TASKS = {
  id: 'tasks',
  pane: 'plan',
  variants: [{
    spot: ['.tasks-section'],
    name: 'the task list',
    title: 'Then the tasks',
    body: ({ touch }) => `List the concrete actions behind those outcomes in **Tasks**: write in an empty row, and **Add a task** makes room for more. ${touch ? 'Tap' : 'Click'} the calendar beside a task or an outcome, **Schedule**, to put it on your schedule.`
  }]
};

const CLOSE_DAY = {
  id: 'closeDay',
  pane: 'schedule',
  variants: [{
    spot: ['[data-end-day-open]'],
    name: 'the Close day button',
    title: 'Close the day',
    body: () => 'When the day is over, **Close day** shows what got done and keeps a memory and a lesson. Then each unfinished item gets a new date, waits in **Unresolved**, or is let go — nothing is lost until you decide.',
    keys: ['closeDay']
  }]
};

const HORIZON_BODY = () => '**Horizon** holds your Misogi — the one hard thing that defines the year — up to six mini-adventures, three commitments, a winning habit each quarter and your key dates. **Progress** paints a square for every day you close.';

const DESKTOP_STEPS = [
  {
    id: 'views',
    variants: [{
      spot: ['[data-view-switch]'],
      name: 'the Day · Week · Horizon switch',
      title: 'Day, Week and Horizon',
      body: () => '**Day · Week · Horizon** moves between three views of the same plans. **Day** shows one day in detail. **Week** puts your planning days side by side, each with its main outcome above its schedule.',
      keys: ['view']
    }]
  },
  {
    id: 'dates',
    variants: [{
      spot: ['.date-nav', '[data-date-picker]'],
      name: 'the day arrows, Now and the date',
      title: 'Move through your days',
      body: ({ touch }) => `**Previous day** and **Next day** step through your days, and **Now** brings you back to the present. ${touch ? 'Tap' : 'Click'} the date to pick any day on the calendar.`,
      keys: ['days', 'now']
    }]
  },
  OUTCOMES,
  TASKS,
  {
    id: 'schedule',
    variants: [{
      spot: ['[data-schedule-pane]'],
      name: 'the schedule',
      title: 'Give the work real time',
      body: ({ touch }) => (touch
        ? 'Tap an empty slot in the **Schedule** to add a block, or use **Add a block**. Hold a block, then drag to move it; drag its lower edge to resize. Tap a block to edit it.'
        : 'Click an empty slot in the **Schedule** to add a block, or use **Add a block**. Hold a block briefly and drag to move it; drag its lower edge to resize. Click a block to edit it.'),
      keys: ['addBlock']
    }]
  },
  CLOSE_DAY,
  {
    id: 'horizon',
    variants: [{ spot: ['[data-view-option="horizon"]'], name: 'the Horizon button', title: 'Keep the year in view', body: HORIZON_BODY, keys: ['horizon', 'horizonSections'] }]
  },
  {
    id: 'reflect',
    variants: [{
      spot: ['[data-journal-open]', '[data-open-work-open]', '[data-stats-open]'],
      name: 'Journal, Unresolved and Time stats',
      title: 'Look back, then decide',
      body: () => 'The **Journal** collects each day’s memory and lesson. **Unresolved** holds what you saved for later and anything still waiting for a decision. **Time stats** show where your hours went, and **Insights** finds when you work best.',
      keys: ['journal', 'unresolved', 'stats']
    }]
  },
  {
    id: 'tools',
    variants: [{
      spot: ['[data-search-open]', '[data-pip]', '[data-print]'],
      name: 'Search, Floating mode and Print',
      title: 'Find, float and print',
      body: ({ visible }) => {
        const print = visible('[data-print]') ? '**Print** gives you a clean landscape sheet of the day.' : '**Print**, under **More**, gives you a clean landscape sheet of the day.';
        return visible('[data-pip]')
          ? `**Search** looks through every saved day. **Floating mode** keeps your day in a small window above your other apps. ${print}`
          : `**Search** looks through every saved day. ${print}`;
      },
      keys: ['search', 'floating', 'print']
    }]
  },
  {
    id: 'settings',
    variants: [
      {
        when: '[data-settings-open]',
        spot: ['[data-settings-open]', '[data-help-open]'],
        name: 'Settings and How it works',
        title: 'Settings and help',
        body: () => '**Settings** holds your hours, planning days, categories, appearance and sync. **How it works** explains each part, lists every shortcut, and starts this tour again whenever you like.',
        keys: ['settings', 'help']
      },
      {
        when: '[data-mobile-more]',
        menu: 'more',
        spot: ['[data-mobile-more]', '[data-mobile-more-menu]'],
        name: 'the More menu',
        title: 'Settings, help and more',
        body: () => '**More** holds **Print / PDF** and **Export**, **Settings**, **Sync my devices**, **Install the app** and **How it works** — where you can take this tour again whenever you like.',
        keys: ['settings', 'help']
      }
    ]
  }
];

const PHONE_STEPS = [
  {
    id: 'tabs',
    variants: [
      {
        when: '[data-mobile-view="horizon"]',
        spot: ['[data-mobile-view-switch]'],
        name: 'the Plan, Schedule and Horizon tabs',
        title: 'Plan, Schedule, Horizon',
        body: () => 'Your day lives in two tabs: **Plan** for what matters, **Schedule** for when. **Horizon** keeps the year in view. Each tab says where you stand.'
      },
      {
        spot: ['[data-mobile-view-switch]'],
        name: 'the Plan and Schedule tabs',
        title: 'Plan and Schedule',
        body: () => 'Your day lives in two tabs: **Plan** for what matters, **Schedule** for when. Each tab says where you stand.'
      }
    ]
  },
  {
    id: 'dates',
    variants: [
      {
        when: '[data-week-view]',
        spot: ['[data-week-view]', '[data-date-picker]', '[data-today]'],
        name: 'the Day / Week button and the date',
        title: 'Day or week, any date',
        body: () => 'The calendar button switches between **Day** and **Week**. Tap the date to open any day, or swipe the plan sideways to move one day.',
        keys: ['view', 'days']
      },
      {
        spot: ['[data-view-switch]', '[data-date-picker]', '[data-today]'],
        name: 'the Day · Week · Horizon switch and the date',
        title: 'Day, Week and Horizon',
        body: () => '**Day · Week · Horizon** moves between the three views. Tap the date to open any day, or swipe the plan sideways to move one day.',
        keys: ['view', 'days']
      }
    ]
  },
  OUTCOMES,
  TASKS,
  {
    id: 'schedule',
    pane: 'schedule',
    variants: [{
      spot: ['[data-mobile-schedule-add]', { css: '[data-blocks] .time-block', pick: 'first-in-view' }],
      name: 'the add button',
      title: 'Give the work real time',
      body: () => 'Tap an empty time, or **+**, to add a block. Hold a block, then drag to move it; drag its lower edge to resize. Tap a block to edit it.',
      keys: ['addBlock']
    }]
  },
  CLOSE_DAY,
  {
    id: 'horizon',
    variants: [
      { spot: ['[data-mobile-view="horizon"]'], name: 'the Horizon tab', title: 'Keep the year in view', body: HORIZON_BODY, keys: ['horizon'] },
      { spot: ['[data-view-option="horizon"]'], name: 'the Horizon button', title: 'Keep the year in view', body: HORIZON_BODY, keys: ['horizon'] }
    ]
  },
  {
    id: 'reflect',
    variants: [{
      spot: ['[data-search-open]', '[data-journal-open]', '[data-open-work-open]', '[data-stats-open]'],
      name: 'Search, Journal, Unresolved and Time stats',
      title: 'Search and look back',
      body: () => '**Search** looks through every saved day. The **Journal** collects each day’s memory and lesson, **Unresolved** holds what is waiting for a decision, and **Time stats** show where your hours went.',
      keys: ['search', 'journal', 'unresolved', 'stats']
    }]
  },
  {
    id: 'settings',
    variants: [{
      when: '[data-mobile-more]',
      menu: 'more',
      spot: ['[data-mobile-more]', '[data-mobile-more-menu]'],
      name: 'the More menu',
      title: 'Everything else is under More',
      body: () => '**Print / PDF** and **Export**, **Settings**, **Sync my devices**, **Install the app** and **How it works**. You can take this tour again from here whenever you like.',
      keys: ['settings', 'help']
    }]
  }
];

export const TOUR_STEPS = Object.freeze({ desktop: DESKTOP_STEPS, phone: PHONE_STEPS });

/** A spotlight entry is a selector, or `{ css, pick, closest }` (tour.js lights `closest` around what `css` finds). */
export const spotSelector = entry => (typeof entry === 'string' ? entry : entry.css);

/**
 * Steps resolved for what is on screen: the first variant whose `when` (or
 * first spotlight) is visible, its visible spotlight targets, its words and
 * keys (`shortcuts` maps their ids). A step with nothing visible to show is
 * left out. `visible(selector, pane)` answers for the phone pane the step
 * shows (Plan or Schedule); a menu the step opens (More) is not visible yet,
 * so it counts once its button is. The contextual guides
 * (src/features/first-use-model.js) resolve their steps the same way, with
 * `context` saying what their dialog shows.
 */
export function resolveSteps(defs, { layout = 'desktop', keys = true, touch = false, visible = () => true, context = {}, shortcuts = SHORTCUTS } = {}) {
  const ctx = { touch, keys, context, visible: selector => visible(selector, '') };
  const steps = [];
  defs.forEach(def => {
    const pane = layout === 'phone' ? def.pane || '' : '';
    const variant = def.variants.find(item => (!item.if || item.if(ctx)) && visible(item.when || spotSelector(item.spot[0]), pane));
    if (!variant) return;
    const spot = variant.spot.filter((entry, index) => visible(spotSelector(entry), pane) || (variant.menu && index > 0));
    if (!spot.length) return;
    const taught = keys ? (variant.keys || []).map(id => shortcuts[id]).filter(item => item && (!item.requires || visible(item.requires, ''))).map(item => ({ keys: [...item.keys], label: item.label })) : [];
    steps.push({ id: def.id, pane, menu: variant.menu || '', join: !!variant.join, spot, name: variant.name, title: variant.title, body: variant.body(ctx), keys: taught });
  });
  return steps;
}

/** The tour for this screen (see resolveSteps). */
export function buildTourSteps({ layout = 'desktop', keys = true, touch = false, visible = () => true } = {}) {
  return resolveSteps(TOUR_STEPS[layout] || TOUR_STEPS.desktop, { layout, keys, touch, visible });
}

/** "Tour · 3 of 9" */
export function stepEyebrow(index, total) {
  return `Tour · ${index + 1} of ${total}`;
}

/** Where to land after the steps were rebuilt (a resize crossed a breakpoint): the same step, or the nearest one. */
export function carryStep(previousSteps, nextSteps, index) {
  const id = previousSteps[index]?.id;
  const same = nextSteps.findIndex(step => step.id === id);
  if (same >= 0) return same;
  return Math.max(0, Math.min(nextSteps.length - 1, index));
}

const clampTo = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The part of the page on screen, from window.visualViewport: where it starts
 * in the layout viewport (page coordinates for anything fixed, and what
 * getBoundingClientRect measures), its size and its pinch-zoom scale. A
 * browser without it, or not zoomed: the whole window at scale 1.
 */
export function visibleArea(visual, inner) {
  const scale = Number(visual?.scale) > 0 ? Number(visual.scale) : 1;
  if (!visual || !(visual.width > 0) || !(visual.height > 0)) return { left: 0, top: 0, width: inner.width, height: inner.height, scale: 1 };
  return { left: Number(visual.offsetLeft) || 0, top: Number(visual.offsetTop) || 0, width: visual.width, height: visual.height, scale };
}

/**
 * Spotlight holes: each target padded and clipped to the viewport (`left`
 * and `top` when only part of the page is on screen: see visibleArea). Holes
 * side by side on one row merge when their padded boxes touch (a row of
 * header buttons reads as one group); holes stacked one above the other stay
 * apart and may overlap (a button and the menu it opens), the page drawing
 * their outline as one shape. `join` makes one hole around them all (a run
 * of sections in the plan).
 */
export function spotlightHoles(rects, viewport, { pad = 6, margin = 4, touch = 2, join = false } = {}) {
  const x0 = viewport.left || 0;
  const y0 = viewport.top || 0;
  const view = { left: x0 + margin, top: y0 + margin, right: x0 + viewport.width - margin, bottom: y0 + viewport.height - margin };
  const boxes = rects.filter(rect => rect && rect.right > rect.left && rect.bottom > rect.top);
  let holes = (join && boxes.length ? [unionRect(boxes)] : boxes)
    .map(rect => ({
      left: Math.max(view.left, rect.left - pad),
      top: Math.max(view.top, rect.top - pad),
      right: Math.min(view.right, rect.right + pad),
      bottom: Math.min(view.bottom, rect.bottom + pad)
    }))
    .filter(rect => rect.right > rect.left && rect.bottom > rect.top);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < holes.length; i += 1) {
      for (let j = i + 1; j < holes.length; j += 1) {
        const a = holes[i];
        const b = holes[j];
        const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >= Math.min(a.bottom - a.top, b.bottom - b.top) / 2;
        if (sameRow && a.left <= b.right + touch && b.left <= a.right + touch) {
          holes[i] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
          holes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  holes = holes.map(rect => ({ left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) }));
  return holes.sort((a, b) => a.top - b.top || a.left - b.left);
}

/** The box around every hole. */
export function unionRect(rects) {
  if (!rects.length) return null;
  return rects.reduce((box, rect) => ({ left: Math.min(box.left, rect.left), top: Math.min(box.top, rect.top), right: Math.max(box.right, rect.right), bottom: Math.max(box.bottom, rect.bottom) }));
}

/**
 * Where the card goes beside its spotlight (`anchor`): below it when there is
 * room, then above, then right, then left — never closer than `margin` to the
 * viewport edge. When no side has room (a target as tall as the screen) the
 * card sits over the end of the screen that covers the target least; with
 * no anchor at all, in the middle.
 *
 * `viewport` is visibleArea(): when the page is pinch-zoomed the card goes
 * in the part on screen and is drawn at its own size (`size`, in screen
 * pixels; tour.js scales it by 1 / scale), so it is always whole and in
 * reach. The answer is in page (layout viewport) coordinates.
 */
export function placeCard(anchor, size, viewport, options = {}) {
  const scale = viewport.scale > 0 ? viewport.scale : 1;
  const x0 = viewport.left || 0;
  const y0 = viewport.top || 0;
  const screen = { width: viewport.width * scale, height: viewport.height * scale };
  const onScreen = anchor && { left: (anchor.left - x0) * scale, top: (anchor.top - y0) * scale, right: (anchor.right - x0) * scale, bottom: (anchor.bottom - y0) * scale };
  const place = placeOnScreen(onScreen, size, screen, options);
  const page = value => Math.round(value * 100) / 100;
  return { side: place.side, left: page(x0 + place.left / scale), top: page(y0 + place.top / scale) };
}

function placeOnScreen(anchor, size, viewport, { gap = 14, margin = 12 } = {}) {
  const maxLeft = viewport.width - margin - size.width;
  const maxTop = viewport.height - margin - size.height;
  if (!anchor) return { side: 'over', left: Math.round(clampTo((viewport.width - size.width) / 2, margin, maxLeft)), top: Math.round(clampTo((viewport.height - size.height) / 2, margin, maxTop)) };
  const centerX = clampTo(anchor.left + (anchor.right - anchor.left) / 2 - size.width / 2, margin, maxLeft);
  const centerY = clampTo(anchor.top + (anchor.bottom - anchor.top) / 2 - size.height / 2, margin, maxTop);
  const room = {
    below: viewport.height - margin - (anchor.bottom + gap),
    above: anchor.top - gap - margin,
    right: viewport.width - margin - (anchor.right + gap),
    left: anchor.left - gap - margin
  };
  let place = null;
  if (room.below >= size.height) place = { side: 'below', left: centerX, top: anchor.bottom + gap };
  else if (room.above >= size.height) place = { side: 'above', left: centerX, top: anchor.top - gap - size.height };
  else if (room.right >= size.width) place = { side: 'right', left: anchor.right + gap, top: centerY };
  else if (room.left >= size.width) place = { side: 'left', left: anchor.left - gap - size.width, top: centerY };
  else {
    const overlap = top => Math.max(0, Math.min(anchor.bottom, top + size.height) - Math.max(anchor.top, top));
    const top = overlap(margin) < overlap(maxTop) ? margin : maxTop;
    place = { side: 'over', left: centerX, top };
  }
  return { side: place.side, left: Math.round(clampTo(place.left, margin, maxLeft)), top: Math.round(clampTo(place.top, margin, maxTop)) };
}

/**
 * How far a scroll area should move so `target` is fully in view — centred
 * when it has to move at all, its top first when it is taller than the area.
 * 0 when it is already visible.
 */
export function scrollDelta(target, port, { margin = 12 } = {}) {
  const top = port.top + margin;
  const bottom = port.bottom - margin;
  if (target.top >= top && target.bottom <= bottom) return 0;
  const height = target.bottom - target.top;
  if (height > bottom - top) return Math.round(target.top - top);
  return Math.round(target.top + height / 2 - (top + (bottom - top) / 2));
}

/** UI flags (`daily-planner-ui:tour`, never synced or backed up): when the tour was seen, and when it was offered. */
export const TOUR_FLAG_KEY = 'daily-planner-ui:tour';

export function readTourFlags(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { seen: typeof value?.seen === 'string' ? value.seen : '', offered: typeof value?.offered === 'string' ? value.offered : '' };
  } catch (_) {
    return { seen: '', offered: '' };
  }
}

/** Someone who set the planner up before the tour existed is offered it once, never during setup. */
export function shouldOfferTour(flags, { onboardingComplete = false, busy = false } = {}) {
  return !!onboardingComplete && !busy && !flags.seen && !flags.offered;
}
