export function renderVisibleHourInputs({ qs, time, startHour, endHour }) {
  const startInput = qs('[data-setting-start-time]');
  const endInput = qs('[data-setting-end-time]');
  if (startInput) startInput.value = time(startHour * 60);
  if (endInput) endInput.value = time(endHour * 60);
}

export function parseVisibleHour(raw, { allow24 = false, parseTimeValue }) {
  const clean = String(raw || '').trim().replace('.', ':');
  if (allow24 && /^(24|2400|24:00)$/.test(clean)) return 24;
  const minutes = parseTimeValue(clean);
  if (minutes == null || minutes % 60 !== 0) return null;
  return minutes / 60;
}

export function renderPlanningWeekSettings({ qs, qsa, activeDays, weekStartsOn, weekdayNames, esc, chevronSvg }) {
  const active = new Set(activeDays);
  qsa('[data-planning-day]').forEach(button => {
    const selected = active.has(Number(button.dataset.planningDay));
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const weekStart = qs('[data-week-starts-on]');
  if (weekStart) weekStart.innerHTML = `<span class="select-trigger__value">${esc(weekdayNames[Number(weekStartsOn) || 0])}</span>${chevronSvg()}`;
}

export function visibleHourChoices(kind, startHour, endHour) {
  return kind === 'start'
    ? Array.from({ length: endHour }, (_, hour) => hour).filter(hour => hour < endHour)
    : Array.from({ length: 24 - startHour }, (_, index) => startHour + 1 + index);
}
