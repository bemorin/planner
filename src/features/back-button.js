import { whenPlannerShown } from './app-entrance.js';

/**
 * The planner's Back button wiring (1.36, src/ui/back-stack.js holds the
 * stack itself). app.js registers its dialogs (openModal / closeModal), its
 * popovers (showPopover / closePopover) and the view (src/features/view-switch.js);
 * Horizon's overlays and the share sheet register their own (backLayers).
 * This module adds what opens without a single entry point:
 *
 * - the header menus (Export, More): opened and closed from several places
 *   (their buttons, a choice, a click outside, Escape, the E shortcut), so
 *   their `hidden` attribute is watched. Back closes the menu, and gives focus
 *   back to its button when it was inside, as Escape does. While the tour
 *   runs, the More menu it opens for a step is the tour's, not a layer;
 * - the planner tour and the guides inside dialogs (src/features/tour.js):
 *   Back leaves them, as Escape does;
 * - start: the history follows only once the planner shows (the opening seal
 *   gone, after the launch links were read), never during boot.
 */
export function wireBackButton({ stack, doc = globalThis.document, closeMenus = () => {}, tour = null, Observer = globalThis.MutationObserver } = {}) {
  if (!stack || !doc) return;
  const touring = () => !!tour?.isActive?.();

  if (typeof Observer === 'function') {
    [['[data-export-menu]', '[data-export]'], ['[data-mobile-more-menu]', '[data-mobile-more]']].forEach(([menuSelector, buttonSelector]) => {
      const menu = doc.querySelector(menuSelector);
      if (!menu) return;
      const back = () => {
        const inside = menu.contains(doc.activeElement);
        closeMenus();
        if (inside) doc.querySelector(buttonSelector)?.focus({ preventScroll: true });
      };
      const sync = () => {
        if (!menu.hidden && !touring()) stack.open(menu, { back, alive: () => !menu.hidden });
        else if (menu.hidden) stack.closed(menu);
      };
      new Observer(sync).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
    });

    if (tour) {
      const key = { tour: true };
      const sync = () => {
        if (touring()) stack.open(key, { back: () => tour.end(), alive: touring });
        else stack.closed(key);
      };
      // The tour draws its layer the first time it runs: watch for it, then for it opening and closing.
      let root = null;
      const watch = new Observer(sync);
      const find = () => {
        if (root) return;
        root = doc.querySelector('[data-tour]');
        if (!root) return;
        finder.disconnect();
        watch.observe(root, { attributes: true, attributeFilter: ['hidden', 'class'] });
        sync();
      };
      const finder = new Observer(find);
      if (doc.body) finder.observe(doc.body, { childList: true });
      find();
    }
  }

  whenPlannerShown(() => stack.start(), { doc });
}
