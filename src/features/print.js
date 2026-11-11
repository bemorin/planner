import { buildYearPrintModel, renderYearPrint } from './year-print.js';

export function createPrintFeature(ctx) {
  let printTitleBefore = document.title;

  function removePrintSheet() {
    document.querySelectorAll('[data-print-sheet]').forEach(sheet => sheet.remove());
  }

  function hourMarkup(visibleStart, visibleEnd) {
    const total = Math.max(60, visibleEnd - visibleStart);
    const labels = [];
    const lines = [];
    for (let minute = visibleStart; minute <= visibleEnd; minute += 60) {
      const pct = ((minute - visibleStart) / total) * 100;
      labels.push(`<span class="print-hour-label" style="top:${pct}%">${ctx.time(minute)}</span>`);
      if (minute < visibleEnd) lines.push(`<span class="print-hour-line" style="top:${pct}%" aria-hidden="true"></span>`);
    }
    return { total, labels: labels.join(''), lines: lines.join('') };
  }

  function printScheduleMarkup(dayState) {
    const visibleStart = ctx.visibleStartMinutes();
    const visibleEnd = ctx.visibleEndMinutes();
    const { total, labels, lines } = hourMarkup(visibleStart, visibleEnd);
    const visible = (dayState.blocks || [])
      .filter(block => block.start < visibleEnd && block.start + block.duration > visibleStart)
      .sort((a, b) => a.start - b.start || b.duration - a.duration);
    const layouts = ctx.layoutBlocks(visible);
    const blocks = visible.map(block => {
      const start = Math.max(block.start, visibleStart);
      const end = Math.min(block.start + block.duration, visibleEnd);
      const top = ((start - visibleStart) / total) * 100;
      const height = Math.max(1.4, ((end - start) / total) * 100);
      const layout = layouts.get(block.id) || { col: 0, cols: 1 };
      const width = 100 / layout.cols;
      const left = layout.col * width;
      const cat = ctx.categoryFor(block.categoryId);
      const done = ctx.isBlockDone(block);
      return `<article class="print-block${done ? ' is-done' : ''}" style="--p-top:${top}%;--p-height:${height}%;--p-left:${left}%;--p-width:${width}%;--p-color:${cat?.color || '#746e67'}"><span class="print-block-checkbox${done ? ' is-checked' : ''}" aria-hidden="true"></span><strong>${ctx.esc(block.title || 'Untitled block')}</strong><span>${ctx.time(block.start)}–${ctx.time(block.start + block.duration)}${cat ? ` · ${ctx.esc(cat.name)}` : ''}</span>${block.link ? `<small>${ctx.esc(block.link)}</small>` : ''}${block.notes ? `<p>${ctx.esc(block.notes.replace(/^\/\/\s?/gm, ''))}</p>` : ''}</article>`;
    }).join('');
    return `<div class="print-schedule-grid"><div class="print-hour-gutter">${labels}</div><div class="print-schedule-canvas">${lines}${blocks}</div></div>`;
  }

  function printCheckRow(item = null) {
    const text = item?.text?.trim?.() || '';
    const done = !!item?.done;
    return `<div class="print-check-row${done ? ' is-done' : ''}"><span class="print-checkbox" aria-hidden="true"></span><p>${text ? ctx.esc(text) : '&nbsp;'}</p></div>`;
  }

  function buildPrintSheet() {
    removePrintSheet();
    const sheet = document.createElement('section');
    const rangeView = ctx.getPlannerRangeView();
    sheet.className = `print-sheet print-sheet--${rangeView}`;
    sheet.dataset.printSheet = 'true';

    if (rangeView === 'week') {
      const days = ctx.planningWeekDates(ctx.getDate());
      const visibleStart = ctx.visibleStartMinutes();
      const visibleEnd = ctx.visibleEndMinutes();
      const { total, labels, lines } = hourMarkup(visibleStart, visibleEnd);
      const columns = days.map(day => {
        const dayState = ctx.loadStateForDate(day);
        const visible = (dayState.blocks || [])
          .filter(block => block.start < visibleEnd && block.start + block.duration > visibleStart)
          .sort((a, b) => a.start - b.start || b.duration - a.duration);
        const layouts = ctx.layoutBlocks(visible);
        const blocks = visible.map(block => {
          const start = Math.max(block.start, visibleStart);
          const end = Math.min(block.start + block.duration, visibleEnd);
          const top = ((start - visibleStart) / total) * 100;
          const height = Math.max(1.4, ((end - start) / total) * 100);
          const layout = layouts.get(block.id) || { col: 0, cols: 1 };
          const width = 100 / layout.cols;
          const cat = ctx.categoryFor(block.categoryId);
          const done = ctx.isBlockDone(block);
          return `<article class="print-week-block${done ? ' is-done' : ''}" style="--p-top:${top}%;--p-height:${height}%;--p-left:${layout.col * width}%;--p-width:${width}%;--p-color:${cat?.color || '#746e67'}"><span class="print-block-checkbox${done ? ' is-checked' : ''}" aria-hidden="true"></span><strong>${ctx.esc(block.title || 'Untitled block')}</strong><span>${ctx.time(block.start)}–${ctx.time(block.start + block.duration)}</span></article>`;
        }).join('');
        return `<div class="print-week-column">${lines}${blocks}</div>`;
      }).join('');
      const first = days[0];
      const last = days[days.length - 1];
      sheet.style.setProperty('--week-days', String(days.length));
      sheet.innerHTML = `<header class="print-sheet-head"><div><h1>${ctx.esc(first.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))}–${ctx.esc(last.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))}</h1></div></header><div class="print-week-head"><span class="print-week-corner"><small>Week</small><strong>${ctx.isoWeekNumber(first)}</strong></span>${days.map(day => `<div><span>${ctx.esc(day.toLocaleDateString(undefined, { weekday: 'short' }))}</span><strong>${day.getDate()}</strong></div>`).join('')}</div><div class="print-week-body"><div class="print-hour-gutter">${labels}</div>${columns}</div><a class="print-sheet-domain" href="https://planner.bemorin.com">planner.bemorin.com</a>`;
    } else {
      const day = ctx.atNoon(ctx.getDate());
      const state = ctx.getState();
      const priorities = state.priorities || [];
      const tasks = (state.tasks || []).filter(item => item.text?.trim());
      const otherRows = [priorities[1] || null, priorities[2] || null].map(printCheckRow).join('');
      const taskRows = Array.from({ length: Math.max(3, tasks.length) }, (_, index) => printCheckRow(tasks[index] || null)).join('');
      sheet.innerHTML = `<header class="print-sheet-head"><div><span>${ctx.esc(day.toLocaleDateString(undefined, { weekday: 'long' }))}</span><h1>${ctx.esc(day.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))}</h1></div></header><div class="print-daily-layout"><aside class="print-plan-column"><section><h2>Keep in mind</h2><p>${ctx.esc(state.focus || '')}</p></section><section><h2>Most important outcome</h2>${printCheckRow(priorities[0] || null)}</section><section><h2>Other important outcomes</h2>${otherRows}</section><section><h2>Tasks</h2>${taskRows}</section><section class="print-notes"><h2>Notes</h2><p>${ctx.esc(state.notes || '')}</p></section></aside><section class="print-schedule-column"><h2>Schedule</h2>${printScheduleMarkup(state)}</section></div><a class="print-sheet-domain" href="https://planner.bemorin.com">planner.bemorin.com</a>`;
    }
    document.body.append(sheet);
    return sheet;
  }

  /** One landscape page for a Horizon year (see year-print.js). */
  function buildYearSheet(year) {
    removePrintSheet();
    const sheet = document.createElement('section');
    sheet.className = 'print-sheet print-sheet--year';
    sheet.dataset.printSheet = 'true';
    sheet.innerHTML = renderYearPrint(buildYearPrintModel(ctx.yearPrintData(year)));
    document.body.append(sheet);
    return sheet;
  }

  function setPrintTitle() {
    const rangeView = ctx.getPlannerRangeView();
    if (rangeView === 'week') {
      const days = ctx.planningWeekDates(ctx.getDate());
      const first = days[0];
      const last = days[days.length - 1];
      document.title = `Daily Planner - week-${String(ctx.isoWeekNumber(first)).padStart(2, '0')} - ${ctx.ymd(first)}-${ctx.ymd(last)}`;
    } else {
      document.title = `Daily Planner - ${ctx.ymd(ctx.getDate())}`;
    }
  }

  function cleanupPrintMode() {
    document.body.classList.remove('is-printing');
    removePrintSheet();
    document.title = printTitleBefore || 'Daily Planner by Ben Morin';
    ctx.updateNow();
  }

  // While Horizon is open, printing (button, P or the browser's own command) prints its year.
  function preparePrint(year = ctx.getPrintYear?.() || null) {
    ctx.hideAppTooltip();
    ctx.closePopover();
    printTitleBefore = document.title;
    if (year) {
      document.title = `Daily Planner - year-${year}`;
      buildYearSheet(year);
    } else {
      ctx.updatePrintSizing();
      if (ctx.getPlannerRangeView() === 'week') ctx.renderWeekSchedule();
      setPrintTitle();
      buildPrintSheet();
    }
    document.body.classList.add('is-printing');
  }

  function printPlanner() {
    preparePrint();
    ctx.trackOncePer?.('day', 'print_used');
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  function printYear(year) {
    preparePrint(year);
    ctx.trackOncePer?.('day', 'print_used');
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  function handleBeforePrint() {
    if (!document.body.classList.contains('is-printing') || !document.querySelector('[data-print-sheet]')) preparePrint();
  }

  return { printPlanner, printYear, buildPrintSheet, buildYearSheet, cleanupPrintMode, handleBeforePrint };
}
