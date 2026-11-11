import { resolveSteps } from './tour-model.js';

/**
 * Contextual first-use guides, as data: the first time someone opens one of
 * the planner's main dialogs, a few steps of the tour's spotlight and card
 * show what to do there and the parts that are not obvious. Pure and
 * unit-tested (tests/first-use.test.js); src/features/first-use.js decides
 * when, and the tour engine (src/features/tour.js) puts them on screen.
 *
 * Each guide has two to four steps, resolved like the tour's (resolveSteps):
 * selectors are looked up inside the dialog, a step whose part is not on
 * screen is left out, and keys only show where Help shows its shortcuts.
 * Words name the dialog's parts in bold (`**…**`), exactly as they read.
 */

/** UI flags (never synced or backed up): when each guide was seen. */
export const TIPS_FLAG_KEY = 'daily-planner-ui:tips';

/** The dialogs that bring a guide, by the selector of their `.modal`. */
export const GUIDE_DIALOGS = Object.freeze({
  block: '[data-block-modal]',
  closeDay: '[data-end-day-modal]',
  dayClosed: '[data-day-closed-modal]',
  horizon: '[data-horizon-modal]',
  journal: '[data-journal-modal]',
  unresolved: '[data-open-work-modal]',
  stats: '[data-stats-modal]',
  search: '[data-search-modal]',
  settings: '[data-settings-modal]'
});

/**
 * The keys the guides teach. Each one is handled by the planner where the
 * guide says (tests/first-use.test.js checks the code behind every one).
 */
export const GUIDE_KEYS = Object.freeze({
  saveBlock: { keys: ['Enter'], label: 'Add or save, from the title' },
  noteCheck: { keys: ['//'], label: 'Checkbox in Notes' },
  leaveOpen: { keys: ['Esc'], label: 'Leave without closing the day' },
  sections: { keys: ['1–7'], label: 'Sections' },
  addHorizon: { keys: ['+'], label: 'Add to Horizon' },
  printYear: { keys: ['P'], label: 'Print the year' },
  closeHorizon: { keys: ['Y'], label: 'Back to your plan' },
  closeJournal: { keys: ['J'], label: 'Close the Journal' },
  closeUnresolved: { keys: ['U'], label: 'Close Unresolved' },
  closeStats: { keys: ['S'], label: 'Close Time stats' },
  closeSettings: { keys: ['G'], label: 'Close Settings' },
  search: { keys: ['F'], label: 'Search, from anywhere in the planner' }
});

const click = ({ touch }) => (touch ? 'Tap' : 'Click');

