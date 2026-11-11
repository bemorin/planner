export function createStatsFeature(ctx) {
  let view = 'day';
  let weekAnchor = null;
  let pinnedSeriesId = '';

  const categoryFallback = () => ctx.categoryFor('__uncategorized') || { id: '__uncategorized', name: 'Uncategorized', color: '#8c867f' };

  function collect(dayState, dayDate) {
    const rows = new Map();
    (dayState.blocks || []).forEach(block => {
      const cat = ctx.categoryFor(block.categoryId) || categoryFallback();
      if (!rows.has(cat.id)) rows.set(cat.id, { cat, scheduled: 0, elapsed: 0, overrun: 0, measured: 0 });
      const row = rows.get(cat.id);
      row.scheduled += block.duration;
      row.elapsed += ctx.elapsedMinutesForDate(block, dayDate);
      if (Number(block.actualDuration) > 0) {
        row.measured += 1;
        row.overrun += Math.max(0, Number(block.actualDuration) - block.duration);
      }
    });
    return [...rows.values()];
  }

  function setWeekFromDate(inputDate = ctx.getDate()) {
    weekAnchor = ctx.planningWeekStart(inputDate);
  }

  function ensureWeek() {
    if (!weekAnchor) setWeekFromDate(ctx.getDate());
  }

  function setView(nextView) {
    view = nextView === 'week' || (nextView === 'insights' && ctx.insights) ? nextView : 'day';
    if (view === 'week') ensureWeek();
    render();
  }

  /** Insights (src/features/insights.js) widens the dialog and brings its own title. */
  function syncInsightsChrome(wrap) {
    const insights = view === 'insights' ? ctx.insights : null;
    if (!insights) ctx.insights?.hideTip?.();
    wrap.closest('.modal__panel')?.classList.toggle('is-insights', !!insights);
    const help = ctx.qs('[data-stats-help]');
    if (help) help.hidden = !!insights;
    [['[data-stats-modal] .modal__eyebrow', 'eyebrow'], ['#stats-title', 'title']].forEach(([selector, part]) => {
      const node = ctx.qs(selector);
      if (!node) return;
      if (!node.dataset.statsText) node.dataset.statsText = node.textContent;
      const next = insights ? insights.header()[part] : node.dataset.statsText;
      if (node.textContent !== next) node.textContent = next;
    });
  }

  function render() {
    const wrap = ctx.qs('[data-stats-content]');
    const state = ctx.getState();
    if (!wrap || !state) return;

    ctx.qsa('[data-stats-view]').forEach(button => {
      const active = button.dataset.statsView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const weekNav = ctx.qs('[data-stats-week-nav]');
    if (weekNav) weekNav.hidden = view !== 'week';
    syncInsightsChrome(wrap);

    if (view === 'insights') ctx.insights.render(wrap);
    else if (view === 'week') renderWeek(wrap);
    else renderDay(wrap);
  }

  function renderDay(wrap) {
    const state = ctx.getState();
    const date = ctx.getDate();
    const items = collect(state, date).sort((a, b) => b.scheduled - a.scheduled);
    const totalScheduled = items.reduce((sum, row) => sum + row.scheduled, 0);
    const totalElapsed = items.reduce((sum, row) => sum + row.elapsed, 0);
    const totalOverrun = items.reduce((sum, row) => sum + row.overrun, 0);
    const measuredBlocks = items.reduce((sum, row) => sum + row.measured, 0);
    const completed = [...state.priorities, ...state.tasks].filter(item => item.done && item.text.trim()).length;
    const totalItems = [...state.priorities, ...state.tasks].filter(item => item.text.trim()).length;

    wrap.innerHTML = `
      <div class="stats-summary">
        <div class="stat-card"><span>Elapsed schedule</span><strong>${ctx.durationLabel(totalElapsed)}</strong></div>
        <div class="stat-card"><span>Scheduled</span><strong>${ctx.durationLabel(totalScheduled)}</strong></div>
        <div class="stat-card"><span>Over plan</span><strong>${totalOverrun ? `+${ctx.durationLabel(totalOverrun)}` : '—'}</strong><small>${measuredBlocks ? `${measuredBlocks} completed block${measuredBlocks === 1 ? '' : 's'} measured` : 'Measured when a scheduled block is completed'}</small></div>
        <div class="stat-card"><span>Completed items</span><strong>${completed}${totalItems ? ` / ${totalItems}` : ''}</strong></div>
      </div>
      ${items.length ? `<div class="stats-list">${items.map(row => {
        const scheduledPct = totalScheduled ? (row.scheduled / totalScheduled) * 100 : 0;
        const elapsedPct = totalScheduled ? (row.elapsed / totalScheduled) * 100 : 0;
        const over = row.overrun ? ` · +${ctx.durationLabel(row.overrun)} over` : '';
        return `<div class="stat-row"><div class="stat-row__head"><span class="stat-row__name"><span class="category-dot" style="background:${row.cat.color}"></span>${ctx.esc(row.cat.name)}</span><span class="stat-row__value">${ctx.durationLabel(row.elapsed)} elapsed · ${ctx.durationLabel(row.scheduled)} scheduled${over}</span></div><div class="stat-bar"><span class="stat-bar__scheduled" style="--pct:${scheduledPct}%;--bar-color:${row.cat.color}"></span><span class="stat-bar__elapsed" style="--pct:${elapsedPct}%;--bar-color:${row.cat.color}"></span></div></div>`;
      }).join('')}</div>` : '<div class="empty-state">No scheduled blocks yet. Statistics appear once you place time on the schedule.</div>'}`;
  }

  function renderWeek(wrap) {
    ensureWeek();
    const currentDate = ctx.getDate();
    const weekStart = ctx.planningWeekStart(weekAnchor);
    const days = ctx.planningWeekDates(weekStart);
    const weekEnd = days[days.length - 1];
    const labelNode = ctx.qs('[data-stats-week-label]');
    if (labelNode) labelNode.textContent = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const byCategory = new Map();
    let totalWeek = 0;
    let totalOver = 0;
    days.forEach((dayDate, dayIndex) => {
      const dayState = ctx.ymd(dayDate) === ctx.ymd(currentDate) ? ctx.getState() : ctx.loadStateForDate(dayDate);
      collect(dayState, dayDate).forEach(row => {
        if (!byCategory.has(row.cat.id)) byCategory.set(row.cat.id, { cat: row.cat, values: Array(days.length).fill(0), elapsed: Array(days.length).fill(0), overrun: 0 });
        const entry = byCategory.get(row.cat.id);
        entry.values[dayIndex] += row.scheduled;
        entry.elapsed[dayIndex] += row.elapsed;
        entry.overrun += row.overrun;
        totalWeek += row.scheduled;
        totalOver += row.overrun;
      });
    });

    const series = [...byCategory.values()]
      .filter(entry => entry.values.some(Boolean))
      .sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0));
    if (!series.length) {
      wrap.innerHTML = '<div class="week-empty empty-state">No scheduled blocks in this week yet.</div>';
      return;
    }

    const maxValue = Math.max(60, ...series.flatMap(entry => entry.values));
    const graphW = 600, graphH = 252, left = 38, right = 14, top = 18, bottom = 42;
    const plotW = graphW - left - right;
    const plotH = graphH - top - bottom;
    const x = index => left + (plotW / Math.max(1, days.length - 1)) * index;
    const y = value => top + plotH - (value / maxValue) * plotH;
    const guideValues = [0, maxValue / 2, maxValue];
    const grid = guideValues.map(value => `<g class="week-chart__guide"><line x1="${left}" y1="${y(value)}" x2="${graphW - right}" y2="${y(value)}"></line><text x="0" y="${y(value) + 3}">${ctx.esc(ctx.durationLabel(value))}</text></g>`).join('');
    const dayLabels = days.map((day, index) => `<text class="week-chart__day${ctx.ymd(day) === ctx.ymd(new Date()) ? ' is-today' : ''}" x="${x(index)}" y="${graphH - 12}" text-anchor="middle">${ctx.esc(day.toLocaleDateString(undefined, { weekday: 'short' }))}</text>`).join('');
    const lines = series.map(entry => {
      const points = entry.values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
      const circles = entry.values.map((value, index) => `<circle data-series-id="${ctx.escAttr(entry.cat.id)}" data-day-index="${index}" data-scheduled="${value}" data-elapsed="${entry.elapsed[index]}" cx="${x(index)}" cy="${y(value)}" r="3.2"></circle>`).join('');
      return `<g class="week-chart__series" data-series-id="${ctx.escAttr(entry.cat.id)}" style="--series-color:${entry.cat.color}"><polyline points="${points}"></polyline>${circles}</g>`;
    }).join('');

    wrap.innerHTML = `
      <div class="week-summary"><div><span>Week scheduled</span><strong>${ctx.durationLabel(totalWeek)}</strong></div><div><span>Over plan</span><strong>${totalOver ? `+${ctx.durationLabel(totalOver)}` : '—'}</strong></div></div>
      <div class="week-chart-wrap"><svg class="week-chart" viewBox="0 0 ${graphW} ${graphH}" role="img" aria-label="Scheduled time by category for the selected week">${grid}${lines}${dayLabels}<g class="week-chart-svg-tooltip" data-week-chart-svg-tooltip style="visibility:hidden" pointer-events="none"><rect width="166" height="54" rx="8"></rect><text class="week-chart-svg-tooltip__title" x="10" y="16"></text><text class="week-chart-svg-tooltip__date" x="10" y="31"></text><text class="week-chart-svg-tooltip__meta" x="10" y="45"></text></g></svg></div>
      <div class="week-legend">${series.map(entry => `<div data-series-id="${ctx.escAttr(entry.cat.id)}"><span class="category-dot" style="background:${entry.cat.color}"></span><span>${ctx.esc(entry.cat.name)}</span><strong>${ctx.durationLabel(entry.values.reduce((sum, value) => sum + value, 0))}</strong></div>`).join('')}</div>`;
    bindWeekChartInteractions(wrap, series, days);
  }

  function bindWeekChartInteractions(wrap, series, days) {
    const chart = ctx.qs('.week-chart', wrap);
    const legend = ctx.qs('.week-legend', wrap);
    const tooltip = ctx.qs('[data-week-chart-svg-tooltip]', chart);
    if (!chart || !legend || !tooltip) return;
    const seriesMap = new Map(series.map(entry => [String(entry.cat.id), entry]));
    if (pinnedSeriesId && !seriesMap.has(pinnedSeriesId)) pinnedSeriesId = '';
    const tipW = 166, tipH = 54, graphW = 600, graphH = 252;

    const hidePoint = () => {
      ctx.qsa('.is-point-active', chart).forEach(node => node.classList.remove('is-point-active'));
      tooltip.style.visibility = 'hidden';
    };
    const highlight = id => {
      const activeId = id || pinnedSeriesId;
      chart.classList.toggle('is-inspecting', !!activeId);
      chart.classList.toggle('is-pinned', !!pinnedSeriesId);
      legend.classList.toggle('is-inspecting', !!activeId);
      ctx.qsa('.week-chart__series', chart).forEach(node => node.classList.toggle('is-highlighted', !!activeId && node.dataset.seriesId === activeId));
      ctx.qsa('[data-series-id]', legend).forEach(node => {
        node.classList.toggle('is-highlighted', !!activeId && node.dataset.seriesId === activeId);
        node.classList.toggle('is-selected', !!pinnedSeriesId && node.dataset.seriesId === pinnedSeriesId);
      });
    };
    const showPoint = point => {
      if (!point) return;
      const id = point.dataset.seriesId;
      if (pinnedSeriesId && id !== pinnedSeriesId) return;
      const entry = seriesMap.get(id);
      const dayIndex = Number(point.dataset.dayIndex);
      if (!entry || !days[dayIndex]) return;
      ctx.qsa('.is-point-active', chart).forEach(node => node.classList.remove('is-point-active'));
      point.classList.add('is-point-active');
      const cx = Number(point.getAttribute('cx')) || 0;
      const cy = Number(point.getAttribute('cy')) || 0;
      let tx = cx + 12;
      if (tx + tipW > graphW - 5) tx = cx - tipW - 12;
      tx = ctx.clamp(tx, 5, graphW - tipW - 5);
      let ty = cy - tipH - 10;
      if (ty < 5) ty = cy + 10;
      ty = ctx.clamp(ty, 5, graphH - tipH - 5);
      tooltip.setAttribute('transform', `translate(${tx} ${ty})`);
      ctx.qs('.week-chart-svg-tooltip__title', tooltip).textContent = entry.cat.name;
      ctx.qs('.week-chart-svg-tooltip__date', tooltip).textContent = days[dayIndex].toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      const scheduled = Number(point.dataset.scheduled) || 0;
      const elapsed = Number(point.dataset.elapsed) || 0;
      ctx.qs('.week-chart-svg-tooltip__meta', tooltip).textContent = `${ctx.durationLabel(scheduled)} scheduled · ${ctx.durationLabel(elapsed)} elapsed`;
      tooltip.style.visibility = 'visible';
    };

    ctx.qsa('.week-chart__series circle', chart).forEach(point => point.addEventListener('pointerenter', () => { highlight(point.dataset.seriesId); showPoint(point); }));
    chart.addEventListener('pointermove', event => {
      const rect = chart.getBoundingClientRect();
      const localX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * graphW;
      const localY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * graphH;
      const groups = pinnedSeriesId ? [ctx.qs(`.week-chart__series[data-series-id="${CSS.escape(pinnedSeriesId)}"]`, chart)].filter(Boolean) : ctx.qsa('.week-chart__series', chart);
      let best = null;
      groups.forEach(group => ctx.qsa('circle', group).forEach(point => {
        const dx = Number(point.getAttribute('cx')) - localX;
        const dy = Number(point.getAttribute('cy')) - localY;
        const distance = pinnedSeriesId ? Math.abs(dx) : Math.hypot(dx, dy);
        if (!best || distance < best.distance) best = { point, distance };
      }));
      if (!best || (!pinnedSeriesId && best.distance > 48)) { if (!pinnedSeriesId) { hidePoint(); highlight(''); } return; }
      highlight(best.point.dataset.seriesId);
      showPoint(best.point);
    });
    chart.addEventListener('pointerleave', () => { hidePoint(); highlight(''); });
    ctx.qsa('[data-series-id]', legend).forEach(item => {
      item.addEventListener('pointerenter', () => highlight(item.dataset.seriesId));
      item.addEventListener('pointerleave', () => highlight(''));
      item.addEventListener('click', () => {
        const id = item.dataset.seriesId;
        pinnedSeriesId = pinnedSeriesId === id ? '' : id;
        highlight(pinnedSeriesId);
        if (pinnedSeriesId) showPoint(ctx.qs(`.week-chart__series[data-series-id="${CSS.escape(pinnedSeriesId)}"] circle`, chart));
        else hidePoint();
      });
    });
    highlight(pinnedSeriesId);
  }

  function shiftWeek(delta) {
    ensureWeek();
    weekAnchor.setDate(weekAnchor.getDate() + delta * 7);
    render();
  }

  function goCurrentWeek() {
    setWeekFromDate(new Date());
    render();
  }

  function syncWeekToDate(inputDate = ctx.getDate()) {
    if (view === 'week') setWeekFromDate(inputDate);
  }

  return {
    render,
    setView,
    shiftWeek,
    goCurrentWeek,
    setWeekFromDate,
    syncWeekToDate,
    ensureWeek,
    get view() { return view; }
  };
}
