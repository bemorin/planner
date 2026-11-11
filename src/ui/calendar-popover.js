function normalizedWeekStart(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1;
}

function weekLabels(weekStartsOn) {
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return Array.from({ length: 7 }, (_, index) => labels[(weekStartsOn + index) % 7]);
}

/**
 * Number of day cells needed to show a month: only the weeks that contain at
 * least one day of that month (5 or 6 rows, never a trailing week that belongs
 * entirely to the next month).
 */
export function monthGridCellCount(year, month, weekStartsOn = 1) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const offset = (firstWeekday - normalizedWeekStart(weekStartsOn) + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.ceil((offset + daysInMonth) / 7) * 7;
}

function monthGridStart(ctx, monthStart, weekStartsOn) {
  const offset = (monthStart.getDay() - weekStartsOn + 7) % 7;
  const gridStart = ctx.atNoon(new Date(monthStart));
  gridStart.setDate(gridStart.getDate() - offset);
  return gridStart;
}

/**
 * Month grids are 4–6 rows tall, so changing month can change the popover's
 * height after it was positioned. Keep it attached to its anchor: a popover
 * shown above the anchor grows upward, one shown below stays inside the window.
 */
function keepPlaced(popover, anchor, renderMonth) {
  const before = popover.offsetHeight;
  renderMonth();
  const delta = popover.offsetHeight - before;
  if (!delta || !popover.isConnected || !popover.style.top) return;
  const top = parseFloat(popover.style.top) || 0;
  const above = anchor && top < anchor.getBoundingClientRect().top;
  const next = above ? top - delta : Math.min(top, window.innerHeight - popover.offsetHeight - 10);
  popover.style.top = `${Math.max(10, next)}px`;
}

export function openDatePopover(ctx, anchor, selectedKey, onSelect, options = {}) {
  const parentPopover = options.preserveParent ? ctx.getActivePopover() : null;
  if (!parentPopover) ctx.closePopover();
  let view = ctx.dateFromKey(selectedKey);
  view.setDate(1);
  const minDate = options.minKey ? ctx.dateFromKey(options.minKey) : null;
  const maxDate = options.maxKey ? ctx.dateFromKey(options.maxKey) : null;
  const popover = document.createElement('div');
  popover.className = 'app-popover calendar-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Choose date');

  const render = () => {
    const monthStart = ctx.atNoon(new Date(view.getFullYear(), view.getMonth(), 1));
    const weekStartsOn = normalizedWeekStart(options.weekStartsOn);
    const gridStart = monthGridStart(ctx, monthStart, weekStartsOn);
    const prevMonth = ctx.atNoon(new Date(view.getFullYear(), view.getMonth() - 1, 1));
    const nextMonth = ctx.atNoon(new Date(view.getFullYear(), view.getMonth() + 1, 1));
    const prevDisabled = !!minDate && new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0) < minDate;
    const nextDisabled = !!maxDate && nextMonth > maxDate;
    popover.innerHTML = `
      <div class="calendar-popover__head">
        <button class="calendar-popover__nav" type="button" data-cal-prev aria-label="Previous month">${ctx.chevronLeftSvg()}</button>
        <strong>${ctx.esc(monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</strong>
        <button class="calendar-popover__nav" type="button" data-cal-next aria-label="Next month">${ctx.chevronRightSvg()}</button>
      </div>
      <div class="calendar-popover__weekdays">${weekLabels(weekStartsOn).map(label => `<span>${label}</span>`).join('')}</div>
      <div class="calendar-popover__grid"></div>`;
    const prev = ctx.qs('[data-cal-prev]', popover);
    const next = ctx.qs('[data-cal-next]', popover);
    prev.disabled = prevDisabled;
    next.disabled = nextDisabled;
    const grid = ctx.qs('.calendar-popover__grid', popover);
    const todayKey = ctx.ymd(new Date());
    for (let index = 0, cells = monthGridCellCount(monthStart.getFullYear(), monthStart.getMonth(), weekStartsOn); index < cells; index += 1) {
      const day = ctx.atNoon(new Date(gridStart));
      day.setDate(day.getDate() + index);
      const key = ctx.ymd(day);
      const disabled = (minDate && day < minDate) || (maxDate && day > maxDate);
      const button = document.createElement('button');
      button.type = 'button';
      const showSelection = options.showSelection !== false;
      button.className = `calendar-day${day.getMonth() !== monthStart.getMonth() ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${showSelection && key === selectedKey ? ' is-selected' : ''}`;
      button.textContent = String(day.getDate());
      button.disabled = !!disabled;
      button.setAttribute('aria-label', day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      button.addEventListener('click', event => {
        event.stopPropagation();
        onSelect(key);
        ctx.closePopover();
      });
      grid.append(button);
    }
    prev.addEventListener('click', event => { event.stopPropagation(); view = prevMonth; keepPlaced(popover, anchor, render); });
    next.addEventListener('click', event => { event.stopPropagation(); view = nextMonth; keepPlaced(popover, anchor, render); });
  };

  render();
  ctx.showPopover(anchor, popover, { width: 292, parentPopover, align: options.align || 'start' });
}

