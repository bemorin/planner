import { qs, qsa } from '../lib/dom.js';
import { esc, escAttr } from '../lib/text.js';

/**
 * Category management — rename, recolor, archive / restore, delete and add —
 * rendered into every `[data-category-settings]` container: the Settings
 * section and the "Manage categories" dialog the block editor opens on top of
 * itself. app.js keeps owning the settings data and passes it in through ctx.
 *
 * Re-rendering keeps keyboard focus on the same control of the same category
 * (or its counterpart: Archive ↔ Restore), so the list stays usable without a
 * mouse.
 */

const ICONS = {
  archive: '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
  restore: '<path d="M4 7h16v13H4zM3 4h18v3H3zM8 13h8M12 9v8"/>',
  remove: '<path d="M7 7l10 10M17 7 7 17"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const COUNTERPART = { archive: 'restore', restore: 'archive' };

/** Where focus should land after a re-render, given where it was (pure; unit-tested). */
export function focusFallback({ control = '', index = 0 } = {}, rows = []) {
  const steps = [];
  if (COUNTERPART[control]) steps.push({ row: 'same', control: COUNTERPART[control] });
  steps.push({ row: 'same', control: 'name' });
  if (rows.length) steps.push({ row: Math.min(index, rows.length - 1), control: 'first' });
  steps.push({ row: 'add', control: 'add' });
  return steps;
}

export function createCategoryManager(ctx) {
  let pendingFocus = null;
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
    const find = selector => qs(selector, wrap);
    const rowSelector = id ? `[data-category-id="${CSS.escape(id)}"]` : '';
    let next = rowSelector && target.control ? find(`${rowSelector} [data-category-control="${target.control}"]`) : null;
    if (!next && !id && target.control === 'add') next = find('[data-category-control="add"]');
    if (!next) {
      const rows = qsa('[data-category-id]', wrap);
      for (const step of focusFallback(target, rows)) {
        const row = step.row === 'same' ? (rowSelector ? find(rowSelector) : null) : step.row === 'add' ? wrap : rows[step.row];
        if (!row) continue;
        next = step.control === 'first' ? qs('[data-category-control]', row) : qs(`[data-category-control="${step.control}"]`, row);
        if (next) break;
      }
    }
    next?.focus({ preventScroll: false });
  }

  function activeRow(category, wrap) {
    const row = document.createElement('div');
    row.className = 'category-setting';
    row.dataset.categoryId = category.id;
    row.innerHTML = `
      <button class="color-trigger color-trigger--compact is-swatch-only" type="button" data-category-color data-category-control="color" aria-label="${escAttr(`Choose color for ${category.name || 'this category'}`)}" data-tooltip="Choose color"><span style="background:${category.color}"></span><strong></strong></button>
      <input class="category-name" value="${escAttr(category.name)}" maxlength="40" aria-label="Category name" data-category-control="name">
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
      ctx.persistSettings();
      render();
      ctx.refreshBlockCategoryTrigger();
      ctx.renderStats();
    });
    qs('.category-remove', row).addEventListener('click', () => {
      const s = settings();
      s.categories = s.categories.filter(c => c.id !== category.id);
      ctx.getState().blocks.filter(b => b.categoryId === category.id).forEach(b => { b.categoryId = ''; });
      ctx.saveSettings();
      ctx.save();
    });
    return row;
  }

  function archivedRow(category) {
    const row = document.createElement('div');
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
      const s = settings();
      s.categories = s.categories.filter(c => c.id !== category.id);
      ctx.saveSettings();
      render();
    });
    return row;
  }

  function renderInto(wrap) {
    wrap.innerHTML = '';
    const { categories } = settings();
    const active = categories.filter(category => !category.archived);
    active.forEach(category => wrap.append(activeRow(category, wrap)));
    if (active.length < ctx.palette.length) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'category-setting category-setting--add';
      add.dataset.categoryControl = 'add';
      add.innerHTML = `${icon('plus')}<span>Add category</span>`;
      add.addEventListener('click', () => ctx.openAddCategory(wrap.closest('[data-category-manage-modal]') ? 'manage' : 'settings'));
      wrap.append(add);
    }
    const archived = categories.filter(category => category.archived);
    if (!archived.length) return;
    const divider = document.createElement('div');
    divider.className = 'archived-categories-head';
    divider.innerHTML = `<div><span>Archived</span><small>Hidden from new blocks, preserved in past statistics.</small></div><strong>${archived.length}</strong>`;
    wrap.append(divider);
    archived.forEach(category => wrap.append(archivedRow(category)));
  }

  function render() {
    const focus = pendingFocus || describeFocus();
    pendingFocus = null;
    qsa('[data-category-settings]').forEach(renderInto);
    restoreFocus(focus);
  }

  /** After a category is added from the dialog, focus its name so it can be adjusted straight away. */
  function focusCategory(id, control = 'name') {
    const wrap = qs('[data-category-settings]', modal());
    if (wrap) pendingFocus = { wrap, id, control };
  }

  /** Opens above the dialog in use (the block editor) and returns to it, unchanged, when closed. */
  function open() {
    const el = modal();
    if (!el) return;
    render();
    ctx.openModal(el, qs('.modal__panel', el), { stack: true });
  }

  qs('[data-category-manage-done]')?.addEventListener('click', () => ctx.closeModal(modal()));

  return { render, open, focusCategory };
}
