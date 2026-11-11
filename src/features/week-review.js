import { esc } from '../lib/text.js';
import { dateFromKey } from '../lib/dates.js';
import { durationLabel } from '../domain/schedule-time.js';
import { activeWeekdays } from '../domain/planning-calendar.js';
import { buildProgressModel } from './progress-model.js';
import { buildWeekShareModel, canShare } from './share-image.js';
import { openShareDialog } from './share-dialog.js';

const SHARE_CELL = { closed: 'is-closed', missed: 'is-missed', joker: 'is-joker', rest: 'is-rest', before: 'is-before', future: 'is-future', today: 'is-today' };
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8v10.7"/><path d="m8.2 7.4 3.8-3.6 3.8 3.6"/><path d="M8.6 10.6H7.2a2 2 0 0 0-2 2v5.6a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2v-5.6a2 2 0 0 0-2-2h-1.4"/></svg>';

/** “Share your week”: the closed week as an image (share-dialog.js). Hidden until a day of the week is closed. */
export function renderWeekShareCta(share) {
  if (!canShare(share)) return '';
  const cells = share.days.map(day => `<i class="hz-paint__cell ${SHARE_CELL[day.state] || ''}${day.state === 'closed' ? ` is-level-${day.level}` : ''}"></i>`).join('');
  return `<div class="week-share"><button type="button" class="week-share__button" data-week-share aria-label="Share your week" aria-describedby="week-share-note">
    <span class="week-share__strip" aria-hidden="true">${cells}</span>
    <span class="week-share__copy"><strong>Share your week</strong><small id="week-share-note">A clean image for a feed or a story, made on this device. Nothing is uploaded.</small></span>
    <span class="week-share__go" aria-hidden="true">${SHARE_ICON}<span>Share</span></span>
  </button></div>`;
}

