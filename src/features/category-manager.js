import { qs, qsa } from '../lib/dom.js';
import { esc, escAttr } from '../lib/text.js';

/**
 * Category management — rename, recolor, archive / restore, delete and add —
 * rendered into every `[data-category-settings]` container: the Settings
 * section and the "Manage categories" dialog the block editor opens on top of
 * itself. app.js keeps owning the settings data and passes it in through ctx.
 *
 * One list (1.39.1): each row is the colour, the whole name (edited in place)
 * and two quiet actions, Archive and Delete. The last row adds a category from
 * the name typed in it, on Enter or on leaving the field, in the next distinct
 * colour; Enter then moves focus to the new name. Archived categories wait
 * below, in a disclosure that opens when one is archived and is closed again
 * each time its dialog opens.
 *
 * Re-rendering keeps keyboard focus on the same control of the same category
 * (or its counterpart: Archive ↔ Restore), so the list stays usable without a
 * mouse.
 */

const ICONS = {
  archive: '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
  restore: '<path d="M4 7h16v13H4zM3 4h18v3H3zM8 13h8M12 9v8"/>',
  remove: '<path d="M7 7l10 10M17 7 7 17"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const COUNTERPART = { archive: 'restore', restore: 'archive' };
const NAME_MAX = 40;

/** Where focus should land after a re-render, given where it was (pure; unit-tested). */
export function focusFallback({ control = '', index = 0 } = {}, rows = []) {
  const steps = [];
  if (COUNTERPART[control]) steps.push({ row: 'same', control: COUNTERPART[control] });
  steps.push({ row: 'same', control: 'name' });
  if (rows.length) steps.push({ row: Math.min(index, rows.length - 1), control: 'first' });
  steps.push({ row: 'add', control: 'add' });
  return steps;
}

/** The first palette colour no active category uses, else the next one in turn (pure; unit-tested). */
export function nextCategoryColor(categories = [], palette = []) {
  const used = new Set(categories.filter(category => !category.archived).map(category => category.color));
  return palette.find(color => !used.has(color.value))?.value || palette[categories.length % (palette.length || 1)]?.value || '';
}

/** The category the add row makes from a typed name, or null: no name, or one per palette colour already (pure; unit-tested). */
export function newCategory(name, categories = [], palette = [], id = '') {
  const clean = String(name ?? '').trim().slice(0, NAME_MAX);
  if (!clean || categories.filter(category => !category.archived).length >= palette.length) return null;
  return { id, name: clean, color: nextCategoryColor(categories, palette), archived: false, archivedAt: '' };
}

// A control inside a closed disclosure can't take focus; its summary can.
function reachable(element) {
  const closed = element?.closest('details:not([open])');
  return element && (!closed || (element.matches('summary') && element.parentElement === closed)) ? element : null;
}

export function createCategoryManager(ctx) {
  let pendingFocus = null;
  // The containers whose Archived disclosure is open.
  const archivedOpen = new WeakSet();
  const modal = () => qs('[data-category-manage-modal]');
  const settings = () => ctx.getSettings();

  function describeFocus(active = document.activeElement) {
    const wrap = active?.closest?.('[data-category-settings]');
    if (!wrap) return null;
    const row = active.closest('[data-category-id]');
    const rows = qsa('[data-category-id]', wrap);
    return { wrap, id: row?.dataset.categoryId || '', control: active.dataset.categoryControl || '', index: Math.max(0, rows.indexOf(row)) };
  }

  function restoreFocus(target) {
    if (!target?.wrap?.isConnected) return;
    const { wrap, id } = target;
    const find = selector => reachable(qs(selector, wrap));
    const rowSelector = id ? `[data-category-id="${CSS.escape(id)}"]` : '';
    let next = rowSelector && target.control ? find(`${rowSelector} [data-category-control="${target.control}"]`) : null;
    // Outside the rows: the add field, or the Archived disclosure itself.
    if (!next && !id && target.control) next = find(`[data-category-control="${target.control}"]`);
    if (!next) {
      const rows = qsa('[data-category-id]', wrap).filter(reachable);
      for (const step of focusFallback(target, rows)) {
        const row = step.row === 'same' ? (rowSelector ? find(rowSelector) : null) : step.row === 'add' ? wrap : rows[step.row];
        if (!row) continue;
        next = reachable(step.control === 'first' ? qs('[data-category-control]', row) : qs(`[data-category-control="${step.control}"]`, row));
        if (next) break;
      }
    }
    next?.focus({ preventScroll: false });
  }

  function remove(category) {
    const s = settings();
    s.categories = s.categories.filter(c => c.id !== category.id);
  }

  function activeRow(category, wrap) {
    const row = document.createElement('li');
    row.className = 'category-setting';
    row.dataset.categoryId = category.id;
    row.innerHTML = `
      <button class="color-trigger color-trigger--compact is-swatch-only" type="button" data-category-color data-category-control="color" aria-label="${escAttr(`Choose color for ${category.name || 'this category'}`)}" data-tooltip="Choose color"><span style="background:${category.color}"></span><strong></strong></button>
      <input class="category-name" value="${escAttr(category.name)}" maxlength="${NAME_MAX}" aria-label="Category name" autocomplete="off" data-category-control="name">
      <button class="task-action category-archive" type="button" data-category-control="archive" aria-label="${escAttr(`Archive ${category.name || 'category'}`)}" data-tooltip="Archive">${icon('archive')}</button>
      <button class="task-action category-remove" type="button" data-category-control="remove" aria-label="${escAttr(`Delete ${category.name || 'category'}`)}" data-tooltip="Delete">${icon('remove')}</button>`;
    qs('.category-name', row).addEventListener('input', event => { category.name = event.target.value.trimStart(); ctx.saveSettingsDebounced(); });
    qs('[data-category-color]', row).addEventListener('click', event => ctx.openColorPopover(event.currentTarget, category.color, selected => {
      category.color = selected.value;
      pendingFocus = { wrap, id: category.id, control: 'color' };
      ctx.saveSettings();
    }));
    qs('.category-archive', row).addEventListener('click', () => {
      category.archived = true;
      category.archivedAt = ctx.today();
      // Opened, so the category is seen arriving there, its Restore one tab away.
      archivedOpen.add(wrap);
      ctx.persistSettings();
      render();
      ctx.refreshBlockCategoryTrigger();
      ctx.renderStats();
    });
    qs('.category-remove', row).addEventListener('click', () => {
      remove(category);
      ctx.getState().blocks.filter(b => b.categoryId === category.id).forEach(b => { b.categoryId = ''; });
      ctx.saveSettings();
      ctx.save();
    });
    return row;
  }

  function archivedRow(category) {
    const row = document.createElement('li');
    row.className = 'category-setting category-setting--archived';
    row.dataset.categoryId = category.id;
    row.innerHTML = `<span class="archived-category-swatch" style="background:${category.color}"></span><span class="archived-category-name">${esc(category.name)}</span><button class="task-action category-restore" type="button" data-category-control="restore" aria-label="${escAttr(`Restore ${category.name || 'category'}`)}" data-tooltip="Restore">${icon('restore')}</button><button class="task-action category-remove" type="button" data-category-control="remove" aria-label="${escAttr(`Delete ${category.name || 'category'}`)}" data-tooltip="Delete">${icon('remove')}</button>`;
    qs('.category-restore', row).addEventListener('click', () => {
      category.archived = false;
      category.archivedAt = '';
      ctx.persistSettings();
      render();
      ctx.refreshBlockCategoryTrigger();
      ctx.renderStats();
    });
    qs('.category-remove', row).addEventListener('click', () => {
      remove(category);
      ctx.saveSettings();
      render();
    });
    return row;
  }

  /** The last row: a name typed here becomes a category on Enter, or on leaving the field (everything here saves as it goes). */
  function addRow(wrap, draft) {
    const row = document.createElement('li');
    row.className = 'category-setting category-setting--add';
    row.innerHTML = `<span class="category-add-mark" aria-hidden="true">${icon('plus')}</span><input class="category-name" maxlength="${NAME_MAX}" placeholder="Add a category" aria-label="Add a category" autocomplete="off" enterkeyhint="done" data-category-control="add">`;
    const input = qs('input', row);
    input.value = draft;
    const commit = focusNew => {
      if (!input.isConnected) return;
      const category = newCategory(input.value, settings().categories, ctx.palette, ctx.newId());
      input.value = '';
      if (!category) return;
      settings().categories.push(category);
      if (focusNew) pendingFocus = { wrap, id: category.id, control: 'name' };
      ctx.saveSettings();
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        commit(true);
      } else if (event.key === 'Escape' && input.value) {
        // A first Escape lets go of the name being typed; the next one closes the dialog, as always.
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
      }
    });
    // Once focus has landed where it was going, so that the re-render keeps it there.
    input.addEventListener('blur', () => { if (input.value.trim()) setTimeout(() => commit(false)); });
    qs('.category-add-mark', row).addEventListener('click', () => input.focus());
    return row;
  }

  function archivedList(archived, wrap) {
    const details = document.createElement('details');
    details.className = 'archived-categories';
    details.open = archivedOpen.has(wrap);
    details.innerHTML = `<summary data-category-control="archived">${icon('chevron')}<span>Archived (${archived.length})</span></summary><p class="archived-categories__note">Hidden from new blocks, kept in past statistics.</p>`;
    const list = document.createElement('ul');
    list.className = 'category-list category-list--archived';
    archived.forEach(category => list.append(archivedRow(category)));
    details.append(list);
    details.addEventListener('toggle', () => { if (details.open) archivedOpen.add(wrap); else archivedOpen.delete(wrap); });
    return details;
  }

  function renderInto(wrap) {
    const draft = qs('[data-category-control="add"]', wrap)?.value || '';
    // Drawn for a dialog about to open: the archived ones start folded away.
    if (wrap.closest('[hidden]')) archivedOpen.delete(wrap);
    wrap.innerHTML = '';
    const { categories } = settings();
    const active = categories.filter(category => !category.archived);
    const list = document.createElement('ul');
    list.className = 'category-list';
    active.forEach(category => list.append(activeRow(category, wrap)));
    if (active.length < ctx.palette.length) list.append(addRow(wrap, draft));
    wrap.append(list);
    const archived = categories.filter(category => category.archived);
    if (archived.length) wrap.append(archivedList(archived, wrap));
  }

  function render() {
    const focus = pendingFocus || describeFocus();
    pendingFocus = null;
    qsa('[data-category-settings]').forEach(renderInto);
    restoreFocus(focus);
  }

  /** Opens above the dialog in use (the block editor) and returns to it, unchanged, when closed. */
  function open() {
    const el = modal();
    if (!el) return;
    render();
    ctx.openModal(el, qs('.modal__panel', el), { stack: true });
  }

  qs('[data-category-manage-done]')?.addEventListener('click', () => ctx.closeModal(modal()));

  return { render, open };
}
