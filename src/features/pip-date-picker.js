function normalizedWeekStart(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  return new Date(year || 1970, Math.max(0, (month || 1) - 1), day || 1, 12, 0, 0, 0);
}

/**
 * A small month calendar under the floating window's date. `focusSelected`
 * (opened from the keyboard) moves focus to the selected day.
 */
export function openPipDatePicker({ doc, anchor, selectedKey, weekStartsOn = 1, minKey = '', focusSelected = false, onSelect }) {
  if (!doc || !anchor || typeof onSelect !== 'function') return () => {};
  doc.querySelector('[data-pip-date-picker]')?.remove();

  const startDay = normalizedWeekStart(weekStartsOn);
  const minDate = minKey ? dateFromKey(minKey) : null;
  const todayKey = localDateKey(new Date());
  let view = dateFromKey(selectedKey || localDateKey(new Date()));
  view.setDate(1);

  const popover = doc.createElement('div');
  popover.className = 'pip-date-picker';
  popover.dataset.pipDatePicker = 'true';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Choose a date');
  anchor.parentElement?.append(popover);

  const close = () => {
    doc.removeEventListener('pointerdown', onOutsidePointerDown, true);
    popover.remove();
  };

  const onOutsidePointerDown = event => {
    if (popover.contains(event.target) || anchor.contains(event.target)) return;
    close();
  };

  const render = () => {
    const monthStart = new Date(view.getFullYear(), view.getMonth(), 1, 12);
    const offset = (monthStart.getDay() - startDay + 7) % 7;
    const gridStart = new Date(monthStart);
    gridStart.setDate(gridStart.getDate() - offset);
    const prevMonth = new Date(view.getFullYear(), view.getMonth() - 1, 1, 12);
    const nextMonth = new Date(view.getFullYear(), view.getMonth() + 1, 1, 12);
    const prevDisabled = !!minDate && new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 12) < minDate;
    const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    popover.innerHTML = `
      <div class="pip-date-picker__head">
        <button type="button" data-pip-cal-prev aria-label="Previous month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
        <strong>${monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" data-pip-cal-next aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
      <div class="pip-date-picker__weekdays">${Array.from({ length: 7 }, (_, index) => `<span>${labels[(startDay + index) % 7]}</span>`).join('')}</div>
      <div class="pip-date-picker__grid"></div>`;

    const grid = popover.querySelector('.pip-date-picker__grid');
    const cells = Math.ceil((offset + new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()) / 7) * 7;
    for (let index = 0; index < cells; index += 1) {
      const day = new Date(gridStart);
      day.setDate(day.getDate() + index);
      const key = localDateKey(day);
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = String(day.getDate());
      button.className = `${day.getMonth() === monthStart.getMonth() ? '' : 'is-outside'}${key === selectedKey ? ' is-selected' : ''}${key === todayKey ? ' is-today' : ''}`.trim();
      if (key === selectedKey) button.setAttribute('aria-current', 'date');
      button.disabled = !!minDate && day < minDate;
      button.setAttribute('aria-label', day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      button.addEventListener('click', () => { onSelect(key); close(); });
      grid.append(button);
    }
    const prev = popover.querySelector('[data-pip-cal-prev]');
    prev.disabled = prevDisabled;
    prev.addEventListener('click', () => { view = prevMonth; render(); });
    popover.querySelector('[data-pip-cal-next]').addEventListener('click', () => { view = nextMonth; render(); });
  };

  render();
  if (focusSelected) (popover.querySelector('.is-selected') || popover.querySelector('.pip-date-picker__grid button:not(:disabled)'))?.focus();
  requestAnimationFrame(() => doc.addEventListener('pointerdown', onOutsidePointerDown, true));
  return close;
}