export function createWeekReviewFeature({
  getDate,
  getState,
  getSettings,
  planningWeekDates,
  isPlanningDay,
  ymd,
  loadStateForDate,
  categoryFor,
  categoryFallback,
  getUnresolvedCounts = () => ({ needs: 0, later: (getSettings().openWork || []).length })
}) {
  function isLastPlanningDay(inputDate) {
    const days = planningWeekDates(inputDate);
    return isPlanningDay(inputDate) && !!days.length && ymd(days[days.length - 1]) === ymd(inputDate);
  }

  let lastShare = null;

  /** The week's planning days as painted cells, with the streak, from the same model as Progress. */
  function weekShareModel(inputDate, review) {
    try {
      const days = planningWeekDates(inputDate);
      if (!days.length) return null;
      const settings = getSettings();
      const currentKey = ymd(getDate());
      const getRecord = key => (key === currentKey ? getState() : loadStateForDate(dateFromKey(key)));
      const planningDays = activeWeekdays(settings);
      const models = new Map();
      const progress = year => {
        if (!models.has(year)) models.set(year, buildProgressModel({ year, today: new Date(), planningDays, getRecord, yearData: settings.horizon?.years?.[year] || null }));
        return models.get(year);
      };
      const cells = days.map(day => {
        const key = ymd(day);
        return progress(day.getFullYear()).months[day.getMonth()].days.find(cell => cell.key === key) || { key, planning: true };
      });
      return buildWeekShareModel({
        cells,
        mainDone: review.mainDone,
        mainTotal: review.mainTotal,
        categories: review.categories.map(item => ({ name: item.cat.name, color: item.cat.color, minutes: item.minutes })),
        scheduledMinutes: review.scheduledMinutes,
        streak: progress(days[days.length - 1].getFullYear()).streak.current,
        lines: review.lessons
      });
    } catch (_) {
      return null;
    }
  }

  function weekReviewData(inputDate) {
    const days = planningWeekDates(inputDate);
    const currentDate = getDate();
    const currentState = getState();
    const settings = getSettings();
    let mainDone = 0, mainTotal = 0, carried = 0, dropped = 0;
    const postponed = [];
    const lessons = [];
    const moved = [];
    const categoryMinutes = new Map();

    days.forEach(dayDate => {
      const dayKey = ymd(dayDate);
      const dayState = dayKey === ymd(currentDate) ? currentState : loadStateForDate(dayDate);
      const main = dayState.priorities[0];
      if (main?.text?.trim()) { mainTotal += 1; if (main.done) mainDone += 1; }
      dayState.priorities.filter(item => item.text?.trim() && item.done).forEach(item => moved.push(item.text.trim()));
      (dayState.triaged || []).forEach(value => { if (value.includes('@')) carried += 1; if (value.endsWith(':drop')) dropped += 1; });
      [...dayState.priorities, ...dayState.tasks]
        .filter(item => item.text?.trim() && Number(item.carriedCount) >= 2)
        .forEach(item => postponed.push({ text: item.text, count: Number(item.carriedCount) }));
      dayState.blocks.forEach(block => {
        const cat = categoryFor(block.categoryId) || categoryFallback();
        categoryMinutes.set(cat.id, { cat, minutes: (categoryMinutes.get(cat.id)?.minutes || 0) + block.duration });
      });
      if (dayState.lesson?.trim()) lessons.push(dayState.lesson.trim());
    });

    (settings.openWork || [])
      .filter(item => Number(item.carriedCount) >= 2)
      .forEach(item => postponed.push({ text: item.text, count: Number(item.carriedCount) }));

    const uniquePostponed = [...new Map(postponed.sort((a, b) => b.count - a.count).map(item => [item.text.toLocaleLowerCase(), item])).values()].slice(0, 4);
    const uniqueMoved = [...new Map(moved.map(text => [text.toLocaleLowerCase(), text])).values()].slice(0, 5);
    const allCategories = [...categoryMinutes.values()].sort((a, b) => b.minutes - a.minutes);
    const scheduledMinutes = allCategories.reduce((total, item) => total + item.minutes, 0);

    const review = {
      mainDone,
      mainTotal,
      carried,
      dropped,
      moved: uniqueMoved,
      postponed: uniquePostponed,
      categories: allCategories.slice(0, 5),
      scheduledMinutes,
      lessons: lessons.slice(-5)
    };
    review.share = weekShareModel(inputDate, review);
    return review;
  }

  function renderWeekReviewSummary(review) {
    const total = Math.max(0, Number(review.scheduledMinutes) || 0);
    const timeRows = review.categories.map(item => {
      const share = total ? Math.max(2, Math.round((item.minutes / total) * 100)) : 0;
      return `<div class="week-review-time-row">
        <div class="week-review-time-row__meta"><span><i style="background:${item.cat.color}"></i>${esc(item.cat.name)}</span><strong>${durationLabel(item.minutes)}</strong></div>
        <div class="week-review-time-track" aria-hidden="true"><i style="--week-review-share:${share}%;--week-review-color:${item.cat.color}"></i></div>
      </div>`;
    }).join('');
    const metrics = `<div class="week-review-metrics">
      <div><span>Main outcomes</span><strong>${review.mainDone}<small> / ${review.mainTotal || 0}</small></strong><em>completed</em></div>
      <div><span>Carried forward</span><strong>${review.carried}</strong><em>items</em></div>
      <div><span>Forgotten</span><strong>${review.dropped}</strong><em>items</em></div>
    </div>`;
    const time = review.categories.length ? `<section class="week-review-section week-review-time">
      <div class="week-review-section__head"><span>Where your scheduled time went</span><strong>${durationLabel(total)}</strong></div>
      <div class="week-review-time-rows">${timeRows}</div>
    </section>` : '';
    const unresolvedCounts = getUnresolvedCounts() || {};
    const unresolvedCount = Math.max(0, Number(unresolvedCounts.needs) || 0) + Math.max(0, Number(unresolvedCounts.later) || 0);
    const unresolvedCopy = unresolvedCount === 1
      ? '1 unresolved item is still waiting for a decision.'
      : `${unresolvedCount} unresolved items are still waiting for a decision.`;
    const unresolved = unresolvedCount ? `<section class="week-review-section week-review-section--unresolved"><div class="week-review-section__head"><span class="week-review-section__title">Still unresolved <em>${unresolvedCount}</em></span><button class="week-review-inline-action" type="button" data-review-open-work><span>Review all</span><span aria-hidden="true">→</span></button></div>${review.postponed.length ? `<div class="week-review-list">${review.postponed.map(item => `<p><span>${esc(item.text)}</span><em>carried ${item.count}×</em></p>`).join('')}</div>` : `<p class="week-review-empty-note">${unresolvedCopy}</p>`}</section>` : '';
    const completed = review.moved.length ? `<section class="week-review-section"><div class="week-review-section__head"><span>Completed outcomes</span></div><div class="week-review-list">${review.moved.map(item => `<p><span>${esc(item)}</span></p>`).join('')}</div></section>` : '';
    const lessons = review.lessons.length ? `<section class="week-review-section"><div class="week-review-section__head"><span>Lessons worth keeping</span></div><div class="week-review-list">${review.lessons.map(item => `<p><span>${esc(item)}</span></p>`).join('')}</div></section>` : '';
    lastShare = canShare(review.share) ? review.share : null;
    return `${metrics}${time}${unresolved}${completed}${lessons}${renderWeekShareCta(review.share)}`;
  }

  // The summary is re-rendered as innerHTML, so its share button is handled by delegation.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-week-share]');
      if (!button || !lastShare) return;
      openShareDialog({ model: lastShare, title: 'Share your week', eyebrow: 'Weekly review', opener: button });
    });
  }

  return { isLastPlanningDay, weekReviewData, renderWeekReviewSummary };
}
