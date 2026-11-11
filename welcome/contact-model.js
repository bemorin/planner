/**
 * Pure helpers for the Contact page (/contact/) and the links that lead to
 * it: the question form's words, the body it sends to the owner API, the
 * same question as an email when the site has no API, and the old addresses
 * of the question form. No DOM here, so tests can import it directly.
 */

/** The Contact page's head: its kicker, title and intro. */
export const CONTACT_COPY = Object.freeze({
  kicker: 'Contact',
  title: 'Ask a question',
  intro: 'Anything about the planner: how something works, an idea, a problem, or your data. You’ll get a reply by email.',
  submit: 'Send the question',
  done: 'Thanks, your question is in. You’ll get a reply by email',
  again: 'Ask another question'
});

/** The email field: any address, since a question is anyone's. */
export const EMAIL_FIELD = Object.freeze({ label: 'Email', placeholder: 'you@example.com', missing: 'Enter your email.' });

/** The owner API's route for a question: POST {PLANNER_API_URL}/contact (server/planner-api.js). */
export const CONTACT_ROUTE = 'contact';

/**
 * Where the Contact page's questions say they come from (`source`): the
 * server stores anything it doesn't know as 'landing'.
 */
export const CONTACT_SOURCE = 'contact';

/** The longest question the server takes, in characters. */
export const MESSAGE_MAX = 1000;

const params = search => {
  try { return new URLSearchParams(search || ''); } catch (_) { return new URLSearchParams(); }
};

/**
 * Whether the Contact page's card may keep to the window as the page scrolls
 * (contact.css `is-following`): only when all of it fits between the top bar
 * and the bottom of the window, `gap` from each, so its button is never kept
 * out of sight.
 */
export const cardFollows = ({ card = 0, viewport = 0, topBar = 0, gap = 24 } = {}) => card > 0 && card + topBar + gap * 2 <= viewport;

/**
 * The body sent to the owner API: the form's values, and where and how it
 * was sent (the page version, the browser's language, the page). `website`
 * is the hidden field only robots fill in. `kind` stays "question", which
 * the older route of the same form (/api/teams) still asks for. No
 * `consent`: replying is what a question is sent for, so there is no box to
 * tick, only the information notice under the form.
 */
export function questionPayload(values, { version = '', locale = '', source = CONTACT_SOURCE } = {}) {
  return {
    email: values.email,
    name: values.name,
    message: values.message,
    website: values.website,
    version,
    locale,
    source,
    kind: 'question'
  };
}

/** The question as an email, when the site has no API but a contact address: its subject and its lines. */
export function questionEmail(values) {
  const lines = [
    `Name: ${values.name}`,
    `Email: ${values.email}`,
    ...(values.message ? ['', values.message] : [])
  ];
  return { subject: `Daily Planner — Question from ${values.name}`, lines };
}

/** The site's root as seen from a page one folder down: '' for /welcome/, /contact/ or /contact/index.html. */
const siteOf = path => String(path).replace(/\/(?:index\.html)?$/, '').replace(/\/[^/]*$/, '');

/**
 * Where an address asking for the question form (?ask=question) now leads:
 * the Contact page, next to the page's own folder (/welcome/ → /contact/),
 * with the rest of the query but not ?ask or ?plan, and no #hash. '' for any
 * other address. The inline script in the <head> of the landing page does
 * the same before first paint.
 */
export function contactAddress({ path = '/welcome/', search = '' } = {}) {
  const query = params(search);
  if (query.get('ask') !== 'question') return '';
  query.delete('ask');
  query.delete('plan');
  const rest = query.toString();
  return `${siteOf(path)}/contact/${rest ? `?${rest}` : ''}`;
}

/**
 * Where an old /welcome/ address now lives: a question (?ask=question) on
 * the Contact page (contactAddress), its neighbour; `path` is the welcome
 * page's own path (/welcome/, /welcome/index.html or /welcome). '' when the
 * address is the landing page's own.
 */
export function movedAddress({ path = '/welcome/', search = '' } = {}) {
  return contactAddress({ path, search });
}

/**
 * An address read against the page's own (`here`, its href), as the full
 * href to go to, or '' when it would leave the page's origin or is blank.
 * movedAddress and contactAddress build on the page's path, which another
 * site can choose: //other.example/welcome/ makes the folder //other.example,
 * another site. The inline script in <head> checks the same.
 */
export function sameSiteHref(address, here) {
  if (!address) return '';
  try {
    const next = new URL(address, here);
    return next.origin === new URL(here).origin ? next.href : '';
  } catch (_) {
    return '';
  }
}
