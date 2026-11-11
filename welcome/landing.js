import { LANDING_EVENTS, plannerApiEnabled, setUsageCountsEnabled, trackEvent, usageCountsEnabled } from '../src/lib/planner-api.js';
import { HERO_SCRIPTS, setupHeroViews } from './hero-views.js';
import { countedMoments, landingMoments, monthWeeks, ritualYear } from './landing-model.js';
import { el, qs, qsa, renderFooter, renderProjectLinks, setupTopBar } from './page-kit.js';
import { followMotion, motionWanted, reduceQuery, setupFaq, setupReveal } from './page-motion.js';
import { createPaletteCard } from './palette-card.js';
import { createPrivacyDialog } from './privacy-dialog.js';
import { playCues, setupScenes } from './scenes.js';
import { movedAddress, sameSiteHref } from './contact-model.js';

/* ============================================================================
   LANDING (/welcome/): the planner, free and open source — the day, the
   week, Horizon and the yearly ritual (plan your year, the quarterly
   check-ins, the year in review, Insights and the palettes), in animated
   replicas of the planner, then what free and open source mean here and the
   questions people ask. The project's links (its source code, GitHub
   Sponsors) show only when the runtime configuration sets them
   (page-kit.js renderProjectLinks). Nothing goes from here to the server
   but the two anonymous counts of LANDING_COUNTED (landing-model.js), and
   only when the owner API is on and the visitor hasn't switched them off.
   ============================================================================ */

const html = document.documentElement;
const apiOn = plannerApiEnabled();
const track = name => { if (apiOn) trackEvent(name); };

/* Header, dock and click counts ------------------------------------------- */

function setupChrome() {
  setupTopBar();
  const dock = qs('[data-dock]');
  const heroCtas = qs('[data-hero-ctas]');
  // The dock steps aside where it would compete: the open-source card, with its own button, and the final call to action.
  const quiet = [qs('[data-open-source]'), qs('[data-final-cta]')].filter(Boolean);
  if (dock && heroCtas && 'IntersectionObserver' in window) {
    let pastHero = false;
    const quietVisible = new Set();
    const sync = () => dock.classList.toggle('is-visible', pastHero && !quietVisible.size);
    new IntersectionObserver(([entry]) => {
      pastHero = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      sync();
    }).observe(heroCtas);
    const quietObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) quietVisible.add(entry.target); else quietVisible.delete(entry.target); });
      sync();
    }, { rootMargin: '-80px 0px -12% 0px' });
    quiet.forEach(node => quietObserver.observe(node));
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('a, button');
    if (!target) return;
    if (target.matches('[data-cta="app"]')) track('landing_cta_app');
  });
}

/* Replica data: painted cells --------------------------------------------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Illustrative demo years. The hero and Progress stop on a Friday in October
// 2026; the year in review covers the year before the one to plan.
const DEMO = { year: 2026, month: 9, day: 9, firstClosed: [0, 12], missed: ['8-10', '5-14', '2-23', '6-27'], jokers: ['9-2', '7-15', '4-7'] };
const REVIEW = { year: 2026, month: 11, day: 31, firstClosed: [0, 5], missed: ['1-17', '3-29', '5-14', '7-12', '10-24', '11-29'], jokers: ['2-11', '4-21', '6-3', '8-23', '10-5'], noToday: true };

/* The year of the ritual: next year from 1 October, else this one --------- */

const PLAN_YEAR = ritualYear(new Date());
REVIEW.year = PLAN_YEAR - 1;

function renderYears() {
  qsa('[data-plan-year]').forEach(node => { node.textContent = String(PLAN_YEAR + (Number(node.dataset.yearOffset) || 0)); });
}

/* The printed year map: twelve small months, a few dates, a pen ------------ */

