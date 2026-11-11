import { esc, escAttr } from '../lib/text.js';
import { trackEvent } from '../lib/planner-api.js';
import { modalEnter, modalExit } from '../ui/motion.js';
import { focusBack, keepTab, openerOf } from '../ui/dialog-focus.js';
import { backLayers } from '../ui/back-stack.js';
import { SHARE_FORMATS, SHARE_LOOKS, SHARE_SITE, describeShare, drawShareImage, normalizeShareOptions, shareFileName, shareFormat } from './share-image.js';

/**
 * The share sheet: a live preview of the image, its format and look, the
 * private details (off until the person turns them on), and Share… /
 * Copy image / Download image. The image is drawn and encoded on this device;
 * nothing is uploaded. A native <dialog> keeps focus inside and returns it.
 */

const PREFS_KEY = 'daily-planner-ui:share';
const DIALOG_CLASS = 'share-sheet';

const ICONS = {
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  share: '<path d="M12 3.8v10.7"/><path d="m8.2 7.4 3.8-3.6 3.8 3.6"/><path d="M8.6 10.6H7.2a2 2 0 0 0-2 2v5.6a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2v-5.6a2 2 0 0 0-2-2h-1.4"/>',
  download: '<path d="M12 4v10.5"/><path d="m7.8 10.6 4.2 4.2 4.2-4.2"/><path d="M5 19.5h14"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { format: shareFormat(raw.format).id, look: raw.look === 'ink' || raw.look === 'paper' ? raw.look : '' };
  } catch (_) {
    return { format: 'square', look: '' };
  }
}

function writePrefs({ format, look }) {
  // Only the format and the look are remembered; private details never are.
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ format, look })); } catch (_) {}
}

const appIsDark = () => {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark' || theme === 'light') return theme === 'dark';
  return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
};

const currentPaint = () => document.documentElement.dataset.paint || 'terracotta';

const testFile = () => { try { return new File([new Blob([''], { type: 'image/png' })], 'share.png', { type: 'image/png' }); } catch (_) { return null; } };

function canShareFiles() {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  const file = testFile();
  try { return !!file && navigator.canShare({ files: [file] }); } catch (_) { return false; }
}

function canCopyImage() {
  if (typeof ClipboardItem !== 'function' || typeof navigator.clipboard?.write !== 'function' || !globalThis.isSecureContext) return false;
  return typeof ClipboardItem.supports === 'function' ? ClipboardItem.supports('image/png') : true;
}

function formatOption(format, selected) {
  return `<label class="share-choice share-choice--format">
    <input type="radio" name="share-format" value="${escAttr(format.id)}"${format.id === selected ? ' checked' : ''}>
    <span class="share-choice__card"><span class="share-choice__frame share-choice__frame--${escAttr(format.id)}" aria-hidden="true"></span><span class="share-choice__text"><b>${esc(format.label)}</b><small>${esc(format.hint)} · ${format.width} × ${format.height}</small></span></span>
  </label>`;
}

function lookOption(look, selected) {
  return `<label class="share-choice share-choice--look">
    <input type="radio" name="share-look" value="${escAttr(look.id)}"${look.id === selected ? ' checked' : ''}>
    <span class="share-choice__card"><span class="share-choice__swatch share-choice__swatch--${escAttr(look.id)}" aria-hidden="true"><i></i></span><b>${esc(look.label)}</b></span>
  </label>`;
}

function toggle(attr, title, note) {
  return `<label class="share-toggle">
    <input type="checkbox" role="switch" ${attr}>
    <span class="share-toggle__track" aria-hidden="true"></span>
    <span class="share-toggle__text"><b>${esc(title)}</b><small>${esc(note)}</small></span>
  </label>`;
}

