import { esc } from '../lib/text.js';

export function parseChecklistLine(line = '') {
  const slash = String(line).match(/^\/\/(x)?\s*(.*)$/i);
  if (slash) return { checked: !!slash[1], text: slash[2] || '' };
  const legacy = String(line).match(/^([☐☑☒])\s*(.*)$/);
  if (legacy) return { checked: legacy[1] !== '☐', text: legacy[2] || '' };
  return null;
}

export function renderBlockNotesPreview(notes = '') {
  return String(notes || '').split('\n').map(line => {
    const item = parseChecklistLine(line);
    if (!item) return `<span class="time-block-note-line">${esc(line)}</span>`;
    return `<span class="time-block-note-line time-block-note-line--check"><i class="rich-note-check${item.checked ? ' is-checked' : ''}" aria-hidden="true"></i><span>${esc(item.text)}</span></span>`;
  }).join('');
}

export function blockNoteLineHtml(line = '') {
  const item = parseChecklistLine(line);
  if (item) {
    return `<div class="block-note-line block-note-line--check"><button type="button" class="rich-note-check${item.checked ? ' is-checked' : ''}" data-rich-note-check contenteditable="false" aria-pressed="${item.checked ? 'true' : 'false'}" aria-label="${item.checked ? 'Mark note item not done' : 'Mark note item done'}"></button><span contenteditable="true">${esc(item.text)}</span></div>`;
  }
  return `<div class="block-note-line">${line ? esc(line) : '<br>'}</div>`;
}

export function dayNoteLineHtml(line = '') {
  const item = parseChecklistLine(line);
  if (item) {
    return `<div class="day-note-line day-note-line--check"><button type="button" class="rich-note-check${item.checked ? ' is-checked' : ''}" data-day-note-check contenteditable="false" aria-pressed="${item.checked ? 'true' : 'false'}" aria-label="${item.checked ? 'Mark note item not done' : 'Mark note item done'}"></button><span contenteditable="true">${esc(item.text)}</span></div>`;
  }
  return `<div class="day-note-line">${line ? esc(line) : '<br>'}</div>`;
}
