// The dashboard's “Questions” card, from the summary's questions (POST
// /api/contact, the Contact page's “Ask a question” form): when, who asked,
// their address, the question and where it was sent from. A row from the
// releases that also took team orders (an invoice, a quote or a talk, with a
// company and a number of people) still reads, with a short line that says
// what it was. Pure: it returns HTML (every value escaped) and is unit-tested
// (tests/admin-requests.test.js); admin.js wires Delete.

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
// A reply link only for plain addresses: nothing that could add ?bcc= or a body to the draft.
const mailLink = email => (/^[^\s?&=%/#@]+@[a-z0-9.-]+$/i.test(String(email || '')) ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : `<span>${esc(email)}</span>`);
const defaultNumber = value => new Intl.NumberFormat('en-US').format(Number(value) || 0);
const DASH = '—';

export const REQUEST_SOURCES = Object.freeze({ contact: 'Contact page', app: 'Planner', landing: 'Welcome page', teams: 'Teams page' });
/** What an earlier row was, when it wasn't a question. */
export const EARLIER_KINDS = Object.freeze({ invoice: 'Invoice request', quote: 'Quote request', talk: 'Talk request' });

/** A question with no team: no company, no number of people (as server/planner-api.js stores one). */
export const isPlainQuestion = row => (row?.kind || 'question') === 'question' && !String(row?.company || '').trim() && !(Number(row?.teamSize) > 0);

// The last column holds Delete: its header is read out, not shown (an empty <th> names nothing).
const COLUMNS = ['Date', 'Name', 'Email', 'Question', 'Source', 'Actions'];
const HIDDEN_HEADS = new Set(['Actions']);

/** The line above an earlier team request's message: what it was, the company and the number of people. */
export function earlierLine(row, { number = defaultNumber } = {}) {
  if (isPlainQuestion(row)) return '';
  const size = Number(row.teamSize) || 0;
  const parts = [EARLIER_KINDS[row.kind] || 'Earlier request', String(row.company || '').trim(), size ? `${number(size)} ${size === 1 ? 'person' : 'people'}` : ''].filter(Boolean);
  return parts.join(' · ');
}

/** One row of the table. `when` and `number` format a date and a count. */
export function questionRowHtml(row, { when = iso => String(iso || ''), number = defaultNumber } = {}) {
  const earlier = earlierLine(row, { number });
  return `<tr data-owner-attn="question:${Number(row.id)}">${[
    `<td class="owner-nowrap">${esc(when(row.createdAt))}</td>`,
    `<td>${esc(row.name || DASH)}</td>`,
    `<td>${mailLink(row.email)}</td>`,
    `<td class="owner-message">${earlier ? `<small class="owner-small">${esc(earlier)}</small>` : ''}${esc(row.message || '')}</td>`,
    `<td>${esc(REQUEST_SOURCES[row.source] || row.source || '')}</td>`,
    `<td><button class="text-button text-button--danger" type="button" data-owner-delete-question="${Number(row.id)}">Delete</button></td>`
  ].join('')}</tr>`;
}

/** The whole table, or '' when there is nothing to list. */
export function questionsTableHtml(rows, options = {}) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const head = COLUMNS.map(label => `<th>${HIDDEN_HEADS.has(label) ? `<span class="sr-only">${esc(label)}</span>` : esc(label)}</th>`).join('');
  return `<div class="owner-scroll"><table class="owner-table"><thead><tr>${head}</tr></thead><tbody>${rows.map(row => questionRowHtml(row, options)).join('')}</tbody></table></div>`;
}
