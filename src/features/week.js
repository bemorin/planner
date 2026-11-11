import { agendaDay } from './day-summary.js';
import { dayHeadPlan, dayLabel, renderWeekAgenda } from './week-agenda.js';

/**
 * Week schedule rendering and interaction.
 * Keeps the week-only DOM, hover/add behavior, and mobile auto-scroll out of app.js.
 * Each day header also carries that day's plan (most important outcome and
 * counts), and the phone's Plan tab gets the same week as an agenda.
 */
export function createWeekFeature(ctx) {
  let autoScrollKey = '';
  let releaseNowLineGuard = null;

  function resetAutoScroll() { autoScrollKey = ''; }

  function bindNowLineGuard(wrap) {
    releaseNowLineGuard?.();
    releaseNowLineGuard = null;
    const line = ctx.qs('.week-now-line', wrap);
    const label = line ? ctx.qs('span', line) : null;
    const column = line?.closest('.week-day-column');
    const scroller = ctx.qs('.schedule-scroll');
    if (!line || !label || !column || !scroller) return;

    const place = () => {
      const lineY = Number.parseFloat(line.style.top) || line.offsetTop || 0;
      const blocks = ctx.qsa('.week-time-block', column);
      const currentBlocks = [];

      // Geometry is the source of truth here. This keeps every overlapping block
      // current even when the clock crosses a block boundary between interactions.
      blocks.forEach(block => {
        const top = Number.parseFloat(block.style.top) || block.offsetTop || 0;
        const height = Number.parseFloat(block.style.height) || block.offsetHeight || 0;
        const onClock = lineY >= top && lineY < top + height;
        // A block finished early stays calm: done styling plus a quiet "now" ring.
        const isCurrent = onClock && !block.classList.contains('done');
        block.classList.toggle('is-current', isCurrent);
        block.classList.toggle('is-now-done', onClock && !isCurrent);
        if (isCurrent) {
          block.style.setProperty('--week-now-in-block', `${lineY - top}px`);
          currentBlocks.push(block);
        } else {
          block.style.removeProperty('--week-now-in-block');
        }
      });

      const columnRect = column.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const visibleLeft = Math.max(columnRect.left, scrollerRect.left);
      const visibleRight = Math.min(columnRect.right, scrollerRect.right);
      if (visibleRight <= visibleLeft) { label.hidden = true; return; }
      label.hidden = false;

      const labelWidth = label.offsetWidth || 42;
      const gap = 7;
      const safe = 4;
      const leftX = -labelWidth - gap;
      const rightX = columnRect.width + gap;
      const leftFits = columnRect.left + leftX >= scrollerRect.left + safe;
      const rightFits = columnRect.left + rightX + labelWidth <= scrollerRect.right - safe;

      let preferred = 'left';
      if (currentBlocks.length) {
        const rect = currentBlocks[0].getBoundingClientRect();
        preferred = (rect.left + rect.width / 2) >= (columnRect.left + columnRect.width / 2) ? 'left' : 'right';
      } else {
        const leftRoom = visibleLeft - scrollerRect.left;
        const rightRoom = scrollerRect.right - visibleRight;
        preferred = leftRoom >= rightRoom ? 'left' : 'right';
      }

      let placement;
      let left;
      if (preferred === 'left' && leftFits) {
        placement = 'outside-left';
        left = leftX;
      } else if (preferred === 'right' && rightFits) {
        placement = 'outside-right';
        left = rightX;
      } else if (leftFits) {
        placement = 'outside-left';
        left = leftX;
      } else if (rightFits) {
        placement = 'outside-right';
        left = rightX;
      } else {
        // Last-resort viewport clamp. This should only happen when the day itself is
        // almost fully clipped; keep the badge readable rather than covering text.
        const minLeft = scrollerRect.left - columnRect.left + safe;
        const maxLeft = scrollerRect.right - columnRect.left - labelWidth - safe;
        const useLeft = preferred === 'left';
        placement = useLeft ? 'inside-left' : 'inside-right';
        left = useLeft ? minLeft : maxLeft;
      }

      line.dataset.labelPlacement = placement;
      label.style.left = `${left}px`;
      label.style.right = 'auto';
    };

    place();
    scroller.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    releaseNowLineGuard = () => {
      scroller.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }

  function render() {
    const wrap = ctx.qs('[data-week-schedule]');
    if (!wrap) return;

    const date = ctx.getDate();
    const days = ctx.planningWeekDates(date);
    const visibleStart = ctx.visibleStartMinutes();
    const visibleEnd = ctx.visibleEndMinutes();
    const visibleHours = Math.max(1, ctx.endHour() - ctx.startHour());
    const hourPx = ctx.pxPerHour();
    const totalHeight = ctx.scheduleTopPad + visibleHours * hourPx + ctx.scheduleBottomPad;
    const todayKey = ctx.ymd(new Date());
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const nowVisible = nowMinutes >= visibleStart && nowMinutes <= visibleEnd;
    const weekNo = ctx.isoWeekNumber(days[0]);

    wrap.style.setProperty('--week-days', days.length);
    wrap.style.setProperty('--week-visible-hours', visibleHours);

    const hourLabels = Array.from({ length: visibleHours + 1 }, (_, index) => {
      const hour = ctx.startHour() + index;
      const label = hour === 24 ? '24:00' : `${String(hour % 24).padStart(2, '0')}:00`;
      return `<span class="week-hour-label" style="top:${ctx.scheduleTopPad + index * hourPx}px">${label}</span>`;
    }).join('');

    const dayHeaders = days.map(day => {
      const key = ctx.ymd(day);
      const current = key === todayKey;
      const past = key < todayKey;
      const info = agendaDay(ctx.loadStateForDate(day), { key, todayKey });
      return `<button type="button" class="week-day-head${current ? ' is-today' : ''}${past ? ' is-past' : ''}" data-week-open-day="${key}" aria-label="${ctx.escAttr(dayLabel(day, info))}"><span class="week-day-head__date"><span>${ctx.esc(day.toLocaleDateString(undefined, { weekday: 'short' }))}</span><strong>${day.getDate()}</strong></span>${dayHeadPlan(info)}</button>`;
    }).join('');
    // An empty week says how blocks are added here: click (or tap) a time in a day.
    const emptyHint = ctx.qs('[data-week-empty-hint]');
    if (emptyHint) emptyHint.hidden = !days.every(day => !(ctx.loadStateForDate(day).blocks || []).length);

    const columns = days.map(day => {
      const key = ctx.ymd(day);
      const dayState = ctx.loadStateForDate(day);
      const currentDay = key === todayKey;
      const pastDay = key < todayKey;
      const visible = (dayState.blocks || [])
        .filter(block => block.start >= visibleStart && block.start < visibleEnd)
        .sort((a, b) => a.start - b.start || b.duration - a.duration);
      const layouts = ctx.layoutBlocks(visible);
      const nowY = ctx.scheduleTopPad + ctx.minutesToPx(nowMinutes - visibleStart);
      const blocks = visible.map(block => {
        const category = ctx.categoryFor(block.categoryId);
        const layout = layouts.get(block.id) || { col: 0, cols: 1 };
        const shown = Math.min(block.duration, visibleEnd - block.start);
        const top = ctx.scheduleTopPad + ctx.minutesToPx(block.start - visibleStart);
        const height = Math.max(24, ctx.minutesToPx(shown));
        const micro = block.duration <= 30;
        const linkedDone = block.linkedType === 'task'
          ? dayState.tasks?.find(item => item.id === block.linkedId)?.done
          : block.linkedType === 'priority'
            ? dayState.priorities?.find(item => item.id === block.linkedId)?.done
            : false;
        const done = !!(block.done || linkedDone);
        const currentBlock = currentDay && nowMinutes >= block.start && nowMinutes < block.start + block.duration;
        const categoryName = category?.name || 'Uncategorized';
        const categoryColor = category?.color || '#746e67';
        const range = `${ctx.time(block.start)}–${ctx.time(block.start + block.duration)}`;
        // The block opens from a button laid over all of it, a sibling of its checkbox (no control inside another);
        // the button says what the copy shows, which screen readers then skip.
        const label = `${block.title || 'Untitled block'}, ${categoryName}, ${range}`;
        return `<div class="week-time-block${micro ? ' is-micro' : ''}${done ? ' done' : ''}${currentBlock ? (done ? ' is-now-done' : ' is-current') : ''}" data-week-open-block="${key}" data-week-block-id="${ctx.escAttr(block.id)}" style="top:${top}px;height:${height}px;left:calc(${layout.col * (100 / layout.cols)}% + ${layout.col ? 2 : 0}px);width:calc(${100 / layout.cols}% - ${layout.cols > 1 ? 4 : 3}px);--block-color:${categoryColor}"><div class="week-time-block__copy" aria-hidden="true"><strong>${ctx.esc(block.title || 'Untitled block')}</strong><div class="week-time-block__meta"><span class="week-time-block__category"><i style="background:${categoryColor}"></i><span class="week-time-block__category-name">${ctx.esc(categoryName)}</span></span><span class="week-time-block__separator">·</span><span class="week-time-block__time">${range}</span></div></div><button type="button" class="week-time-block__open" data-week-block-open aria-label="${ctx.escAttr(label)}"></button><input class="check week-time-block__check" type="checkbox" data-week-block-check="${key}" data-week-block-check-id="${ctx.escAttr(block.id)}" ${done ? 'checked' : ''} aria-label="Mark block done"><div class="resize week-time-block__resize" data-week-block-resize="${key}" data-week-block-resize-id="${ctx.escAttr(block.id)}" aria-hidden="true"></div></div>`;
      }).join('');
      const line = currentDay && nowVisible
        ? `<div class="week-now-line" style="top:${nowY}px"><span>${ctx.time(nowMinutes)}</span></div>`
        : '';
      return `<div class="week-day-column${currentDay ? ' is-today' : ''}${pastDay ? ' is-past' : ''}" data-week-day="${key}" style="height:${totalHeight}px">${line}<div class="week-schedule-hover" hidden><span></span></div>${blocks}</div>`;
    }).join('');

    wrap.innerHTML = `<div class="week-schedule-head"><span class="week-gutter-head"><small>Week</small><strong>${weekNo}</strong></span>${dayHeaders}</div><div class="week-schedule-body" style="--week-days:${days.length};height:${totalHeight}px"><div class="week-hour-gutter">${hourLabels}</div>${columns}</div>`;
    renderWeekAgenda(ctx, days, todayKey);

    bindNowLineGuard(wrap);

    ctx.qsa('[data-week-open-day]', wrap).forEach(button => button.addEventListener('click', () => ctx.openDay(button.dataset.weekOpenDay)));

    ctx.qsa('[data-week-open-block]', wrap).forEach(blockElement => {
      const dayKey = blockElement.dataset.weekOpenBlock;
      const blockId = blockElement.dataset.weekBlockId;

      const open = event => {
        event?.stopPropagation?.();
        const sourceState = ctx.loadStateForDate(ctx.dateFromKey(dayKey));
        const block = sourceState.blocks.find(item => item.id === blockId);
        if (block) ctx.openBlock(block, { sourceDate: dayKey, sourceState });
      };

      blockElement.addEventListener('pointerdown', event => {
        if (event.target.closest?.('[data-week-block-check], [data-week-block-resize]')) return;
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const sourceState = ctx.loadStateForDate(ctx.dateFromKey(dayKey));
        const block = sourceState.blocks.find(item => item.id === blockId);
        if (!block) return;

        const startY = event.clientY;
        const original = block.start;
        let latest = original;
        let targetDayKey = dayKey;
        let dragging = false;
        let moved = false;
        let dragBody = null;
        let dragScroller = null;
        const holdTimer = setTimeout(beginDrag, 160);
        blockElement.setPointerCapture?.(event.pointerId);
        blockElement.classList.add('is-pressed');

        const clearDropTarget = () => ctx.qsa('.week-day-column.is-drop-target', wrap).forEach(column => column.classList.remove('is-drop-target'));

        function targetColumnAt(clientX) {
          const columns = ctx.qsa('.week-day-column', wrap);
          if (!columns.length) return null;
          let match = columns.find(column => {
            const rect = column.getBoundingClientRect();
            return clientX >= rect.left && clientX <= rect.right;
          });
          if (match) return match;
          return columns.reduce((best, column) => {
            const rect = column.getBoundingClientRect();
            const distance = Math.abs(clientX - (rect.left + rect.width / 2));
            return !best || distance < best.distance ? { column, distance } : best;
          }, null)?.column || null;
        }

        function beginDrag() {
          if (dragging) return;
          dragging = true;
          blockElement.classList.remove('is-pressed');
          blockElement.classList.add('is-dragging');
          dragBody = ctx.qs('.week-schedule-body', wrap);
          dragScroller = ctx.qs('.schedule-scroll');
          if (!dragBody) return;
          const blockRect = blockElement.getBoundingClientRect();
          const bodyRect = dragBody.getBoundingClientRect();
          blockElement.style.left = `${blockRect.left - bodyRect.left}px`;
          blockElement.style.width = `${blockRect.width}px`;
          blockElement.style.top = `${blockRect.top - bodyRect.top}px`;
          blockElement.style.position = 'absolute';
          dragBody.append(blockElement);
          // Re-establish capture after reparenting so the drag keeps tracking
          // across day columns and while the week scroller moves.
          blockElement.setPointerCapture?.(event.pointerId);
        }

        const move = moveEvent => {
          if (!dragging || !dragBody) return;

          if (dragScroller) {
            const scrollerRect = dragScroller.getBoundingClientRect();
            const edge = 44;
            if (moveEvent.clientX < scrollerRect.left + edge) dragScroller.scrollLeft = Math.max(0, dragScroller.scrollLeft - 14);
            else if (moveEvent.clientX > scrollerRect.right - edge) dragScroller.scrollLeft += 14;
          }

          const delta = ctx.snapMinutes(ctx.pxToMinutes((moveEvent.clientY - startY) / ctx.visualScale(blockElement)));
          latest = ctx.clamp(original + delta, visibleStart, visibleEnd - ctx.snap);
          const targetColumn = targetColumnAt(moveEvent.clientX);
          if (targetColumn) targetDayKey = targetColumn.dataset.weekDay || dayKey;
          moved = moved || Math.abs(latest - original) >= ctx.snap || targetDayKey !== dayKey;

          clearDropTarget();
          targetColumn?.classList.add('is-drop-target');

          const bodyRect = dragBody.getBoundingClientRect();
          if (targetColumn) {
            const targetRect = targetColumn.getBoundingClientRect();
            blockElement.style.left = `${targetRect.left - bodyRect.left + 2}px`;
            blockElement.style.width = `${Math.max(28, targetRect.width - 5)}px`;
          }
          blockElement.style.top = `${ctx.scheduleTopPad + ctx.minutesToPx(latest - visibleStart)}px`;
          const time = ctx.qs('.week-time-block__time', blockElement);
          if (time) time.textContent = `${ctx.time(latest)}–${ctx.time(latest + block.duration)}`;
        };

        const endDrag = endEvent => {
          clearTimeout(holdTimer);
          blockElement.removeEventListener('pointermove', move);
          blockElement.removeEventListener('pointerup', endDrag);
          blockElement.removeEventListener('pointercancel', endDrag);
          try { blockElement.releasePointerCapture?.(endEvent.pointerId); } catch (_) {}
          blockElement.classList.remove('is-pressed', 'is-dragging');
          clearDropTarget();

          if (!dragging) {
            open(endEvent);
            return;
          }
          if (moved) ctx.moveWeekBlock(dayKey, blockId, latest, targetDayKey);
          else render();
        };

        blockElement.addEventListener('pointermove', move);
        blockElement.addEventListener('pointerup', endDrag);
        blockElement.addEventListener('pointercancel', endDrag);
      });

      // Enter, Space and a screen reader's own activation click the open button without a pointer (detail 0);
      // a pointer opens the block from pointerup above, unless it dragged it.
      ctx.qs('[data-week-block-open]', blockElement)?.addEventListener('click', event => {
        if (event.detail === 0) open(event);
      });
    });

    ctx.qsa('[data-week-block-check]', wrap).forEach(check => {
      check.addEventListener('pointerdown', event => event.stopPropagation());
      check.addEventListener('click', event => event.stopPropagation());
      check.addEventListener('change', event => {
        event.stopPropagation();
        ctx.setWeekBlockDone(check.dataset.weekBlockCheck, check.dataset.weekBlockCheckId, check.checked);
      });
    });

    ctx.qsa('[data-week-block-resize]', wrap).forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const dayKey = handle.dataset.weekBlockResize;
        const blockId = handle.dataset.weekBlockResizeId;
        const sourceState = ctx.loadStateForDate(ctx.dateFromKey(dayKey));
        const block = sourceState.blocks.find(item => item.id === blockId);
        const blockElement = handle.closest('.week-time-block');
        if (!block || !blockElement) return;

        const startY = event.clientY;
        const original = block.duration;
        let latest = original;
        handle.setPointerCapture?.(event.pointerId);
        blockElement.classList.add('is-resizing');

        const move = moveEvent => {
          const delta = ctx.snapMinutes(ctx.pxToMinutes((moveEvent.clientY - startY) / ctx.visualScale(blockElement)));
          latest = ctx.clamp(original + delta, ctx.snap, 24 * 60);
          const shown = Math.max(ctx.snap, Math.min(latest, visibleEnd - block.start));
          blockElement.style.height = `${Math.max(24, ctx.minutesToPx(shown))}px`;
          const time = ctx.qs('.week-time-block__time', blockElement);
          if (time) time.textContent = `${ctx.time(block.start)}–${ctx.time(block.start + latest)}`;
          blockElement.classList.toggle('is-micro', latest <= 30);
        };

        const end = endEvent => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          try { handle.releasePointerCapture?.(endEvent.pointerId); } catch (_) {}
          blockElement.classList.remove('is-resizing');
          ctx.resizeWeekBlock(dayKey, blockId, latest);
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
    });

    ctx.qsa('[data-week-day]', wrap).forEach(column => {
      const key = column.dataset.weekDay;
      const hover = ctx.qs('.week-schedule-hover', column);
      const minuteAtEvent = event => {
        const rect = column.getBoundingClientRect();
        const y = (event.clientY - rect.top) / ctx.visualScale(column) - ctx.scheduleTopPad;
        if (y < 0 || y > ctx.minutesToPx(visibleEnd - visibleStart)) return null;
        return ctx.clamp(visibleStart + ctx.snapMinutes(ctx.pxToMinutes(y)), visibleStart, visibleEnd - ctx.snap);
      };

      column.addEventListener('pointermove', event => {
        if (event.target.closest('.week-time-block')) { hover.hidden = true; return; }
        const minute = minuteAtEvent(event);
        if (minute == null) { hover.hidden = true; return; }
        hover.hidden = false;
        hover.style.top = `${ctx.scheduleTopPad + ctx.minutesToPx(minute - visibleStart)}px`;
        ctx.qs('span', hover).textContent = `Add ${ctx.time(minute)}`;
      });
      column.addEventListener('pointerleave', () => { hover.hidden = true; });
      column.addEventListener('click', event => {
        if (event.target.closest('.week-time-block')) return;
        const minute = minuteAtEvent(event);
        if (minute == null) return;
        ctx.openBlock(null, { start: minute, startDate: key });
      });
    });

    const weekKey = `${ctx.ymd(days[0])}:${days.length}`;
    if (innerWidth <= 760 && autoScrollKey !== weekKey) {
      autoScrollKey = weekKey;
      requestAnimationFrame(() => {
        const scroller = ctx.qs('.schedule-scroll');
        if (!scroller) return;
        const todayHead = ctx.qs('.week-day-head.is-today', wrap);
        if (todayHead) {
          const gutter = 54;
          scroller.scrollTo({ left: Math.max(0, todayHead.offsetLeft - gutter - 8), behavior: 'auto' });
        } else {
          scroller.scrollTo({ left: 0, behavior: 'auto' });
        }
      });
    }
  }

  return { render, resetAutoScroll };
}