// What the guided session planned (the same plan as its replica), by month.
const PRINT_EVENTS = [
  { month: 1, from: 2, kind: 'milestone', when: 'Feb 2', text: 'Book the flights' },
  { month: 2, from: 9, to: 11, kind: 'keydate', when: 'Mar 9 – 11', text: 'Team offsite in Lisbon' },
  { month: 2, from: 14, kind: 'adventure', when: 'Mar 14', text: 'Sleep in a mountain hut' },
  { month: 2, from: 21, kind: 'milestone', when: 'Mar 21', text: 'Walk 100 km in one week' },
  { month: 3, from: 11, kind: 'milestone', when: 'Apr 11', text: 'Test the gear on a weekend' },
  { month: 4, from: 3, to: 31, kind: 'misogi', when: 'May 3 – 31', text: 'Walk the Camino de Santiago' },
  { month: 5, from: 6, kind: 'adventure', when: 'Jun 6', text: 'Swim before 8am' },
  { month: 5, from: 20, kind: 'keydate', when: 'Jun 20', text: 'Sam’s wedding' },
  { month: 7, from: 2, to: 20, kind: 'keydate', when: 'Aug 2 – 20', text: 'Summer break' },
  { month: 10, from: 21, kind: 'adventure', when: 'Nov 21', text: 'Cook for twelve people' }
];
// Written by hand on the printout: a circled day, and a note on its month's first free line.
const PEN_CIRCLE = { month: 8, day: 9 };
const PEN_CIRCLE_PATH = 'M23.6 6.2C20.4 2.6 10.9 2.2 6.3 5.8 1.8 9.4 2.9 17.2 9.6 19.9c6.2 2.5 14.7.6 16.9-4.2 1.9-4.2-.9-8.9-6.4-10.8-2.6-.9-5.4-.9-7.6-.3';
const PEN_NOTE_PATH = 'M1 11.1c.5-.3 2.1-.8 3.1-1.8c.9-.9 2-2.7 2.6-3.9c.6-1.2 .9-2.7 .9-3.3c.1-.5-.4-.4-.7 .1c-.2 .5-.9 2-1 3.2c-.2 1.2-.3 3 .1 3.9c.3 1 1.3 1.6 1.9 1.7c.7 .2 1.4-.4 2.1-.8c.6-.5 1.3-1.4 1.7-1.9c.4-.6 .7-1.3 .8-1.6c.1-.3 0-.3-.1-.1c0 .3-.2 1-.2 1.6c.1 .6 .2 1.5 .5 2c.4 .4 1 .8 1.5 .8c.5 0 1-.3 1.5-.7c.6-.5 1.2-1.4 1.7-1.9c.4-.5 .9-1.1 1.2-1.4c.4-.2 .6-.3 .7 0c.2 .2 .2 .8 .4 1.4c.1 .5 .2 1.4 .4 1.9c.3 .4 .4 .8 1 .8c.7 0 2-.4 2.8-.8c.8-.4 1.5-1.3 1.9-1.8c.3-.5 .3-1.1 .2-1.3c-.1-.2-.6-.3-.8-.1c-.3 .3-.7 .9-.7 1.4c0 .6 .3 1.3 .8 1.7c.5 .5 1.9 .8 2.2 .9M30.1 11.1c.5-.3 2.1-.8 3-1.7c1-1 2.1-2.8 2.7-4c.6-1.1 .9-2.6 .9-3.1c.1-.5-.3-.5-.6 0c-.3 .5-.9 2-1 3.2c-.2 1.1-.3 3 .1 3.9c.3 .9 1.1 1.5 1.9 1.7c.8 .2 2.1-.4 2.9-.7c.8-.4 1.6-1.2 1.9-1.7c.4-.5 .4-1.1 .3-1.3c-.1-.3-.7-.3-.9-.1c-.3 .3-.7 .9-.7 1.4c.1 .5 .3 1.3 .9 1.7c.5 .4 2 .6 2.4 .7';
const PRINT_LINES = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

function penMark(className, viewBox, d, order) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `pen ${className}`);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMinYMax meet');
  svg.style.setProperty('--pen', String(order));
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('pathLength', '1');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function buildPrintMonths(year) {
  const box = qs('[data-print-months]');
  if (!box) return;
  box.replaceChildren(...MONTHS.map((name, month) => {
    const events = PRINT_EVENTS.filter(event => event.month === month);
    const kindOf = day => events.find(event => day >= event.from && day <= (event.to || event.from))?.kind || '';
    const head = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(letter => el('span', { class: 'rp-pp__wd' }, letter));
    const days = monthWeeks(year, month).flat().map(day => {
      if (!day) return el('span', {});
      const weekday = new Date(year, month, day).getDay();
      const kind = kindOf(day);
      const cell = el('span', { class: [kind ? `is-${kind}` : '', weekday === 0 || weekday === 6 ? 'is-weekend' : ''].filter(Boolean).join(' ') || null }, String(day));
      if (month === PEN_CIRCLE.month && day === PEN_CIRCLE.day) cell.append(penMark('pen--circle', '0 0 30 24', PEN_CIRCLE_PATH, 1));
      return cell;
    });
    const lines = events.slice(0, PRINT_LINES).map(event => el('li', { class: `k-${event.kind}` }, el('i', {}), el('b', {}, event.when), ` ${event.text}`));
    while (lines.length < PRINT_LINES) lines.push(el('li', {}));
    if (month === PEN_CIRCLE.month) lines[events.length]?.append(penMark('pen--note', '0 0 48 14', PEN_NOTE_PATH, 2.6));
    return el('div', { class: 'rp-pp__month' },
      el('p', { class: 'rp-pp__mname' }, name, month % 3 === 0 ? el('small', {}, `Q${month / 3 + 1}`) : null),
      el('div', { class: 'rp-pp__cal' }, head, days),
      el('ul', { class: 'rp-pp__lines' }, lines));
  }));
}