function sheetMarkup({ eyebrow, title, intro, model, state, shareAvailable, copyAvailable }) {
  const lines = model.kind === 'week' ? model.lines : [];
  const lineChoice = lines.length > 1
    ? `<label class="share-sheet__select" data-share-line-pick hidden><span class="sr-only">Line to include</span><select data-share-line-choice>${lines.map((line, index) => `<option value="${index}"${index === state.lineIndex ? ' selected' : ''}>${esc(line.length > 70 ? `${line.slice(0, 68).trimEnd()}…` : line)}</option>`).join('')}</select></label>`
    : '';
  const privateToggles = [
    lines.length ? `${toggle('data-share-line', 'Add a line you wrote this week', lines.length > 1 ? 'Choose one of your lessons. Off unless you turn it on.' : `“${lines[0].length > 60 ? `${lines[0].slice(0, 58).trimEnd()}…` : lines[0]}”`)}${lineChoice}` : '',
    model.kind === 'year' && model.misogi ? toggle('data-share-misogi', 'Show my Misogi', `“${model.misogi.length > 60 ? `${model.misogi.slice(0, 58).trimEnd()}…` : model.misogi}”`) : ''
  ].filter(Boolean).join('');
  const privacy = privateToggles
    ? `<fieldset class="share-sheet__group share-sheet__group--private"><legend>Private details</legend>${privateToggles}<p class="share-sheet__note">${icon('lock')}<span>Only what the preview shows goes into the image.</span></p></fieldset>`
    : `<p class="share-sheet__note">${icon('lock')}<span>Only what the preview shows goes into the image.</span></p>`;
  const secondary = [
    copyAvailable ? `<button class="secondary-button share-sheet__action" type="button" data-share-copy>${icon('copy')}<span>Copy image</span></button>` : '',
    `<button class="${shareAvailable ? 'secondary-button' : 'primary-button'} share-sheet__action" type="button" data-share-download>${icon('download')}<span>Download image</span></button>`,
    shareAvailable ? `<button class="primary-button share-sheet__action" type="button" data-share-native>${icon('share')}<span>Share…</span></button>` : ''
  ].join('');
  return `<div class="share-sheet__panel">
    <header class="share-sheet__head">
      <div>
        <p class="modal__eyebrow">${esc(eyebrow)}</p>
        <h2 id="share-sheet-title">${esc(title)}</h2>
        <p id="share-sheet-intro">${esc(intro)}</p>
      </div>
      <button class="modal__close icon-button share-sheet__close" type="button" data-share-close aria-label="Close">${icon('close')}</button>
    </header>
    <div class="share-sheet__body">
      <div class="share-sheet__stage" data-share-stage data-format="${escAttr(state.format)}" data-look="${escAttr(state.look)}">
        <canvas class="share-sheet__canvas" data-share-canvas role="img"></canvas>
      </div>
      <div class="share-sheet__controls">
        <fieldset class="share-sheet__group"><legend>Format</legend><div class="share-sheet__formats">${SHARE_FORMATS.map(format => formatOption(format, state.format)).join('')}</div></fieldset>
        <fieldset class="share-sheet__group"><legend>Look</legend><div class="share-sheet__looks">${SHARE_LOOKS.map(look => lookOption(look, state.look)).join('')}</div></fieldset>
        ${privacy}
      </div>
    </div>
    <footer class="share-sheet__foot">
      <div class="share-sheet__messages">
        <p class="share-sheet__status" data-share-status role="status" aria-live="polite"></p>
      </div>
      <div class="share-sheet__actions">${secondary}</div>
    </footer>
  </div>`;
}

let openSheet = null;

/**
 * Open the share sheet for a week or year model (share-image.js).
 * @param {object} options
 * @param {object} options.model buildWeekShareModel() or buildYearShareModel()
 * @param {string} options.title dialog title, e.g. “Share your week”
 * @param {string} [options.eyebrow] where it comes from, e.g. “Weekly review”
 * @param {Element} [options.opener] focus returns here on close
 */
