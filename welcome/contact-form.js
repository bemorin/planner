// Imported as a namespace so a value missing from an older config.js reads as
// undefined instead of failing the whole module.
import * as config from '../src/config.js';
import { plannerApiEnabled } from '../src/lib/planner-api.js';
import { CONTACT_COPY, CONTACT_ROUTE, CONTACT_SOURCE, EMAIL_FIELD, MESSAGE_MAX, questionEmail, questionPayload } from './contact-model.js';
import { EMAIL_RE, configText, emailAddress, qs } from './page-kit.js';

/* ============================================================================
   The question form of the Contact page (/contact/): an email, a name and the
   question, anyone's, about anything.

   Sent to the owner API (POST {PLANNER_API_URL}/contact). Without the API it
   becomes an email to LANDING.contactEmail, else to SUPPORT_EMAIL; without
   either, it stays visible but cannot be sent.
   ============================================================================ */

const PLANNER_API_URL = typeof config.PLANNER_API_URL === 'string' ? config.PLANNER_API_URL : '';
const APP_VERSION = typeof config.APP_VERSION === 'string' ? config.APP_VERSION : '';

function readForm(form) {
  const data = new FormData(form);
  const text = name => String(data.get(name) || '').trim();
  return { email: text('email'), name: text('name'), message: text('message'), website: String(data.get('website') || '') };
}

function setError(field, message) {
  const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/);
  const box = ids.map(id => document.getElementById(id)).find(node => node?.classList.contains('field__err'));
  field.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (box) box.textContent = message;
}

/** The first field that is wrong, after marking each one; null when all is well. */
function validate(form, values) {
  const checks = [
    ['email', !values.email ? EMAIL_FIELD.missing : (!EMAIL_RE.test(values.email) || values.email.length > 254 ? 'Enter an email address like name@example.com.' : '')],
    ['name', !values.name ? 'Enter your name.' : (values.name.length > 80 ? 'Keep your name under 80 characters.' : '')],
    ['message', !values.message ? 'Write your question.' : (values.message.length > MESSAGE_MAX ? 'Keep the message under 1,000 characters.' : '')]
  ];
  let first = null;
  checks.forEach(([name, message]) => {
    const field = qs(`[name="${name}"]`, form);
    if (!field) return;
    setError(field, message);
    if (message && !first) first = field;
  });
  return first;
}

async function sendQuestion(values, { source }) {
  const payload = questionPayload(values, { version: APP_VERSION, locale: navigator.language || '', source });
  try {
    const response = await fetch(`${PLANNER_API_URL}/${CONTACT_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.ok !== false) return { ok: true };
    return { ok: false, error: data.error || 'The question could not be sent. Check the form and try again.' };
  } catch (_) {
    return { ok: false, error: navigator.onLine === false ? 'You’re offline. Send the question again once you’re connected.' : 'The server couldn’t be reached. Try again in a moment.' };
  }
}

/**
 * Wires the form. Returns { mode } ('api' | 'mailto' | 'off'), or null when
 * the page has no form.
 *
 * @param {object} options
 * @param {{ contactEmail: string, replyDelay: string }} options.settings
 * @param {string} [options.source] the page, as the question names it
 */
export function createContactForm({ settings, source = CONTACT_SOURCE }) {
  const panel = qs('[data-form-panel]');
  const form = qs('[data-contact-form]');
  if (!panel || !form) return null;

  // Without the API: an email to the contact address, else to the site's
  // SUPPORT_EMAIL, either typed plain, “<…>” or “Name <…>”.
  const contactEmail = emailAddress(settings.contactEmail || configText('SUPPORT_EMAIL'));
  const mode = plannerApiEnabled() ? 'api' : (EMAIL_RE.test(contactEmail) ? 'mailto' : 'off');

  const field = name => qs(`[name="${name}"]`, form);
  const submit = qs('[data-form-submit]', form);
  const errorBox = qs('[data-form-error]', form);
  const counter = qs('[data-message-count]', form);
  const done = qs('[data-form-done]', panel);
  const doneText = qs('[data-form-done-text]', panel);
  const again = qs('[data-form-again]', panel);

  // No box to tick: replying is what the form is for, so an information
  // notice is enough. The line under it says what is kept, why, for how long
  // and that it is deleted on request, and links legal/privacy/#requests.
  const mailtoLine = qs('[data-mailto-line]', form);
  if (mailtoLine) mailtoLine.hidden = mode !== 'mailto';
  const privacyLine = qs('[data-privacy-line]', form);
  if (privacyLine) privacyLine.hidden = mode !== 'api';
  if (mode === 'off') {
    submit.disabled = true;
    submit.setAttribute('aria-describedby', 'form-off');
    const off = qs('[data-form-off]', form);
    off.id = 'form-off';
    off.hidden = false;
  } else {
    submit.disabled = false;
  }
  submit.textContent = mode === 'mailto' ? 'Write the email' : CONTACT_COPY.submit;

  const updateCount = () => { counter.textContent = `${field('message').value.length}/${MESSAGE_MAX}`; };
  field('message').addEventListener('input', updateCount);
  updateCount();

  form.addEventListener('input', event => {
    if (event.target.getAttribute('aria-invalid') === 'true') setError(event.target, '');
  });

  function showForm() {
    form.hidden = false;
    done.hidden = true;
    errorBox.hidden = true;
  }

  function showDone(text) {
    doneText.textContent = text;
    if (again) again.textContent = CONTACT_COPY.again;
    form.hidden = true;
    done.hidden = false;
    done.focus();
  }

  again?.addEventListener('click', () => {
    // Another one: the same email and name, a new question.
    field('message').value = '';
    updateCount();
    showForm();
    field('message').focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (mode === 'off') return;
    errorBox.hidden = true;
    const values = readForm(form);
    const invalid = validate(form, values);
    if (invalid) { invalid.focus(); return; }

    if (mode === 'mailto') {
      const { subject, lines } = questionEmail(values);
      location.href = `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\r\n'))}`;
      showDone(`Your email app should open with the question, ready to send. If it doesn’t, write to ${contactEmail}.`);
      return;
    }

    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Sending…';
    const result = await sendQuestion(values, { source });
    submit.disabled = false;
    submit.textContent = label;
    if (result.ok) {
      const delay = settings.replyDelay ? ` ${settings.replyDelay}` : '';
      showDone(`${CONTACT_COPY.done}${delay}.`);
    } else {
      errorBox.textContent = result.error;
      errorBox.hidden = false;
    }
  });

  return { mode };
}
