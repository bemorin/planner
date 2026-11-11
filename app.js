import { qs, qsa } from './src/lib/dom.js';
import { esc, escAttr, linkLabel, normalizeUrl, safeUrl } from './src/lib/text.js';
import { clamp, uid } from './src/lib/utils.js';
import { atNoon, ymdKey, dateFromKey, addDaysKey, daysBetweenKeys, weekdayNames } from './src/lib/dates.js';
import { APP_VERSION, snap, minTaskSlots, scheduleTopPad, scheduleBottomPad, PROJECT_GITHUB_URL, GITHUB_SPONSOR_URL, SOCIAL_X_URL, SOCIAL_LINKEDIN_URL, CLOUD_API_URL, GOOGLE_CLIENT_ID, DROPBOX_APP_KEY, palette, defaultCategories } from './src/config.js';
import { createPrintFeature } from './src/features/print.js';
import { createPipFeature } from './src/features/pip-window.js';
import { rangeLabel, horizonCountdown, rangeOverlapsMonth, dayInRange, habitQuarterForMonth, habitChecked, habitQuarterBounds, habitActivityStats, horizonTabLine } from './src/features/horizon-model.js';
import { buildHorizonModel, createHorizonView } from './src/features/horizon-view.js';
import { modalEnter, modalExit, popoverEnter, panelEnter, resetMotion } from './src/ui/motion.js';
import { createThemeController } from './src/ui/theme.js';
import { createAppTooltips } from './src/ui/tooltip.js';
import { createOnboarding } from './src/features/onboarding.js';
import { createTour } from './src/features/tour.js';
import { createFirstUse } from './src/features/first-use.js';
import { createInstallFeature } from './src/features/install.js';
import { createSponsorMoment } from './src/features/sponsor-moment.js';
import { createSyncGuide } from './src/features/sync-guide.js';
import { createFeedbackFeature, featureVersion } from './src/features/feedback.js';
import { createPrivacyNotice } from './src/features/privacy.js';
import { createCategoryManager, nextCategoryColor } from './src/features/category-manager.js';
import { buildProgressModel, newlyUnlocked } from './src/features/progress-model.js';
import { markTrophiesSeen, readSeenTrophies, renderDayClosedProgress } from './src/features/progress-view.js';
import { markQuarterNudged, quarterNudgeFor, renderQuarterNudge } from './src/features/quarter-review.js';
import { trackAppActive, trackEvent, trackOncePer } from './src/lib/planner-api.js';
import { viewSummaries } from './src/features/day-summary.js';
import { createViewSwitch } from './src/features/view-switch.js';
import { showPlanner } from './src/features/app-entrance.js';
import { openHelpFromAddress } from './src/features/help-link.js';
import { createBackStack, installBackStack } from './src/ui/back-stack.js';
import { wireBackButton } from './src/features/back-button.js';
import { createLocalStore } from './src/state/local-store.js';
import { BLOCKED_NOTICE, ensureStorage } from './src/state/browser-storage.js';
import { createSyncLedger } from './src/sync/ledger.js';
import { restateRetiredBase } from './src/sync/document.js';
import { createPersonalSyncFeature } from './src/features/personal-sync.js';
import { createSyncStatus } from './src/features/sync-status.js';
import { createBlankDay, normalizeDayState } from './src/state/day-state.js';
import { normalizePlannerSettings } from './src/state/settings-state.js';
import { forgetRetiredData, withoutRetiredSettings } from './src/state/retired-keys.js';
import { buildPlannerBackup, formatStorageBytes } from './src/state/planner-backup.js';
import { openDatePopover, openDateRangePopover } from './src/ui/calendar-popover.js';
import { openListbox } from './src/ui/listbox.js';
import { closeOnTriggerClick } from './src/ui/popover-trigger.js';
import { createDialogReturns, focusDialog, focusOpener, keepTab, twinIn } from './src/ui/dialog-focus.js';
import { createStatsFeature } from './src/features/stats.js';
import { createInsightsFeature, renderInsightsEntry } from './src/features/insights.js';
import { createWeekFeature } from './src/features/week.js';
import { searchPlannerDays, searchSnippet } from './src/features/search.js';
import { createJournal } from './src/features/journal.js';
import { createSaveHealth, LEDGER_KEY, measureStorage, storageBudget, storageLevel } from './src/state/storage-health.js';
import { createStorageAlert, storageSafetyLine } from './src/features/storage-alert.js';
import { createWeekReviewFeature } from './src/features/week-review.js';
import { createWorkspaceFeature } from './src/features/workspace.js';
import { createDaySwipeNavigation, navigationDirection } from './src/features/day-swipe.js';
import { parseVisibleHour, renderPlanningWeekSettings, renderVisibleHourInputs, visibleHourChoices } from './src/features/settings-schedule.js';
import { visualScale, computeFitLayout } from './src/features/fit.js';
import { detectedWeekStart, activeWeekdays as getActiveWeekdays, isPlanningDay as isConfiguredPlanningDay, nextPlanningDateFrom as getNextPlanningDateFrom, previousPlanningDateFrom as getPreviousPlanningDateFrom, firstPlanningSlotAfter, planningWeekStart as getPlanningWeekStart, planningWeekDates as getPlanningWeekDates } from './src/domain/planning-calendar.js';
import { elapsedMinutesForDate, durationLabel, clockTime, pad2, padHour, parseTimeValue, time, blockEndDateKey as getBlockEndDateKey, blockTimeRange as getBlockTimeRange } from './src/domain/schedule-time.js';
import { parseChecklistLine as parseBlockChecklistLine, renderBlockNotesPreview, blockNoteLineHtml, dayNoteLineHtml } from './src/domain/note-lines.js';
(() => {
  // Cookies and site data blocked: the planner runs on memory for this tab and says so (checkLocalStorage).
  const { localStorage: browserStorage, blocked: storageBlocked } = ensureStorage(window);
  const syncLedger = createSyncLedger(browserStorage);
  let personalSyncFeature = null;
  // The Journal keeps a light index of the saved days while it is open (src/features/journal.js): a saved day redraws it.
  let journal = null;
  // A write the browser refuses (its storage full) is told, in the header and in Data on this device, until one lands
  // (src/state/storage-health.js, src/features/storage-alert.js); so is storage 80% full. Nothing throws into the planner.
  let storageAlert = null;
  let storageNow = null;
  let localSavingAvailable = true;
  let storageCheckAt = 0;
  let storageCheckTimer = 0;
  // Saves landing again means storage changed: it is measured once more at once, not a minute later.
  const saveHealth = createSaveHealth({ onChange: change => { renderStorageState(); if (!change.failing) checkStorageSoon({ soon: true }); } });
  // Saving never worked in this browser (blocked, or no room at all, as in some private windows): the startup dialog says so.
  const savingUnavailable = () => storageBlocked || (!localSavingAvailable && !saveHealth.saved);
  const syncInUse = () => { const sync = personalSyncFeature?.getState?.(); return !!(sync?.configured && sync.connected); };
  const store = createLocalStore(browserStorage, {
    onMutation: mutation => {
      const marked = syncLedger.recordMutation(mutation);
      if (marked !== null) saveHealth.note({ key: LEDGER_KEY, ok: marked });
      personalSyncFeature?.noteLocalChange?.();
      journal?.noteMutation(mutation);
    },
    onWrite: result => { saveHealth.note(result); if (result.ok && result.tracked) retryRefused(); }
  });
  // A write landed, so there is room again: what was refused and is still held here (the day on screen, the
  // settings) is written once more, rather than waiting for its next change.
  let retrying = false;
  function retryRefused() {
    if (retrying || !saveHealth.failing) return;
    retrying = true;
    try {
      const refused = saveHealth.keys();
      if (refused.includes(storageKey())) store.writeJSON(storageKey(), state);
      if (refused.includes('daily-planner:settings')) persistSettings();
    } finally {
      retrying = false;
    }
  }
  let date = atNoon(new Date());
  let state;
  // Keys of the paid add-on of earlier releases go, once; the settings are left as they are, and their sync base is
  // restated without its fields before anything saves them (src/state/retired-keys.js, src/sync/document.js).
  forgetRetiredData(browserStorage);
  restateRetiredBase(store, syncLedger);
  let settings = loadSettings();
  let saveTimer;
  let settingsTimer;
  let activeModal = null;
  // A dialog opened with { stack: true } returns to the one beneath it (and the control that opened it) when it closes.
  const stackedReturns = new WeakMap();
  // Every dialog gives focus back to what opened it (src/ui/dialog-focus.js).
  const dialogReturns = createDialogReturns();
  let activePopover = null;
  let blockDraft = null;
  let blockTimeDraft = { startDate: '', startMinutes: 9 * 60, endDate: '', endMinutes: 10 * 60, categoryId: '' };
  let categoryDraftColor = '';
  let blockDoneDraft = false;
  let blockEndDateExplicit = false;
  let initialScheduleScrollDone = false;
  // Floating window (src/features/pip-window.js): it shows the selected day and redraws with it.
  let pipFeature = null;
  const renderPip = options => pipFeature?.render(options);
  let categoryReturnModal = null;
  let confirmationReturnModal = null;
  let confirmationReturnScrollTop = 0;
  let openWorkReturnModal = null;
  let openWorkReturnScrollTop = 0;
  const appTooltips = createAppTooltips({ getActiveModal: () => activeModal });
  const hideAppTooltip = () => appTooltips.hide();
  let endDayTargetDate = null;
  let endDayActions = new Map();
  let openWorkView = 'needs';
  let openWorkPendingPlans = new Map();
  let dayClosedNextDate = null;
  let dayClosedWeekComplete = false;
  let dayClosedStage = 'prep';
  let endDayMemoryDraft = '';
  let endDayLessonDraft = '';
  let endDayHabitDraft = null;
  let horizonYear = date.getFullYear();
  let horizonMonth = date.getMonth();
  let plannerRangeView = 'day';
  // Back closes what is open, the topmost first, then goes back to the view the planner opened on (src/ui/back-stack.js).
  const backStack = installBackStack(createBackStack({ baseView: plannerRangeView }));
  let pendingConfirmAction = null;
  let categoryAddContext = 'settings';
  let progressCache = { year: null, at: 0, model: null };

  // ---------------------------------------------------------------------------
  // Runtime state and date helpers
  // ---------------------------------------------------------------------------

  function ymd(d = date) { return ymdKey(d); }

  function formatDateButton(key) {
    const d = dateFromKey(key);
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  }

  function storageKey() { return `daily-planner:${ymd()}`; }
  function startHour() { return clamp(Number(settings.startHour ?? 6), 0, 23); }
  function endHour() { return clamp(Number(settings.endHour ?? 22), startHour() + 1, 24); }
  function visibleStartMinutes() { return startHour() * 60; }
  function visibleEndMinutes() { return endHour() * 60; }

  const activeWeekdays = () => getActiveWeekdays(settings);
  const isPlanningDay = inputDate => isConfiguredPlanningDay(inputDate, settings);
  const nextPlanningDateFrom = (inputDate, options) => getNextPlanningDateFrom(inputDate, settings, options);
  const defaultEndDayTarget = () => ymd(date) < ymd(new Date()) ? nextPlanningDateFrom(new Date(), { includeCurrent: true }) : nextPlanningDateFrom(date);
  const previousPlanningDateFrom = (inputDate, options) => getPreviousPlanningDateFrom(inputDate, settings, options);
  const planningWeekStart = inputDate => getPlanningWeekStart(inputDate, settings);
  const planningWeekDates = inputDate => getPlanningWeekDates(inputDate, settings);

  // ---------------------------------------------------------------------------
  // Day state and settings persistence
  // ---------------------------------------------------------------------------

  function loadSettings() {
    try {
      const raw = store.readJSON('daily-planner:settings');
      return normalizePlannerSettings(raw, { detectedWeekStart: detectedWeekStart(), currentYear: new Date().getFullYear() });
    } catch (_) {
      return normalizePlannerSettings(null, { detectedWeekStart: detectedWeekStart(), currentYear: new Date().getFullYear() });
    }
  }

  function persistSettings() {
    try { store.writeJSON('daily-planner:settings', settings); } catch (_) {}
  }

  // After an import, a sync or a reset.
  const reloadSettings = () => { settings = loadSettings(); };

  function saveSettings({ rerenderSettings = true } = {}) {
    persistSettings();
    if (rerenderSettings) renderCategorySettings();
    renderSettingsHours();
    renderPlanningWeek();
    renderScheduleRange();
    renderItems();
    renderStats();
    refreshBlockCategoryTrigger();
    updateNow();
    initialScheduleScrollDone = false;
    weekFeature?.resetAutoScroll?.();
    requestAnimationFrame(() => scrollScheduleToRelevantTime());
    renderPip();
  }

  function saveSettingsDebounced() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      persistSettings();
      renderScheduleRange();
      renderItems();
      renderStats();
      refreshBlockCategoryTrigger();
    }, 130);
  }

  function load() {
    // What was on screen is replaced by what storage holds: a change it refused is gone (the notice stays).
    saveHealth.reloaded();
    try { state = normalizeDayState(store.readJSON(storageKey()), ymd()); }
    catch (_) { state = createBlankDay(); }
    initialScheduleScrollDone = false;
    render();
    renderPip();
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { store.writeJSON(storageKey(), state); } catch (_) {}
      checkStorageSoon();
    }, 70);
    renderPip();
    viewSwitch.refresh();
  }

  // ---------------------------------------------------------------------------
  // Primary Day rendering
  // ---------------------------------------------------------------------------

  function render() {
    renderDate();
    qs('[data-focus]').value = state.focus;
    autoGrowInlineField(qs('[data-focus]'));
    setDayNotesEditor(state.notes);
    autoGrowNotes();
    renderItems();
    renderScheduleRange();
    updateNow();
    renderStats();
    renderSettingsHours();
    renderPlanningWeek();
    checkStorageSoon();
    updateEndDayButton();
    applyExpandedView();
    updatePrintSizing();
    viewSwitch.refresh();
    if (!initialScheduleScrollDone) {
      initialScheduleScrollDone = true;
      requestAnimationFrame(() => scrollScheduleToRelevantTime());
    }
  }

  function fitHeaderDate() {
    const title = qs('.date-title');
    const heading = title?.querySelector('h1');
    if (!title || !heading) return;
    // Let flexbox allocate the real remaining header width first. Only shorten
    // the date when the currently visible label actually overflows that space.
    // Where the weekday line is hidden (phones), "Wed, Oct 7" keeps the weekday.
    const variants = qs('[data-weekday]')?.offsetParent ? ['full', 'medium', 'short'] : ['compact', 'short'];
    variants.some(variant => { title.dataset.dateVariant = variant; return heading.scrollWidth <= heading.clientWidth + 1; });
  }

  function renderDate() {
    const weekday = qs('[data-weekday]');
    const full = qs('[data-date]');
    const medium = qs('[data-date-medium]');
    const short = qs('[data-date-short]');
    const compact = qs('[data-date-compact]');
    if (plannerRangeView === 'week') {
      const days = planningWeekDates(date);
      const first = days[0]; const last = days[days.length - 1];
      weekday.textContent = `Week ${isoWeekNumber(first)}`;
      const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
      if (sameMonth) {
        const monthLong = last.toLocaleDateString(undefined, { month: 'long' });
        const monthShort = last.toLocaleDateString(undefined, { month: 'short' });
        full.textContent = `${first.getDate()}–${last.getDate()} ${monthLong} ${last.getFullYear()}`;
        medium.textContent = `${first.getDate()}–${last.getDate()} ${monthLong}`;
        short.textContent = `${first.getDate()}–${last.getDate()} ${monthShort}`;
      } else {
        const sameYear = first.getFullYear() === last.getFullYear();
        full.textContent = sameYear
          ? `${first.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} – ${last.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
          : `${first.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} – ${last.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`;
        medium.textContent = sameYear
          ? `${first.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
          : `${first.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })} – ${last.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })}`;
        short.textContent = `${first.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}–${last.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
      }
      compact.textContent = short.textContent;
    } else {
      weekday.textContent = date.toLocaleDateString(undefined, { weekday: 'long' });
      full.textContent = date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
      medium.textContent = date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
      short.textContent = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      compact.textContent = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    }
    requestAnimationFrame(fitHeaderDate);
    const todayLabel = qs('[data-today-label]');
    if (todayLabel) todayLabel.textContent = 'Now';
    qs('[data-today-day]')?.replaceChildren(String(new Date().getDate()));
    const todayButton = qs('[data-today]');
    if (todayButton) {
      const todayInView = plannerRangeView === 'week' ? ymd(planningWeekStart(date)) === ymd(planningWeekStart(new Date())) : isToday();
      todayButton.classList.toggle('is-away', !todayInView);
      todayButton.dataset.tooltip = 'Go to now';
      todayButton.setAttribute('aria-label', 'Go to now');
    }
    viewSwitch.sync();
    const prevButton = qs('[data-prev]');
    const nextButton = qs('[data-next]');
    if (prevButton) {
      prevButton.dataset.tooltip = plannerRangeView === 'week' ? 'Previous week' : 'Previous planning day';
      prevButton.setAttribute('aria-label', plannerRangeView === 'week' ? 'Previous week' : 'Previous planning day');
    }
    if (nextButton) {
      nextButton.dataset.tooltip = plannerRangeView === 'week' ? 'Next week' : 'Next planning day';
      nextButton.setAttribute('aria-label', plannerRangeView === 'week' ? 'Next week' : 'Next planning day');
    }
  }

  function autoGrowInlineField(field) {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.max(field.scrollHeight, 20)}px`;
  }

  function renderItems() {
    const mit = qs('[data-mit]');
    mit.innerHTML = '';
    mit.append(createItemRow(state.priorities[0], 'priority', 0, 'e.g. Send the final proposal'));

    const secondary = qs('[data-secondary-priorities]');
    secondary.innerHTML = '';
    state.priorities.slice(1).forEach((item, index) => secondary.append(createItemRow(item, 'priority', index + 1, index === 0 ? 'Another outcome worth moving forward' : 'One more, if it truly matters')));

    while (state.tasks.length < minTaskSlots) state.tasks.push({ id: uid('task'), text: '', done: false, carriedCount: 0 });
    const tasks = qs('[data-tasks]');
    tasks.innerHTML = '';
    state.tasks.forEach((item, index) => tasks.append(createItemRow(item, 'task', index, 'Concrete action')));
    const addTask = qs('[data-task-add-toggle]');
    if (addTask) addTask.hidden = state.tasks.some(item => !item.text.trim());
    // Rows are measured while detached; size them again once they're laid out.
    requestAnimationFrame(regrowItemFields);
  }
  function regrowItemFields() { qsa('.item-input, [data-focus]').forEach(autoGrowInlineField); }
  function createItemRow(item, type, index, placeholder) {
    // Tasks and the other outcomes sit in lists (<ul>, <ol>); the main outcome stands alone.
    const row = document.createElement(type === 'task' || index > 0 ? 'li' : 'div');
    const scheduled = linkedBlock(type, item.id);
    const empty = !item.text.trim();
    row.className = `item-row ${type}${item.done ? ' done' : ''}${empty ? ' is-empty' : ''}${scheduled ? ' is-scheduled' : ''}`;
    row.dataset.itemId = item.id;
    row.dataset.itemType = type;
    if (type === 'task') row.dataset.taskIndex = index;

    const timeMeta = scheduled
      ? `<button type="button" class="item-time" data-open-linked-block aria-label="Edit scheduled block">${time(scheduled.start)}–${time(scheduled.start + scheduled.duration)}</button>`
      : '<span class="item-time" aria-hidden="true"></span>';

    const editIcon = scheduled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4ZM13.8 6.2l4 4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M12 12v5M9.5 14.5h5"/></svg>';

    const openDays = item.originDay ? Math.max(0, daysBetweenKeys(item.originDay, ymd(date))) : 0;
    const historyMeta = Number(item.carriedCount) > 0 ? `<small class="item-history"><span>Moved ${Number(item.carriedCount)}×</span></small>` : '';
    row.innerHTML = `
      <input class="check" type="checkbox" aria-label="Mark as done" ${item.done ? 'checked' : ''}>
      <div class="item-main">
        <textarea class="item-input" rows="1" placeholder="${escAttr(placeholder)}" maxlength="220">${esc(item.text)}</textarea>${historyMeta}
      </div>
      ${timeMeta}
      <div class="item-actions">
        ${type === 'task' ? `<button class="task-action task-action--remove" type="button" data-remove-task aria-label="Delete task" data-tooltip="Delete" ${empty ? 'hidden' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>` : `<button class="task-action item-clear-action" type="button" data-clear-item aria-label="Clear outcome" data-tooltip="Clear" ${empty ? 'hidden' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>`}
        <button class="task-action" type="button" data-schedule-item aria-label="${scheduled ? 'Edit scheduled time' : `Schedule this ${type}`}" data-tooltip="${scheduled ? 'Edit schedule' : 'Schedule'}" ${type === 'task' && empty ? 'hidden' : ''}>${editIcon}</button>
      </div>`;

    const checkbox = qs('.check', row);
    const input = qs('.item-input', row);
    const scheduleButton = qs('[data-schedule-item]', row);
    autoGrowInlineField(input);
    checkbox.addEventListener('change', () => {
      item.done = checkbox.checked;
      state.blocks
        .filter(block => block.linkedType === type && block.linkedId === item.id)
        .forEach(block => setBlockDone(block, item.done));
      row.classList.toggle('done', item.done);
      renderBlocks();
      renderStats();
      save();
    });
    input.addEventListener('input', () => {
      item.text = input.value;
      autoGrowInlineField(input);
      const nowEmpty = !item.text.trim();
      row.classList.toggle('is-empty', nowEmpty);
      qs('[data-clear-item]', row)?.toggleAttribute('hidden', nowEmpty);
      if (type === 'task') {
        qs('[data-remove-task]', row)?.toggleAttribute('hidden', nowEmpty);
        qs('[data-schedule-item]', row)?.toggleAttribute('hidden', nowEmpty);
        const addTask = qs('[data-task-add-toggle]');
        if (addTask) addTask.hidden = state.tasks.some(task => !task.text.trim());
      }
      state.blocks.filter(b => b.linkedType === type && b.linkedId === item.id).forEach(b => { b.title = item.text; });
      renderBlocks();
      save();
    });
    row.addEventListener('click', event => {
      if (event.target.closest('.check, .task-action, .item-time, button, a') || event.target === input) return;
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    });
    scheduleButton.addEventListener('click', () => {
      if (type === 'task' && !item.text.trim()) return;
      const existing = linkedBlock(type, item.id);
      if (existing) openBlockModal(existing);
      else openBlockModal(null, { title: item.text, linkedType: type, linkedId: item.id, start: recommendedStart() });
    });
    qs('[data-open-linked-block]', row)?.addEventListener('click', () => openBlockModal(linkedBlock(type, item.id)));
    if (type === 'task') qs('[data-remove-task]', row).addEventListener('click', () => {
      const hasBlock = !!linkedBlock('task', item.id);
      requestConfirmation({
        eyebrow: 'Delete task',
        title: 'Delete this task?',
        message: hasBlock ? 'The task and its linked schedule block will both be removed.' : 'The task will be removed from this day.',
        confirmLabel: 'Delete',
        action: () => removeTask(item.id)
      });
    });
    qs('[data-clear-item]', row)?.addEventListener('click', () => {
      const hasBlock = !!linkedBlock(type, item.id);
      requestConfirmation({
        eyebrow: 'Clear outcome',
        title: 'Clear this outcome?',
        message: hasBlock ? 'The outcome and its linked schedule block will both be removed.' : 'The outcome will be cleared from this day.',
        confirmLabel: 'Clear',
        action: () => { item.text = ''; item.done = false; state.blocks = state.blocks.filter(b => !(b.linkedType === type && b.linkedId === item.id)); renderItems(); renderBlocks(); renderStats(); save(); }
      });
    });
    return row;
  }
  function removeTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    state.blocks = state.blocks.filter(b => !(b.linkedType === 'task' && b.linkedId === id));
    while (state.tasks.length < minTaskSlots) state.tasks.push({ id: uid('task'), text: '', done: false, carriedCount: 0 });
    renderItems();
    renderBlocks();
    renderStats();
    save();
  }
  function linkedBlock(type, id) {
    return state.blocks.find(b => b.linkedType === type && b.linkedId === id) || null;
  }

  function categoryFor(id) {
    return settings.categories.find(c => c.id === id) || null;
  }

  function sourceForBlock(block) {
    if (!block?.linkedType || !block?.linkedId) return null;
    if (block.linkedType === 'task') return state.tasks.find(item => item.id === block.linkedId) || null;
    if (block.linkedType === 'priority') return state.priorities.find(item => item.id === block.linkedId) || null;
    return null;
  }

  function isBlockDone(block) {
    const source = sourceForBlock(block);
    return source ? !!source.done : !!block.done;
  }

  function setBlockDone(block, done) {
    block.done = !!done;
    if (done) {
      if (!block.completedAt && isToday()) {
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (nowMinutes >= block.start) {
          block.completedAt = now.toISOString();
          block.actualDuration = Math.max(snap, nowMinutes - block.start);
        }
      }
    } else {
      block.completedAt = '';
      block.actualDuration = null;
    }
    const source = sourceForBlock(block);
    if (source) source.done = !!done;
  }

  // ---------------------------------------------------------------------------
  // Schedule rendering and block interaction
  // ---------------------------------------------------------------------------

  function renderBlocks() {
    const schedule = qs('[data-schedule]');
    const visibleHours = endHour() - startHour();
    const totalVisibleMinutes = Math.max(1, visibleEndMinutes() - visibleStartMinutes());
    schedule.style.setProperty('--visible-hours', visibleHours);

    const hours = qs('[data-hours]');
    hours.innerHTML = '';
    const hourPx = pxPerHour();
    for (let h = startHour(); h <= endHour(); h++) {
      const el = document.createElement('span');
      el.className = 'hour-label';
      el.style.top = `${scheduleTopPad + (h - startHour()) * hourPx}px`;
      el.style.setProperty('--print-top', `${((h - startHour()) / visibleHours) * 100}%`);
      const label = h === 24 ? '24:00' : `${String(h % 24).padStart(2, '0')}:00`;
      el.innerHTML = `<span class="hour-label__text">${label}</span>`;
      hours.append(el);
    }

    const wrap = qs('[data-blocks]');
    wrap.innerHTML = '';
    const visible = state.blocks
      .filter(b => b.start >= visibleStartMinutes() && b.start < visibleEndMinutes())
      .sort((a, b) => a.start - b.start || b.duration - a.duration);
    const layouts = layoutBlocks(visible);

    visible.forEach(block => {
      const cat = categoryFor(block.categoryId);
      const layout = layouts.get(block.id) || { col: 0, cols: 1 };
      const el = document.createElement('article');
      const done = isBlockDone(block);
      block.done = done;
      const densityClass = block.duration <= 30 ? ' is-micro' : block.duration <= 45 ? ' is-compact' : '';
      const nowDate = new Date();
      const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
      const currentBlock = isToday() && nowMinutes >= block.start && nowMinutes < block.start + block.duration;
      const shownDuration = Math.min(block.duration, visibleEndMinutes() - block.start);
      const blockHeight = Math.max(30, minutesToPx(shownDuration));
      const titleLines = block.duration <= 30 ? 1 : clamp(Math.floor((blockHeight - 28) / 16), 2, 5);
      const noteLines = block.duration > 60 ? clamp(Math.floor((blockHeight - (56 + titleLines * 14)) / 14), 0, 5) : 0;
      el.className = `time-block${done ? ' done' : ''}${densityClass}${currentBlock ? (done ? ' is-now-done' : ' is-current') : ''}`;
      el.dataset.blockId = block.id;
      el.style.top = `${minutesToPx(block.start - visibleStartMinutes())}px`;
      el.style.height = `${blockHeight}px`;
      el.style.setProperty('--print-top', `${((block.start - visibleStartMinutes()) / totalVisibleMinutes) * 100}%`);
      el.style.setProperty('--print-height', `${(shownDuration / totalVisibleMinutes) * 100}%`);
      el.style.setProperty('--block-color', cat?.color || '#716b64');
      el.style.setProperty('--note-lines', noteLines);
      el.style.setProperty('--title-lines', titleLines);
      el.style.left = `calc(${layout.col * (100 / layout.cols)}% + ${layout.col ? 2 : 0}px)`;
      el.style.width = `calc(${100 / layout.cols}% - ${layout.cols > 1 ? 4 : 3}px)`;
      const link = safeUrl(block.link);
      const showLink = !!link && block.duration >= 60;
      const overrun = Number(block.actualDuration) > block.duration ? Number(block.actualDuration) - block.duration : 0;
      el.innerHTML = `
        <div class="time-block__top">
          <div class="time-block__title">${esc(block.title || 'Untitled block')}</div>
          <span class="time-block__micro-time">${blockTimeRange(block)}</span>
          <input class="block-check" type="checkbox" aria-label="Mark block as done" ${done ? 'checked' : ''}>
        </div>
        <div class="time-block__meta">${cat ? `<span class="category-dot" style="background:${cat.color}"></span><span>${esc(cat.name)}</span><span>·</span>` : ''}<span>${durationLabel(block.duration)}</span><span>·</span><span>${blockTimeRange(block)}</span>${overrun ? `<span class="time-block__overrun">+${durationLabel(overrun)}</span>` : ''}</div>
        ${showLink ? `<a class="time-block__link" href="${escAttr(link)}" target="_blank" rel="noopener" aria-label="Open block link"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></svg><span>${esc(linkLabel(link))}</span></a>` : ''}
        ${block.notes && noteLines > 0 ? `<div class="time-block__notes">${renderBlockNotesPreview(block.notes)}</div>` : ''}
        <div class="resize" aria-hidden="true"></div>`;
      const blockCheck = qs('.block-check', el);
      blockCheck.addEventListener('pointerdown', e => e.stopPropagation());
      blockCheck.addEventListener('click', e => e.stopPropagation());
      blockCheck.addEventListener('change', () => {
        setBlockDone(block, blockCheck.checked);
        renderItems();
        renderBlocks();
        renderStats();
        save();
      });
      qs('.time-block__link', el)?.addEventListener('pointerdown', e => e.stopPropagation());
      qs('.time-block__link', el)?.addEventListener('click', e => e.stopPropagation());
      setupBlockInteraction(el, block);
      setupBlockResize(qs('.resize', el), block, el);
      wrap.append(el);
    });
  }

  function setWeekBlockDone(dayKey, blockId, done) {
    const targetDate = dateFromKey(dayKey);
    const targetState = ymd(targetDate) === ymd(date) ? state : loadStateForDate(targetDate);
    const block = targetState.blocks.find(item => item.id === blockId);
    if (!block) return;
    block.done = !!done;
    const linked = block.linkedType === 'task'
      ? targetState.tasks.find(item => item.id === block.linkedId)
      : block.linkedType === 'priority'
        ? targetState.priorities.find(item => item.id === block.linkedId)
        : null;
    if (linked) linked.done = !!done;
    if (done) { block.completedAt = new Date().toISOString(); }
    else { block.completedAt = ''; block.actualDuration = null; }
    if (targetState === state) save(); else persistStateForDate(targetDate, targetState);
    renderWeekSchedule();
    renderStats();
    renderPip();
  }

  function resizeWeekBlock(dayKey, blockId, duration) {
    const targetDate = dateFromKey(dayKey);
    const targetState = ymd(targetDate) === ymd(date) ? state : loadStateForDate(targetDate);
    const block = targetState.blocks.find(item => item.id === blockId);
    if (!block) return;
    block.duration = clamp(Number(duration) || snap, snap, 24 * 60);
    block.startDate = block.startDate || dayKey;
    block.endDate = addDaysKey(block.startDate, Math.floor((block.start + block.duration) / (24 * 60)));
    if (targetState === state) save(); else persistStateForDate(targetDate, targetState);
    renderWeekSchedule();
    if (targetState === state) renderItems();
    renderStats();
    renderPip();
  }

  function moveWeekBlock(dayKey, blockId, start, destinationDayKey = dayKey) {
    const sourceDate = dateFromKey(dayKey);
    const sourceState = ymd(sourceDate) === ymd(date) ? state : loadStateForDate(sourceDate);
    const block = sourceState.blocks.find(item => item.id === blockId);
    if (!block) return;

    const nextStart = clamp(Number(start) || 0, visibleStartMinutes(), visibleEndMinutes() - snap);
    const targetKey = destinationDayKey || dayKey;

    if (targetKey === dayKey) {
      block.start = nextStart;
      block.startDate = dayKey;
      block.endDate = addDaysKey(dayKey, Math.floor((block.start + block.duration) / (24 * 60)));
      if (sourceState === state) save(); else persistStateForDate(sourceDate, sourceState);
    } else {
      const targetDate = dateFromKey(targetKey);
      const targetState = ymd(targetDate) === ymd(date) ? state : loadStateForDate(targetDate);

      sourceState.blocks = sourceState.blocks.filter(item => item.id !== blockId);

      if (block.linkedType && block.linkedId) {
        const sourceItem = block.linkedType === 'priority'
          ? sourceState.priorities.find(item => item.id === block.linkedId)
          : sourceState.tasks.find(item => item.id === block.linkedId);
        const title = sourceItem?.text || block.title || '';
        let linkedType = '';
        let linkedId = '';

        if (block.linkedType === 'priority') {
          const sourceIndex = sourceState.priorities.findIndex(item => item.id === block.linkedId);
          const slot = targetState.priorities[Math.max(0, sourceIndex)] || targetState.priorities.find(item => !item.text.trim());
          if (slot && !slot.text.trim()) {
            slot.text = title;
            slot.done = !!block.done;
            linkedType = 'priority';
            linkedId = slot.id;
          }
        }
        if (!linkedId) {
          let task = targetState.tasks.find(item => !item.text.trim());
          if (!task) {
            task = { id: uid('task'), text: '', done: false, carriedCount: 0 };
            targetState.tasks.push(task);
          }
          task.text = title;
          task.done = !!block.done;
          linkedType = 'task';
          linkedId = task.id;
        }
        block.linkedType = linkedType;
        block.linkedId = linkedId;
      }

      block.start = nextStart;
      block.startDate = targetKey;
      block.endDate = addDaysKey(targetKey, Math.floor((block.start + block.duration) / (24 * 60)));
      targetState.blocks.push(block);

      if (sourceState !== state) persistStateForDate(sourceDate, sourceState);
      if (targetState !== state) persistStateForDate(targetDate, targetState);
      if (sourceState === state || targetState === state) save();
    }

    renderWeekSchedule();
    renderItems();
    renderStats();
    renderPip();
  }

  const weekFeature = createWeekFeature({
    qs, qsa, esc, escAttr, clamp, snap, scheduleTopPad, scheduleBottomPad,
    getDate: () => date,
    planningWeekDates, visibleStartMinutes, visibleEndMinutes, startHour, endHour, pxPerHour,
    minutesToPx, pxToMinutes, snapMinutes, visualScale, isoWeekNumber, ymd, time, dateFromKey,
    loadStateForDate: viewStateForDate, layoutBlocks, categoryFor,
    openDay: dayKey => { date = dateFromKey(dayKey); plannerRangeView = 'day'; load(); },
    openBlock: (block, options) => openBlockModal(block, options),
    setWeekBlockDone,
    resizeWeekBlock,
    moveWeekBlock
  });
  // What the phone's Horizon tab says. A year never opened in Horizon is read as empty, not created.
  const horizonTabSummary = now => { const year = now.getFullYear(); const known = !!settings.horizon?.years?.[year]; return horizonTabLine(buildHorizonModel(known ? horizonYearData(year) : { misogi: '', misogiMilestones: [], miniAdventures: [], meaningful: [], habits: [] }, year, known ? horizonYearKeyDates(year) : [], now)); };
  // Day · Week · Horizon (header) and Plan · Schedule · Horizon (phone bar), with what each holds in a few words.
  const viewSwitch = createViewSwitch({
    qs, qsa, backStack,
    summary: () => { const now = new Date(); const days = plannerRangeView === 'week' ? planningWeekDates(date) : [date]; return { ...viewSummaries(days.map(day => ({ key: ymd(day), state: viewStateForDate(day) })), { todayKey: ymd(now), nowMinutes: now.getHours() * 60 + now.getMinutes() }), horizon: horizonTabSummary(now) }; },
    range: () => plannerRangeView,
    setRange: view => { if (view !== plannerRangeView) toggleWeekView(); },
    openHorizon: () => openHorizon('year', date),
    closeHorizon: () => closeModal(qs('[data-horizon-modal]')),
    setPane: view => setMobileView(view)
  });


  createDaySwipeNavigation({
    element: qs('[data-workspace]'),
    isEnabled: () => innerWidth <= 790
      && plannerRangeView === 'day'
      && !activeModal
      && qs('[data-workspace]')?.dataset.workspaceMode !== 'enterprise',
    onShift: shiftDate
  });

  function renderScheduleRange() {
    const daySchedule = qs('[data-schedule]');
    const weekSchedule = qs('[data-week-schedule]');
    const workspace = qs('[data-workspace]');
    const scheduleTitle = qs('.schedule-head h2');
    const isWeek = plannerRangeView === 'week';
    if (daySchedule) daySchedule.hidden = isWeek;
    if (weekSchedule) weekSchedule.hidden = !isWeek;
    workspace?.classList.toggle('is-week-view', isWeek);
    document.body.classList.toggle('is-week-view', isWeek);
    if (scheduleTitle) scheduleTitle.textContent = 'Schedule';
    if (isWeek) renderWeekSchedule(); else renderBlocks();
  }

  function isoWeekNumber(inputDate) {
    const d = atNoon(new Date(inputDate));
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1, 12);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  function renderWeekSchedule() { weekFeature.render(); viewSwitch.refresh(); }

  function layoutBlocks(blocks) {
    const map = new Map();
    let cluster = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      if (!cluster.length) return;
      const columnEnds = [];
      cluster.forEach(block => {
        const effectiveDuration = Math.max(block.duration, pxToMinutes(30));
        let col = columnEnds.findIndex(end => end <= block.start);
        if (col < 0) col = columnEnds.length;
        columnEnds[col] = block.start + effectiveDuration;
        map.set(block.id, { col, cols: 1 });
      });
      const cols = Math.max(1, columnEnds.length);
      cluster.forEach(block => map.get(block.id).cols = cols);
      cluster = [];
      clusterEnd = -Infinity;
    };
    blocks.forEach(block => {
      const effectiveEnd = block.start + Math.max(block.duration, pxToMinutes(30));
      if (cluster.length && block.start >= clusterEnd) flush();
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, effectiveEnd);
    });
    flush();
    return map;
  }

  function setupBlockInteraction(el, block) {
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('a, .resize, .block-check')) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const original = block.start;
      let latest = original;
      let dragging = false;
      let moved = false;
      const holdTimer = setTimeout(() => beginDrag(), 160);
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('is-pressed');

      function beginDrag() {
        if (dragging) return;
        dragging = true;
        el.classList.remove('is-pressed');
        el.classList.add('is-dragging');
      }

      const move = ev => {
        if (!dragging) return;
        const delta = snapMinutes(pxToMinutes((ev.clientY - startY) / visualScale(el)));
        latest = clamp(original + delta, visibleStartMinutes(), visibleEndMinutes() - snap);
        if (Math.abs(latest - original) >= snap) moved = true;
        el.style.top = `${minutesToPx(latest - visibleStartMinutes())}px`;
        setBlockMeta(el, block, latest, block.duration);
      };

      const end = ev => {
        clearTimeout(holdTimer);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', end);
        el.removeEventListener('pointercancel', end);
        try { el.releasePointerCapture?.(ev.pointerId); } catch (_) {}
        el.classList.remove('is-pressed', 'is-dragging');
        if (!dragging) {
          openBlockModal(block);
          return;
        }
        if (moved) {
          block.start = latest;
          block.startDate = block.startDate || ymd();
          block.endDate = addDaysKey(block.startDate, Math.floor((block.start + block.duration) / (24 * 60)));
        }
        renderBlocks();
        renderItems();
        renderStats();
        save();
      };

      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
  }

  function setupBlockResize(handle, block, blockElement) {
    if (!handle) return;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const original = block.duration;
      let latest = original;
      handle.setPointerCapture?.(e.pointerId);
      blockElement.classList.add('is-resizing');

      const move = ev => {
        const delta = snapMinutes(pxToMinutes((ev.clientY - startY) / visualScale(blockElement)));
        latest = clamp(original + delta, snap, 24 * 60);
        blockElement.style.height = `${Math.max(30, minutesToPx(latest))}px`;
        setBlockMeta(blockElement, block, block.start, latest);
      };

      const end = ev => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        try { handle.releasePointerCapture?.(ev.pointerId); } catch (_) {}
        blockElement.classList.remove('is-resizing');
        block.duration = latest;
        block.startDate = block.startDate || ymd();
        block.endDate = addDaysKey(block.startDate, Math.floor((block.start + block.duration) / (24 * 60)));
        renderBlocks();
        renderItems();
        renderStats();
        save();
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }

  function setBlockMeta(el, block, start, duration) {
    const meta = qs('.time-block__meta', el);
    if (!meta) return;
    const cat = categoryFor(block.categoryId);
    const overrun = Number(block.actualDuration) > duration ? Number(block.actualDuration) - duration : 0;
    meta.innerHTML = `${cat ? `<span class="category-dot" style="background:${cat.color}"></span><span>${esc(cat.name)}</span><span>·</span>` : ''}<span>${durationLabel(duration)}</span><span>·</span><span>${clockTime(start)}–${clockTime(start + duration)}${start + duration >= 24 * 60 ? ' +1d' : ''}</span>${overrun ? `<span class="time-block__overrun">+${durationLabel(overrun)}</span>` : ''}`;
  }

  function handleScheduleClick(e) {
    if (e.target.closest('.time-block')) return;
    const start = scheduleMinuteAtPointer(e);
    if (start == null) return;
    openBlockModal(null, { start });
  }

  function handleSchedulePointerMove(e) {
    const hover = qs('[data-schedule-hover]');
    if (e.target.closest('.time-block')) {
      hover.hidden = true;
      return;
    }
    const minute = scheduleMinuteAtPointer(e);
    if (minute == null) {
      hover.hidden = true;
      return;
    }
    hover.hidden = false;
    hover.style.top = `${scheduleTopPad + minutesToPx(minute - visibleStartMinutes())}px`;
    qs('[data-schedule-hover-label]').textContent = `Add ${time(minute)}`;
  }

  function scheduleMinuteAtPointer(e) {
    const schedule = qs('[data-schedule]');
    const rect = schedule.getBoundingClientRect();
    const y = (e.clientY - rect.top) / visualScale(schedule) - scheduleTopPad;
    if (y < 0 || y > minutesToPx(visibleEndMinutes() - visibleStartMinutes())) return null;
    return clamp(visibleStartMinutes() + snapMinutes(pxToMinutes(y)), visibleStartMinutes(), visibleEndMinutes() - snap);
  }

  // ---------------------------------------------------------------------------
  // Notes editors and lightweight checklist syntax
  // ---------------------------------------------------------------------------

  function setBlockNotesEditor(value = '') {
    const editor = qs('[data-block-notes-editor]');
    const storage = qs('[data-block-notes]');
    if (storage) storage.value = value;
    if (!editor) return;
    const lines = String(value || '').split('\n');
    editor.innerHTML = (lines.length ? lines : ['']).map(blockNoteLineHtml).join('');
  }

  function getBlockNotesValue() {
    const editor = qs('[data-block-notes-editor]');
    if (!editor) return qs('[data-block-notes]')?.value || '';
    return [...editor.children].map(row => {
      const check = row.querySelector('[data-rich-note-check]');
      const text = (row.querySelector('span')?.innerText ?? row.innerText ?? '').replace(/\u00a0/g, ' ').trimEnd();
      return check ? `//${check.classList.contains('is-checked') ? 'x ' : ' '}${text}` : text;
    }).join('\n');
  }

  function syncBlockNotesStorage() {
    const storage = qs('[data-block-notes]');
    if (storage) storage.value = getBlockNotesValue();
  }

  function setDayNotesEditor(value = '') {
    const editor = qs('[data-day-notes-editor]');
    const storage = qs('[data-notes]');
    if (storage) storage.value = value;
    if (!editor) return;
    const lines = String(value || '').split('\n');
    editor.innerHTML = (lines.length ? lines : ['']).map(dayNoteLineHtml).join('');
  }

  function getDayNotesValue() {
    const editor = qs('[data-day-notes-editor]');
    if (!editor) return qs('[data-notes]')?.value || '';
    return [...editor.children].map(row => {
      const check = row.querySelector('[data-day-note-check]');
      const text = (row.querySelector('span')?.innerText ?? row.innerText ?? '').replace(/\u00a0/g, ' ').trimEnd();
      return check ? `//${check.classList.contains('is-checked') ? 'x ' : ' '}${text}` : text;
    }).join('\n');
  }

  function syncDayNotesStorage() {
    const storage = qs('[data-notes]');
    if (storage) storage.value = getDayNotesValue();
  }

  function upgradeDayNoteSlashShortcut(editor) {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!anchorNode || !editor.contains(anchorNode)) return;
    let row = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
    row = row?.closest?.('.day-note-line');
    if (!row || row.classList.contains('day-note-line--check')) return;
    const text = (row.innerText || '').replace(/\u00a0/g, ' ');
    if (!/^\/\/.*$/.test(text)) return;
    const body = text.replace(/^\/\/\s?/, '');
    row.className = 'day-note-line day-note-line--check';
    row.innerHTML = `<button type="button" class="rich-note-check" data-day-note-check contenteditable="false" aria-pressed="false" aria-label="Mark note item done"></button><span contenteditable="true">${esc(body)}</span>`;
    placeCaretAtEnd(row.querySelector('span'));
  }

  function placeCaretAtEnd(node) {
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function upgradeBlockNoteSlashShortcut(editor) {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!anchorNode || !editor.contains(anchorNode)) return;
    let row = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
    let line = row?.closest?.('.block-note-line');
    if (!line) {
      const candidate = row?.closest?.('div');
      if (candidate && candidate.parentElement === editor) {
        candidate.classList.add('block-note-line');
        line = candidate;
      }
    }
    if (!line || line.classList.contains('block-note-line--check')) return;
    const text = (line.innerText || '').replace(/\u00a0/g, ' ');
    if (!/^\/\/.*$/.test(text)) return;
    const body = text.replace(/^\/\/\s?/, '');
    line.className = 'block-note-line block-note-line--check';
    line.innerHTML = `<button type="button" class="rich-note-check" data-rich-note-check contenteditable="false" aria-pressed="false" aria-label="Mark note item done"></button><span>${esc(body)}</span>`;
    placeCaretAtEnd(line.querySelector('span'));
  }

  // ---------------------------------------------------------------------------
  // Block editor
  // ---------------------------------------------------------------------------

  function openBlockModal(block = null, seed = {}) {
    const isEdit = !!block;
    const startMinutes = clamp(block?.start ?? seed.start ?? recommendedStart(), 0, 24 * 60 - 1);
    const duration = clamp(block?.duration ?? seed.duration ?? 60, snap, 24 * 60);
    const startDate = block?.startDate || seed.startDate || ymd();
    const endTotal = startMinutes + duration;
    const endDate = block?.endDate || addDaysKey(startDate, Math.floor(endTotal / (24 * 60)));
    const endMinutes = endTotal % (24 * 60);

    blockDraft = {
      mode: isEdit ? 'edit' : 'add',
      id: block?.id || null,
      sourceDate: seed.sourceDate || ymd(),
      linkedType: block?.linkedType || seed.linkedType || '',
      linkedId: block?.linkedId || seed.linkedId || ''
    };
    blockTimeDraft = {
      startDate,
      startMinutes,
      endDate,
      endMinutes,
      categoryId: block?.categoryId || seed.categoryId || ''
    };

    qs('[data-block-modal-eyebrow]').textContent = isEdit ? 'Schedule block' : (seed.linkedType ? 'Schedule this item' : 'Schedule');
    qs('[data-block-modal-title]').textContent = isEdit ? 'Edit time block' : 'Add a time block';
    qs('[data-block-title]').value = block?.title || seed.title || '';
    qs('[data-block-link]').value = block?.link || seed.link || '';
    setBlockNotesEditor(block?.notes || seed.notes || '');

    const modalSourceState = seed.sourceState || (blockDraft.sourceDate === ymd() ? state : loadStateForDate(dateFromKey(blockDraft.sourceDate)));
    const seedLinkedType = block?.linkedType || seed.linkedType || '';
    const seedLinkedId = block?.linkedId || seed.linkedId || '';
    const seedSource = seedLinkedType === 'task'
      ? modalSourceState.tasks.find(item => item.id === seedLinkedId)
      : seedLinkedType === 'priority'
        ? modalSourceState.priorities.find(item => item.id === seedLinkedId)
        : null;

    blockDoneDraft = isEdit ? isBlockDone(block) : (seedSource ? !!seedSource.done : false);
    blockEndDateExplicit = false;
    qs('[data-block-delete]').hidden = !isEdit;
    qs('[data-block-done]').hidden = !isEdit;
    renderBlockDoneToggle();

    const actions = qs('.modal__actions--block');
    actions?.classList.toggle('is-add', !isEdit);
    const submitLabel = qs('[data-block-submit-label]');
    const submitIcon = qs('[data-block-submit-icon]');
    if (submitLabel) submitLabel.textContent = isEdit ? 'Save' : 'Add';
    if (submitIcon) submitIcon.innerHTML = isEdit
      ? '<path d="m5.5 12.5 4 4L18.5 7.5"/>'
      : '<path d="M12 5v14M5 12h14"/>';

    qs('[data-block-error]').hidden = true;
    renderBlockTimeControls();
    refreshBlockCategoryTrigger();
    openModal(qs('[data-block-modal]'), qs('[data-block-title]'));
  }

  function renderBlockDoneToggle() {
    const button = qs('[data-block-done]');
    if (!button) return;
    button.classList.toggle('is-active', !!blockDoneDraft);
    button.setAttribute('aria-pressed', String(!!blockDoneDraft));
    button.dataset.tooltip = blockDoneDraft ? 'Marked done' : 'Mark as done';
    button.setAttribute('aria-label', blockDoneDraft ? 'Mark block as not done' : 'Mark block as done');
  }

  function blockDraftDuration() {
    const dayDelta = daysBetweenKeys(blockTimeDraft.startDate, blockTimeDraft.endDate);
    return dayDelta * 24 * 60 + blockTimeDraft.endMinutes - blockTimeDraft.startMinutes;
  }

  function blockDraftStartDateTime() {
    const d = dateFromKey(blockTimeDraft.startDate);
    d.setHours(Math.floor(blockTimeDraft.startMinutes / 60), blockTimeDraft.startMinutes % 60, 0, 0);
    return d;
  }

  function renderBlockTimeControls() {
    const startDate = qs('[data-start-date]');
    const endDate = qs('[data-end-date]');
    const startInput = qs('[data-start-time]');
    const endInput = qs('[data-end-time]');
    const endControls = qs('.block-time-controls--end');
    const toggleEndDate = qs('[data-toggle-end-date]');
    const crossesDay = blockTimeDraft.endDate !== blockTimeDraft.startDate;
    const showEndDate = blockEndDateExplicit || crossesDay;
    if (startDate) startDate.innerHTML = `<span>${esc(formatDateButton(blockTimeDraft.startDate))}</span>${chevronSvg()}`;
    if (endDate) {
      endDate.hidden = !showEndDate;
      endDate.innerHTML = `<span>${esc(formatDateButton(blockTimeDraft.endDate))}</span>${chevronSvg()}`;
    }
    endControls?.classList.toggle('has-end-date', showEndDate);
    qs('[data-block-time-layout]')?.classList.toggle('has-end-date', showEndDate);
    if (toggleEndDate) {
      toggleEndDate.hidden = showEndDate;
      toggleEndDate.textContent = 'Add end date';
    }
    if (startInput) startInput.value = time(blockTimeDraft.startMinutes);
    if (endInput) endInput.value = time(blockTimeDraft.endMinutes);
    renderDurationShortcuts();
  }

  function renderDurationShortcuts() {
    const current = blockDraftDuration();
    qsa('[data-duration]').forEach(button => {
      const active = Number(button.dataset.duration) === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setDraftEndFromDuration(minutes) {
    const total = blockTimeDraft.startMinutes + Number(minutes);
    const dayOffset = Math.floor(total / (24 * 60));
    blockTimeDraft.endDate = addDaysKey(blockTimeDraft.startDate, Math.min(1, dayOffset));
    blockTimeDraft.endMinutes = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  }

  function applyDuration(minutes) {
    setDraftEndFromDuration(clamp(Number(minutes), snap, 24 * 60));
    renderBlockTimeControls();
  }

  function commitTimeInput(which, { preserveDuration = true } = {}) {
    const isStart = which === 'start';
    const input = qs(isStart ? '[data-start-time]' : '[data-end-time]');
    const parsed = parseTimeValue(input?.value);
    if (parsed == null) {
      renderBlockTimeControls();
      return false;
    }
    const previousDuration = clamp(blockDraftDuration(), snap, 24 * 60);
    if (isStart) {
      blockTimeDraft.startMinutes = parsed;
      if (preserveDuration) setDraftEndFromDuration(previousDuration);
    } else {
      blockTimeDraft.endMinutes = parsed;
      if (parsed <= blockTimeDraft.startMinutes) {
        blockTimeDraft.endDate = addDaysKey(blockTimeDraft.startDate, 1);
      } else if (blockDraftDuration() > 24 * 60 || blockTimeDraft.endDate !== blockTimeDraft.startDate) {
        blockTimeDraft.endDate = blockTimeDraft.startDate;
      }
    }
    renderBlockTimeControls();
    return true;
  }

  function timeMenuItems(which) {
    const isEnd = which === 'end';
    const values = Array.from({ length: 96 }, (_, i) => i * 15);
    return values.map(value => {
      let label = time(value);
      if (isEnd) {
        const duration = value > blockTimeDraft.startMinutes
          ? value - blockTimeDraft.startMinutes
          : 24 * 60 + value - blockTimeDraft.startMinutes;
        label += ` · ${durationLabel(duration)}`;
      }
      return { value, label };
    });
  }

  function openBlockTimeMenu(which, anchor) {
    commitTimeInput(which, { preserveDuration: which === 'start' });
    const current = which === 'start' ? blockTimeDraft.startMinutes : blockTimeDraft.endMinutes;
    openListPopover(anchor, timeMenuItems(which), current, item => {
      const previousDuration = clamp(blockDraftDuration(), snap, 24 * 60);
      if (which === 'start') {
        blockTimeDraft.startMinutes = Number(item.value);
        setDraftEndFromDuration(previousDuration);
      } else {
        blockTimeDraft.endMinutes = Number(item.value);
        if (blockTimeDraft.endMinutes <= blockTimeDraft.startMinutes) {
          blockTimeDraft.endDate = addDaysKey(blockTimeDraft.startDate, 1);
        } else {
          blockTimeDraft.endDate = blockTimeDraft.startDate;
        }
      }
      renderBlockTimeControls();
    }, { compact: true, minWidth: 160, matchWidth: true, alignSelected: true, timeMenu: true });
  }

  function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

  function calendarUiContext() {
    return {
      getActivePopover: () => activePopover,
      closePopover,
      closeAllPopovers,
      showPopover,
      dateFromKey,
      atNoon,
      ymd,
      esc,
      qs,
      chevronLeftSvg,
      chevronRightSvg,
      rangeLabel
    };
  }

  function openCalendarPopover(anchor, selectedKey, onSelect, options = {}) {
    return openDatePopover(calendarUiContext(), anchor, selectedKey, onSelect, { weekStartsOn: settings.weekStartsOn, ...options });
  }

  function openPeriodCalendarPopover(anchor, startKey, endKey, onSave, options = {}) {
    return openDateRangePopover(calendarUiContext(), anchor, startKey, endKey, onSave, { weekStartsOn: settings.weekStartsOn, ...options });
  }

  function openBlockDateMenu(which, anchor) {
    const isStart = which === 'start';
    const selected = isStart ? blockTimeDraft.startDate : blockTimeDraft.endDate;
    openCalendarPopover(anchor, selected, itemValue => {
      const previousDuration = clamp(blockDraftDuration(), snap, 24 * 60);
      if (isStart) {
        blockTimeDraft.startDate = itemValue;
        setDraftEndFromDuration(previousDuration);
      } else {
        blockTimeDraft.endDate = itemValue;
        blockEndDateExplicit = true;
        if (blockDraftDuration() <= 0) {
          if (blockTimeDraft.endDate === blockTimeDraft.startDate) {
            const nextTotal = blockTimeDraft.startMinutes + 60;
            if (nextTotal < 24 * 60) blockTimeDraft.endMinutes = nextTotal;
            else {
              blockTimeDraft.endDate = addDaysKey(blockTimeDraft.startDate, 1);
              blockTimeDraft.endMinutes = nextTotal % (24 * 60);
            }
          }
        }
        if (blockDraftDuration() > 24 * 60) {
          blockTimeDraft.endDate = blockTimeDraft.startDate;
          blockEndDateExplicit = false;
        }
      }
      renderBlockTimeControls();
    }, isStart ? {} : { minKey: blockTimeDraft.startDate, maxKey: addDaysKey(blockTimeDraft.startDate, 1) });
  }

  function refreshBlockCategoryTrigger() {
    const button = qs('[data-block-category]');
    if (!button) return;
    // A category deleted while the block was being edited leaves the draft uncategorized.
    if (blockTimeDraft.categoryId && !categoryFor(blockTimeDraft.categoryId)) blockTimeDraft.categoryId = '';
    const cat = categoryFor(blockTimeDraft.categoryId);
    button.innerHTML = cat
      ? `<span class="select-trigger__value"><span class="category-dot" style="background:${cat.color}"></span>${esc(cat.name)}</span>${chevronSvg()}`
      : `<span class="select-trigger__value">Uncategorized</span>${chevronSvg()}`;
  }

  function openBlockCategoryMenu() {
    const items = [
      { value: '', label: 'Uncategorized' },
      ...settings.categories.filter(c => !c.archived).map(c => ({ value: c.id, label: c.name, color: c.color })),
      ...(settings.categories.filter(c => !c.archived).length < palette.length ? [{ value: '__add_category__', label: 'Add category…', className: 'is-add-category' }] : [])
    ];
    openListPopover(qs('[data-block-category]'), items, blockTimeDraft.categoryId, item => {
      if (item.value === '__add_category__') { openAddCategoryModal({ context: 'block' }); return; }
      blockTimeDraft.categoryId = item.value;
      refreshBlockCategoryTrigger();
    }, { matchWidth: true, alignSelected: true, className: 'category-menu', label: 'Category / project' });
  }

  function moveLinkedSourceToDate(targetState, title, sourceState = state, sourceKey = ymd()) {
    if (!blockDraft?.linkedType || !blockDraft?.linkedId) return { type: '', id: '' };
    if (blockTimeDraft.startDate === sourceKey) return { type: blockDraft.linkedType, id: blockDraft.linkedId };

    if (blockDraft.linkedType === 'priority') {
      const index = sourceState.priorities.findIndex(item => item.id === blockDraft.linkedId);
      const slot = targetState.priorities[Math.max(0, index)] || targetState.priorities.find(item => !item.text.trim());
      if (slot && !slot.text.trim()) {
        slot.text = title;
        slot.done = !!blockDoneDraft;
        return { type: 'priority', id: slot.id };
      }
    }
    let task = targetState.tasks.find(item => !item.text.trim());
    if (!task) {
      task = { id: uid('task'), text: '', done: false, carriedCount: 0 };
      targetState.tasks.push(task);
    }
    task.text = title;
    task.done = !!blockDoneDraft;
    return { type: 'task', id: task.id };
  }

  function saveBlockFromForm(e) {
    e.preventDefault();
    commitTimeInput('start', { preserveDuration: false });
    commitTimeInput('end', { preserveDuration: false });

    const title = qs('[data-block-title]').value.trim();
    const rawLink = qs('[data-block-link]').value.trim();
    const link = rawLink ? normalizeUrl(rawLink) : '';
    const notes = getBlockNotesValue().trim();
    const duration = blockDraftDuration();

    if (!title) return showFormError('Give this block a concrete outcome.');
    if (rawLink && !link) return showFormError('Use a valid http or https link.');
    if (duration < snap) return showFormError('End time must be at least 15 minutes after the start.');
    if (duration > 24 * 60) return showFormError('A time block can last up to 24 hours.');

    const targetKey = blockTimeDraft.startDate;
    const currentKey = ymd();
    const sourceKey = blockDraft?.sourceDate || currentKey;
    const sourceState = sourceKey === currentKey ? state : loadStateForDate(dateFromKey(sourceKey));
    const payloadBase = {
      title,
      link,
      notes,
      start: blockTimeDraft.startMinutes,
      duration,
      startDate: blockTimeDraft.startDate,
      endDate: blockTimeDraft.endDate,
      categoryId: blockTimeDraft.categoryId,
      done: !!blockDoneDraft
    };

    if (blockDraft?.mode === 'edit') {
      const existingBlock = sourceState.blocks.find(b => b.id === blockDraft.id);
      if (targetKey === sourceKey && existingBlock) {
        Object.assign(existingBlock, payloadBase);
        if (sourceState === state) setBlockDone(existingBlock, blockDoneDraft);
        else {
          existingBlock.done = !!blockDoneDraft;
          const linkedSource = existingBlock.linkedType === 'task'
            ? sourceState.tasks.find(item => item.id === existingBlock.linkedId)
            : existingBlock.linkedType === 'priority'
              ? sourceState.priorities.find(item => item.id === existingBlock.linkedId)
              : null;
          if (linkedSource) linkedSource.done = !!blockDoneDraft;
          if (!blockDoneDraft) { existingBlock.completedAt = ''; existingBlock.actualDuration = null; }
        }
        if (sourceState !== state) persistStateForDate(dateFromKey(sourceKey), sourceState);
      } else {
        if (existingBlock) sourceState.blocks = sourceState.blocks.filter(b => b.id !== existingBlock.id);
        if (sourceState !== state) persistStateForDate(dateFromKey(sourceKey), sourceState);
        const targetState = targetKey === currentKey ? state : loadStateForDate(dateFromKey(targetKey));
        const linked = moveLinkedSourceToDate(targetState, title, sourceState, sourceKey);
        const created = {
          id: uid('block'),
          ...payloadBase,
          linkedType: linked.type,
          linkedId: linked.id,
          completedAt: '',
          actualDuration: null
        };
        targetState.blocks.push(created);
        if (targetState !== state) persistStateForDate(dateFromKey(targetKey), targetState);
      }
    } else if (targetKey === currentKey) {
      const created = {
        id: uid('block'),
        ...payloadBase,
        linkedType: blockDraft?.linkedType || '',
        linkedId: blockDraft?.linkedId || '',
        completedAt: '',
        actualDuration: null
      };
      if (created.linkedType && created.linkedId) {
        const source = created.linkedType === 'task'
          ? state.tasks.find(item => item.id === created.linkedId)
          : state.priorities.find(item => item.id === created.linkedId);
        if (source) source.text = title;
      }
      state.blocks.push(created);
      setBlockDone(created, blockDoneDraft);
    } else {
      const targetState = loadStateForDate(dateFromKey(targetKey));
      const linked = moveLinkedSourceToDate(targetState, title, sourceState, sourceKey);
      targetState.blocks.push({
        id: uid('block'),
        ...payloadBase,
        linkedType: linked.type,
        linkedId: linked.id,
        completedAt: '',
        actualDuration: null
      });
      persistStateForDate(dateFromKey(targetKey), targetState);
    }

    closeModal(activeModal);
    if (plannerRangeView === 'week') renderWeekSchedule(); else renderBlocks();
    renderItems();
    renderStats();
    save();
  }

  function deleteActiveBlock() {
    if (!blockDraft?.id) return;
    const sourceKey = blockDraft.sourceDate || ymd();
    const sourceState = sourceKey === ymd() ? state : loadStateForDate(dateFromKey(sourceKey));
    sourceState.blocks = sourceState.blocks.filter(b => b.id !== blockDraft.id);
    if (sourceState !== state) persistStateForDate(dateFromKey(sourceKey), sourceState);
    closeModal(activeModal);
    if (plannerRangeView === 'week') renderWeekSchedule(); else renderBlocks();
    renderItems();
    renderStats();
    save();
  }

  function showFormError(message) {
    const error = qs('[data-block-error]');
    error.textContent = message;
    error.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Categories, settings, install prompt, and onboarding
  // ---------------------------------------------------------------------------

  const categoryManager = createCategoryManager({
    getSettings: () => settings, getState: () => state, palette, today: () => ymd(new Date()),
    persistSettings, saveSettings: () => saveSettings(), saveSettingsDebounced, save, refreshBlockCategoryTrigger, renderStats,
    openColorPopover, newId: () => uid('category'), openModal, closeModal
  });
  const renderCategorySettings = () => categoryManager.render();

  // From the block editor's category menu (Settings and Manage categories add theirs in their own list).
  function openAddCategoryModal({ context = 'settings' } = {}) {
    categoryAddContext = context;
    categoryReturnModal = activeModal && !activeModal.matches('[data-category-modal]') ? activeModal : null;
    categoryDraftColor = '';
    qs('[data-new-category-name]').value = '';
    renderNewCategoryColorTrigger();
    openModal(qs('[data-category-modal]'), qs('[data-new-category-name]'));
  }

  function renderNewCategoryColorTrigger() {
    const button = qs('[data-new-category-color]');
    const color = palette.find(p => p.value === categoryDraftColor);
    button.classList.toggle('is-auto', !color);
    qs('span', button).style.background = color?.value || 'transparent';
    qs('strong', button).textContent = color?.name || 'Auto';
  }

  function addCategoryFromForm(e) {
    e.preventDefault();
    if (settings.categories.filter(c => !c.archived).length >= palette.length) return;
    const name = qs('[data-new-category-name]').value.trim();
    if (!name) return;
    const color = categoryDraftColor || nextCategoryColor(settings.categories, palette);
    const category = { id: uid('category'), name, color, archived: false, archivedAt: '' };
    settings.categories.push(category);
    if (categoryAddContext === 'block') blockTimeDraft.categoryId = category.id;
    closeModal(qs('[data-category-modal]'));
    saveSettings();
    if (categoryAddContext === 'block') refreshBlockCategoryTrigger();
    categoryAddContext = 'settings';
  }

  function renderSettingsHours() { renderVisibleHourInputs({ qs, time, startHour: startHour(), endHour: endHour() }); }

  function commitSettingHourInput(kind) {
    const isStart = kind === 'start';
    const input = qs(isStart ? '[data-setting-start-time]' : '[data-setting-end-time]');
    const value = parseVisibleHour(input?.value, { allow24: !isStart, parseTimeValue });
    if (value == null || (isStart ? value >= endHour() : value <= startHour())) { renderSettingsHours(); return false; }
    if (isStart) settings.startHour = value; else settings.endHour = value;
    saveSettings({ rerenderSettings: false });
    return true;
  }

  function renderPlanningWeek() { renderPlanningWeekSettings({ qs, qsa, activeDays: activeWeekdays(), weekStartsOn: settings.weekStartsOn, weekdayNames, esc, chevronSvg }); }

  function togglePlanningDay(day) {
    const active = new Set(activeWeekdays());
    if (active.has(day)) {
      if (active.size === 1) return;
      active.delete(day);
    } else active.add(day);
    settings.planningDays = [...active].sort((a,b)=>a-b);
    saveSettings({ rerenderSettings: false });
    if (statsFeature.view === 'week') { statsFeature.setWeekFromDate(date); renderStats(); }
  }

  function openSettingHourMenu(kind) {
    const isStart = kind === 'start';
    commitSettingHourInput(kind);
    const button = qs(isStart ? '[data-setting-start-hour]' : '[data-setting-end-hour]');
    const anchor = button?.closest('.time-combo') || button;
    const values = visibleHourChoices(kind, startHour(), endHour());
    const selected = isStart ? startHour() : endHour();
    openListPopover(anchor, values.map(v => ({ value: v, label: time(v * 60) })), selected, item => {
      if (isStart) settings.startHour = Number(item.value);
      else settings.endHour = Number(item.value);
      if (settings.endHour <= settings.startHour) settings.endHour = Math.min(24, settings.startHour + 1);
      saveSettings({ rerenderSettings: false });
    }, { compact: true, minWidth: 116, matchWidth: true, alignSelected: true, timeMenu: true });
  }

  function openWeekStartMenu() {
    const button = qs('[data-week-starts-on]');
    if (!button) return;
    const items = weekdayNames.map((label, value) => ({ value, label }));
    openListPopover(button, items, settings.weekStartsOn, item => {
      settings.weekStartsOn = Number(item.value);
      settings.weekStartsOnExplicit = true;
      saveSettings({ rerenderSettings: false });
    }, { compact: true, matchWidth: true, label: 'Week starts on' });
  }

  function maybePromptInstallOrSupport() {
    if (activeModal) return;
    if (!settings.installPromptShown && installFeature.maybePrompt()) return;
    // Once, after ten closed days, when this copy has a sponsor page (src/features/sponsor-moment.js).
    if (sponsorMoment.maybeOpen({ closeDayCount: settings.closeDayCount, busy: tour.isActive() || tour.offerVisible() })) return;
    feedbackFeature.maybePrompt({ closeDayCount: settings.closeDayCount, busy: !settings.onboardingComplete || !!activeModal });
  }

  /** Progress (painted year, streak, trophies) is derived from stored days; memoised briefly per render. */
  function progressFor(year = horizonYear) {
    const now = Date.now();
    if (progressCache.model && progressCache.year === year && now - progressCache.at < 400) return progressCache.model;
    const model = buildProgressModel({ year, today: new Date(), planningDays: activeWeekdays(), getRecord: key => (key === ymd(date) ? state : store.readJSON(`daily-planner:${key}`)), yearData: horizonYearData(year) });
    progressCache = { year, at: now, model };
    return model;
  }

  function renderClosedDayProgress() {
    const wrap = qs('[data-day-closed-progress]');
    if (!wrap) return;
    const year = date.getFullYear();
    progressCache.model = null;
    const model = progressFor(year);
    const fresh = newlyUnlocked(model, readSeenTrophies(year), ymd(date));
    markTrophiesSeen(year, model.unlocked.map(trophy => trophy.id));
    // The last planning day of a quarter offers its check-in, once (quarter-review.js).
    const nudge = quarterNudgeFor({ dayKey: ymd(date), planningDays: activeWeekdays(), yearData: horizonYearData(year) });
    wrap.innerHTML = renderDayClosedProgress(model, ymd(date), fresh) + (nudge ? renderQuarterNudge(nudge) : '');
    if (nudge) { markQuarterNudged(horizonYearData(year), nudge.quarter); persistSettings(); qs('[data-quarter-nudge]', wrap)?.addEventListener('click', event => { const quarter = event.currentTarget.dataset.quarterNudge; closeModal(qs('[data-day-closed-modal]')); setTimeout(() => openQuarterCheckIn(quarter), 200); }); }
    wrap.hidden = false;
    if (fresh.length) trackEvent('trophy_unlocked');
  }

  function seedFirstBlockAfterOnboarding() {
    const { date: targetDate, startMinutes } = firstPlanningSlotAfter(new Date(), settings, { startMinutes: visibleStartMinutes(), endMinutes: visibleEndMinutes() });
    const targetKey = ymd(targetDate);
    const targetState = targetKey === ymd(date) ? state : loadStateForDate(targetDate);
    if (!(targetState.blocks || []).length) {
      targetState.blocks.push({
        id: uid('block'),
        title: 'Click on me to edit your first block',
        link: '',
        notes: '',
        start: startMinutes,
        duration: 60,
        startDate: targetKey,
        endDate: addDaysKey(targetKey, Math.floor((startMinutes + 60) / (24 * 60))),
        categoryId: '',
        linkedType: '',
        linkedId: '',
        done: false,
        completedAt: '',
        actualDuration: null,
        carriedCount: 0,
        originDay: ''
      });
      persistStateForDate(targetDate, targetState);
    }
    date = targetDate;
    state = targetState;
    plannerRangeView = 'day';
    initialScheduleScrollDone = false;
  }

  async function registerPwa() {
    if (!('serviceWorker' in navigator)) return;
    const localDev = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (localDev) {
      // Keep py -m http.server development deterministic: no stale cached JS/CSS.
      try { (await navigator.serviceWorker.getRegistrations()).forEach(registration => registration.unregister()); } catch (_) {}
      return;
    }
    try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (_) {}
  }

  function categoryFallback(id = '__uncategorized') {
    return categoryFor(id) || { id: '__uncategorized', name: 'Uncategorized', color: '#8c867f' };
  }

  // Insights: the Stats dialog's third view, worked out from stored days on this device.
  const insightsFeature = createInsightsFeature({ readDay: key => (key === ymd(date) ? state : store.readJSON(`daily-planner:${key}`)), categoryFor, planningDays: activeWeekdays, weekStartsOn: () => settings.weekStartsOn, hours: () => ({ startHour: startHour(), endHour: endHour() }), dayKeys: () => store.keys('daily-planner:'), modal: () => qs('[data-stats-modal]') });
  const statsFeature = createStatsFeature({
    qs, qsa, esc, escAttr, clamp, insights: insightsFeature,
    getState: () => state,
    getDate: () => date,
    categoryFor,
    elapsedMinutesForDate,
    durationLabel,
    planningWeekStart,
    planningWeekDates,
    ymd,
    loadStateForDate
  });

  // ---------------------------------------------------------------------------
  // Stats, modal primitives, popovers, and live-time behavior
  // ---------------------------------------------------------------------------

  function renderStats() { statsFeature.render(); }
  function setStatsWeekFromDate(inputDate = date) { statsFeature.setWeekFromDate(inputDate); }

  function elapsedMinutes(block) {
    return elapsedMinutesForDate(block, date);
  }

  const blockEndDateKey = block => getBlockEndDateKey(block, ymd());
  const blockTimeRange = block => getBlockTimeRange(block, ymd());
  // A dialog that comes back once the one opened in its place closes (Settings under Add category, say).
  const returnsLater = modal => !!modal && [categoryReturnModal, confirmationReturnModal, openWorkReturnModal].includes(modal);

  function openModal(modal, focusTarget = null, options = {}) {
    if (!modal) return;
    hideAppTooltip();
    closePopover();
    const stackOverCurrent = !!options.stack && activeModal && activeModal !== modal;
    // One entry in the history per dialog: one opened in place of another takes its entry, unless that one comes back after it. Back runs `options.back` first (true: the dialog keeps Back for itself).
    const layer = { back: () => { if (!options.back?.()) closeModal(modal); }, alive: () => !modal.hidden || returnsLater(modal) };
    if (activeModal && activeModal !== modal && !stackOverCurrent && !returnsLater(activeModal)) backStack.swap(activeModal, modal, layer); else backStack.open(modal, layer);
    // What opened it gets focus back when it closes (src/ui/dialog-focus.js); one that replaces a dialog keeps what opened that one behind.
    if (activeModal !== modal) dialogReturns.remember(modal, document.activeElement, activeModal && !stackOverCurrent ? dialogReturns.take(activeModal) : null);
    if (activeModal && activeModal !== modal && !stackOverCurrent) closeModal(activeModal, false);
    // Re-opening the dialog that is already on top keeps its stack (a double Enter must not orphan the one underneath).
    if (stackOverCurrent) { modal.dataset.stackedOver = 'true'; stackedReturns.set(modal, { parent: activeModal, opener: document.activeElement }); } else if (activeModal !== modal) { delete modal.dataset.stackedOver; stackedReturns.delete(modal); }
    activeModal = modal;
    // Each opening gets a number, so a close started just before can tell it was reopened.
    modal.dataset.openSeq = String(Number(modal.dataset.openSeq || 0) + 1);
    modal.hidden = false;
    document.body.classList.add('has-modal');
    // Never leave typing focus in the page behind a dialog (Safari doesn't move focus to a clicked button).
    if (!focusTarget && document.activeElement && document.activeElement !== document.body && !modal.contains(document.activeElement)) document.activeElement.blur?.();
    const scroll = qs('.modal__scroll', modal);
    if (scroll && !options.preserveScroll) scroll.scrollTop = 0;
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
      // A panel that left with an exit animation keeps its last frame inline;
      // returning dialogs (preserveScroll) reappear without an entrance, so reset it.
      if (options.preserveScroll) resetMotion(qs('.modal__panel', modal)); else modalEnter(qs('.modal__panel', modal));
      // Only while it is still the dialog on top: one opened over it meanwhile keeps the focus.
      // Focus goes inside: the control named, else the dialog's title.
      setTimeout(() => { if (activeModal === modal) focusDialog(qs('.modal__panel', modal), focusTarget); }, 80);
    });
  }

  function closeModal(modal = activeModal, restore = true) {
    if (!modal) return;
    if (restore) backStack.closed(modal);
    // Closed while it waits to come back (a second Back while the dialog over it closes): it stays closed, and
    // focus goes back to what had opened it (carried by the dialog over it).
    if (restore && returnsLater(modal)) {
      const over = qs(modal === categoryReturnModal ? '[data-category-modal]' : modal === confirmationReturnModal ? '[data-confirm-modal]' : '[data-open-work-modal]');
      if (modal === categoryReturnModal) categoryReturnModal = null;
      if (modal === confirmationReturnModal) confirmationReturnModal = null;
      if (modal === openWorkReturnModal) openWorkReturnModal = null;
      if (!over?.classList.contains('is-open')) dialogReturns.adopt(modal, dialogReturns.take(over)?.outer);
    }
    closePopover();
    const categoryReturn = restore && modal.matches('[data-category-modal]') ? categoryReturnModal : null;
    const confirmReturn = restore && modal.matches('[data-confirm-modal]') ? confirmationReturnModal : null;
    const openWorkReturn = restore && modal.matches('[data-open-work-modal]') ? openWorkReturnModal : null;
    const returnModal = categoryReturn || confirmReturn || openWorkReturn;
    const stacked = restore && !returnModal ? stackedReturns.get(modal) : null;
    const stackParent = stacked?.parent?.classList.contains('is-open') && !stacked.parent.hidden ? stacked.parent : null;
    stackedReturns.delete(modal);
    modal.classList.remove('is-open');
    modalExit(qs('.modal__panel', modal));
    const closing = modal.dataset.openSeq;
    setTimeout(() => {
      // Reopened within the closing animation (e.g. Week then Horizon at once): leave it open.
      if (modal.dataset.openSeq !== closing) return;
      modal.hidden = true;
      // The dialog underneath comes back, unless it was closed meanwhile.
      if (returnModal && returnsLater(returnModal)) {
        if (categoryReturn) categoryReturnModal = null;
        if (openWorkReturn) { openWorkReturnModal = null; openWorkReturnScrollTop = 0; }
        const returnScrollTop = confirmReturn ? confirmationReturnScrollTop : openWorkReturn ? openWorkReturnScrollTop : 0;
        if (confirmReturn) { confirmationReturnModal = null; confirmationReturnScrollTop = 0; }
        if (returnModal.matches('[data-settings-modal]')) { renderCategorySettings(); renderSettingsHours(); }
        // Back in the dialog underneath: focus on what opened this one (or its twin, drawn again), else that dialog's title.
        const from = dialogReturns.take(modal);
        const back = from ? (returnModal.contains(from.el) && from.el.isConnected ? from.el : twinIn(from.selector, returnModal, { now: false })) : null;
        if (!returnModal.hidden && returnModal.classList.contains('is-open')) {
          activeModal = returnModal;
          document.body.classList.add('has-modal');
          focusDialog(qs('.modal__panel', returnModal), back);
        } else {
          openModal(returnModal, back, { preserveScroll: true });
          // Opened in place of that dialog, this one carried what had opened it: hand it back.
          dialogReturns.adopt(returnModal, from?.outer);
        }
        if (confirmReturn || openWorkReturn) requestAnimationFrame(() => {
          const scroll = qs('.modal__scroll', returnModal);
          if (scroll) scroll.scrollTop = returnScrollTop;
        });
      }
    }, 180);
    if (activeModal === modal) activeModal = stackParent;
    if (!qsa('.modal.is-open').length && !returnModal) document.body.classList.remove('has-modal');
    const opener = returnModal ? null : dialogReturns.take(modal);
    if (restore && !returnModal) {
      if (stackParent) (stackParent.contains(stacked.opener) ? stacked.opener : qs('.modal__panel', stackParent))?.focus?.({ preventScroll: true });
      else if (!focusOpener(opener)) qs('[data-app]')?.focus?.({ preventScroll: true });
    }
  }

  function toggleModalShortcut(selector, openAction) {
    const modal = qs(selector);
    if (modal && activeModal === modal && !modal.hidden) {
      closeModal(modal);
      return true;
    }
    if (typeof openAction === 'function') openAction();
    else if (modal) openModal(modal);
    return true;
  }

  function requestConfirmation({ eyebrow = 'Confirm', title, message, confirmLabel = 'Remove', action }) {
    pendingConfirmAction = typeof action === 'function' ? action : null;
    const modal = qs('[data-confirm-modal]');
    confirmationReturnModal = activeModal && activeModal !== modal ? activeModal : null;
    confirmationReturnScrollTop = confirmationReturnModal ? (qs('.modal__scroll', confirmationReturnModal)?.scrollTop || 0) : 0;
    qs('[data-confirm-eyebrow]', modal).textContent = eyebrow;
    qs('[data-confirm-title]', modal).textContent = title || 'Remove this item?';
    qs('[data-confirm-message]', modal).textContent = message || 'This action cannot be undone.';
    qs('[data-confirm-action]', modal).textContent = confirmLabel;
    // Confirmations launched from Horizon sit above it. The strategic context
    // never disappears/reappears behind a destructive action.
    openModal(modal, null, { stack: !!confirmationReturnModal });
  }

  // The app's own dropdown list (keyboard and screen-reader ready): src/ui/listbox.js.
  function openListPopover(anchor, items, selected, onSelect, options = {}) { openListbox({ showPopover, closePopover }, anchor, items, selected, onSelect, options); }

  function openColorPopover(anchor, selected, onSelect, options = {}) {
    closePopover();
    const popover = document.createElement('div');
    popover.className = 'app-popover color-popover color-popover--palettes';
    const selectedColor = palette.find(p => p.value === selected);
    const groups = ['Muted', 'Rich', 'Bright'];
    popover.innerHTML = `${options.allowAuto ? '<button class="color-auto-option" type="button" data-color-auto><span></span><strong>Auto</strong><em>next distinct color</em></button>' : ''}<div class="color-palettes">${groups.map(group => `<section class="color-palette-group"><div class="color-palette-group__head"><span>${group}</span></div><div class="color-popover__grid" data-color-group="${group}"></div></section>`).join('')}</div><div class="color-popover__label" data-color-label>${esc(selectedColor?.name || (options.allowAuto ? 'Auto' : palette[0].name))}</div>`;
    if (options.allowAuto) {
      const auto = qs('[data-color-auto]', popover);
      auto.classList.toggle('is-selected', !selected);
      auto.addEventListener('mouseenter', () => { qs('[data-color-label]', popover).textContent = 'Auto · next distinct color'; });
      auto.addEventListener('click', e => {
        e.stopPropagation();
        onSelect({ name: 'Auto', value: '' });
        closePopover();
      });
    }
    palette.forEach(color => {
      const grid = qs(`[data-color-group="${color.group}"]`, popover);
      if (!grid) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `color-option${color.value === selected ? ' is-selected' : ''}`;
      button.style.setProperty('--swatch', color.value);
      button.setAttribute('aria-label', `${color.name}, ${color.group} palette`);
      button.addEventListener('mouseenter', () => { qs('[data-color-label]', popover).textContent = `${color.name} · ${color.group}`; });
      button.addEventListener('focus', () => { qs('[data-color-label]', popover).textContent = `${color.name} · ${color.group}`; });
      button.addEventListener('click', e => {
        e.stopPropagation();
        onSelect(color);
        closePopover();
      });
      grid.append(button);
    });
    const resetColorLabel = () => {
      const label = qs('[data-color-label]', popover);
      if (label) label.textContent = selectedColor ? `${selectedColor.name} · ${selectedColor.group}` : (options.allowAuto ? 'Auto · next distinct color' : palette[0].name);
    };
    popover.addEventListener('mouseleave', resetColorLabel);
    qs('.color-palettes', popover)?.addEventListener('pointerleave', resetColorLabel);
    qsa('.color-option', popover).forEach(option => option.addEventListener('pointerleave', resetColorLabel));
    showPopover(anchor, popover, { width: 332 });
  }

  function openInfoPopover(anchor, html) {
    closePopover();
    const popover = document.createElement('div');
    popover.className = 'app-popover info-popover';
    popover.innerHTML = html;
    showPopover(anchor, popover, { width: 320 });
  }

  function showPopover(anchor, popover, options = {}) {
    document.body.append(popover);
    // aria-expanded goes on the control that opens it (a time field's menu button, not the field): src/ui/popover-trigger.js.
    const trigger = options.trigger || anchor;
    activePopover = { el: popover, anchor, trigger, parent: options.parentPopover || null };
    backStack.open(popover, { alive: () => popover.isConnected, back: () => { const inside = popover.contains(document.activeElement); while (activePopover && popover.isConnected) closePopover(); if (inside) trigger?.focus?.({ preventScroll: true }); } });
    trigger?.setAttribute('aria-expanded', 'true');
    const rect = anchor.getBoundingClientRect();
    const boundary = anchor.closest?.('.modal__panel')?.getBoundingClientRect?.() || options.parentPopover?.anchor?.closest?.('.modal__panel')?.getBoundingClientRect?.() || { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 };
    const boundaryPad = 10;
    const maxPopoverWidth = Math.max(140, boundary.right - boundary.left - boundaryPad * 2);
    if (options.width) popover.style.width = `${Math.min(options.width, maxPopoverWidth)}px`;
    if (options.matchWidth) popover.style.width = `${Math.min(rect.width, maxPopoverWidth)}px`;
    const pRect = popover.getBoundingClientRect();
    const gap = 7;
    let left = options.align === 'end' ? rect.right - pRect.width : options.align === 'center' ? rect.left + (rect.width - pRect.width) / 2 : rect.left;
    let top = rect.bottom + gap;
    let selectedOption = null;

    if (options.alignSelected) {
      selectedOption = popover.querySelector('[data-selected-option]');
      top = clamp(rect.top + rect.height / 2 - pRect.height / 2, 8, Math.max(8, innerHeight - pRect.height - 8));
    }

    const minLeft = boundary.left + boundaryPad;
    const maxLeft = Math.max(minLeft, boundary.right - pRect.width - boundaryPad);
    if (left + pRect.width > boundary.right - boundaryPad) left = Math.max(minLeft, rect.right - pRect.width);
    if (!options.alignSelected && top + pRect.height > boundary.bottom - boundaryPad && rect.top - pRect.height - gap > boundary.top + boundaryPad) top = rect.top - pRect.height - gap;
    top = clamp(top, boundary.top + boundaryPad, Math.max(boundary.top + boundaryPad, boundary.bottom - pRect.height - boundaryPad));
    popover.style.left = `${clamp(left, minLeft, maxLeft)}px`;
    popover.style.top = `${top}px`;

    if (options.alignSelected && selectedOption) {
      const anchorCenterInPopover = rect.top + rect.height / 2 - top;
      const selectedCenter = selectedOption.offsetTop + selectedOption.offsetHeight / 2;
      const maxScroll = Math.max(0, popover.scrollHeight - popover.clientHeight);
      popover.scrollTop = clamp(selectedCenter - anchorCenterInPopover, 0, maxScroll);
      // A short list can't scroll its choice over the trigger: it moves there instead (within its bounds), so a
      // second click on the trigger lands on the current choice and closes the list unchanged (1.39.2).
      const shift = anchorCenterInPopover - (selectedCenter - popover.scrollTop);
      if (Math.abs(shift) >= 1) popover.style.top = `${(top = clamp(top + shift, boundary.top + boundaryPad, Math.max(boundary.top + boundaryPad, boundary.bottom - pRect.height - boundaryPad)))}px`;
    }
    requestAnimationFrame(() => { popover.classList.add('is-open'); if (!popover.matches('.hz-add-menu')) popoverEnter(popover, { above: top < rect.top }); });
  }

  function closePopover() {
    if (!activePopover) return;
    const parent = activePopover.parent || null;
    (activePopover.trigger || activePopover.anchor)?.setAttribute('aria-expanded', 'false');
    backStack.closed(activePopover.el);
    activePopover.el.remove();
    activePopover = parent;
  }

  function closeAllPopovers() {
    let guard = 0;
    while (activePopover && guard < 12) { closePopover(); guard += 1; }
  }

  function updateNow() {
    if (plannerRangeView === 'week') { renderWeekSchedule(); return; }
    const line = qs('[data-now]');
    if (!isToday()) { line.hidden = true; return; }
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < visibleStartMinutes() || minutes > visibleEndMinutes()) { line.hidden = true; return; }
    line.hidden = false;
    line.style.top = `${scheduleTopPad + minutesToPx(minutes - visibleStartMinutes())}px`;
    qs('[data-now-label]').textContent = time(minutes);
  }

  function scrollScheduleToRelevantTime({ smooth = false, centerNow = false } = {}) {
    const scroller = qs('[data-schedule-scroll]');
    if (!scroller) return;
    let target = Math.max(visibleStartMinutes(), Math.min(8 * 60, visibleEndMinutes() - 60));

    if (plannerRangeView === 'week') {
      const todayInWeek = planningWeekDates(date).some(d => ymd(d) === ymd(new Date()));
      if (todayInWeek) {
        const now = new Date();
        const current = clamp(now.getHours() * 60 + now.getMinutes(), visibleStartMinutes(), visibleEndMinutes());
        const currentPx = scheduleTopPad + minutesToPx(current - visibleStartMinutes());
        scroller.scrollTo({ top: Math.max(0, currentPx - scroller.clientHeight * .42), behavior: smooth ? 'smooth' : 'auto' });
        return;
      }
      const weekBlocks = planningWeekDates(date).flatMap(d => loadStateForDate(d).blocks || []).filter(b => b.start >= visibleStartMinutes() && b.start < visibleEndMinutes());
      if (weekBlocks.length) target = clamp(Math.min(...weekBlocks.map(b => b.start)) - 30, visibleStartMinutes(), visibleEndMinutes());
    } else if (isToday()) {
      const now = new Date();
      const current = clamp(now.getHours() * 60 + now.getMinutes(), visibleStartMinutes(), visibleEndMinutes());
      if (centerNow) {
        const currentPx = scheduleTopPad + minutesToPx(current - visibleStartMinutes());
        const top = Math.max(0, currentPx - scroller.clientHeight * .42);
        scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
        return;
      }
      target = clamp(current - 90, visibleStartMinutes(), visibleEndMinutes());
    } else {
      const visibleBlocks = state.blocks.filter(b => b.start >= visibleStartMinutes() && b.start < visibleEndMinutes());
      if (visibleBlocks.length) target = clamp(Math.min(...visibleBlocks.map(b => b.start)) - 30, visibleStartMinutes(), visibleEndMinutes());
    }

    const top = Math.max(0, scheduleTopPad + minutesToPx(target - visibleStartMinutes()) - 6);
    scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ---------------------------------------------------------------------------
  // Navigation, responsive layout, search, and storage utilities
  // ---------------------------------------------------------------------------

  // Now travels like the arrows: back from a later day or week, forward from an earlier one, still when already there.
  function goToNow() {
    weekFeature?.resetAutoScroll?.();
    const alreadyToday = isToday();
    const direction = navigationDirection(navigationUnitKey(date), navigationUnitKey(new Date()));
    if (!alreadyToday || plannerRangeView === 'week') {
      try { store.writeJSON(storageKey(), state); } catch (_) {}
      date = atNoon(new Date());
      load();
    }
    if (direction) animatePlannerChange(direction);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollScheduleToRelevantTime({ smooth: true, centerNow: true })));
  }
  // The span the main window moves through: a day, or the planning week in Week view.
  const navigationUnitKey = day => ymd(plannerRangeView === 'week' ? planningWeekStart(day) : day);
  const showDate = target => {
    const direction = navigationDirection(navigationUnitKey(date), navigationUnitKey(target));
    weekFeature?.resetAutoScroll?.();
    date = atNoon(target);
    load();
    if (direction) animatePlannerChange(direction);
  };

  function recommendedStart() {
    if (isToday()) {
      const now = new Date();
      const current = snapMinutes(now.getHours() * 60 + now.getMinutes() + snap);
      return clamp(current, visibleStartMinutes(), visibleEndMinutes() - 60);
    }
    const visibleBlocks = state.blocks.filter(b => b.start >= visibleStartMinutes() && b.start < visibleEndMinutes());
    if (visibleBlocks.length) {
      const lastEnd = Math.max(...visibleBlocks.map(b => b.start + b.duration));
      return clamp(snapMinutes(lastEnd), visibleStartMinutes(), visibleEndMinutes() - 60);
    }
    return clamp(9 * 60, visibleStartMinutes(), visibleEndMinutes() - 60);
  }

  // The arrows move a week in Week view; the floating window (byDay) always moves one planning
  // day, and Week view then only moves when that day crosses into another week.
  function shiftDate(direction, { byDay = plannerRangeView !== 'week' } = {}) {
    weekFeature?.resetAutoScroll?.();
    const before = navigationUnitKey(date);
    if (byDay) date = direction < 0 ? previousPlanningDateFrom(date) : nextPlanningDateFrom(date);
    else date.setDate(date.getDate() + direction * 7);
    load();
    if (navigationUnitKey(date) !== before) animatePlannerChange(direction);
  }

  // Direction-aware settle so moving through days and weeks keeps its spatial sense.
  function animatePlannerChange(direction = 0) {
    [qs('[data-left-pane]'), qs('[data-schedule-scroll]')].forEach(el => { if (el?.offsetParent) panelEnter(el, { direction, distance: 14 }); });
  }

  function toggleWeekView() {
    weekFeature?.resetAutoScroll?.();
    plannerRangeView = plannerRangeView === 'week' ? 'day' : 'week';
    if (plannerRangeView === 'week') trackOncePer('day', 'week_view_opened');
    initialScheduleScrollDone = false;
    render();
    animatePlannerChange(0);
  }

  function isToday() { return ymd(date) === ymd(new Date()); }
  function cssLengthToPx(raw) {
    const value = String(raw || '').trim();
    const amount = parseFloat(value);
    if (!Number.isFinite(amount)) return 0;
    if (!value || value.endsWith('px')) return amount;
    if (value.endsWith('mm')) return amount * (96 / 25.4);
    if (value.endsWith('cm')) return amount * (96 / 2.54);
    if (value.endsWith('in')) return amount * 96;
    if (value.endsWith('pt')) return amount * (96 / 72);
    if (value.endsWith('pc')) return amount * 16;
    // The app only writes absolute lengths to --hour, but this fallback also
    // resolves any future CSS unit through layout rather than guessing.
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${value};height:0;`;
    (qs('[data-schedule]') || document.body).append(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px || amount;
  }
  function pxPerHour() {
    const scheduleValue = getComputedStyle(qs('[data-schedule]')).getPropertyValue('--hour');
    const rootValue = getComputedStyle(document.documentElement).getPropertyValue('--hour');
    return cssLengthToPx(scheduleValue) || cssLengthToPx(rootValue) || 72;
  }
  function minutesToPx(minutes) { return (minutes / 60) * pxPerHour(); }
  function pxToMinutes(pixels) { return (pixels / pxPerHour()) * 60; }
  function snapMinutes(minutes) { return Math.round(minutes / snap) * snap; }
  function chevronSvg() { return '<svg class="select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>'; }
  function checkSvg() { return '<svg class="option-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.3 3.3 7.7-8"/></svg>'; }
  // Save (a disk) and Forget (a bin) in close-day triage and Unresolved: icons, their words in the tooltip and the label.
  const SAVE_ICON = '<svg class="triage-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11.2L20 7.8V20H4V4z"/><path d="M8 4v4.5h7.5V4M7.5 20v-6.5h9V20"/></svg>';
  const FORGET_ICON = '<svg class="triage-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
  function calendarSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>'; }

  function autoGrowNotes() {
    const area = qs('[data-day-notes-editor]');
    if (!area) return;
    // Notes owns the remaining height of the left pane; content scrolls inside it.
    area.style.height = '';
  }

  function applyExpandedView() {
    const fit = computeFitLayout({
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      enabled: settings.expandedView
    });
    const button = qs('[data-expanded-view]');
    if (button) button.hidden = !fit.hasWhitespace;
    document.documentElement.style.setProperty('--app-scale', fit.scale.toFixed(4));
    document.documentElement.style.setProperty('--app-expanded-width', `${fit.logicalWidth}px`);
    document.documentElement.style.setProperty('--app-expanded-height', `${fit.logicalHeight}px`);
    document.documentElement.style.setProperty('--modal-expanded-max-height', `${fit.modalMaxHeight}px`);
    document.body.classList.toggle('app-expanded', fit.active);
    if (button) {
      button.setAttribute('aria-pressed', String(fit.active));
      button.dataset.tooltip = fit.active ? 'Default width' : 'Fit app to width';
      button.setAttribute('aria-label', fit.active ? 'Return to default app width' : 'Fit app to width');
    }
  }
  function toggleExpandedView() {
    settings.expandedView = !settings.expandedView;
    persistSettings();
    applyExpandedView();
    requestAnimationFrame(() => {
      renderScheduleRange();
      updateNow();
      scrollScheduleToRelevantTime();
    });
  }

  function updatePrintSizing() {
    const root = document.documentElement;
    const hours = Math.max(1, endHour() - startHour());
    // The planner's print sheet is landscape-only so both columns and the complete
    // visible hour range remain readable at Actual size.
    const landscapeHourMm = clamp(136 / hours, 4.8, 14);
    root.style.setProperty('--print-hour-landscape', `${landscapeHourMm.toFixed(2)}mm`);
    root.style.setProperty('--print-hour-portrait', `${landscapeHourMm.toFixed(2)}mm`);
    root.style.setProperty('--print-hour-flex', `${landscapeHourMm.toFixed(2)}mm`);
  }
  function savedPlannerDays() {
    const days = new Map();
    try {
      store.keys('daily-planner:')
        .filter(key => /^daily-planner:\d{4}-\d{2}-\d{2}$/.test(key))
        .forEach(key => {
          const day = key.slice('daily-planner:'.length);
          try { days.set(day, normalizeDayState(store.readJSON(key), day)); } catch (_) {}
        });
    } catch (_) {}
    days.set(ymd(), state);
    return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }

  function searchPlanner(query) {
    return searchPlannerDays({
      query,
      days: savedPlannerDays(),
      categories: settings.categories,
      blockTimeRange
    });
  }

  function renderSearchResults(query = '') {
    const wrap = qs('[data-search-results]');
    if (!wrap) return;
    const trimmed = query.trim();
    if (!trimmed) {
      wrap.innerHTML = '<div class="empty-state">Start typing to search across your saved days.</div>';
      return;
    }
    const results = searchPlanner(trimmed);
    if (!results.length) {
      wrap.innerHTML = `<div class="empty-state">No match for “${esc(trimmed)}”.</div>`;
      return;
    }
    wrap.innerHTML = results.map(result => {
      const d = new Date(`${result.day}T12:00:00`);
      const when = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
      return `<button class="search-result" type="button" data-search-date="${escAttr(result.day)}" data-search-kind="${escAttr(result.kind)}" data-search-id="${escAttr(result.id || '')}"><span class="search-result__top"><strong>${esc(result.label)}</strong><span class="search-result__date"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg><time>${esc(when)}</time></span></span><span class="search-result__text">${esc(searchSnippet(result.text || result.meta))}</span>${result.meta ? `<small>${esc(result.meta)}</small>` : ''}</button>`;
    }).join('');
  }

  function syncSearchClear() {
    const input = qs('[data-search-input]');
    const clear = qs('[data-search-clear]');
    if (clear) clear.hidden = !input?.value;
  }

  function openSearchModal() {
    try { store.writeJSON(storageKey(), state); } catch (_) {}
    const input = qs('[data-search-input]');
    if (input) input.value = '';
    renderSearchResults('');
    openModal(qs('[data-search-modal]'), input);
    trackOncePer('day', 'search_opened');
  }

  function goToSearchResult(button) {
    const targetDay = button.dataset.searchDate;
    const kind = button.dataset.searchKind;
    const id = button.dataset.searchId;
    if (!targetDay) return;

    closeModal(qs('[data-search-modal]'));
    date = dateFromKey(targetDay);
    load();

    requestAnimationFrame(() => {
      if (kind === 'block' && id) {
        const block = state.blocks.find(item => item.id === id);
        if (block) openBlockModal(block);
        return;
      }

      if ((kind === 'task' || kind === 'priority') && id) {
        const block = linkedBlock(kind, id);
        if (block) {
          openBlockModal(block);
          return;
        }
        const row = qs(`[data-item-id="${CSS.escape(id)}"]`);
        row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        const input = row && qs('.item-input', row);
        input?.focus({ preventScroll: true });
        input?.select?.();
        row?.classList.add('search-hit');
        setTimeout(() => row?.classList.remove('search-hit'), 900);
        return;
      }

      if (kind === 'notes') {
        const field = qs('[data-day-notes-editor]');
        field?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        field?.focus({ preventScroll: true });
      }
      if (kind === 'focus') {
        const field = qs('[data-focus]');
        field?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        field?.focus({ preventScroll: true });
      }
      if (kind === 'memory' || kind === 'lesson') journal.open({ day: targetDay });
    });
  }

  // Data on this device, as How it works opens: the planner's own data (UTF-8 bytes, saved days) and how full storage is.
  function updateStorageUsage() {
    const output = qs('[data-storage-usage]');
    const usage = measureStorage(browserStorage, { bytes: true });
    storageCheckAt = Date.now();
    storageNow = storageLevel(usage.chars, storageBudget());
    if (output) output.textContent = `${formatStorageBytes(usage.bytes)} · ${usage.days} saved ${usage.days === 1 ? 'day' : 'days'}`;
    renderStorageState();
  }

  // For the header's warning only: how full storage is, at most once a minute and when the browser is idle, never per save.
  function checkStorageSoon({ soon = false } = {}) {
    if (soon && storageCheckTimer) { clearTimeout(storageCheckTimer); storageCheckTimer = 0; storageCheckAt = 0; }
    if (soon) storageCheckAt = 0;
    if (storageCheckTimer) return;
    storageCheckTimer = setTimeout(() => {
      const run = () => {
        storageCheckTimer = 0;
        storageCheckAt = Date.now();
        storageNow = storageLevel(measureStorage(browserStorage).chars, storageBudget());
        renderStorageState();
      };
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 5000 });
      else run();
    }, Math.max(0, storageCheckAt + 60000 - Date.now()));
  }

  // The real state of local saving, not the probe's alone: unavailable, a refused change or sync mark, how full.
  function renderStorageState() {
    const unavailable = savingUnavailable();
    const line = storageSafetyLine({ failing: saveHealth.failing, syncMarkRefused: saveHealth.syncMarkRefused, syncInUse: syncInUse(), available: !unavailable, level: storageNow });
    const status = qs('[data-storage-safety]');
    if (status) { status.textContent = line.text; status.classList.toggle('is-warning', line.warning); }
    const meter = qs('[data-storage-meter]');
    if (meter) {
      meter.hidden = unavailable || !storageNow;
      if (storageNow) {
        meter.classList.toggle('is-warning', storageNow.warn);
        qs('[data-storage-meter-fill]', meter)?.style.setProperty('--fill', `${storageNow.percent}%`);
        const words = qs('[data-storage-meter-text]', meter);
        if (words) words.textContent = `About ${storageNow.percent}% full`;
      }
    }
    storageAlert?.render();
  }

  function checkLocalStorage() {
    const available = !storageBlocked && store.canWrite('daily-planner:');
    localSavingAvailable = available;
    renderStorageState();
    const warning = qs('[data-storage-warning-modal]');
    if (storageBlocked && warning) [['#storage-warning-title', BLOCKED_NOTICE.title], ['[data-storage-warning-text]', BLOCKED_NOTICE.text]].forEach(([selector, words]) => { const node = qs(selector, warning); if (node) node.textContent = words; });
    // Once, over first-run setup when it is open (it comes back on Continue), with focus on Continue.
    if (!available) setTimeout(() => openModal(warning, qs('[data-modal-close].primary-button', warning), { stack: true }), 180);
    return available;
  }

  let pendingImport = null;
  function openImportPicker() { qs('[data-import-file]')?.click(); }
  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let parsed = JSON.parse(String(reader.result || ''));
        if (parsed && parsed.app === 'Daily Planner' && parsed.days && typeof parsed.days === 'object') {
          // full backup
        } else if (parsed && Array.isArray(parsed.priorities) && Array.isArray(parsed.tasks) && Array.isArray(parsed.blocks)) {
          parsed = { app: 'Daily Planner', version: 13, settings: null, days: { [ymd()]: parsed } };
        } else {
          throw new Error('Invalid backup');
        }
        pendingImport = parsed;
        const dayCount = Object.keys(parsed.days).length;
        const summary = qs('[data-import-summary]');
        if (summary) summary.textContent = `This file contains ${dayCount} planner ${dayCount === 1 ? 'day' : 'days'}${parsed.settings ? ' and planner settings' : ''}.`;
        openModal(qs('[data-import-modal]'));
      } catch (_) {
        alert('This file does not look like a Daily Planner backup.');
      }
    };
    reader.readAsText(file);
  }
  function confirmImport() {
    if (!pendingImport) return;
    try {
      Object.entries(pendingImport.days || {}).forEach(([day, value]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
        store.writeJSON(`daily-planner:${day}`, value);
      });
      if (pendingImport.settings && typeof pendingImport.settings === 'object') store.writeJSON('daily-planner:settings', withoutRetiredSettings(pendingImport.settings));
      pendingImport = null;
      reloadSettings();
      closeModal(qs('[data-import-modal]'));
      load();
      renderCategorySettings();
      renderSettingsHours();
      checkStorageSoon();
    } catch (_) {
      alert('The browser blocked the import. Check that site storage is allowed.');
    }
  }

  const plannerBackup = () => buildPlannerBackup(store);

  // What storage refused is still on screen: save what waits once more, then lay the day on screen and the settings
  // in memory over what storage holds, so the file has everything (the storage notice's Export backup above all).
  function exportPlannerBackup() {
    flushPlannerForSync();
    const backup = buildPlannerBackup(store, { live: { day: ymd(), state, settings } });
    download(`daily-planner-backup-${ymd(new Date())}.json`, JSON.stringify(backup, null, 2), 'application/json');
  }

  function flushPlannerForSync() {
    clearTimeout(saveTimer); clearTimeout(settingsTimer);
    store.writeJSON(storageKey(), state); persistSettings(); checkStorageSoon();
  }

  function reloadPlannerAfterSync() {
    reloadSettings(); load(); journal?.changed();
    renderCategorySettings(); renderSettingsHours(); renderPlanningWeek();
    checkStorageSoon(); renderPip();
  }

  function resetPlannerData() {
    clearTimeout(saveTimer);
    clearTimeout(settingsTimer);
    store.removePrefix('daily-planner:');
    store.withoutMutationTracking(() => store.remove('daily-planner-ui:trophies-seen'));
    progressCache.model = null;
    reloadSettings();
    date = atNoon(new Date());
    state = createBlankDay();
    closeModal(qs('[data-reset-modal]'));
    renderCategorySettings();
    renderSettingsHours();
    renderPlanningWeek();
    render();
    renderPip();
    requestAnimationFrame(() => onboarding.maybeOpen());
  }

  // ---------------------------------------------------------------------------
  // Close-day workflow and carry-forward logic
  // ---------------------------------------------------------------------------

  function endDayDateOptions(selectedDate = endDayTargetDate || defaultEndDayTarget()) {
    const start = atNoon(new Date());
    if (selectedDate && ymd(selectedDate) < ymd(start)) start.setTime(selectedDate.getTime());
    const options = [];
    for (let i = 0; i < 62; i++) {
      const d = atNoon(new Date(start));
      d.setDate(d.getDate() + i);
      options.push({
        value: ymd(d),
        label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
      });
    }
    if (selectedDate && !options.some(item => item.value === ymd(selectedDate))) {
      options.unshift({ value: ymd(selectedDate), label: formatDateButton(ymd(selectedDate)) });
    }
    return options;
  }

  function openEndDayDateMenu(anchor, candidateKey = '') {
    const currentAction = candidateKey ? endDayActions.get(candidateKey) : null;
    const selectedDate = currentAction?.mode === 'date' ? dateFromKey(currentAction.dateKey) : (endDayTargetDate || defaultEndDayTarget());
    const previousGlobalKey = ymd(endDayTargetDate || defaultEndDayTarget());
    openCalendarPopover(anchor, ymd(selectedDate), itemValue => {
      const selected = dateFromKey(itemValue);
      if (candidateKey) {
        endDayActions.set(candidateKey, { mode: 'date', dateKey: ymd(selected), custom: true });
      } else {
        endDayTargetDate = selected;
        endDayActions.forEach((action, key) => {
          if (action.mode === 'date' && (!action.custom || action.dateKey === previousGlobalKey)) endDayActions.set(key, { mode: 'date', dateKey: ymd(selected), custom: false });
        });
      }
      renderEndDayReview();
    }, { minKey: ymd(new Date()) });
  }

  function loadStateForDate(targetDate) {
    try { return normalizeDayState(store.readJSON(`daily-planner:${ymd(targetDate)}`), ymd(targetDate)); }
    catch (_) { return createBlankDay(); }
  }

  function viewStateForDate(targetDate) {
    // Week view must reflect edits immediately. The selected day lives in memory
    // until the debounced save completes, so reading localStorage here can be stale.
    return ymd(targetDate) === ymd(date) ? state : loadStateForDate(targetDate);
  }

  function persistStateForDate(targetDate, targetState) {
    store.writeJSON(`daily-planner:${ymd(targetDate)}`, targetState);
  }

  function candidateTriaged(dayState, key) {
    return (dayState.triaged || []).some(value => value === `${key}:later` || value === `${key}:drop` || value.startsWith(`${key}@`));
  }

  function candidateKey(candidate) { return candidate.key || `${candidate.kind}:${candidate.item?.id || candidate.block?.id || ''}`; }

  function endDayCandidates() {
    const candidates = [];
    state.priorities.forEach((item, index) => {
      const key = `priority:${item.id}`;
      if (!item.text.trim() || item.done || candidateTriaged(state, key)) return;
      candidates.push({ key, kind: 'priority', item, index, block: linkedBlock('priority', item.id), originDay: ymd() });
    });
    state.tasks.forEach((item, index) => {
      const key = `task:${item.id}`;
      if (!item.text.trim() || item.done || candidateTriaged(state, key)) return;
      candidates.push({ key, kind: 'task', item, index, block: linkedBlock('task', item.id), originDay: ymd() });
    });
    state.blocks.forEach(block => {
      const key = `block:${block.id}`;
      if (sourceForBlock(block) || isBlockDone(block) || candidateTriaged(state, key)) return;
      candidates.push({ key, kind: 'block', block, originDay: ymd() });
    });
    return candidates;
  }

  function candidatesForSavedDay(dayKey, dayState) {
    const candidates = [];
    const linked = (type, id) => dayState.blocks.find(block => block.linkedType === type && block.linkedId === id) || null;
    dayState.priorities.forEach((item, index) => {
      const key = `priority:${item.id}`;
      if (!item.text.trim() || item.done || candidateTriaged(dayState, key)) return;
      candidates.push({ key, kind: 'priority', item, index, block: linked('priority', item.id), originDay: dayKey });
    });
    dayState.tasks.forEach((item, index) => {
      const key = `task:${item.id}`;
      if (!item.text.trim() || item.done || candidateTriaged(dayState, key)) return;
      candidates.push({ key, kind: 'task', item, index, block: linked('task', item.id), originDay: dayKey });
    });
    dayState.blocks.forEach(block => {
      if (block.linkedType && block.linkedId) return;
      const key = `block:${block.id}`;
      if (block.done || candidateTriaged(dayState, key)) return;
      candidates.push({ key, kind: 'block', block, originDay: dayKey });
    });
    return candidates;
  }

  function endDayCounts() {
    const sources = [...state.priorities.filter(item => item.text.trim()), ...state.tasks.filter(item => item.text.trim())];
    const standaloneBlocks = state.blocks.filter(block => !sourceForBlock(block));
    const done = sources.filter(item => item.done).length + standaloneBlocks.filter(block => isBlockDone(block)).length;
    const total = sources.length + standaloneBlocks.length;
    return { done, total, open: Math.max(0, total - done) };
  }

  function endActionFor(key) {
    if (!endDayActions.has(key)) endDayActions.set(key, { mode: 'date', dateKey: ymd(endDayTargetDate || defaultEndDayTarget()), custom: false });
    return endDayActions.get(key);
  }

  function renderEndDayReview() {
    const list = qs('[data-end-day-list]');
    const summary = qs('[data-end-day-summary]');
    const candidates = endDayCandidates();
    const counts = endDayCounts();
    if (state.endedAt) counts.open = 0;
    const target = endDayTargetDate || defaultEndDayTarget();
    endDayTargetDate = target;
    const targetLabel = target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const destination = qs('[data-end-day-destination]');
    if (destination) destination.textContent = targetLabel;
    summary.innerHTML = `
      <div class="end-day-metric"><span>Done</span><strong>${counts.done}</strong></div>
      <div class="end-day-metric"><span>Still open</span><strong>${counts.open}</strong></div>
      <div class="end-day-target"><span>Carry to</span><button class="end-day-date-trigger" type="button" data-end-day-date aria-haspopup="listbox"><strong>${esc(targetLabel)}</strong><span class="end-day-date-chevron" aria-hidden="true">${chevronSvg()}</span></button></div>`;
    qs('[data-end-day-date]', summary)?.addEventListener('click', e => openEndDayDateMenu(e.currentTarget));
    const memoryField = qs('[data-end-day-memory]');
    const lessonField = qs('[data-end-day-lesson]');
    const submitButton = qs('[data-close-day-submit]');
    if (memoryField) memoryField.value = endDayMemoryDraft;
    if (lessonField) lessonField.value = endDayLessonDraft;
    if (submitButton) submitButton.hidden = false;
    const habitWrap = qs('[data-end-day-habit]');
    if (habitWrap) {
      const dayYearData = horizonYearData(date.getFullYear());
      const habitIndex = habitQuarterForMonth(date.getMonth());
      const habitText = dayYearData.habits[habitIndex]?.trim() || '';
      const habitStarted = dayYearData.habitStartedAt?.[habitIndex] || '';
      if (habitText && (!habitStarted || ymd(date) >= habitStarted)) {
        habitWrap.hidden = false;
        const habitStats = habitActivityStats(dayYearData, habitIndex, date.getFullYear());
        habitWrap.innerHTML = `<label><input type="checkbox" data-end-day-habit-check ${endDayHabitDraft ? 'checked' : ''}><span><small>Winning habit · Q${habitIndex + 1}</small><strong>${esc(habitText)}</strong></span><span class="end-day-habit__stats"><strong>${habitStats.percent}% · ${habitStats.longest}d best</strong></span></label>`;
        qs('[data-end-day-habit-check]', habitWrap)?.addEventListener('change', e => { endDayHabitDraft = e.target.checked; });
      } else {
        habitWrap.hidden = true;
        habitWrap.innerHTML = '';
      }
    }

    if (!candidates.length) {
      list.innerHTML = '<div class="empty-state">Nothing unfinished needs a decision.</div>';
      return;
    }

    list.innerHTML = candidates.map(candidate => {
      const key = candidateKey(candidate);
      const action = endActionFor(key);
      const title = candidate.kind === 'block' ? candidate.block.title : candidate.item.text;
      const block = candidate.block;
      const cat = block ? categoryFor(block.categoryId) : null;
      const label = cat?.name || (candidate.kind === 'priority' ? (candidate.index === 0 ? 'Most important outcome' : 'Other outcome') : candidate.kind === 'task' ? 'Task' : 'Uncategorized');
      const meta = block ? blockTimeRange(block) : 'Unscheduled';
      const carriedCount = Number(candidate.item?.carriedCount ?? candidate.block?.carriedCount ?? 0);
      const originDay = candidate.item?.originDay || candidate.block?.originDay || candidate.originDay || ymd();
      const openDays = Math.max(0, daysBetweenKeys(originDay, ymd(date)));
      const dateKey = action.mode === 'date' ? action.dateKey : ymd(target);
      const dateLabel = formatDateButton(dateKey);
      return `<div class="end-day-item" data-end-item="${escAttr(key)}">
        <div class="end-day-item__body"><strong>${esc(title || 'Untitled block')}</strong><span class="end-day-item__meta"><span>${esc(label)}</span>${meta ? `<span>${esc(meta)}</span>` : ''}${carriedCount ? `<span class="carry-badge">Moved ${carriedCount}×</span>` : ''}</span></div>
        <div class="end-day-triage" role="group" aria-label="Choose what happens to ${escAttr(title || 'this item')}">
          <button type="button" class="end-day-triage__date${action.mode === 'date' ? ' is-selected' : ''}" data-end-action-date data-key="${escAttr(key)}">${action.mode === 'date' ? checkSvg() : '<span class="date-choice-spacer" aria-hidden="true"></span>'}<span>${esc(dateLabel)}</span>${chevronSvg()}</button>
          <button type="button" class="triage-icon-button${action.mode === 'later' ? ' is-selected' : ''}" data-end-action="later" data-key="${escAttr(key)}" aria-label="Save" aria-pressed="${action.mode === 'later'}" data-tooltip="Save: keep it in Unresolved, without a date">${SAVE_ICON}</button>
          <button type="button" class="end-day-triage__drop triage-icon-button${action.mode === 'drop' ? ' is-selected' : ''}" data-end-action="drop" data-key="${escAttr(key)}" aria-label="Forget" aria-pressed="${action.mode === 'drop'}" data-tooltip="Forget: take it off your plate — its day keeps the history">${FORGET_ICON}</button>
        </div>
      </div>`;
    }).join('');

    qsa('[data-end-action-date]', list).forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.key;
      const action = endActionFor(key);
      const selected = action.mode === 'date' ? action.dateKey : ymd(endDayTargetDate || defaultEndDayTarget());
      openCalendarPopover(button, selected, value => {
        endDayActions.set(key, { mode: 'date', dateKey: value, custom: true });
        renderEndDayReview();
      }, { minKey: ymd(date) });
    }));
    qsa('[data-end-action]', list).forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.key;
      const mode = button.dataset.endAction;
      const current = endActionFor(key);
      if (current.mode === mode) {
        endDayActions.set(key, { mode: 'date', dateKey: ymd(endDayTargetDate || defaultEndDayTarget()), custom: false });
      } else {
        endDayActions.set(key, { mode });
      }
      renderEndDayReview();
    }));
  }

  function openEndDayModal() {
    if (ymd(date) > ymd(new Date())) return;
    if (state?.endedAt) { requestReopenDay(); return; }
    endDayTargetDate = defaultEndDayTarget();
    endDayActions = new Map();
    endDayMemoryDraft = state.memory || '';
    endDayLessonDraft = state.lesson || '';
    { const yd = horizonYearData(date.getFullYear()); const qi = habitQuarterForMonth(date.getMonth()); endDayHabitDraft = !!(yd.habits[qi]?.trim() && habitChecked(yd, ymd(date), qi)); }
    renderEndDayReview();
    openModal(qs('[data-end-day-modal]'));
  }

  function findExistingTargetItem(targetState, text) {
    const needle = text.trim().toLocaleLowerCase();
    const priority = targetState.priorities.find(item => item.text.trim().toLocaleLowerCase() === needle);
    if (priority) return { type: 'priority', id: priority.id, item: priority };
    const task = targetState.tasks.find(item => item.text.trim().toLocaleLowerCase() === needle);
    return task ? { type: 'task', id: task.id, item: task } : null;
  }

  function carryItemToTarget(candidate, targetState) {
    const text = candidate.item.text.trim();
    const nextCount = Math.max(0, Number(candidate.item.carriedCount) || 0) + 1;
    const originDay = candidate.item.originDay || candidate.originDay || ymd();
    const existing = findExistingTargetItem(targetState, text);
    if (existing) {
      existing.item.carriedCount = Math.max(Number(existing.item.carriedCount) || 0, nextCount);
      existing.item.originDay = existing.item.originDay || originDay;
      existing.item.done = false;
      return { type: existing.type, id: existing.id, carriedCount: existing.item.carriedCount, originDay, created: false };
    }

    if (candidate.kind === 'priority') {
      const preferred = targetState.priorities[candidate.index];
      let target = preferred && !preferred.text.trim() ? preferred : targetState.priorities.find(item => !item.text.trim());
      if (target) {
        target.text = text; target.done = false; target.carriedCount = nextCount; target.originDay = originDay;
        return { type: 'priority', id: target.id, carriedCount: nextCount, originDay, created: true };
      }
    }

    let task = targetState.tasks.find(item => !item.text.trim());
    if (task) { task.text = text; task.done = false; task.carriedCount = nextCount; task.originDay = originDay; }
    else { task = { id: uid('task'), text, done: false, carriedCount: nextCount, originDay }; targetState.tasks.push(task); }
    return { type: 'task', id: task.id, carriedCount: nextCount, originDay, created: true };
  }

  function copyBlockToTarget(source, targetState, destination = null, targetDate = endDayTargetDate || defaultEndDayTarget(), originDay = ymd()) {
    if (!source) return null;
    const targetKey = ymd(targetDate);
    const duplicate = targetState.blocks.find(block => block.title.trim().toLocaleLowerCase() === source.title.trim().toLocaleLowerCase() && block.start === source.start && block.duration === source.duration);
    if (duplicate) return { id: duplicate.id, created: false };
    const block = {
      id: uid('block'), title: source.title, link: source.link || '', notes: source.notes || '', start: source.start, duration: source.duration,
      startDate: targetKey, endDate: addDaysKey(targetKey, Math.floor((source.start + source.duration) / (24 * 60))), categoryId: source.categoryId || '',
      linkedType: destination?.type || '', linkedId: destination?.id || '', done: false, completedAt: '', actualDuration: null,
      carriedCount: Math.max(Number(destination?.carriedCount) || 0, Math.max(0, Number(source.carriedCount) || 0) + 1),
      originDay: source.originDay || originDay
    };
    targetState.blocks.push(block);
    return { id: block.id, created: true };
  }

  function addCandidateToLater(candidate) {
    const text = candidate.kind === 'block' ? candidate.block.title : candidate.item.text;
    if (!text?.trim()) return null;
    const carriedCount = Math.max(0, Number(candidate.item?.carriedCount ?? candidate.block?.carriedCount) || 0) + 1;
    const originDay = candidate.item?.originDay || candidate.block?.originDay || candidate.originDay || ymd();
    const existing = settings.openWork.find(item => item.text.trim().toLocaleLowerCase() === text.trim().toLocaleLowerCase() && item.originDay === originDay);
    if (existing) {
      existing.carriedCount = Math.max(existing.carriedCount || 0, carriedCount);
      return existing.id;
    }
    const entry = {
      id: uid('open'), text: text.trim(), kind: candidate.kind, originDay, carriedCount,
      block: candidate.block ? { title: candidate.block.title, link: candidate.block.link || '', notes: candidate.block.notes || '', start: candidate.block.start, duration: candidate.block.duration, categoryId: candidate.block.categoryId || '', carriedCount, originDay } : null
    };
    settings.openWork.push(entry);
    return entry.id;
  }

  const weekReviewFeature = createWeekReviewFeature({
    getDate: () => date,
    getState: () => state,
    getSettings: () => settings,
    planningWeekDates,
    isPlanningDay,
    ymd,
    loadStateForDate,
    categoryFor,
    categoryFallback,
    getUnresolvedCounts: () => ({
      needs: needsAttentionEntries().length,
      later: (settings.openWork || []).length
    })
  });
  const { isLastPlanningDay, weekReviewData, renderWeekReviewSummary } = weekReviewFeature;

  function renderNextDayPrep(nextDate) {
    const wrap = qs('[data-next-day-prep]');
    if (!wrap || !nextDate) return;
    const nextState = loadStateForDate(nextDate);
    const nextLabel = nextDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    wrap.hidden = false;
    qs('[data-next-day-prep-title]', wrap).textContent = nextLabel;
    const focus = qs('[data-next-day-focus]', wrap);
    const main = qs('[data-next-day-main]', wrap);
    const other1 = qs('[data-next-day-other="1"]', wrap);
    const other2 = qs('[data-next-day-other="2"]', wrap);
    if (focus) focus.value = nextState.focus || '';
    if (main) main.value = nextState.priorities?.[0]?.text || '';
    if (other1) other1.value = nextState.priorities?.[1]?.text || '';
    if (other2) other2.value = nextState.priorities?.[2]?.text || '';
  }

  function persistNextDayPrep() {
    if (!dayClosedNextDate) return;
    const wrap = qs('[data-next-day-prep]');
    if (!wrap || wrap.hidden) return;
    const nextState = loadStateForDate(dayClosedNextDate);
    nextState.focus = qs('[data-next-day-focus]', wrap)?.value || '';
    const values = [
      qs('[data-next-day-main]', wrap)?.value || '',
      qs('[data-next-day-other="1"]', wrap)?.value || '',
      qs('[data-next-day-other="2"]', wrap)?.value || ''
    ];
    values.forEach((value, index) => {
      if (!nextState.priorities[index]) nextState.priorities[index] = { id: uid('priority'), text: '', done: false, carriedCount: 0 };
      nextState.priorities[index].text = value;
    });
    persistStateForDate(dayClosedNextDate, nextState);
  }

  function showWeekReviewStage() {
    if (!dayClosedWeekComplete || !dayClosedNextDate) return;
    dayClosedStage = 'review';
    persistNextDayPrep();
    const nextLabel = dayClosedNextDate.toLocaleDateString(undefined, { weekday: 'long' });
    const review = weekReviewData(date);
    const eyebrow = qs('[data-day-closed-eyebrow]'), title = qs('[data-day-closed-title]'), copy = qs('[data-day-closed-copy]');
    const summary = qs('[data-week-review-summary]'), prep = qs('[data-next-day-prep]'), prepare = qs('[data-prepare-next-day]'), done = qs('[data-day-closed-done]'), modal = qs('[data-day-closed-modal]');
    modal.dataset.stage = 'review';
    eyebrow.textContent = 'Weekly review';
    title.textContent = 'The week is closed.';
    copy.textContent = `You have already given ${nextLabel} a little direction. Now look back at what moved, what carried forward, and where your scheduled time went.`;
    if (prep) prep.hidden = true;
    qs('[data-day-closed-progress]').hidden = true;
    summary.hidden = false;
    summary.innerHTML = renderWeekReviewSummary(review);
    prepare.hidden = false;
    prepare.textContent = `Open ${nextLabel}`;
    done.hidden = false;
    qs('.modal__scroll', qs('[data-day-closed-modal]'))?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showDayClosedTransition(nextDate, carriedToNext = 0) {
    dayClosedNextDate = nextDate;
    dayClosedWeekComplete = isLastPlanningDay(date);
    dayClosedStage = 'prep';
    const title = qs('[data-day-closed-title]'), eyebrow = qs('[data-day-closed-eyebrow]'), copy = qs('[data-day-closed-copy]');
    const prepare = qs('[data-prepare-next-day]'), done = qs('[data-day-closed-done]'), summary = qs('[data-week-review-summary]');
    const modal = qs('[data-day-closed-modal]'), prepCopy = qs('[data-next-day-prep-copy]');
    const nextLabel = nextDate.toLocaleDateString(undefined, { weekday: 'long' });
    summary.hidden = true;
    summary.innerHTML = '';
    renderNextDayPrep(nextDate);

    eyebrow.textContent = 'Day closed';
    title.textContent = `${date.toLocaleDateString(undefined, { weekday: 'long' })} closed.`;
    if (dayClosedWeekComplete) {
      modal.dataset.stage = 'week-prep';
      if (prepCopy) prepCopy.textContent = `Give ${nextLabel} a little direction before you review the week.`;
      copy.textContent = `${carriedToNext} item${carriedToNext === 1 ? '' : 's'} carried toward ${nextLabel}. Give the next planning day a little direction before you review the week.`;
      prepare.textContent = 'Continue to weekly review';
      done.hidden = true;
    } else {
      modal.dataset.stage = 'day-prep';
      if (prepCopy) prepCopy.textContent = 'Give the next day a little direction now, or leave it for tomorrow.';
      copy.textContent = `${carriedToNext} item${carriedToNext === 1 ? '' : 's'} carried to ${nextLabel}. Set a little direction now, or leave it for tomorrow.`;
      prepare.textContent = `Open ${nextLabel}`;
      done.hidden = false;
    }
    renderClosedDayProgress();
    openModal(qs('[data-day-closed-modal]'));
  }

  function completeEndDay(e) {
    e.preventDefault();
    if (ymd(date) > ymd(new Date())) return;
    const candidates = endDayCandidates();
    const targetStates = new Map();
    const getTargetState = targetKey => {
      if (!targetStates.has(targetKey)) targetStates.set(targetKey, loadStateForDate(dateFromKey(targetKey)));
      return targetStates.get(targetKey);
    };
    const triaged = [];
    const carried = [];
    const transfers = [];
    candidates.forEach(candidate => {
      const key = candidateKey(candidate);
      const action = endActionFor(key);
      if (action.mode === 'later') {
        const openId = addCandidateToLater(candidate);
        triaged.push(`${key}:later`);
        transfers.push({ sourceKey: key, mode: 'later', openId });
        return;
      }
      if (action.mode === 'drop') {
        triaged.push(`${key}:drop`);
        transfers.push({ sourceKey: key, mode: 'drop' });
        return;
      }
      const targetKey = action.dateKey || ymd(endDayTargetDate || defaultEndDayTarget());
      const targetDate = dateFromKey(targetKey);
      const targetState = getTargetState(targetKey);
      let destination = null;
      let blockCopy = null;
      if (candidate.kind === 'block') blockCopy = copyBlockToTarget(candidate.block, targetState, null, targetDate, candidate.originDay);
      else {
        destination = carryItemToTarget(candidate, targetState);
        blockCopy = copyBlockToTarget(candidate.block, targetState, destination, targetDate, candidate.originDay);
      }
      triaged.push(`${key}@${targetKey}`);
      carried.push({ key, targetKey });
      transfers.push({ sourceKey: key, mode: 'date', targetKey, targetType: destination?.type || '', targetId: destination?.id || '', targetCreated: !!destination?.created, blockId: blockCopy?.id || '', blockCreated: !!blockCopy?.created });
    });

    state.memory = endDayMemoryDraft.trim();
    state.lesson = endDayLessonDraft.trim();
    {
      const yd = horizonYearData(date.getFullYear());
      const qi = habitQuarterForMonth(date.getMonth());
      if (yd.habits[qi]?.trim()) {
        const current = new Set(Array.isArray(yd.habitChecks?.[ymd(date)]) ? yd.habitChecks[ymd(date)] : []);
        if (endDayHabitDraft) current.add(qi); else current.delete(qi);
        yd.habitChecks[ymd(date)] = [...current].sort();
      }
    }
    state.endedAt = new Date().toISOString();
    settings.closeDayCount = Math.max(0, Number(settings.closeDayCount) || 0) + 1;
    trackEvent('day_closed');
    state.triaged = [...new Set([...(state.triaged || []), ...triaged])];
    state.carriedForward = [...new Set([...(state.carriedForward || []), ...carried.map(item => `${item.key}@${item.targetKey}`)])];
    state.closeTransfers = transfers;
    try {
      store.writeJSON(storageKey(), state);
      targetStates.forEach((targetState, targetKey) => persistStateForDate(dateFromKey(targetKey), targetState));
      persistSettings();
    } catch (_) {}
    personalSyncFeature?.syncNow?.({ interactive: false, reason: 'close-day' });
    closeModal(qs('[data-end-day-modal]'));
    updateEndDayButton();
    checkStorageSoon();
    const nextDate = ymd(date) < ymd(new Date()) ? defaultEndDayTarget() : nextPlanningDateFrom(date);
    const nextKey = ymd(nextDate);
    showDayClosedTransition(nextDate, carried.filter(item => item.targetKey === nextKey).length);
  }

  function reopenClosedDay() {
    if (!state?.endedAt) return;
    let transfers = Array.isArray(state.closeTransfers) ? state.closeTransfers : [];

    // Older saved state did not persist exact transfer ids. Reconstruct conservative transfer records
    // from the source day so reopening an older closed day does not knowingly duplicate its work.
    if (!transfers.length && (state.triaged || []).length) {
      const sourceForKey = key => {
        const [kind, id] = String(key).split(':');
        if (kind === 'priority') { const item = state.priorities.find(entry => entry.id === id); return item ? { kind, item, text: item.text } : null; }
        if (kind === 'task') { const item = state.tasks.find(entry => entry.id === id); return item ? { kind, item, text: item.text } : null; }
        if (kind === 'block') { const block = state.blocks.find(entry => entry.id === id); return block ? { kind, block, text: block.title } : null; }
        return null;
      };
      transfers = (state.triaged || []).map(value => {
        const at = value.lastIndexOf('@');
        if (at > 0) return { sourceKey: value.slice(0, at), mode: 'date', targetKey: value.slice(at + 1), legacy: true };
        if (value.endsWith(':later')) return { sourceKey: value.slice(0, -6), mode: 'later', legacy: true };
        if (value.endsWith(':drop')) return { sourceKey: value.slice(0, -5), mode: 'drop', legacy: true };
        return null;
      }).filter(Boolean);
      transfers.forEach(transfer => {
        const source = sourceForKey(transfer.sourceKey);
        transfer.sourceText = source?.text || '';
        transfer.sourceBlock = source?.block || (source?.item ? linkedBlock(source.kind, source.item.id) : null);
      });
    }

    transfers.forEach(transfer => {
      if (transfer.mode === 'later') {
        settings.openWork = (settings.openWork || []).filter(item => {
          if (transfer.openId) return item.id !== transfer.openId;
          return !(transfer.legacy && item.originDay === ymd(date) && item.text.trim().toLocaleLowerCase() === String(transfer.sourceText || '').trim().toLocaleLowerCase());
        });
        return;
      }
      if (transfer.mode !== 'date' || !transfer.targetKey) return;
      const targetDate = dateFromKey(transfer.targetKey);
      const targetState = loadStateForDate(targetDate);
      if (transfer.blockCreated && transfer.blockId) targetState.blocks = targetState.blocks.filter(block => block.id !== transfer.blockId);
      else if (transfer.legacy && transfer.sourceBlock) {
        const title = String(transfer.sourceBlock.title || '').trim().toLocaleLowerCase();
        const idx = targetState.blocks.findIndex(block => block.title.trim().toLocaleLowerCase() === title && block.start === transfer.sourceBlock.start && block.duration === transfer.sourceBlock.duration);
        if (idx >= 0) targetState.blocks.splice(idx, 1);
      }
      if (transfer.targetCreated && transfer.targetId) {
        if (transfer.targetType === 'priority') {
          const item = targetState.priorities.find(entry => entry.id === transfer.targetId);
          if (item) { item.text = ''; item.done = false; item.carriedCount = 0; item.originDay = ''; }
        } else if (transfer.targetType === 'task') {
          targetState.tasks = targetState.tasks.filter(entry => entry.id !== transfer.targetId);
        }
      } else if (transfer.legacy && transfer.sourceText) {
        const needle = transfer.sourceText.trim().toLocaleLowerCase();
        const p = targetState.priorities.find(item => item.text.trim().toLocaleLowerCase() === needle && Number(item.carriedCount) > 0);
        if (p) { p.text = ''; p.done = false; p.carriedCount = 0; p.originDay = ''; }
        else {
          const idx = targetState.tasks.findIndex(item => item.text.trim().toLocaleLowerCase() === needle && Number(item.carriedCount) > 0);
          if (idx >= 0) targetState.tasks.splice(idx, 1);
        }
      }
      while (targetState.tasks.length < minTaskSlots) targetState.tasks.push({ id: uid('task'), text: '', done: false, carriedCount: 0, originDay: '' });
      persistStateForDate(targetDate, targetState);
    });
    state.endedAt = '';
    state.triaged = [];
    state.carriedForward = [];
    state.closeTransfers = [];
    persistSettings();
    try { store.writeJSON(storageKey(), state); } catch (_) {}
    closeModal(qs('[data-end-day-modal]'));
    render();
    checkStorageSoon();
  }

  function updateEndDayButton() {
    const button = qs('[data-end-day-open]');
    if (!button) return;
    const ended = !!state?.endedAt;
    const future = ymd(date) > ymd(new Date());
    button.classList.toggle('is-day-ended', ended);
    button.disabled = future;
    button.dataset.tooltip = ended ? 'Reopen day' : 'Close day';
    button.dataset.tooltipKey = 'D';
    button.setAttribute('aria-label', future ? 'Close day is unavailable for future dates' : (ended ? 'Reopen day' : 'Close day'));
    button.innerHTML = ended
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10a7 7 0 1 1 1.7 7.2"/><path d="M5 5v5h5"/></svg><span>Reopen day</span>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15.5h16"/><path d="M6.2 15.5a5.8 5.8 0 0 1 11.6 0"/><path d="M12 4.2v2.1M5.9 6.7l1.5 1.5M18.1 6.7l-1.5 1.5M3.6 11.1h2.1M18.3 11.1h2.1"/></svg><span>Close day</span>`;
  }

  function requestReopenDay() {
    if (!state?.endedAt) return;
    openModal(qs('[data-reopen-modal]'));
  }

  function handleEndDayButton() {
    if (ymd(date) > ymd(new Date())) return;
    if (state?.endedAt) requestReopenDay();
    else openEndDayModal();
  }

  // ---------------------------------------------------------------------------
  // Horizon / Year map
  // ---------------------------------------------------------------------------

  function horizonMinYear() {
    const nowYear = new Date().getFullYear();
    if (!Number.isFinite(Number(settings.horizonStartYear))) { settings.horizonStartYear = nowYear; persistSettings(); }
    return Math.max(2000, Number(settings.horizonStartYear) || nowYear);
  }

  function ensureHorizon() {
    if (!settings.horizon || typeof settings.horizon !== 'object') settings.horizon = { years: {} };
    if (!settings.horizon.years || typeof settings.horizon.years !== 'object') settings.horizon.years = {};
    return settings.horizon;
  }

  function horizonYearData(year = horizonYear) {
    const root = ensureHorizon();
    const key = String(year);
    if (!root.years[key] || typeof root.years[key] !== 'object') root.years[key] = { misogi: '', misogiStartDate: '', misogiEndDate: '', misogiDone: false, misogiMilestones: [], meaningful: ['', '', ''], meaningfulMeta: [], miniAdventures: [], habits: ['', '', '', ''], habitChecks: {}, months: {} };
    const data = root.years[key];
    data.misogiDone = !!data.misogiDone;
    if (!Array.isArray(data.meaningful)) data.meaningful = ['', '', ''];
    data.meaningful = data.meaningful.slice(0, 3).map(value => String(value || ''));
    while (data.meaningful.length < 3) data.meaningful.push('');
    // Annual commitments are deliberately simple statements. Legacy date/status
    // metadata is retained in storage for backwards compatibility but no longer
    // drives Horizon UI or the Year map.
    if (!Array.isArray(data.meaningfulMeta)) data.meaningfulMeta = [];
    data.meaningfulMeta = Array.from({ length: 3 }, (_, i) => data.meaningfulMeta[i] && typeof data.meaningfulMeta[i] === 'object' ? data.meaningfulMeta[i] : {});
    if (!Array.isArray(data.misogiMilestones)) data.misogiMilestones = [];
    data.misogiMilestones = data.misogiMilestones.slice(0, 5).map(item => ({
      id: item?.id || uid('milestone'), text: String(item?.text || ''), done: !!item?.done,
      date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') ? item.date : ''
    }));
    if (!Array.isArray(data.miniAdventures)) data.miniAdventures = [];
    data.miniAdventures = data.miniAdventures.slice(0, 6).map(item => {
      const fallbackMonth = clamp(Number(item?.month ?? 0), 0, 11);
      const hasExplicitStartField = !!item && Object.prototype.hasOwnProperty.call(item, 'startDate');
      const legacyDate = /^\d{4}-\d{2}-\d{2}$/.test(item?.startDate || '')
        ? item.startDate
        : (!hasExplicitStartField && item?.month != null ? `${year}-${String(fallbackMonth + 1).padStart(2,'0')}-01` : '');
      let startDate = legacyDate;
      // A legacy migration briefly inferred the first day of the selected month for new
      // unscheduled adventures. Treat those legacy "idea" records as
      // genuinely unscheduled again; a manually chosen date always switches
      // the item to planned.
      if (item?.status === 'idea' && startDate && startDate.endsWith('-01') && !item?.endDate) startDate = '';
      const endDate = startDate && /^\d{4}-\d{2}-\d{2}$/.test(item?.endDate || '') && item.endDate >= startDate ? item.endDate : '';
      const status = ['idea','planned','done'].includes(item?.status) ? item.status : (startDate ? 'planned' : 'idea');
      return { id: item?.id || uid('adventure'), text: String(item?.text || ''), startDate, endDate, month: startDate ? dateFromKey(startDate).getMonth() : fallbackMonth, status, done: !!item?.done || status === 'done', nextStep: String(item?.nextStep || '') };
    });
    if (!Array.isArray(data.habits)) data.habits = ['', '', '', ''];
    data.habits = Array.from({ length: 4 }, (_, i) => String(data.habits?.[i] || ''));
    if (!Array.isArray(data.habitStartedAt)) data.habitStartedAt = ['', '', '', ''];
    data.habitStartedAt = Array.from({ length: 4 }, (_, i) => /^\d{4}-\d{2}-\d{2}$/.test(data.habitStartedAt?.[i] || '') ? data.habitStartedAt[i] : '');
    if (!data.habitChecks || typeof data.habitChecks !== 'object') data.habitChecks = {};
    Object.keys(data.habitChecks).forEach(day => {
      const values = Array.isArray(data.habitChecks[day]) ? data.habitChecks[day] : [];
      data.habitChecks[day] = [...new Set(values.map(Number).filter(i => i >= 0 && i < 4))];
    });
    if (!data.months || typeof data.months !== 'object') data.months = {};
    data.misogi = String(data.misogi || '');
    const legacy = /^\d{4}-\d{2}-\d{2}$/.test(data.misogiDate || '') ? data.misogiDate : '';
    data.misogiStartDate = /^\d{4}-\d{2}-\d{2}$/.test(data.misogiStartDate || '') ? data.misogiStartDate : legacy;
    data.misogiEndDate = /^\d{4}-\d{2}-\d{2}$/.test(data.misogiEndDate || '') && data.misogiEndDate >= data.misogiStartDate ? data.misogiEndDate : '';
    delete data.misogiDate;
    return data;
  }

  function horizonMonthKey(year = horizonYear, month = horizonMonth) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }

  function horizonMonthData(year = horizonYear, month = horizonMonth) {
    const yearData = horizonYearData(year);
    const key = horizonMonthKey(year, month);
    if (!yearData.months[key] || typeof yearData.months[key] !== 'object') yearData.months[key] = { outcomes: [], anchors: [] };
    const data = yearData.months[key];
    // Legacy month outcomes are kept in storage for backwards compatibility but are no longer part of Horizon UI.
    if (!Array.isArray(data.outcomes)) data.outcomes = [];
    if (!Array.isArray(data.anchors)) data.anchors = [];
    data.anchors = data.anchors.map(anchor => {
      const legacy = /^\d{4}-\d{2}-\d{2}$/.test(anchor?.date || '') ? anchor.date : `${key}-01`;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(anchor?.startDate || '') ? anchor.startDate : legacy;
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(anchor?.endDate || '') && anchor.endDate >= startDate ? anchor.endDate : '';
      return { id: anchor?.id || uid('keydate'), text: String(anchor?.text || ''), startDate, endDate };
    }).filter(anchor => anchor.text.trim() || anchor.startDate);
    return data;
  }

  function horizonYearKeyDates(year = horizonYear) {
    const rows = [];
    for (let month = 0; month < 12; month += 1) {
      horizonMonthData(year, month).anchors.forEach(anchor => rows.push({ ...anchor, ownerMonth: month }));
    }
    return rows;
  }

  function openHorizon(view = 'year', targetDate = date) {
    horizonYear = Math.max(horizonMinYear(), targetDate.getFullYear());
    horizonMonth = targetDate.getMonth();
    renderHorizon();
    openModal(qs('[data-horizon-modal]'));
    horizonView.onOpen();
    trackOncePer('day', 'horizon_opened');
  }

  function renderHorizon(options) { horizonView.render(options); }

  const horizonView = createHorizonView({
    getYear: () => horizonYear,
    getMonth: () => horizonMonth,
    minYear: horizonMinYear,
    shiftYear: delta => { horizonYear = Math.max(horizonMinYear(), horizonYear + delta); },
    yearData: horizonYearData,
    keyDates: horizonYearKeyDates,
    persist: persistSettings,
    confirm: requestConfirmation,
    openCalendar: openCalendarPopover,
    openPeriod: openPeriodCalendarPopover,
    openList: openListPopover,
    openEvent: openHorizonYearEventPopover,
    openNewKeyDate: openNewKeyDatePopover,
    showPopover,
    closeAllPopovers,
    autoGrow: autoGrowInlineField,
    progress: progressFor,
    printYear: () => printFeature.printYear(horizonYear),
    readDay: key => (key === ymd(date) ? state : store.readJSON(`daily-planner:${key}`)),
    categoryFor: id => { const category = categoryFor(id); return category ? { id: category.id, name: category.name, color: category.color } : null; },
    categories: () => settings.categories.map(category => ({ ...category })),
    weekStartsOn: () => settings.weekStartsOn,
    insightsEntry: year => renderInsightsEntry(year),
    openInsights: year => { insightsFeature.focusYear(year); insightsFeature.invalidate(); statsFeature.setView('insights'); openModal(qs('[data-stats-modal]'), null, { stack: true }); },
    track: trackEvent,
    trackOncePer,
    openDay: dayKey => { closeModal(qs('[data-horizon-modal]')); date = dateFromKey(dayKey); plannerRangeView = 'day'; load(); }
  });

  function openHorizonYearEventPopover(anchor, kind, id, ownerMonth = '') {
    closeAllPopovers();
    const data = horizonYearData(horizonYear);
    let item = null;
    if (kind === 'misogi') item = { text: data.misogi || '', startDate: data.misogiStartDate || '', endDate: data.misogiEndDate || '', done: !!data.misogiDone };
    if (kind === 'adventure') item = data.miniAdventures.find(entry => entry.id === id) || null;
    if (kind === 'keydate') item = horizonYearKeyDates(horizonYear).find(entry => entry.id === id) || null;
    if (!item) return;
    let draftStart = item.startDate || '';
    let draftEnd = item.endDate || '';
    const popover = document.createElement('div');
    popover.className = 'app-popover horizon-event-popover';
    const typeLabel = kind === 'misogi' ? 'Misogi' : kind === 'adventure' ? 'Mini-adventure' : 'Key date';
    const doneControl = kind === 'misogi' || kind === 'adventure' ? `<input class="check horizon-event-popover__check" type="checkbox" data-horizon-event-done ${item.done ? 'checked' : ''} aria-label="Mark ${escAttr(typeLabel)} complete">` : '';
    const titleLabel = kind === 'keydate' ? '<span>Title</span>' : '';
    popover.innerHTML = `<div class="horizon-event-popover__head"><span>${esc(typeLabel)}</span><button type="button" data-horizon-event-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>
      <div class="horizon-event-popover__title-row${doneControl ? ' has-done-control' : ''}">${doneControl}<label class="horizon-event-popover__title">${titleLabel}<input type="text" data-horizon-event-title value="${escAttr(item.text || '')}" maxlength="180"></label></div>
      <div class="horizon-event-popover__calendar-line"><span data-horizon-event-period-label>${esc(draftStart ? rangeLabel(draftStart, draftEnd) : 'Put it on the calendar')}</span><button class="task-action" type="button" data-horizon-event-period aria-label="Put it on the calendar" data-tooltip="Choose dates">${calendarSvg()}</button></div>
      <div class="horizon-event-popover__actions"><button type="button" class="task-action horizon-event-popover__remove" data-horizon-event-remove aria-label="${kind === 'misogi' ? 'Clear Misogi' : `Remove ${typeLabel}`}" data-tooltip="${kind === 'misogi' ? 'Clear' : 'Remove'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button><div class="horizon-event-popover__actions-right"><button type="button" class="text-button" data-horizon-event-cancel>Cancel</button><button type="button" class="primary-button" data-horizon-event-save>Save</button></div></div>`;
    const periodLabel = qs('[data-horizon-event-period-label]', popover);
    const syncPeriod = () => { if (periodLabel) periodLabel.textContent = draftStart ? rangeLabel(draftStart, draftEnd) : 'Put it on the calendar'; };
    qs('[data-horizon-event-period]', popover)?.addEventListener('click', event => {
      openPeriodCalendarPopover(event.currentTarget, draftStart, draftEnd, (startDate, endDate) => {
        draftStart = startDate || '';
        draftEnd = endDate || '';
        syncPeriod();
      }, { minKey: `${horizonMinYear()}-01-01`, maxKey: `${horizonYear}-12-31`, fallbackKey: draftStart || `${horizonYear}-01-01`, preserveParent: true, align: 'end' });
    });
    qs('[data-horizon-event-close]', popover).addEventListener('click', closePopover);
    qs('[data-horizon-event-cancel]', popover)?.addEventListener('click', closePopover);
    qs('[data-horizon-event-save]', popover).addEventListener('click', () => {
      const text = qs('[data-horizon-event-title]', popover).value.trim();
      const startDate = draftStart;
      let endDate = draftEnd;
      if (startDate && endDate && endDate < startDate) endDate = startDate;
      if (kind === 'misogi') { data.misogi = text; data.misogiStartDate = startDate; data.misogiEndDate = endDate === startDate ? '' : endDate; data.misogiDone = !!qs('[data-horizon-event-done]', popover)?.checked; }
      if (kind === 'adventure') { const target = data.miniAdventures.find(entry => entry.id === id); if (target) { target.text = text; target.startDate = startDate; target.endDate = endDate === startDate ? '' : endDate; target.done = !!qs('[data-horizon-event-done]', popover)?.checked; target.status = target.done ? 'done' : (startDate ? 'planned' : 'idea'); if (startDate) target.month = dateFromKey(startDate).getMonth(); } }
      if (kind === 'keydate') {
        const month = Number(ownerMonth);
        const target = Number.isInteger(month) ? horizonMonthData(horizonYear, month).anchors.find(entry => entry.id === id) : null;
        if (target) { target.text = text; target.startDate = startDate; target.endDate = endDate === startDate ? '' : endDate; }
      }
      persistSettings(); closeAllPopovers(); renderHorizon();
    });
    qs('[data-horizon-event-remove]', popover).addEventListener('click', () => {
      requestConfirmation({
        eyebrow: kind === 'misogi' ? 'Clear Misogi' : `Remove ${typeLabel.toLowerCase()}`,
        title: kind === 'misogi' ? 'Clear this Misogi?' : `Remove this ${typeLabel.toLowerCase()}?`,
        message: 'This removes it from Horizon. Existing daily plans are not changed.',
        confirmLabel: kind === 'misogi' ? 'Clear' : 'Remove',
        action: () => {
          if (kind === 'misogi') { data.misogi = ''; data.misogiStartDate = ''; data.misogiEndDate = ''; data.misogiDone = false; }
          if (kind === 'adventure') data.miniAdventures = data.miniAdventures.filter(entry => entry.id !== id);
          if (kind === 'keydate') for (let month = 0; month < 12; month += 1) horizonMonthData(horizonYear, month).anchors = horizonMonthData(horizonYear, month).anchors.filter(entry => entry.id !== id);
          persistSettings(); closeAllPopovers(); renderHorizon();
        }
      });
    });
    showPopover(anchor, popover, { width: 360 });
    requestAnimationFrame(() => qs('[data-horizon-event-title]', popover)?.focus({ preventScroll: true }));
  }

  function openNewKeyDatePopover(anchor, initialStartDate = `${horizonYear}-${String(horizonMonth + 1).padStart(2, '0')}-01`, options = {}) {
    closeAllPopovers();
    const preselect = options.preselect !== false;
    let draftStart = preselect ? initialStartDate : '';
    let draftEnd = '';
    const popover = document.createElement('div');
    popover.className = 'app-popover horizon-event-popover horizon-event-popover--keydate-new';
    popover.innerHTML = `<div class="horizon-event-popover__head"><span>Add a key date</span><button type="button" data-horizon-event-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>
      <label class="horizon-event-popover__title"><span>Title</span><input type="text" data-horizon-event-title maxlength="180" placeholder="What is worth protecting?"></label>
      <div class="horizon-event-popover__calendar-line"><span data-horizon-event-period-label>${esc(draftStart ? rangeLabel(draftStart, draftEnd) : 'Put it on the calendar')}</span><button class="task-action" type="button" data-horizon-event-period aria-label="Put it on the calendar" data-tooltip="Choose dates" disabled>${calendarSvg()}</button></div>
      <div class="horizon-event-popover__actions horizon-event-popover__actions--single"><button type="button" class="text-button" data-horizon-event-cancel>Cancel</button><button type="button" class="primary-button" data-horizon-event-save disabled>Add</button></div>`;
    const titleInput = qs('[data-horizon-event-title]', popover);
    const saveButton = qs('[data-horizon-event-save]', popover);
    const periodButton = qs('[data-horizon-event-period]', popover);
    const periodLabel = qs('[data-horizon-event-period-label]', popover);
    const sync = () => {
      const hasTitle = !!titleInput.value.trim();
      periodLabel.textContent = draftStart ? rangeLabel(draftStart, draftEnd) : 'Put it on the calendar';
      periodButton.disabled = !hasTitle;
      saveButton.disabled = !draftStart || !hasTitle;
    };
    titleInput.addEventListener('input', sync);
    titleInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || !titleInput.value.trim()) return;
      event.preventDefault();
      if (draftStart) saveButton.click(); else periodButton.click();
    });
    periodButton?.addEventListener('click', event => {
      if (!titleInput.value.trim()) return;
      openPeriodCalendarPopover(event.currentTarget, draftStart, draftEnd, (startDate, endDate) => {
        draftStart = startDate || '';
        draftEnd = endDate || '';
        sync();
      }, { minKey: `${horizonMinYear()}-01-01`, maxKey: `${horizonYear}-12-31`, fallbackKey: draftStart || initialStartDate, preserveParent: true, align: 'end' });
    });
    sync();
    const close = () => closePopover();
    qs('[data-horizon-event-close]', popover).addEventListener('click', close);
    qs('[data-horizon-event-cancel]', popover).addEventListener('click', close);
    saveButton.addEventListener('click', () => {
      const text = titleInput.value.trim();
      if (!text || !draftStart) return;
      const ownerMonth = dateFromKey(draftStart).getMonth();
      horizonMonthData(horizonYear, ownerMonth).anchors.push({ id: uid('keydate'), text, startDate: draftStart, endDate: draftEnd || '' });
      persistSettings();
      closeAllPopovers();
      renderHorizon();
    });
    showPopover(anchor, popover, { width: 360 });
    requestAnimationFrame(() => titleInput?.focus({ preventScroll: true }));
  }

  function chevronLeftSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'; }
  function chevronRightSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'; }

  // ---------------------------------------------------------------------------
  // Journal and Unresolved work
  // ---------------------------------------------------------------------------

  function candidateAlreadyTransferred(candidate, sourceDay) {
    const text = (candidate.kind === 'block' ? candidate.block?.title : candidate.item?.text || '').trim().toLocaleLowerCase();
    if (!text) return false;
    if ((settings.openWork || []).some(item => item.originDay === sourceDay && item.text.trim().toLocaleLowerCase() === text)) return true;
    return savedPlannerDays().some(([dayKey, dayState]) => {
      if (dayKey <= sourceDay) return false;
      const items = [...(dayState.priorities || []), ...(dayState.tasks || [])];
      if (items.some(item => item.originDay === sourceDay && item.text.trim().toLocaleLowerCase() === text && Number(item.carriedCount) > 0)) return true;
      return (dayState.blocks || []).some(block => block.originDay === sourceDay && block.title.trim().toLocaleLowerCase() === text && Number(block.carriedCount) > 0);
    });
  }

  function needsAttentionEntries() {
    const todayKey = ymd(new Date());
    const entries = [];
    savedPlannerDays().forEach(([dayKey, dayState]) => {
      if (dayKey >= todayKey) return;
      candidatesForSavedDay(dayKey, dayState).forEach(candidate => { if (!candidateAlreadyTransferred(candidate, dayKey)) entries.push(candidate); });
    });
    return entries.sort((a, b) => b.originDay.localeCompare(a.originDay));
  }

  function pendingPlanKey({ mode, origin = '', key = '', openId = '' }) {
    return mode === 'later' ? `later:${openId}` : `need:${origin}:${key}`;
  }

  function renderOpenWork() {
    const wrap = qs('[data-open-work-content]');
    if (!wrap) return;
    const needs = needsAttentionEntries();
    const later = settings.openWork || [];
    const validPending = new Set([
      ...needs.map(candidate => pendingPlanKey({ mode: 'need', origin: candidate.originDay, key: candidate.key })),
      ...later.map(item => pendingPlanKey({ mode: 'later', openId: item.id }))
    ]);
    [...openWorkPendingPlans.keys()].forEach(key => { if (!validPending.has(key)) openWorkPendingPlans.delete(key); });

    qsa('[data-open-work-view]').forEach(button => {
      const active = button.dataset.openWorkView === openWorkView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const needsCount = qs('[data-open-work-count="needs"]'), laterCount = qs('[data-open-work-count="later"]');
    if (needsCount) needsCount.textContent = String(needs.length);
    if (laterCount) laterCount.textContent = String(later.length);
    const ageMeta = (originDay, count = 0) => {
      const days = originDay ? Math.max(0, daysBetweenKeys(originDay, ymd(new Date()))) : 0;
      return { days, count: Math.max(0, Number(count) || 0) };
    };
    const renderNeed = candidate => {
      const text = candidate.kind === 'block' ? candidate.block.title : candidate.item.text;
      const count = Number(candidate.item?.carriedCount ?? candidate.block?.carriedCount ?? 0);
      const origin = candidate.item?.originDay || candidate.block?.originDay || candidate.originDay;
      const age = ageMeta(origin, count);
      const planKey = pendingPlanKey({ mode: 'need', origin: candidate.originDay, key: candidate.key });
      const pending = openWorkPendingPlans.get(planKey);
      return `<article class="open-work-row${pending ? ' has-pending-plan' : ''}"><button class="open-work-row__main" type="button" data-open-origin="${escAttr(candidate.originDay)}"><strong>${esc(text)}</strong><span class="open-work-meta"><time>${esc(formatDateButton(candidate.originDay))}</time>${age.count ? `<span class="carry-badge">Moved ${age.count}×</span>` : ''}</span></button><div class="open-work-row__actions"><button type="button" class="${pending ? 'is-planned' : ''}" data-open-plan="need" data-origin="${escAttr(candidate.originDay)}" data-key="${escAttr(candidate.key)}">${pending ? esc(formatDateButton(pending.dateKey)) : 'Plan'}</button><button type="button" data-open-later data-origin="${escAttr(candidate.originDay)}" data-key="${escAttr(candidate.key)}" class="triage-icon-button" aria-label="Save" data-tooltip="Save: keep it for later, without a date">${SAVE_ICON}</button><button type="button" class="triage-icon-button" data-open-drop="need" data-origin="${escAttr(candidate.originDay)}" data-key="${escAttr(candidate.key)}" aria-label="Forget" data-tooltip="Forget: remove it from Unresolved — its day keeps the history">${FORGET_ICON}</button></div></article>`;
    };
    const renderLater = item => {
      const age = ageMeta(item.originDay, item.carriedCount);
      const planKey = pendingPlanKey({ mode: 'later', openId: item.id });
      const pending = openWorkPendingPlans.get(planKey);
      return `<article class="open-work-row${pending ? ' has-pending-plan' : ''}"><div class="open-work-row__main"><strong>${esc(item.text)}</strong><span class="open-work-meta">${age.count ? `<span class="carry-badge">Moved ${age.count}×</span>` : ''}</span></div><div class="open-work-row__actions"><button type="button" class="${pending ? 'is-planned' : ''}" data-open-plan="later" data-open-id="${escAttr(item.id)}">${pending ? esc(formatDateButton(pending.dateKey)) : 'Plan'}</button><button type="button" class="triage-icon-button" data-open-drop="later" data-open-id="${escAttr(item.id)}" aria-label="Forget" data-tooltip="Forget: remove it from Unresolved">${FORGET_ICON}</button></div></article>`;
    };
    const rows = openWorkView === 'needs' ? needs.map(renderNeed) : later.map(renderLater);
    const empty = openWorkView === 'needs' ? 'Nothing unfinished from past days.' : 'Nothing saved for later.';
    wrap.innerHTML = rows.length ? `<div class="open-work-list">${rows.join('')}</div>` : `<div class="open-work-empty">${empty}</div>`;

    const footer = qs('[data-open-work-footer]');
    const pendingCopy = qs('[data-open-work-pending-copy]');
    const confirm = qs('[data-open-work-confirm]');
    const pendingCount = openWorkPendingPlans.size;
    if (footer) footer.hidden = pendingCount === 0;
    if (pendingCopy) pendingCopy.textContent = pendingCount === 1 ? '1 plan ready' : `${pendingCount} plans ready`;
    if (confirm) confirm.textContent = pendingCount === 1 ? 'Confirm plan' : `Confirm ${pendingCount} plans`;

    qsa('[data-open-origin]', wrap).forEach(button => button.addEventListener('click', () => { closeModal(qs('[data-open-work-modal]')); date = dateFromKey(button.dataset.openOrigin); load(); }));
    qsa('[data-open-plan]', wrap).forEach(button => button.addEventListener('click', () => planOpenWork(button)));
    qsa('[data-open-later]', wrap).forEach(button => button.addEventListener('click', () => { openWorkPendingPlans.delete(pendingPlanKey({ mode:'need', origin:button.dataset.origin, key:button.dataset.key })); moveNeedToLater(button.dataset.origin, button.dataset.key); }));
    qsa('[data-open-drop]', wrap).forEach(button => button.addEventListener('click', () => { const planKey = button.dataset.openDrop === 'later' ? pendingPlanKey({mode:'later',openId:button.dataset.openId}) : pendingPlanKey({mode:'need',origin:button.dataset.origin,key:button.dataset.key}); openWorkPendingPlans.delete(planKey); dropOpenWork(button); }));
    if (confirm) confirm.onclick = confirmOpenWorkPlans;
    const clear = qs('[data-open-work-clear-plans]');
    if (clear) clear.onclick = () => { openWorkPendingPlans.clear(); renderOpenWork(); };
  }

  function findCandidateInDay(dayKey, key) {
    const dayState = dayKey === ymd() ? state : loadStateForDate(dateFromKey(dayKey));
    return { dayState, candidate: candidatesForSavedDay(dayKey, dayState).find(item => item.key === key) || null };
  }

  function markCandidateTriaged(dayKey, dayState, key, suffix) {
    dayState.triaged = [...new Set([...(dayState.triaged || []), `${key}${suffix}`])];
    if (dayKey === ymd()) state = dayState;
    persistStateForDate(dateFromKey(dayKey), dayState);
  }

  function moveNeedToLater(dayKey, key) {
    const { dayState, candidate } = findCandidateInDay(dayKey, key);
    if (!candidate) return;
    addCandidateToLater(candidate);
    markCandidateTriaged(dayKey, dayState, key, ':later');
    persistSettings(); renderOpenWork(); checkStorageSoon();
  }

  function dropOpenWork(button) {
    if (button.dataset.openDrop === 'later') {
      settings.openWork = settings.openWork.filter(item => item.id !== button.dataset.openId);
      persistSettings(); renderOpenWork(); return;
    }
    const { dayState, candidate } = findCandidateInDay(button.dataset.origin, button.dataset.key);
    if (!candidate) return;
    markCandidateTriaged(button.dataset.origin, dayState, button.dataset.key, ':drop');
    renderOpenWork();
  }

  function planOpenWork(button) {
    const descriptor = button.dataset.openPlan === 'later'
      ? { mode: 'later', openId: button.dataset.openId }
      : { mode: 'need', origin: button.dataset.origin, key: button.dataset.key };
    const planKey = pendingPlanKey(descriptor);
    const existing = openWorkPendingPlans.get(planKey);
    const defaultDate = existing?.dateKey ? dateFromKey(existing.dateKey) : nextPlanningDateFrom(new Date(), { includeCurrent: true });
    openCalendarPopover(button, ymd(defaultDate), value => {
      openWorkPendingPlans.set(planKey, { ...descriptor, dateKey: value });
      closePopover();
      renderOpenWork();
    }, { minKey: ymd(new Date()) });
  }

  function applyOpenWorkPlan(plan) {
    const targetDate = dateFromKey(plan.dateKey);
    const targetState = loadStateForDate(targetDate);
    if (plan.mode === 'later') {
      const item = settings.openWork.find(entry => entry.id === plan.openId);
      if (!item) return false;
      const priorCarryCount = Math.max(0, Number(item.carriedCount) || 0);
      const sourceCarryCount = Math.max(0, priorCarryCount - 1);
      const candidate = item.kind === 'block'
        ? { kind: 'block', block: { ...(item.block || {}), title: item.text, carriedCount: sourceCarryCount, originDay: item.originDay }, originDay: item.originDay }
        : { kind: item.kind === 'priority' ? 'priority' : 'task', index: item.kind === 'priority' ? 1 : 0, item: { id: uid('open-source'), text: item.text, done: false, carriedCount: sourceCarryCount, originDay: item.originDay }, block: item.block ? { ...item.block, carriedCount: sourceCarryCount, originDay: item.originDay } : null, originDay: item.originDay };
      if (candidate.kind === 'block') copyBlockToTarget(candidate.block, targetState, null, targetDate, candidate.originDay);
      else { const destination = carryItemToTarget(candidate, targetState); copyBlockToTarget(candidate.block, targetState, destination, targetDate, candidate.originDay); }
      settings.openWork = settings.openWork.filter(entry => entry.id !== item.id);
      persistSettings();
    } else {
      const { dayState, candidate } = findCandidateInDay(plan.origin, plan.key);
      if (!candidate) return false;
      if (candidate.kind === 'block') copyBlockToTarget(candidate.block, targetState, null, targetDate, candidate.originDay);
      else { const destination = carryItemToTarget(candidate, targetState); copyBlockToTarget(candidate.block, targetState, destination, targetDate, candidate.originDay); }
      markCandidateTriaged(plan.origin, dayState, plan.key, `@${ymd(targetDate)}`);
    }
    persistStateForDate(targetDate, targetState);
    return true;
  }

  function confirmOpenWorkPlans() {
    const plans = [...openWorkPendingPlans.values()];
    if (!plans.length) return;
    plans.forEach(applyOpenWorkPlan);
    openWorkPendingPlans.clear();
    renderOpenWork();
    checkStorageSoon();
  }

  function openUnresolvedModal(options = {}) {
    const returnTo = options.returnTo || null;
    openWorkPendingPlans.clear();
    renderOpenWork();
    openWorkReturnModal = returnTo;
    openWorkReturnScrollTop = returnTo ? (qs('.modal__scroll', returnTo)?.scrollTop || 0) : 0;
    openModal(qs('[data-open-work-modal]'));
    trackOncePer('day', 'unresolved_opened');
  }

  const yearPrintData = year => ({ year, data: horizonYearData(year), keyDates: horizonYearKeyDates(year), weekStartsOn: settings.weekStartsOn, progress: progressFor(year), today: new Date() });
  const printFeature = createPrintFeature({
    qs, getState: () => state, getDate: () => date, getPlannerRangeView: () => plannerRangeView,
    visibleStartMinutes, visibleEndMinutes, layoutBlocks, categoryFor, isBlockDone, time, esc,
    planningWeekDates, isoWeekNumber, loadStateForDate, ymd, atNoon, updatePrintSizing,
    renderWeekSchedule, hideAppTooltip, closePopover, updateNow, trackOncePer,
    getPrintYear: () => (qs('[data-horizon-modal]')?.hidden === false ? horizonYear : null),
    yearPrintData
  });
  const { printPlanner, cleanupPrintMode } = printFeature;

  // ---------------------------------------------------------------------------
  // Export, Picture-in-Picture, mobile shell, help, and bootstrap bindings
  // ---------------------------------------------------------------------------

  function markdown() {
    return `# Daily Planner — ${ymd()}\n\n## Keep in mind\n${state.focus || '—'}\n\n## Most important outcome\n- [${state.priorities[0].done ? 'x' : ' '}] ${state.priorities[0].text}\n\n## Other important outcomes\n${state.priorities.slice(1).map(x => `- [${x.done ? 'x' : ' '}] ${x.text}`).join('\n')}\n\n## Schedule\n${[...state.blocks].sort((a,b) => a.start-b.start).map(b => `- [${isBlockDone(b) ? 'x' : ' '}] ${blockTimeRange(b)} ${b.title}${categoryFor(b.categoryId) ? ` [${categoryFor(b.categoryId).name}]` : ''}${b.link ? ` — ${b.link}` : ''}${b.notes ? ` — ${b.notes}` : ''}`).join('\n')}\n\n## Tasks\n${state.tasks.map(x => `- [${x.done ? 'x' : ' '}] ${x.text}`).join('\n')}\n\n## Notes\n${state.notes || '—'}\n`;
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // The floating window shows the selected day. Its arrows move one planning day (the main window
  // follows and keeps its Day or Week view); ticks and edits in either window show in the other.
  const pipItem = (type, id) => (type === 'priority' ? state.priorities : type === 'task' ? state.tasks : []).find(item => item.id === id);
  const linkedBlocks = (type, id) => state.blocks.filter(block => block.linkedType === type && block.linkedId === id);
  const commitFromPip = () => { renderItems(); renderScheduleRange(); renderStats(); save(); };
  // Floating mode needs Document Picture-in-Picture (Chromium on a computer): elsewhere its button,
  // shortcut hint and shortcut are gone rather than answering with an error.
  const pipSupported = !!window.documentPictureInPicture;
  qsa('[data-pip], [data-pip-hint]').forEach(node => { node.hidden = !pipSupported; });
  // Scheduling needs the full planner: the floating window closes so the dialog never opens behind it.
  const openInPlanner = open => { pipFeature.close(); setTimeout(() => { window.focus(); open(); }, 30); };
  pipFeature = createPipFeature({
    canOpen: () => pipSupported && !window.matchMedia('(max-width: 790px)').matches,
    onOpen: () => trackOncePer('day', 'pip_opened'),
    mirrorTheme: doc => themeController.mirrorTo(doc),
    getDate: () => date,
    getState: () => state,
    ymd,
    weekStartsOn: () => settings.weekStartsOn,
    minDateKey: '2026-01-01',
    categoryFor,
    isBlockDone,
    linkedBlock,
    blockTimeRange,
    stepDay: direction => shiftDate(direction, { byDay: true }),
    goToNow,
    goToDate: key => showDate(dateFromKey(key)),
    toggleBlock: (id, done) => { const block = state.blocks.find(item => item.id === id); if (!block) return; setBlockDone(block, done); commitFromPip(); },
    toggleItem: (type, id, done) => { const item = pipItem(type, id); if (!item) return; item.done = done; linkedBlocks(type, id).forEach(block => setBlockDone(block, done)); commitFromPip(); },
    editItem: (type, id, text) => { const item = pipItem(type, id); if (!item) return; item.text = text; linkedBlocks(type, id).forEach(block => { block.title = text; }); renderItems(); renderScheduleRange(); save(); },
    editFocus: text => { state.focus = text; qs('[data-focus]').value = text; autoGrowInlineField(qs('[data-focus]')); save(); },
    editNotes: text => { state.notes = text; setDayNotesEditor(text); autoGrowNotes(); save(); },
    addTask: () => { const task = { id: uid('task'), text: '', done: false, carriedCount: 0 }; state.tasks.push(task); renderItems(); save(); return task.id; },
    openBlock: id => { const block = state.blocks.find(item => item.id === id); if (block) { window.focus(); openBlockModal(block); } },
    scheduleItem: (type, id) => {
      const item = pipItem(type, id);
      if (!item?.text.trim()) return;
      const existing = linkedBlock(type, item.id);
      openInPlanner(() => (existing ? openBlockModal(existing) : openBlockModal(null, { title: item.text, linkedType: type, linkedId: item.id, start: recommendedStart() })));
    },
    addBlock: () => openInPlanner(() => openBlockModal(null, { start: recommendedStart() })),
    // Plan ends with what the planner's Unresolved holds: past items to decide on, and Later.
    unresolved: () => ({ needs: needsAttentionEntries(), later: settings.openWork || [] })
  });

  function setMobileView(view, { animate = true } = {}) {
    qs('[data-workspace]').dataset.mobileActive = view;
    viewSwitch.setActive(view, { animate });
    if (view === 'plan') requestAnimationFrame(regrowItemFields);
    // The week grid was hidden behind the agenda: bring today's column into view again.
    else if (plannerRangeView === 'week') { weekFeature.resetAutoScroll(); renderWeekSchedule(); }
  }

  function focusOrCreateTaskSlot() {
    let task = state.tasks.find(item => !item.text.trim());
    if (!task) {
      task = { id: uid('task'), text: '', done: false, carriedCount: 0 };
      state.tasks.push(task);
      renderItems();
      save();
    }
    const id = task.id;
    requestAnimationFrame(() => {
      const input = qs(`[data-item-id="${id}"] .item-input`);
      input?.focus({ preventScroll: true });
    });
  }
  function setupHelpFaq() {
    qsa('.help-faq > summary').forEach(summary => {
      summary.addEventListener('click', event => {
        event.preventDefault();
        const details = summary.parentElement;
        const reveal = qs('.help-faq__reveal', details);
        if (!reveal || details.dataset.animating === 'true') return;
        details.dataset.animating = 'true';
        const opening = !details.open;
        if (opening) details.open = true;
        const inner = reveal.firstElementChild;
        const from = opening ? 0 : reveal.getBoundingClientRect().height;
        const to = opening ? (inner?.scrollHeight || 0) : 0;
        const anim = reveal.animate([{ height: `${from}px`, opacity: opening ? .2 : 1 }, { height: `${to}px`, opacity: opening ? 1 : .2 }], { duration: 210, easing: 'cubic-bezier(.22,1,.36,1)' });
        anim.onfinish = () => { reveal.style.height = ''; reveal.style.opacity = ''; if (!opening) details.open = false; details.dataset.animating = 'false'; };
      });
    });
  }

  // Core bindings
  qs('[data-focus]').addEventListener('input', e => { state.focus = e.target.value; autoGrowInlineField(e.target); qs('[data-focus-clear]')?.toggleAttribute('hidden', !state.focus.trim()); save(); });
  qs('[data-focus-clear]')?.addEventListener('click', () => requestConfirmation({
    eyebrow: 'Clear Keep in mind',
    title: 'Clear Keep in mind?',
    message: 'This removes the intention from this day.',
    confirmLabel: 'Clear',
    action: () => { state.focus=''; const field=qs('[data-focus]'); field.value=''; autoGrowInlineField(field); qs('[data-focus-clear]').hidden=true; save(); }
  }));
  const dayNotesEditor = qs('[data-day-notes-editor]');
  dayNotesEditor?.addEventListener('input', () => {
    upgradeDayNoteSlashShortcut(dayNotesEditor);
    syncDayNotesStorage();
    state.notes = getDayNotesValue();
    save();
  });
  dayNotesEditor?.addEventListener('click', event => {
    const check = event.target.closest('[data-day-note-check]');
    if (!check) return;
    event.preventDefault();
    check.classList.toggle('is-checked');
    check.setAttribute('aria-pressed', String(check.classList.contains('is-checked')));
    syncDayNotesStorage();
    state.notes = getDayNotesValue();
    save();
  });
  dayNotesEditor?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const row = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest?.('.day-note-line');
    if (!row || !dayNotesEditor.contains(row)) return;
    event.preventDefault();
    const next = document.createElement('div');
    next.className = 'day-note-line';
    next.innerHTML = '<br>';
    row.after(next);
    placeCaretAtEnd(next);
    syncDayNotesStorage();
    state.notes = getDayNotesValue();
    save();
  });
  qs('[data-task-add-toggle]').addEventListener('click', focusOrCreateTaskSlot);

  qs('[data-schedule]').addEventListener('click', handleScheduleClick);
  qsa('[data-schedule-add], [data-mobile-schedule-add]').forEach(button => button.addEventListener('click', () => openBlockModal(null, { start: recommendedStart() })));
  qs('[data-schedule]').addEventListener('pointermove', handleSchedulePointerMove);
  qs('[data-schedule]').addEventListener('pointerleave', () => { qs('[data-schedule-hover]').hidden = true; });
  qs('[data-prev]').addEventListener('click', () => shiftDate(-1));
  qs('[data-next]').addEventListener('click', () => shiftDate(1));
  qs('[data-today]').addEventListener('click', goToNow);
  qs('[data-week-view]')?.addEventListener('click', toggleWeekView);
  const datePicker = qs('[data-date-picker]');
  const openHeaderDatePicker = () => openCalendarPopover(datePicker, ymd(date), value => showDate(dateFromKey(value)), { minKey: '2026-01-01' });
  datePicker?.addEventListener('click', openHeaderDatePicker);
  // Enter or Space clicks it, so a second press closes the calendar as a second click does (src/ui/popover-trigger.js).
  datePicker?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); datePicker.click(); } });
  qs('[data-search-open]').addEventListener('click', openSearchModal);
  qs('[data-expanded-view]').addEventListener('click', toggleExpandedView);
  qs('[data-print]').addEventListener('click', printPlanner);
  qs('[data-export]').addEventListener('click', e => {
    e.stopPropagation();
    closePopover();
    const menu = qs('[data-export-menu]');
    menu.hidden = !menu.hidden;
    qs('[data-export]').setAttribute('aria-expanded', String(!menu.hidden));
    // Opened from the keyboard (Enter or Space: no pointer, detail 0), focus goes to its first choice.
    if (!menu.hidden && e.detail === 0) qs('button', menu)?.focus();
  });
  qs('[data-export-md]').addEventListener('click', () => download(`daily-planner-${ymd()}.md`, markdown(), 'text/markdown'));
  qs('[data-export-json]').addEventListener('click', () => download(`daily-planner-${ymd()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  qs('[data-export-backup]')?.addEventListener('click', exportPlannerBackup);
  qs('[data-import-menu]')?.addEventListener('click', openImportPicker);
  qs('[data-pip]').addEventListener('click', () => pipFeature.open());
  // The header notice's Data on this device: How it works, at its card.
  const openStorageCard = () => {
    const help = qs('[data-help-modal]');
    const title = qs('.storage-card h3', help);
    if (title) title.tabIndex = -1;
    updateStorageUsage();
    openModal(help, title);
    requestAnimationFrame(() => qs('.storage-card', help)?.scrollIntoView?.({ block: 'center' }));
  };
  storageAlert = createStorageAlert({ health: saveHealth, level: () => storageNow, syncInUse, unavailable: savingUnavailable, exportBackup: exportPlannerBackup, openData: openStorageCard, onLayout: () => requestAnimationFrame(fitHeaderDate) });
  journal = createJournal({ store, liveDay: () => ymd(), liveState: () => state, openModal, closeModal, openDay: key => { date = dateFromKey(key); load(); } });
  const openJournal = () => { journal.open(); trackOncePer('day', 'journal_opened'); };
  const openStats = () => { statsFeature.ensureWeek(); insightsFeature.invalidate(); renderStats(); openModal(qs('[data-stats-modal]')); trackOncePer('day', 'stats_opened'); };
  qs('[data-journal-open]').addEventListener('click', openJournal);
  qs('[data-open-work-open]').addEventListener('click', openUnresolvedModal);
  qs('[data-horizon-scroll]')?.addEventListener('scroll', () => closeAllPopovers(), { passive: true });
  qs('[data-settings-open]').addEventListener('click', () => { renderCategorySettings(); renderSettingsHours(); renderPlanningWeek(); openModal(qs('[data-settings-modal]')); });
  qs('[data-end-day-open]').addEventListener('click', handleEndDayButton);
  qs('[data-end-day-form]').addEventListener('submit', completeEndDay);
  qs('[data-end-day-memory]')?.addEventListener('input', e => { endDayMemoryDraft = e.target.value; });
  qs('[data-end-day-lesson]')?.addEventListener('input', e => { endDayLessonDraft = e.target.value; });
  qs('[data-day-closed-done]')?.addEventListener('click', () => { persistNextDayPrep(); closeModal(qs('[data-day-closed-modal]')); setTimeout(maybePromptInstallOrSupport, 220); });
  qsa('[data-next-day-focus], [data-next-day-main], [data-next-day-other]').forEach(field => field.addEventListener('input', persistNextDayPrep));
  qs('[data-prepare-next-day]')?.addEventListener('click', () => {
    const target = dayClosedNextDate;
    persistNextDayPrep();
    if (dayClosedWeekComplete && dayClosedStage === 'prep') {
      showWeekReviewStage();
      return;
    }
    closeModal(qs('[data-day-closed-modal]'));
    if (target) {
      date = atNoon(target);
      load();
      requestAnimationFrame(() => qs('[data-left-pane]')?.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    setTimeout(maybePromptInstallOrSupport, 220);
  });
  qs('[data-week-review-summary]')?.addEventListener('click', event => {
    if (!event.target.closest('[data-review-open-work]')) return;
    openUnresolvedModal({ returnTo: qs('[data-day-closed-modal]') });
  });
  qs('[data-stats-open]').addEventListener('click', openStats);
  qsa('[data-open-work-view]').forEach(button => button.addEventListener('click', () => { openWorkView = button.dataset.openWorkView; renderOpenWork(); }));
  qsa('[data-stats-view]').forEach(button => button.addEventListener('click', () => {
    statsFeature.setView(button.dataset.statsView);
  }));
  qs('[data-stats-prev-week]').addEventListener('click', () => {
    statsFeature.shiftWeek(-1);
  });
  qs('[data-stats-next-week]').addEventListener('click', () => {
    statsFeature.shiftWeek(1);
  });
  qs('[data-stats-this-week]').addEventListener('click', () => {
    statsFeature.goCurrentWeek();
  });
  qs('[data-stats-help]').addEventListener('click', e => openInfoPopover(e.currentTarget, '<p><strong>Scheduled</strong> is the duration you planned. <strong>Elapsed schedule</strong> is the portion of those blocks whose clock time has passed. <strong>Over plan</strong> is estimated when you mark a scheduled block done on its scheduled day: the planner compares its planned duration with the time from the scheduled start to completion. It is not background activity tracking. The weekly chart compares planned time by category across the active planning days in the selected week.</p>'));
  qs('[data-help-open]').addEventListener('click', () => { updateStorageUsage(); openModal(qs('[data-help-modal]')); });
  qs('[data-reset-open]').addEventListener('click', () => openModal(qs('[data-reset-modal]')));
  qs('[data-reset-export]').addEventListener('click', exportPlannerBackup);
  qs('[data-reset-confirm]').addEventListener('click', resetPlannerData);
  const blockNotesEditor = qs('[data-block-notes-editor]');
  blockNotesEditor?.addEventListener('input', () => {
    upgradeBlockNoteSlashShortcut(blockNotesEditor);
    syncBlockNotesStorage();
  });
  blockNotesEditor?.addEventListener('click', event => {
    const check = event.target.closest('[data-rich-note-check]');
    if (!check) return;
    event.preventDefault();
    check.classList.toggle('is-checked');
    check.setAttribute('aria-pressed', String(check.classList.contains('is-checked')));
    syncBlockNotesStorage();
  });
  blockNotesEditor?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    let line = node && (node.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest?.('.block-note-line');
    if (!line || !blockNotesEditor.contains(line) || line.parentElement !== blockNotesEditor) return;
    event.preventDefault();
    const next = document.createElement('div');
    next.className = 'block-note-line';
    next.innerHTML = '<br>';
    line.insertAdjacentElement('afterend', next);
    placeCaretAtEnd(next);
    syncBlockNotesStorage();
  });

  qs('[data-block-form]').addEventListener('submit', saveBlockFromForm);
  qs('[data-block-delete]').addEventListener('click', deleteActiveBlock);
  qs('[data-block-done]').addEventListener('click', () => { blockDoneDraft = !blockDoneDraft; renderBlockDoneToggle(); });
  qs('[data-toggle-end-date]').addEventListener('click', () => { blockEndDateExplicit = true; renderBlockTimeControls(); });
  qs('[data-block-category]').addEventListener('click', openBlockCategoryMenu);
  qs('[data-block-category-manage]')?.addEventListener('click', () => categoryManager.open());
  qs('[data-start-date]').addEventListener('click', e => openBlockDateMenu('start', e.currentTarget));
  qs('[data-end-date]').addEventListener('click', e => openBlockDateMenu('end', e.currentTarget));
  qs('[data-start-time-menu]').addEventListener('click', e => openBlockTimeMenu('start', e.currentTarget.closest('.time-combo')));
  qs('[data-end-time-menu]').addEventListener('click', e => openBlockTimeMenu('end', e.currentTarget.closest('.time-combo')));
  qs('[data-start-time]').addEventListener('blur', () => commitTimeInput('start'));
  qs('[data-end-time]').addEventListener('blur', () => commitTimeInput('end', { preserveDuration: false }));
  qs('[data-start-time]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitTimeInput('start'); } });
  qs('[data-end-time]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitTimeInput('end', { preserveDuration: false }); } });
  qsa('[data-duration]').forEach(button => button.addEventListener('click', () => applyDuration(Number(button.dataset.duration))));
  qs('[data-setting-start-hour]').addEventListener('click', () => openSettingHourMenu('start'));
  qs('[data-setting-end-hour]').addEventListener('click', () => openSettingHourMenu('end'));
  qs('[data-setting-start-time]')?.addEventListener('blur', () => commitSettingHourInput('start'));
  qs('[data-setting-end-time]')?.addEventListener('blur', () => commitSettingHourInput('end'));
  qs('[data-setting-start-time]')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commitSettingHourInput('start'); } });
  qs('[data-setting-end-time]')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commitSettingHourInput('end'); } });
  qs('[data-week-starts-on]')?.addEventListener('click', openWeekStartMenu);
  qsa('[data-planning-day]').forEach(button => button.addEventListener('click', () => togglePlanningDay(Number(button.dataset.planningDay))));
  qs('[data-category-form]').addEventListener('submit', addCategoryFromForm);
  qs('[data-new-category-color]').addEventListener('click', e => openColorPopover(e.currentTarget, categoryDraftColor, selected => {
    categoryDraftColor = selected.value;
    renderNewCategoryColorTrigger();
  }, { allowAuto: true }));
  qsa('[data-modal-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.closest('.modal'))));
  qs('[data-search-input]').addEventListener('input', e => { renderSearchResults(e.target.value); syncSearchClear(); });
  qs('[data-search-clear]').addEventListener('click', () => { const input = qs('[data-search-input]'); input.value = ''; renderSearchResults(''); syncSearchClear(); input.focus({ preventScroll: true }); });
  qs('[data-search-results]').addEventListener('click', e => { const button = e.target.closest('[data-search-date]'); if (button) goToSearchResult(button); });

  qs('[data-mobile-more]').addEventListener('click', e => {
    e.stopPropagation();
    const menu = qs('[data-mobile-more-menu]');
    menu.hidden = !menu.hidden;
    qs('[data-mobile-more]').setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden && e.detail === 0) qsa('button, a[href]', menu).find(item => !item.hidden && item.getClientRects().length)?.focus();
  });

  qs('[data-mobile-export-toggle]')?.addEventListener('click', e => {
    e.stopPropagation();
    const disclosure = qs('[data-mobile-export-disclosure]');
    const open = !disclosure.classList.contains('is-open');
    disclosure.classList.toggle('is-open', open);
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  // The header menus (Export, More) close on a choice, a click outside or Escape, which hands focus back to their button.
  const closeHeaderMenus = () => [['[data-export-menu]', '[data-export]'], ['[data-mobile-more-menu]', '[data-mobile-more]']].forEach(([menu, button]) => { qs(menu).hidden = true; qs(button).setAttribute('aria-expanded', 'false'); });
  qs('[data-mobile-print]').addEventListener('click', () => { closeHeaderMenus(); printPlanner(); });
  qs('[data-mobile-stats]')?.addEventListener('click', () => { closeHeaderMenus(); openStats(); });
  qs('[data-mobile-export]')?.addEventListener('click', () => { closeHeaderMenus(); openModal(qs('[data-export-modal]')); });
  qs('[data-mobile-settings]').addEventListener('click', () => { closeHeaderMenus(); renderCategorySettings(); renderSettingsHours(); renderPlanningWeek(); openModal(qs('[data-settings-modal]')); });
  qs('[data-mobile-help]').addEventListener('click', () => { closeHeaderMenus(); updateStorageUsage(); openModal(qs('[data-help-modal]')); });
  [['[data-export-menu]', '[data-export]'], ['[data-mobile-export-options]', '[data-mobile-more]']].forEach(([list, button]) => qs(list)?.addEventListener('click', e => {
    if (!e.target.closest('button')) return;
    const focused = qs(list).contains(document.activeElement);
    closeHeaderMenus();
    if (focused) qs(button).focus({ preventScroll: true });
  }));

  registerPwa();

  appTooltips.bind();
  // A second click on the trigger of the open popover closes it, before its opener could draw it again (1.39.2).
  closeOnTriggerClick(document, { getOpen: () => activePopover, close: closePopover });
  document.addEventListener('click', e => {
    if (!e.target.closest('.action-popover-wrap')) closeHeaderMenus();
    if (activePopover && !e.target.closest('.app-popover') && e.target !== activePopover.anchor && !activePopover.anchor?.contains(e.target)) closePopover();
  });
  document.addEventListener('keydown', e => {
    // Tab and Shift+Tab stay inside the dialog on top (a popover over it handles its own keys).
    if (e.key === 'Tab' && activeModal && !qs('.app-popover')) { keepTab(e, qs('.modal__panel', activeModal)); return; }
    const key = e.key.toLocaleLowerCase();
    const editable = !!e.target.closest?.('input, textarea, [contenteditable="true"]');
    if (e.key === 'Escape') {
      // Focus inside it (or lost with a click on its blank space) comes back to the control that opened it.
      if (activePopover) { const { el, trigger } = activePopover; const back = el.contains(document.activeElement) || document.activeElement === document.body; closePopover(); if (back) trigger?.focus?.({ preventScroll: true }); return; }
      // A dialog that can't be dismissed (data-modal-keep: first-run setup) ends with its own button, never with Escape.
      if (activeModal?.hasAttribute('data-modal-keep')) return;
      if (activeModal) { closeModal(activeModal); return; }
      const openMenu = [['[data-export-menu]', '[data-export]'], ['[data-mobile-more-menu]', '[data-mobile-more]']].find(([menu]) => !qs(menu).hidden);
      if (openMenu) { closeHeaderMenus(); qs(openMenu[1]).focus(); return; }
    }
    if (!editable && !e.metaKey && !e.ctrlKey && !e.altKey && activeModal) {
      const activeModalShortcut = {
        j: '[data-journal-modal]',
        u: '[data-open-work-modal]',
        y: '[data-horizon-modal]',
        v: '[data-horizon-modal]',
        s: '[data-stats-modal]',
        g: '[data-settings-modal]',
        h: '[data-help-modal]'
      }[key];
      if (activeModalShortcut && activeModal.matches(activeModalShortcut)) {
        e.preventDefault();
        closeModal(activeModal);
        return;
      }
    }
    if (editable || activeModal || activePopover || e.metaKey || e.ctrlKey || e.altKey) return;
    const shortcuts = {
      arrowleft: () => shiftDate(-1), arrowright: () => shiftDate(1),
      n: goToNow, v: toggleWeekView, f: openSearchModal, w: toggleExpandedView,
      i: () => { if (pipSupported) pipFeature.toggle(); },
      j: () => toggleModalShortcut('[data-journal-modal]', openJournal),
      u: () => toggleModalShortcut('[data-open-work-modal]', openUnresolvedModal),
      y: () => toggleModalShortcut('[data-horizon-modal]', () => openHorizon('year', date)),
      s: () => toggleModalShortcut('[data-stats-modal]', openStats),
      p: printPlanner,
      e: () => { const menu = qs('[data-export-menu]'); const trigger = qs('[data-export]'); closePopover(); const opening = !!menu.hidden; menu.hidden = !opening; trigger?.setAttribute('aria-expanded', String(opening)); if (opening) qs('button', menu)?.focus(); else if (menu.contains(document.activeElement)) trigger?.focus(); },
      g: () => toggleModalShortcut('[data-settings-modal]', () => { renderCategorySettings(); renderSettingsHours(); renderPlanningWeek(); openModal(qs('[data-settings-modal]')); }),
      h: () => toggleModalShortcut('[data-help-modal]', () => { updateStorageUsage(); openModal(qs('[data-help-modal]')); }),
      d: () => { if (ymd(date) <= ymd(new Date())) handleEndDayButton(); },
      t: () => openBlockModal(null, { start: recommendedStart() })
    };
    const action = shortcuts[key];
    if (action) { e.preventDefault(); action(); }
  });
  window.addEventListener('resize', () => { hideAppTooltip(); closePopover(); applyExpandedView(); renderScheduleRange(); updateNow(); requestAnimationFrame(fitHeaderDate); requestAnimationFrame(regrowItemFields); });
  window.addEventListener('beforeprint', printFeature.handleBeforePrint);
  window.addEventListener('afterprint', cleanupPrintMode);
  setInterval(() => { updateNow(); renderStats(); renderPip({ tick: true }); viewSwitch.write(); }, 30000);

  qs('[data-mobile-export-md]')?.addEventListener('click', () => download(`daily-planner-${ymd()}.md`, markdown(), 'text/markdown'));
  qs('[data-mobile-export-json]')?.addEventListener('click', () => download(`daily-planner-${ymd()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  qs('[data-mobile-export-backup]')?.addEventListener('click', exportPlannerBackup);
  qs('[data-mobile-import]')?.addEventListener('click', openImportPicker);

  qs('[data-import-open]')?.addEventListener('click', openImportPicker);
  qs('[data-import-file]')?.addEventListener('change', e => { handleImportFile(e.target.files?.[0]); e.target.value = ''; });
  qs('[data-import-confirm]')?.addEventListener('click', confirmImport);

  qs('[data-confirm-action]')?.addEventListener('click', () => { const action = pendingConfirmAction; pendingConfirmAction = null; closeModal(qs('[data-confirm-modal]')); action?.(); });
  qs('[data-reopen-confirm]')?.addEventListener('click', () => { closeModal(qs('[data-reopen-modal]')); reopenClosedDay(); });
  qs('[data-export-modal-md]')?.addEventListener('click', () => { closeModal(qs('[data-export-modal]')); download(`daily-planner-${ymd()}.md`, markdown(), 'text/markdown'); });
  qs('[data-export-modal-json]')?.addEventListener('click', () => { closeModal(qs('[data-export-modal]')); download(`daily-planner-${ymd()}.json`, JSON.stringify(state, null, 2), 'application/json'); });
  qs('[data-export-modal-backup]')?.addEventListener('click', () => { closeModal(qs('[data-export-modal]')); exportPlannerBackup(); });
  qs('[data-export-modal-import]')?.addEventListener('click', () => { closeModal(qs('[data-export-modal]')); openImportPicker(); });
  qs('[data-export-modal-pdf]')?.addEventListener('click', () => { closeModal(qs('[data-export-modal]')); printPlanner(); });

  qsa('[data-github-link]').forEach(link => {
    const url = String(PROJECT_GITHUB_URL || '').trim();
    link.hidden = !url;
    if (url) link.href = url; else link.removeAttribute('href');
  });
  const mobileGithub = qs('[data-mobile-github]');
  if (mobileGithub) {
    const url = String(PROJECT_GITHUB_URL || '').trim();
    mobileGithub.hidden = !url;
    if (url) mobileGithub.href = url; else mobileGithub.removeAttribute('href');
  }
  qsa('[data-github-sponsor]').forEach(link => {
    const url = String(GITHUB_SPONSOR_URL || '').trim();
    link.hidden = !url;
    if (url) link.href = url; else link.removeAttribute('href');
  });
  const supportCard = qs('.github-support');
  if (supportCard) supportCard.hidden = !(String(PROJECT_GITHUB_URL || '').trim() || String(GITHUB_SPONSOR_URL || '').trim());
  const configureOptionalSocial = (selector, url) => qsa(selector).forEach(link => {
    const value = String(url || '').trim();
    link.hidden = !value;
    if (value) link.href = value;
    else link.removeAttribute('href');
  });
  configureOptionalSocial('[data-social-x]', SOCIAL_X_URL);
  configureOptionalSocial('[data-social-linkedin]', SOCIAL_LINKEDIN_URL);
  qsa('.bemorin-footer__socials').forEach(group => { group.hidden = !group.querySelector('a:not([hidden])'); });
  qsa('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  const printHost = qs('[data-print-domain]');
  if (printHost) { printHost.textContent = 'planner.bemorin.com'; printHost.href = 'https://planner.bemorin.com'; }
  const themeController = createThemeController({ onChange: () => pipFeature.syncTheme() });
  checkLocalStorage();
  setupHelpFaq();
  // Settings on its Personal sync section: from the sync guide, and back from Dropbox's sign-in (1.38).
  const openSyncSettings = () => { renderCategorySettings(); renderSettingsHours(); renderPlanningWeek(); openModal(qs('[data-settings-modal]')); requestAnimationFrame(() => { const section = qs('[data-personal-sync]'); section?.scrollIntoView({ behavior: 'smooth', block: 'center' }); section?.classList.add('is-spotlit'); personalSyncFeature?.focus(); setTimeout(() => section?.classList.remove('is-spotlit'), 2400); }); };
  personalSyncFeature = createPersonalSyncFeature({
    store,
    ledger: syncLedger,
    googleClientId: GOOGLE_CLIENT_ID,
    dropboxAppKey: DROPBOX_APP_KEY,
    buildBackup: plannerBackup,
    flushLocal: flushPlannerForSync,
    reloadFromStorage: reloadPlannerAfterSync,
    openSettings: openSyncSettings,
    // Site data blocked: Dropbox's sign-in and access couldn't wait on this device, so it isn't offered.
    storageKept: !storageBlocked
  });
  // The header alert, only while something waits on the person (src/features/sync-status.js); it can move the date title.
  createSyncStatus({ sync: personalSyncFeature, openSettings: openSyncSettings, onLayout: () => requestAnimationFrame(fitHeaderDate) });
  createWorkspaceFeature({ apiUrl: CLOUD_API_URL }).load();
  const sponsorMoment = createSponsorMoment({ openModal, closeModal, url: GITHUB_SPONSOR_URL, dayKeys: () => store.keys('daily-planner:'), readDay: key => (key === ymd(date) ? state : store.readJSON(`daily-planner:${key}`)), shown: () => !!settings.sponsorPromptShown, markShown: () => { settings.sponsorPromptShown = true; persistSettings(); } });
  const installFeature = createInstallFeature({ openModal, closeModal, getCloseDayCount: () => settings.closeDayCount, wasPrompted: () => !!settings.installPromptShown, markPrompted: () => { settings.installPromptShown = true; persistSettings(); } });
  const privacyNotice = createPrivacyNotice({ openModal, closeModal });
  const syncGuide = createSyncGuide({ openModal, closeModal, openPrivacy: privacyNotice.open, clouds: () => personalSyncFeature.clouds || [], openSyncSettings });
  const feedbackFeature = createFeedbackFeature({ openModal, closeModal, openPrivacy: privacyNotice.open });
  // The quarter nudge after closing a day opens its check-in in Horizon.
  const openQuarterCheckIn = quarter => { if (qs('[data-horizon-modal]').hidden) openHorizon('year', date); horizonView.openQuarter(quarter); };
  // The planner tour (src/features/tour.js): once after setup, offered once to earlier users, always in How it works and More.
  const tour = createTour({ getActiveModal: () => activeModal, closeModal, closePopovers: closeAllPopovers, setPane: view => setMobileView(view), range: () => plannerRangeView, setRange: view => { if (view !== plannerRangeView) toggleWeekView(); }, isReady: () => !!settings.onboardingComplete });
  // The first time each main dialog opens, a short guide inside it (src/features/first-use.js).
  createFirstUse({ tour, isReady: () => !!settings.onboardingComplete, isFloating: () => !!pipFeature?.isOpen(), getActiveModal: () => activeModal });
  const onboarding = createOnboarding({ settings: () => settings, persistSettings, startHour, endHour, time, chevronSvg, openListPopover, openModal, closeModal, seedFirstBlock: seedFirstBlockAfterOnboarding, afterFinish: () => { render(); requestAnimationFrame(() => qs('[data-focus]')?.focus({ preventScroll: true })); }, openInstall: () => installFeature.open(), keepTheme: () => { if (themeController.get() === 'system') themeController.set(themeController.resolved()); }, startTour: () => tour.startWhenIdle() });
  const fromMenu = action => () => { closeHeaderMenus(); action(); };
  qsa('[data-install-open]').forEach(button => button.addEventListener('click', fromMenu(() => installFeature.open())));
  qsa('[data-sync-guide-open]').forEach(button => button.addEventListener('click', fromMenu(() => syncGuide.open())));
  qsa('[data-feedback-open]').forEach(button => { button.hidden = !feedbackFeature.available(); button.addEventListener('click', fromMenu(() => feedbackFeature.open())); });
  const helpFeedback = qs('[data-help-feedback]');
  if (helpFeedback) helpFeedback.hidden = !feedbackFeature.available();
  // Help shows the feature release (1.33); feedback still sends the exact version.
  qsa('[data-app-version]').forEach(node => { node.textContent = featureVersion(APP_VERSION); });
  setMobileView('plan', { animate: false });
  renderCategorySettings();
  renderSettingsHours();
  renderPlanningWeek();
  load();
  personalSyncFeature.load();
  feedbackFeature.noteVersionSeen();
  trackAppActive({ installed: window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true });
  // /?help opens How it works, except on a first run (src/features/help-link.js).
  requestAnimationFrame(() => {
    const firstRun = onboarding.maybeOpen();
    openHelpFromAddress({ firstRun, open: () => { const help = qs('[data-help-modal]'); updateStorageUsage(); openModal(help, qs('.modal__close', help)); } });
    // The address read, Back starts to follow what is open once the planner shows (src/features/back-button.js).
    wireBackButton({ stack: backStack, closeMenus: closeHeaderMenus, tour });
  });
  // The first day is drawn: the opening seal leaves and the planner shows, with its entrance once per session (src/features/app-entrance.js).
  // Counted from when it shows (the seal gone): the tour's offer, then, once per feature release, what's new and a request for feedback (never over another dialog).
  showPlanner({ dialog: !settings.onboardingComplete, shown: () => {
    setTimeout(() => tour.maybeOffer(), 1600);
    setTimeout(() => feedbackFeature.maybePrompt({ closeDayCount: settings.closeDayCount, busy: !settings.onboardingComplete || !!activeModal || tour.isActive() || tour.offerVisible() }), 2400);
  } });
})();