function paintState(demo, month, day) {
  const date = new Date(demo.year, month, day);
  if (date.getMonth() !== month) return 'none';
  const key = `${month}-${day}`;
  const afterToday = month > demo.month || (month === demo.month && day > demo.day);
  if (afterToday) return '';
  if (!demo.noToday && month === demo.month && day === demo.day) return 'l3 is-today';
  if (month < demo.firstClosed[0] || (month === demo.firstClosed[0] && day < demo.firstClosed[1])) return 'before';
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) return 'rest';
  if (demo.missed.includes(key)) return 'miss';
  if (demo.jokers.includes(key)) return 'joker';
  const roll = (month * 37 + day * 11 + day * day) % 10;
  return roll < 3 ? 'l1' : roll < 7 ? 'l2' : 'l3';
}

function buildYear(grid, demo) {
  let order = 0;
  let closed = 0;
  let mits = 0;
  const rows = MONTHS.map((name, monthIndex) => {
    const cells = [];
    for (let day = 1; day <= 31; day += 1) {
      const state = paintState(demo, monthIndex, day);
      if (/\bl[123]\b/.test(state)) closed += 1;
      if (/\bl[23]\b/.test(state)) mits += 1;
      const painted = /\b(l[123]|joker|miss)\b/.test(state);
      // --d: the order days were painted in; --w: a diagonal wave for recolouring.
      cells.push(el('span', { class: `cell ${state}`, style: painted ? `--d:${order};--w:${monthIndex + day}` : null }));
      if (painted) order += 1;
    }
    return el('div', { class: 'rp-paint__row' }, el('span', {}, name[0], el('b', {}, name.slice(1, 3))), el('div', { class: 'rp-paint__cells' }, cells));
  });
  grid.replaceChildren(...rows);
  return { order, closed, mits };
}

/* The quarter check-in, printed: the third quarter of the year in review ----- */

// Its days are painted as that review paints them; the winning habit ("Write
// three lines") is kept on most closed days, which shows as the darkest square.
const QUARTER = { months: [6, 7, 8], kept: (month, day) => (month * 5 + day * 7) % 10 < 8 };