const GUIDES = {
  // Add a time block (and editing one, the first time it is the first use).
  block: {
    steps: [
      {
        id: 'title',
        variants: [
          {
            if: ({ context }) => context.mode === 'edit',
            spot: ['.block-title-row'],
            name: 'the block title and its done check',
            title: 'A clear finish line',
            body: () => 'Name the result, not the activity, in **What will you complete?** The check beside it, **Mark as done**, ticks the block off — and its task or outcome with it.',
            keys: ['saveBlock']
          },
          {
            spot: ['.block-title-row'],
            name: 'the block title',
            title: 'A clear finish line',
            body: () => 'Name the result, not the activity, in **What will you complete?** “Draft the intro” is easier to finish than “Work on the report”.',
            keys: ['saveBlock']
          }
        ]
      },
      {
        id: 'category',
        variants: [{
          spot: ['.block-category-field'],
          name: 'the category',
          title: 'A colour per project',
          body: () => '**Category / project** colours the block and adds its time to **Time stats**. **Manage** renames, recolours or adds a category without leaving the block.'
        }]
      },
      {
        id: 'time',
        variants: [{
          spot: ['[data-block-time-layout]', '.duration-field'],
          join: true,
          name: 'the start, end and duration shortcuts',
          title: 'When, and for how long',
          body: () => 'Type a time in **Start** or **End** — 930 means 9:30 — or pick one from its list. **Duration shortcuts** set the end for you, and a block can run past midnight.'
        }]
      },
      {
        id: 'notes',
        variants: [
          {
            if: ({ context }) => context.mode === 'edit',
            spot: ['.block-notes-field', '[data-block-delete]'],
            name: 'the notes and Delete',
            title: 'Notes, or let it go',
            body: () => '**Notes** keep what you need while doing it; start a line with // to make a checkbox. **Delete** takes the block off the schedule, and leaves a linked task on your plan.',
            keys: ['noteCheck']
          },
          {
            spot: ['.block-notes-field'],
            name: 'the notes',
            title: 'Notes for later you',
            body: () => '**Notes** keep the context you’ll need while doing it. Start a line with // to turn it into a checkbox.',
            keys: ['noteCheck']
          }
        ]
      }
    ]
  },
  // Editing a block, once the add guide was seen: what only an existing block has.
  blockEdit: {
    steps: [
      {
        id: 'done',
        variants: [{
          spot: ['[data-block-done]'],
          name: 'Mark as done',
          title: 'Done when it’s done',
          body: () => '**Mark as done** ticks the block off, and its task or outcome too. Ticked on its own day, it also measures how long it really took: **Over plan** in **Time stats**.'
        }]
      },
      {
        id: 'delete',
        variants: [{
          spot: ['[data-block-delete]'],
          name: 'Delete',
          title: 'Move it, or let it go',
          body: () => 'To move the block, hold it on the schedule, then drag; drag its lower edge to change its length. **Delete** takes it off the schedule and leaves a linked task on your plan.'
        }]
      }
    ]
  },
  closeDay: {
    steps: [
      {
        id: 'summary',
        variants: [{
          spot: ['[data-end-day-summary]'],
          name: 'the day’s summary',
          title: 'Where the day stands',
          body: () => '**Done** and **Still open** count today’s outcomes, tasks and blocks. **Carry to** is where unfinished work goes unless you choose otherwise.'
        }]
      },
      {
        id: 'reflect',
        variants: [
          {
            when: '[data-end-day-habit]',
            spot: ['.end-day-reflection', '[data-end-day-habit]'],
            join: true,
            name: 'the memory, the lesson and your winning habit',
            title: 'Two lines worth keeping',
            body: () => 'What made today worth remembering, and what it taught you: both optional, both kept in the **Journal**. Tick your **Winning habit** if you kept it today.'
          },
          {
            spot: ['.end-day-reflection'],
            name: 'the memory and the lesson',
            title: 'Two lines worth keeping',
            body: () => 'What made today worth remembering, and what it taught you: both optional, both kept in the **Journal**, where you can read them back.'
          }
        ]
      },
      {
        id: 'carry',
        variants: [{
          when: '[data-end-day-list] .end-day-item',
          spot: ['[data-end-day-list] .end-day-item'],
          name: 'the first unfinished item',
          title: 'A decision for each item',
          body: () => 'Keep its date, or pick another, to carry it forward. The disk, **Save**, keeps it in **Unresolved** without a date; the bin, **Forget**, takes it off your plate, while its day keeps the history.'
        }]
      },
      {
        id: 'close',
        variants: [{
          spot: ['[data-close-day-submit]'],
          name: 'the Close day button',
          title: 'Then close it',
          body: () => '**Close day** carries out your choices and paints the day on your year, in Horizon’s **Progress**. Changed your mind? The same button then reads **Reopen day**.',
          keys: ['leaveOpen']
        }]
      }
    ]
  },
  // The weekly review, after closing the last planning day of a week.
  weekReview: {
    steps: [
      {
        id: 'metrics',
        variants: [{
          spot: ['.week-review-metrics'],
          name: 'the week in numbers',
          title: 'How the week went',
          body: () => 'Your **Main outcomes** done, what was **Carried forward** and what was **Forgotten**, across the planning days of the week.'
        }]
      },
      {
        id: 'waiting',
        variants: [
          {
            spot: ['.week-review-section--unresolved'],
            name: 'Still unresolved',
            title: 'What still waits',
            body: () => '**Still unresolved** counts what is waiting for a decision. **Review all** opens Unresolved, then brings you back here.'
          },
          {
            spot: ['.week-review-time'],
            name: 'where your scheduled time went',
            title: 'Where the time went',
            body: () => '**Where your scheduled time went** adds up your blocks by category: what you planned, not what a tracker measured.'
          }
        ]
      },
      {
        id: 'share',
        variants: [{
          spot: ['.week-share'],
          name: 'Share your week',
          title: 'Worth sharing?',
          body: () => '**Share your week** makes a clean image of the week for a feed or a story. It is made on this device; nothing is uploaded.'
        }]
      }
    ]
  },
  horizon: {
    steps: [
      {
        id: 'sections',
        variants: [{
          spot: ['.hz-tabs__list'],
          name: 'the seven sections',
          title: 'Seven sections, one year',
          body: () => 'From **Overview** to **Progress**, each section says where it stands. Your days stay in your plan; this is the year above them.',
          keys: ['sections']
        }]
      },
      {
        id: 'year',
        variants: [{
          spot: ['.hz-head__year'],
          name: 'the year and its arrows',
          title: 'Any year',
          body: () => '**Previous year** and **Next year** move between years: plan the next one ahead, or look back on the last.'
        }]
      },
      {
        id: 'actions',
        variants: [{
          spot: ['.hz-head__actions'],
          name: 'Plan your year, Print the year and Add',
          title: 'Add, plan, print',
          body: () => '**Add** puts a key date, a mini-adventure or a milestone on the year. **Plan your year** is a guided half hour; **Print the year** fits it on one page.',
          keys: ['addHorizon', 'printYear', 'closeHorizon']
        }]
      }
    ]
  },
  journal: {
    requires: '[data-journal-list] .journal-row',
    steps: [
      {
        id: 'columns',
        variants: [
          {
            spot: ['.journal-columns-head'],
            name: 'Best memory and Lesson learned',
            title: 'What each day left you',
            body: () => 'Each day you close with a memory or a lesson gets a row, newest first: its **Best memory**, then its **Lesson learned**.'
          },
          {
            spot: ['[data-journal-list]'],
            name: 'the Journal’s days',
            title: 'What each day left you',
            body: () => 'Each day you close with a memory or a lesson gets a row here, newest first: the memory, then the lesson.'
          }
        ]
      },
      {
        id: 'open',
        variants: [{
          spot: ['[data-journal-list] .journal-row'],
          name: 'a day in the Journal',
          title: 'Back to that day',
          body: ctx => `${click(ctx)} a day to open it in the planner, just as you left it.`,
          keys: ['closeJournal']
        }]
      }
    ]
  },
  unresolved: {
    requires: '.open-work-row',
    steps: [
      {
        id: 'lists',
        variants: [{
          spot: ['.open-work-tabs'],
          name: 'Needs attention and Later',
          title: 'Two lists',
          body: () => '**Needs attention** holds unfinished work from past days that never got a decision. **Later** holds what you saved without a date.'
        }]
      },
      {
        id: 'decide',
        variants: [
          {
            when: '.open-work-row [data-open-later]',
            spot: ['.open-work-row__actions'],
            name: 'Plan, Save and Forget',
            title: 'Decide, one item at a time',
            body: () => '**Plan** picks a date, the disk (**Save**) moves the item to Later, the bin (**Forget**) takes it off the list — its day keeps the history. Plans wait at the bottom until you confirm them.',
            keys: ['closeUnresolved']
          },
          {
            spot: ['.open-work-row__actions'],
            name: 'Plan and Forget',
            title: 'Decide, one item at a time',
            body: () => '**Plan** picks a date for the item; the bin (**Forget**) takes it off the list. Plans wait at the bottom until you confirm them.',
            keys: ['closeUnresolved']
          }
        ]
      }
    ]
  },
  stats: {
    steps: [
      {
        id: 'views',
        variants: [{
          spot: ['.stats-tabs'],
          name: 'Day, Week and Insights',
          title: 'Day, Week, Insights',
          body: () => '**Day** and **Week** show where your scheduled time goes, by category. **Insights** looks across weeks for your rhythm, worked out on this device.'
        }]
      },
      {
        id: 'figures',
        variants: [
          {
            spot: ['.stats-summary', '[data-stats-help]'],
            name: 'the day’s figures',
            title: 'Planned, then passed',
            body: () => '**Scheduled** is the time you planned; **Elapsed schedule**, the part whose clock time has passed. **Over plan** is measured when you tick a block on its day. **?** explains each one.',
            keys: ['closeStats']
          },
          {
            spot: ['[data-stats-week-nav]'],
            name: 'the week arrows',
            title: 'Any week',
            body: () => '**Previous week** and **Next week** step through your weeks, and **This week** comes back. The chart compares planned time by category, day by day.',
            keys: ['closeStats']
          }
        ]
      }
    ]
  },
  // Insights, the first time it shows real figures.
  insights: {
    steps: [
      {
        id: 'period',
        variants: [{
          spot: ['.ins-controls'],
          name: 'the period',
          title: 'Choose the period',
          body: () => '**4 weeks**, **Quarter** or **Year**. The arrows step back to earlier periods, and every figure follows.'
        }]
      },
      {
        id: 'findings',
        variants: [{
          spot: ['.ins-findings'],
          name: 'What stands out',
          title: 'The short version',
          body: () => '**What stands out** sums up the period in a few plain sentences. The charts below show where each one comes from.'
        }]
      },
      {
        id: 'charts',
        variants: [{
          spot: ['[data-insights] .ins-card'],
          name: 'a chart',
          title: 'Every figure, up close',
          body: ({ touch }) => `${touch ? 'Tap' : 'Point at or focus'} a mark for its reading; **Show table** lists every figure. Insights are worked out on this device from your own days, and nothing is sent anywhere.`
        }]
      }
    ]
  },
  search: {
    steps: [
      {
        id: 'type',
        variants: [{
          spot: ['.search-box'],
          name: 'the search field',
          title: 'Every saved day',
          body: () => 'Outcomes, tasks, blocks, notes, **Keep in mind**, memories and lessons: start typing and matches appear at once.'
        }]
      },
      {
        id: 'open',
        variants: [{
          spot: ['[data-search-results]'],
          name: 'the results',
          title: 'Straight to it',
          body: ctx => `${click(ctx)} a result to open its day at that item; a scheduled one opens its block.`,
          keys: ['search']
        }]
      }
    ]
  },
  settings: {
    steps: [
      {
        id: 'devices',
        variants: [{
          spot: ['.settings-group--devices'],
          name: 'Your devices',
          title: 'On every device',
          body: () => '**Install the app** gives the planner its own window, offline. **Sync on all my devices** keeps your phone and computer in step through your own Google Drive.'
        }]
      },
      {
        id: 'week',
        variants: [{
          spot: [{ css: '.hours-setting', closest: '.settings-group' }, { css: '[data-planning-days-picker]', closest: '.settings-group' }],
          join: true,
          name: 'Displayed hours and Planning week',
          title: 'Your hours, your week',
          body: () => '**Displayed hours** sets what the schedule shows. **Planning week** is the days you plan: Week view shows them, and **Close day** carries work to the next one.'
        }]
      },
      {
        id: 'categories',
        variants: [{
          spot: [{ css: '.settings-group [data-category-settings]', closest: '.settings-group' }],
          name: 'Categories & projects',
          title: 'Categories & projects',
          body: () => 'Rename, recolour or archive. An archived category leaves new blocks, but keeps its history in **Time stats**.',
          keys: ['closeSettings']
        }]
      }
    ]
  }
};