export function openShareDialog({ model, title = 'Share', eyebrow = 'Share', opener = document.activeElement } = {}) {
  if (!model || typeof document === 'undefined') return null;
  openSheet?.close({ restoreFocus: false });
  // Focus goes back here on close, or to its twin when the planner drew it again meanwhile.
  const from = openerOf(opener);
  const prefs = readPrefs();
  const state = {
    format: prefs.format,
    look: prefs.look || (appIsDark() ? 'ink' : 'paper'),
    includeLine: false,
    lineIndex: model.kind === 'week' && model.lines.length ? model.lines.length - 1 : 0,
    includeMisogi: false
  };
  const shareAvailable = canShareFiles();
  const copyAvailable = canCopyImage();
  const intro = model.kind === 'year'
    ? `An image of ${model.isCurrentYear ? `${model.year} so far` : `your ${model.year}`}, made on this device. Nothing is uploaded — you choose where it goes.`
    : 'An image of this week, made on this device. Nothing is uploaded — you choose where it goes.';
  const dialog = document.createElement('dialog');
  dialog.className = DIALOG_CLASS;
  dialog.setAttribute('aria-labelledby', 'share-sheet-title');
  dialog.setAttribute('aria-describedby', 'share-sheet-intro');
  dialog.innerHTML = sheetMarkup({ eyebrow, title, intro, model, state, shareAvailable, copyAvailable });
  document.body.append(dialog);

  const $ = selector => dialog.querySelector(selector);
  const canvas = $('[data-share-canvas]');
  const stage = $('[data-share-stage]');
  const status = $('[data-share-status]');
  const panel = $('.share-sheet__panel');
  const fontFamily = getComputedStyle(document.body).fontFamily;
  let blob = null;
  let pending = null;
  let renderToken = 0;
  let counted = false;
  let statusTimer = 0;
  let closing = false;

  const options = () => normalizeShareOptions({
    format: state.format,
    look: state.look,
    paint: currentPaint(),
    includeLine: state.includeLine,
    line: model.kind === 'week' ? model.lines[state.lineIndex] : '',
    includeMisogi: state.includeMisogi,
    locale: undefined
  });

  const say = (message, { keep = false } = {}) => {
    clearTimeout(statusTimer);
    status.textContent = message;
    if (message && !keep) statusTimer = setTimeout(() => { status.textContent = ''; }, 4200);
  };

  /** Encode the current drawing ahead of time, so Share… can run inside the click that asked for it. */
  function encode(token) {
    blob = null;
    pending = new Promise(resolve => {
      try {
        canvas.toBlob(result => {
          if (token === renderToken) blob = result;
          resolve(result);
        }, 'image/png');
      } catch (_) {
        resolve(null);
      }
    });
    return pending;
  }

  function render() {
    const opts = options();
    const format = shareFormat(opts.format);
    if (canvas.width !== format.width) canvas.width = format.width;
    if (canvas.height !== format.height) canvas.height = format.height;
    const ctx = canvas.getContext('2d');
    drawShareImage(ctx, model, { ...opts, fontFamily });
    canvas.setAttribute('aria-label', `Preview. ${describeShare(model, opts)}`);
    stage.dataset.format = format.id;
    stage.dataset.look = opts.look;
    renderToken += 1;
    encode(renderToken);
  }

  async function currentBlob() {
    return blob || (await pending) || null;
  }

  function counts() {
    if (counted) return;
    counted = true;
    trackEvent('share_image_created');
  }

  async function download() {
    const result = await currentBlob();
    if (!result) { say('The image couldn’t be made on this device.'); return; }
    const url = URL.createObjectURL(result);
    const link = document.createElement('a');
    link.href = url;
    link.download = shareFileName(model, state.format);
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    counts();
    say('Image downloaded.');
  }

  async function copy() {
    try {
      // Safari wants the promise handed over inside the click.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob ? Promise.resolve(blob) : pending.then(result => result || Promise.reject(new Error('no image'))) })]);
      counts();
      say('Image copied. Paste it wherever you like.');
    } catch (_) {
      say('This browser didn’t allow copying the image. Download it instead.');
    }
  }

  async function shareNative() {
    const result = blob || await currentBlob();
    if (!result) { say('The image couldn’t be made on this device.'); return; }
    const file = new File([result], shareFileName(model, state.format), { type: 'image/png' });
    const data = { files: [file], title: model.kind === 'year' ? `My ${model.year} in Daily Planner` : 'My week in Daily Planner', text: `Made with Daily Planner · https://${SHARE_SITE}` };
    try {
      if (navigator.canShare && !navigator.canShare(data)) delete data.text;
      await navigator.share(data);
      counts();
      say('Shared.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      say('The share sheet didn’t open. Download the image instead.');
    }
  }

  function syncPrivate() {
    const pick = $('[data-share-line-pick]');
    if (pick) pick.hidden = !state.includeLine;
  }

  dialog.addEventListener('change', event => {
    const target = event.target;
    if (target.name === 'share-format') { state.format = shareFormat(target.value).id; writePrefs(state); }
    else if (target.name === 'share-look') { state.look = target.value === 'ink' ? 'ink' : 'paper'; writePrefs(state); }
    else if (target.matches('[data-share-line]')) { state.includeLine = target.checked === true; syncPrivate(); }
    else if (target.matches('[data-share-line-choice]')) state.lineIndex = Math.max(0, Math.min(model.lines.length - 1, Number(target.value) || 0));
    else if (target.matches('[data-share-misogi]')) state.includeMisogi = target.checked === true;
    else return;
    render();
  });

  dialog.addEventListener('click', event => {
    // A click on the backdrop lands on the <dialog> itself.
    if (event.target === dialog) { handle.close(); return; }
    if (event.target.closest('[data-share-close]')) { handle.close(); return; }
    if (event.target.closest('[data-share-download]')) { download(); return; }
    if (event.target.closest('[data-share-copy]')) { copy(); return; }
    if (event.target.closest('[data-share-native]')) shareNative();
  });

  // Keys stay inside the sheet: the planner's shortcuts (and its Escape) must not act underneath, and Tab wraps.
  dialog.addEventListener('keydown', event => { keepTab(event, dialog); event.stopPropagation(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); handle.close(); });

  const handle = {
    el: dialog,
    render,
    close({ restoreFocus = true } = {}) {
      if (closing) return;
      closing = true;
      backLayers.closed(handle);
      clearTimeout(statusTimer);
      if (openSheet === handle) openSheet = null;
      const finish = () => {
        if (dialog.open) dialog.close();
        dialog.remove();
        if (restoreFocus) focusBack(from?.el, from?.selector);
      };
      Promise.resolve(modalExit(panel)).then(finish, finish);
    }
  };
  openSheet = handle;
  // Back closes it (src/ui/back-stack.js). On Android, Chrome's back closes a modal <dialog> itself (cancel, above).
  backLayers.open(handle, { back: () => handle.close(), alive: () => openSheet === handle });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  syncPrivate();
  render();
  modalEnter(panel);
  const primary = $('[data-share-native]') || $('[data-share-download]');
  requestAnimationFrame(() => primary?.focus({ preventScroll: true }));
  // Fonts load lazily: draw again once they are in, so the first preview is never in a fallback face.
  document.fonts?.ready?.then(() => { if (openSheet === handle) render(); });
  return handle;
}