function buildQuarter(year) {
  const box = qs('[data-quarter-months]');
  if (!box) return;
  const totals = { closed: 0, planning: 0, mits: 0, kept: 0, days: 0 };
  let run = 0;
  let best = 0;
  let habitRun = 0;
  let habitBest = 0;
  let order = 0;
  const habitMonths = [];
  const months = QUARTER.months.map(month => {
    const length = new Date(year, month + 1, 0).getDate();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    let closedInMonth = 0;
    let keptInMonth = 0;
    const cells = [];
    for (let day = 1; day <= length; day += 1) {
      const weekday = new Date(year, month, day).getDay();
      const state = paintState(REVIEW, month, day);
      totals.days += 1;
      if (weekday > 0 && weekday < 6) totals.planning += 1;
      if (/^l[123]/.test(state)) {
        const mit = !state.startsWith('l1');
        const kept = QUARTER.kept(month, day);
        totals.closed += 1;
        closedInMonth += 1;
        if (mit) totals.mits += 1;
        if (kept) { totals.kept += 1; keptInMonth += 1; }
        habitRun = kept ? habitRun + 1 : 0;
        habitBest = Math.max(habitBest, habitRun);
        run += 1;
        best = Math.max(best, run);
        cells.push(el('i', { class: `is-l${1 + (mit ? 1 : 0) + (kept ? 1 : 0)}`, style: `--d:${order}` }));
        order += 1;
      } else if (state === 'miss') {
        run = 0;
        habitRun = 0;
        cells.push(el('i', { class: 'is-miss', style: `--d:${order}` }));
        order += 1;
      } else {
        habitRun = 0;
        cells.push(el('i', { class: state === 'joker' ? 'is-joker' : 'is-rest', style: state === 'joker' ? `--d:${order}` : null }));
      }
    }
    habitMonths.push(Math.round((keptInMonth / length) * 100));
    return el('div', { class: 'rp-qp__month' },
      el('p', {}, MONTHS[month], el('span', {}, String(closedInMonth))),
      el('div', { class: 'rp-qp__cal' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(letter => el('b', {}, letter)), Array.from({ length: lead }, () => el('i', { class: 'is-pad' })), cells));
  });
  box.replaceChildren(...months);
  const root = box.closest('.rp--quarter');
  const values = { closed: totals.closed, rate: Math.round((totals.closed / totals.planning) * 100), streak: best, mits: totals.mits, habit: Math.round((totals.kept / totals.days) * 100) };
  Object.entries(values).forEach(([name, value]) => qsa(`[data-q="${name}"]`, root).forEach(node => setCount(node, value)));
  const words = { closed: totals.closed, squares: totals.closed, planning: totals.planning, kept: totals.kept, 'mit-share': Math.round((totals.mits / totals.closed) * 100), 'habit-streak': habitBest };
  Object.entries(words).forEach(([name, value]) => qsa(`[data-q-text="${name}"]`, root).forEach(node => { node.textContent = String(value); }));
  qsa('[data-quarter-habit] li', root).forEach((row, index) => {
    row.style.setProperty('--w', String(habitMonths[index]));
    const label = qs('b', row);
    if (label) label.textContent = `${habitMonths[index]}%`;
  });
  root?.style.setProperty('--paint-steps', String(order));
}

/* Insights: when your time is scheduled, Monday to Sunday, 7:00 to 20:00 --- */

const INSIGHTS_HEAT = ['4155231002011', '0155231233123', '3155231002021', '0155231233123', '0111131003021', '0022200000000', '0023300000000'];

function buildHeat() {
  const box = qs('[data-insights-heat]');
  if (!box) return;
  const hours = Array.from({ length: 13 }, (_, index) => 7 + index);
  const head = [el('span', {}), ...hours.map(hour => el('span', { class: `rp-ins__hour${hour % 2 ? ' is-odd' : ''}` }, String(hour)))];
  const rows = INSIGHTS_HEAT.flatMap((levels, row) => [
    el('span', { class: 'rp-ins__day' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][row]),
    ...[...levels].map((level, column) => el('i', { class: `is-l${level}`, style: `--d:${row + column}` }))
  ]);
  box.replaceChildren(...head, ...rows);
}

function setCount(node, value) {
  if (!node) return;
  node.dataset.count = String(value);
  node.textContent = String(value);
}

function buildPaint() {
  const month = qs('[data-month]');
  if (month) {
    const cells = [];
    for (let day = 1; day <= 31; day += 1) cells.push(el('span', { class: `cell ${paintState(DEMO, DEMO.month, day)}` }));
    month.replaceChildren(...cells);
  }

  const grid = qs('[data-paint]');
  if (grid) {
    const { order, closed } = buildYear(grid, DEMO);
    setCount(qs('[data-paint-total]'), closed);
    qs('.rp--progress')?.style.setProperty('--paint-steps', String(order));
  }

  const review = qs('[data-review-paint]');
  if (review) {
    const { order, closed, mits } = buildYear(review, REVIEW);
    setCount(qs('[data-review-closed]'), closed);
    setCount(qs('[data-review-mits]'), mits);
    qs('.rp--review')?.style.setProperty('--paint-steps', String(order));
  }

  buildPrintMonths(PLAN_YEAR);
  buildQuarter(REVIEW.year);
  buildHeat();

  // Colours for the painted year: a whole year, every level of the palette,
  // without the jokers' own colour.
  const palettes = qs('[data-palette-year]');
  if (palettes) buildYear(palettes, { ...REVIEW, firstClosed: [0, 1], jokers: [] });
}

/* Scenes: replicas that play near the viewport and pause when they leave --- */

const SCRIPTS = {
  // The hero's two views, Your day and Your year (Horizon): a pointer plans
  // and closes the day, then shapes the year. Their cues are in hero-views.js,
  // next to how long each view stays.
  day: { length: HERO_SCRIPTS.day.length, loop: true, run: t => playCues(t, HERO_SCRIPTS.day.cues) },
  horizon: { length: HERO_SCRIPTS.horizon.length, run: t => playCues(t, HERO_SCRIPTS.horizon.cues) },
  close: {
    length: 13000,
    loop: true,
    run(t) {
      const [memory, lesson, next] = qsa('[data-type]', t.root);
      t.add('s-save', 900);
      t.add('s-forget', 1800);
      t.type(memory, 2700);
      t.type(lesson, 4000);
      t.add('s-press', 5800);
      t.remove('s-press', 6060);
      t.add('s-closed', 6200);
      t.type(next, 7000);
    }
  },
  week: { run(t) { t.add('s-in', 150); } },
  journal: {
    run(t) {
      t.add('s-in', 120);
      t.add('s-new', 1500);
    }
  },
  unresolved: {
    length: 9400,
    loop: true,
    run(t) {
      t.add('s-press-plan', 900);
      t.remove('s-press-plan', 1120);
      t.add('s-plan', 1120);
      t.add('s-press-save', 2700);
      t.remove('s-press-save', 2920);
      t.add('s-save', 2920);
      t.add('s-later', 4700);
    }
  },
  stats: {
    run(t) {
      t.add('s-in', 150);
      t.add('s-elapsed', 1250);
    }
  },
  search: {
    length: 7200,
    loop: true,
    run(t) {
      t.type(qs('[data-type]', t.root), 500);
      t.add('s-res', 1250);
    }
  },
  ribbon: { run(t) { t.add('s-in', 150); } },
  adventures: { run(t) { t.add('s-planned', 1200); } },
  progress: {
    run(t) {
      const steps = Number(t.root.style.getPropertyValue('--paint-steps')) || 150;
      const span = steps * 7;
      t.add('s-in', 100);
      qsa('[data-count]', t.root).forEach(node => t.count(node, 150, span));
      t.add('s-toast', span + 900);
    }
  },
  trophies: { run(t) { t.add('s-in', 250); } },
  sync: {
    length: 7400,
    loop: true,
    run(t) {
      t.add('s-finger', 400);
      t.add('s-tap', 1050);
      t.add('s-sync', 1500);
      t.add('s-done', 2900);
      t.remove('s-sync', 3300);
    }
  },
  yearplan: {
    length: 16800,
    loop: true,
    run(t) {
      t.type(qs('[data-type]', t.root), 600);
      t.add('s-when', 2100);
      t.add('s-2', 3300);
      t.add('s-3', 5400);
      t.add('s-4', 7700);
      t.add('s-5', 9700);
      t.add('s-6', 11600);
      t.add('s-7', 13600);
      t.add('s-press', 15200);
      t.remove('s-press', 15460);
    }
  },
  // The printout: the pen goes over it once (ticks, a circled day, two notes).
  print: { length: 4200, run(t) { t.add('s-ink', 500); } },
  review: {
    run(t) {
      const steps = Number(t.root.style.getPropertyValue('--paint-steps')) || 240;
      const span = steps * 4;
      t.add('s-in', 100);
      qsa('[data-count]', t.root).forEach(node => t.count(node, 150, span));
      t.add('s-bars', 500);
      t.add('s-notes', Math.round(span * 0.6) + 400);
      t.add('s-press', span + 1100);
      t.remove('s-press', span + 1360);
    }
  },
  // The quarter, printed: its days paint in, the figures count, the bars grow,
  // then the notes appear and a pen writes on the lines under each answer.
  quarter: {
    length: 5200,
    run(t) {
      const steps = Number(t.root.style.getPropertyValue('--paint-steps')) || 60;
      const span = steps * 14;
      t.add('s-in', 100);
      qsa('[data-count]', t.root).forEach(node => t.count(node, 150, span));
      t.add('s-bars', 450);
      t.add('s-notes', Math.round(span * 0.6) + 350);
      t.add('s-ink', span + 900);
    }
  },
  insights: { run(t) { t.add('s-in', 120); t.add('s-bars', 420); } }
};

/* Start -------------------------------------------------------------------- */

let motionOn = motionWanted();
const motionHooks = [];

function start() {
  renderYears();
  buildPaint();
  renderProjectLinks();
  renderFooter();
  createPrivacyDialog({
    dialog: qs('[data-privacy-dialog]'),
    enabled: apiOn,
    moments: countedMoments(landingMoments(LANDING_EVENTS)),
    countsEnabled: () => usageCountsEnabled(),
    setCountsEnabled: on => setUsageCountsEnabled(on),
    reduceMotion: () => reduceQuery.matches
  });
  setupChrome();
  const scenes = setupScenes({ scripts: SCRIPTS, motionOn, motionHooks });
  setupHeroViews(qs('[data-hero-views]'), { scene: scenes.scene, motionOn, motionHooks });
  createPaletteCard(qs('[data-palette-card]'), { motion: () => motionOn });
  setupReveal({ motionOn, motionHooks });
  setupFaq();
  followMotion(motionHooks, on => { motionOn = on; });

  html.classList.add('js-ready');
  track('landing_viewed');
}

// The question form moved to the Contact page (/contact/): its old address here (?ask=question) leads there.
// The inline script in <head> already did this before first paint; this is the fallback, on this site only.
const movedTo = sameSiteHref(movedAddress({ path: location.pathname, search: location.search }), location.href);
if (movedTo) location.replace(movedTo);
else start();