export const GUIDES_BY_ID = Object.freeze(GUIDES);

/** The guide a dialog brings now, from what it shows (`context`) and what was seen: '' for none. */
export function pickGuide(dialog, context = {}, seen = {}) {
  if (dialog === 'block') {
    if (!seen.block) return 'block';
    return context.mode === 'edit' && !seen.blockEdit ? 'blockEdit' : '';
  }
  if (dialog === 'stats') {
    if (context.view === 'insights') return context.insights === 'ready' && !seen.insights ? 'insights' : '';
    return seen.stats ? '' : 'stats';
  }
  if (dialog === 'dayClosed') return context.stage === 'review' && !seen.weekReview ? 'weekReview' : '';
  return GUIDE_DIALOGS[dialog] && GUIDES[dialog] && !seen[dialog] ? dialog : '';
}

/** What a guide covers besides itself: the block guide, shown on an edit, already explains done and Delete. */
export function coveredBy(id, context = {}) {
  return id === 'block' && context.mode === 'edit' ? ['block', 'blockEdit'] : [id];
}

/**
 * Only for a dialog a person just opened, once the planner is set up, never
 * during the tour or over another guide, never while the floating window is
 * open, and never over a menu or a picker the person already opened.
 */
export function canShowGuide({ ready = false, person = true, busy = false, floating = false, open = true, popover = false } = {}) {
  return !!ready && !!person && !busy && !floating && !!open && !popover;
}