export function openDateRangePopover(ctx, anchor, startKey, endKey, onSave, options = {}) {
  const parentPopover = options.preserveParent ? ctx.getActivePopover() : null;
  if (!parentPopover) {
    if (ctx.closeAllPopovers) ctx.closeAllPopovers();
    else ctx.closePopover();
  }
  let draftStart = /^\d{4}-\d{2}-\d{2}$/.test(startKey || '') ? startKey : '';
  let draftEnd = /^\d{4}-\d{2}-\d{2}$/.test(endKey || '') ? endKey : '';
  let view = ctx.dateFromKey(draftStart || options.fallbackKey || ctx.ymd(new Date()));
  view.setDate(1);
  const minDate = options.minKey ? ctx.dateFromKey(options.minKey) : null;
  const maxDate = options.maxKey ? ctx.dateFromKey(options.maxKey) : null;
  const popover = document.createElement('div');
  popover.className = 'app-popover calendar-popover period-calendar-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Choose a date or period');

  const render = () => {
    const monthStart = ctx.atNoon(new Date(view.getFullYear(), view.getMonth(), 1));
    const weekStartsOn = normalizedWeekStart(options.weekStartsOn);
    const gridStart = monthGridStart(ctx, monthStart, weekStartsOn);
    const prevMonth = ctx.atNoon(new Date(view.getFullYear(), view.getMonth() - 1, 1));
    const nextMonth = ctx.atNoon(new Date(view.getFullYear(), view.getMonth() + 1, 1));
    const prevDisabled = !!minDate && new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0) < minDate;
    const nextDisabled = !!maxDate && nextMonth > maxDate;
    const hasPeriod = !!draftStart && !!draftEnd && draftEnd > draftStart;
    const summary = draftStart ? ctx.rangeLabel(draftStart, hasPeriod ? draftEnd : '') : 'Choose a start date';
    popover.innerHTML = `
      <div class="period-calendar-popover__summary"><span>Date / period</span><strong>${ctx.esc(summary)}</strong></div>
      <div class="calendar-popover__head">
        <button class="calendar-popover__nav" type="button" data-cal-prev aria-label="Previous month">${ctx.chevronLeftSvg()}</button>
        <strong>${ctx.esc(monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</strong>
        <button class="calendar-popover__nav" type="button" data-cal-next aria-label="Next month">${ctx.chevronRightSvg()}</button>
      </div>
      <div class="calendar-popover__weekdays">${weekLabels(weekStartsOn).map(label => `<span>${label}</span>`).join('')}</div>
      <div class="calendar-popover__grid"></div>
      <div class="period-calendar-popover__actions">
        <button class="text-button" type="button" data-period-secondary>${hasPeriod ? 'Clear end' : 'Cancel'}</button>
        <button class="primary-button" type="button" data-period-save ${draftStart ? '' : 'disabled'}>${hasPeriod ? 'Save period' : 'Save date'}</button>
      </div>`;
    const prev = ctx.qs('[data-cal-prev]', popover);
    const next = ctx.qs('[data-cal-next]', popover);
    prev.disabled = prevDisabled;
    next.disabled = nextDisabled;
    const grid = ctx.qs('.calendar-popover__grid', popover);
    const todayKey = ctx.ymd(new Date());
    for (let index = 0, cells = monthGridCellCount(monthStart.getFullYear(), monthStart.getMonth(), weekStartsOn); index < cells; index += 1) {
      const day = ctx.atNoon(new Date(gridStart));
      day.setDate(day.getDate() + index);
      const key = ctx.ymd(day);
      const disabled = (minDate && day < minDate) || (maxDate && day > maxDate);
      const inRange = !!draftStart && !!draftEnd && key >= draftStart && key <= draftEnd;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `calendar-day${day.getMonth() !== monthStart.getMonth() ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${key === draftStart ? ' is-selected' : ''}${key === draftEnd ? ' is-range-end' : ''}${inRange ? ' is-in-range' : ''}`;
      button.textContent = String(day.getDate());
      button.disabled = !!disabled;
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (!draftStart || draftEnd || key < draftStart) { draftStart = key; draftEnd = ''; }
        else if (key === draftStart) draftEnd = '';
        else draftEnd = key;
        render();
      });
      grid.append(button);
    }
    prev.addEventListener('click', event => { event.stopPropagation(); view = prevMonth; keepPlaced(popover, anchor, render); });
    next.addEventListener('click', event => { event.stopPropagation(); view = nextMonth; keepPlaced(popover, anchor, render); });
    ctx.qs('[data-period-secondary]', popover)?.addEventListener('click', event => { event.stopPropagation(); if (hasPeriod) { draftEnd = ''; render(); } else ctx.closePopover(); });
    ctx.qs('[data-period-save]', popover)?.addEventListener('click', event => {
      event.stopPropagation();
      if (!draftStart) return;
      onSave(draftStart, draftEnd);
      ctx.closePopover();
    });
  };

  render();
  ctx.showPopover(anchor, popover, { width: 318, parentPopover, align: options.align || 'start' });
}