/** The steps of a guide on this screen (see resolveSteps in tour-model.js); none when what it needs is not there. */
export function buildGuideSteps(id, { layout = 'desktop', keys = true, touch = false, visible = () => true, context = {} } = {}) {
  const guide = GUIDES[id];
  if (!guide || (guide.requires && !visible(guide.requires, ''))) return [];
  const steps = resolveSteps(guide.steps, { layout, keys, touch, visible, context, shortcuts: GUIDE_KEYS });
  return steps.map(step => ({ ...step, pane: '', menu: '' }));
}

// The keys a guide keeps for itself, and keys that only modify the next one.
const GUIDE_OWN_KEYS = new Set(['Escape', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock', 'CapsLock', 'NumLock', 'ScrollLock', 'Symbol', 'SymbolLock']);

/**
 * What a key does while a guide is open in a dialog (pure): 'own' — Esc,
 * Enter, the arrows, Tab and Space work the guide (Tab and Esc even with a
 * modifier); 'wait' — a modifier alone (Shift, Ctrl, Cmd, AltGr…) waits for
 * the key it goes with; 'pass' — any other key, a shortcut (Y), a letter, a
 * paste (Ctrl/Cmd+V), a dead key (^ ¨) or a key composing text, closes the
 * guide and goes on to the dialog as if the guide had never been there.
 */
export function guideKeyAction(event = {}) {
  const key = String(event.key ?? '');
  if (event.isComposing) return 'pass';
  if (MODIFIER_KEYS.has(key)) return 'wait';
  if (key === 'Escape' || key === 'Tab') return 'own';
  if (GUIDE_OWN_KEYS.has(key) && !event.ctrlKey && !event.metaKey && !event.altKey) return 'own';
  return 'pass';
}

/** "Tips · 2 of 3", or "Tip" for one. */
export function guideEyebrow(index, total) {
  return total > 1 ? `Tips · ${index + 1} of ${total}` : 'Tip';
}

export function readTipsFlags(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const seen = {};
    Object.entries(value?.seen && typeof value.seen === 'object' ? value.seen : {}).forEach(([id, at]) => { if (typeof at === 'string' && at) seen[id] = at; });
    return { seen };
  } catch (_) {
    return { seen: {} };
  }
}

export function markSeen(flags, ids, at) {
  const seen = { ...(flags?.seen || {}) };
  ids.forEach(id => { seen[id] = at; });
  return { seen };
}

export function anyTipSeen(flags) {
  return Object.keys(flags?.seen || {}).length > 0;
}

/** Every guide there is. */
export const GUIDE_IDS = Object.freeze(Object.keys(GUIDES));

/**
 * How it works → Tips, a switch: on while a guide is still to come (not every
 * one has been seen). Turning it off marks them all seen, so none shows;
 * turning it on clears them, so each comes back the next time its dialog
 * opens. Nothing else is stored.
 */
export function tipsOn(flags) {
  const seen = flags?.seen || {};
  return GUIDE_IDS.some(id => !seen[id]);
}

/** The flags after the switch is turned `on` (none seen) or off (all seen, at `at`). */
export function switchTips(flags, on, at) {
  return on ? { seen: {} } : markSeen(flags, GUIDE_IDS, at);
}
