/**
 * The publisher's details on the legal pages (SUPPORT_EMAIL, PRIVACY_EMAIL,
 * LEGAL_PHONE, LEGAL_ADDRESS, LEGAL_REGISTRATION, build variables
 * DAILY_PLANNER_…), checked and written the same way everywhere:
 *   - legal/legal.js fills the pages with them in the browser;
 *   - scripts/build.mjs writes them into the pages of dist/ (staticLegalHtml),
 *     so they show without JavaScript too;
 *   - the owner dashboard's Setup card (admin/admin.js, admin/attention.js)
 *     says when a value is set but not used (legalValueProblem).
 * Pure: Node (the build, the tests) and the browser load it as is, with the
 * one rule for reading an email setting (src/lib/text.js emailAddress).
 */

import { emailAddress } from '../src/lib/text.js';

export const PUBLISHER = 'Ben Morin, an individual based in France';
// The legal notice's director of publication (LCEN art. 6 III): the publisher himself.
export const DIRECTOR = 'Ben Morin';
// Plain addresses only: nothing that could add ?subject= or ?bcc= to a mailto: link.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"?&=%/#]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,188}[a-z0-9])?\.[a-z]{2,24}$/i;
// A phone number as people write it: digits, spaces and + ( ) - . only, with 6 to 20 digits.
const PHONE_RE = /^\+?[\d ().-]{6,32}$/;
// An international number has at most 15 digits, country code included (ITU-T E.164).
const E164_MAX = 15;
// The question form: the Contact page, /contact/ (1.31; the Teams page's form before).
const ASK_PATH = 'contact/';
// The configuration keys that hold an email address.
const EMAIL_KEYS = ['SUPPORT_EMAIL', 'PRIVACY_EMAIL'];

export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const oneLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const configText = (config, key) => (typeof config?.[key] === 'string' ? config[key].trim() : '');

/**
 * The address in an email value as it may be typed: “support@example.com”,
 * “<support@example.com>” or “Support <support@example.com>”, spaces around
 * it allowed, all give support@example.com. Anything else comes back
 * trimmed, for legalEmail to accept or refuse. The planner and the welcome
 * pages read it with the same function (src/config.js).
 */
export { emailAddress };

/** An email address from the configuration (emailAddress), or '' when it isn't a plain one. */
export function legalEmail(value) {
  const email = emailAddress(value);
  return EMAIL_RE.test(email) ? email : '';
}

/* Phone numbers ---------------------------------------------------------------
   LEGAL_PHONE is written in international form, as it is dialled from abroad
   (E.164): + and the country code, then the national number without its
   leading 0, e.g. +33 then 199001234. The pages show it the way people of
   that country write it, after the country code: France one digit, then
   pairs; the US and Canada 3, 3 and 4 digits; and so on (PHONE_PLANS). For
   another country, the number keeps the spaces it was typed with, or gets
   groups of three and two digits. Spaces, dots, dashes and the national
   “(0)” of “+33 (0)1 …” may be typed: the digits decide. A number written
   without + is shown as typed. The tel: link is always the digits (telHref). */

// Country calling codes (ITU-T E.164): 1 and 7 have one digit, these have two, every other code has three.
const TWO_DIGIT_CODES = new Set('20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '));

/** The country calling code an international number's digits start with: '33' for 33199001234. */
export function callingCode(digits) {
  const text = String(digits ?? '');
  if (/^[17]/.test(text)) return text.slice(0, 1);
  return TWO_DIGIT_CODES.has(text.slice(0, 2)) ? text.slice(0, 2) : text.slice(0, 3);
}

/** Digits cut into groups of these sizes, the last group taking whatever is left. */
function groups(digits, sizes) {
  const parts = [];
  let at = 0;
  sizes.forEach((size, index) => {
    if (at >= digits.length) return;
    const end = index === sizes.length - 1 ? digits.length : at + size;
    parts.push(digits.slice(at, end));
    at = end;
  });
  return parts.join(' ');
}

// The United Kingdom: mobiles 7xxx xxxxxx; London and the other 02 areas
// 2x xxxx xxxx; the cities with a 011x or 01x1 code 1x1 xxx xxxx; other 01
// areas 1xxx xxxxxx; 03, 08 and 09 numbers 3xx xxx xxxx; the few 9-digit
// numbers 1xxxx xxxx or 800 xxxxxx.
function ukGroups(national) {
  if (national.length === 9) return groups(national, national.startsWith('8') ? [3, 6] : [5, 4]);
  if (/^7/.test(national)) return groups(national, [4, 6]);
  if (/^1(?:1|\d1)/.test(national)) return groups(national, [3, 3, 4]);
  if (/^1/.test(national)) return groups(national, [4, 6]);
  if (/^[389]/.test(national)) return groups(national, [3, 3, 4]);
  return groups(national, [2, 4, 4]);
}

// Belgium: mobiles 4xx xx xx xx; Brussels, Antwerp, Liège and Ghent
// x xxx xx xx; other areas xx xx xx xx; 0800 and 090x numbers 800 xx xxx.
function beGroups(national) {
  if (national.length === 9) return groups(national, [3, 2, 2, 2]);
  if (/^[89]0/.test(national)) return groups(national, [3, 2, 3]);
  if (/^[2349]/.test(national)) return groups(national, [1, 3, 2, 2]);
  return groups(national, [2, 2, 2, 2]);
}

// Germany, as DIN 5008 writes it: the area code, then the number in one
// block. Berlin, Hamburg, Frankfurt and Munich have two digits; mobiles,
// service numbers and the cities whose code ends in 1 (211, 221 …) three;
// the rest is cut after four, which reads well even for a longer code.
function deGroups(national) {
  const area = /^(?:30|40|69|89)/.test(national) ? 2 : (/^(?:1|[2-9]\d1|[79]00|800)/.test(national) ? 3 : 4);
  return groups(national, [area, national.length]);
}

/**
 * The countries whose numbers the pages know: how many digits follow the
 * country code (`digits`, the shortest and the longest), what the first one
 * may be (never the national 0, which isn't dialled from abroad) and how
 * they're grouped.
 */
const PHONE_PLANS = Object.freeze({
  // The US and Canada (+1): area code, exchange, line.
  1: { digits: [10, 10], first: /^[2-9]/, format: national => groups(national, [3, 3, 4]) },
  // France: one digit, then pairs.
  33: { digits: [9, 9], format: national => groups(national, [1, 2, 2, 2, 2]) },
  32: { digits: [8, 9], format: beGroups },
  // Switzerland: xx xxx xx xx; 0800, 084x and 090x numbers 800 xxx xxx.
  41: { digits: [9, 9], format: national => groups(national, /^(?:8[04]|90)/.test(national) ? [3, 3, 3] : [2, 3, 2, 2]) },
  44: { digits: [9, 10], format: ukGroups },
  49: { digits: [5, 13], format: deGroups }
});

// Another country: groups of three, ending with one or two groups of two (9 digits: 3 3 3; 10: 3 3 2 2; 8: 3 3 2).
function plainGroups(national) {
  const tail = [[], [2, 2], [2]][national.length % 3];
  const threes = Math.max(0, (national.length - tail.reduce((sum, size) => sum + size, 0)) / 3);
  return groups(national, [...Array(threes).fill(3), ...tail]);
}

/** An international number's digits: + and what is dialled, without the national “(0)”. */
const internationalDigits = phone => String(phone).replace(/\(0\)/g, '').replace(/\D/g, '');

/** What was typed after the country code (+351 and then “21 000 0000”). */
function afterCode(phone, code) {
  let seen = 0;
  for (let index = 0; index < phone.length; index += 1) {
    if (/\d/.test(phone[index])) seen += 1;
    if (seen === code.length) return phone.slice(index + 1);
  }
  return '';
}

const NOT_A_PHONE = 'not a phone number';

/**
 * Why a phone number from the configuration can't be shown, in a few words
 * ('' when it can): not a phone number at all, or, for a country the pages
 * know (PHONE_PLANS), not the right digits after its code (“not a phone
 * number: after +33, the 9 digits of the number, without its leading 0”).
 */
function phoneProblem(value) {
  const phone = oneLine(value);
  const count = phone.replace(/\D/g, '').length;
  if (!PHONE_RE.test(phone) || count < 6 || count > 20) return NOT_A_PHONE;
  if (!phone.startsWith('+')) return '';
  const digits = internationalDigits(phone);
  const code = callingCode(digits);
  const national = digits.slice(code.length);
  const plan = PHONE_PLANS[code];
  if (plan) {
    const [shortest, longest] = plan.digits;
    if (national.length >= shortest && national.length <= longest && (plan.first || /^[1-9]/).test(national)) return '';
    const how = shortest === longest ? `${shortest}` : `${shortest} ${longest - shortest === 1 ? 'or' : 'to'} ${longest}`;
    return `${NOT_A_PHONE}: after +${code}, the ${how} digits of the number${code === '1' ? '' : ', without its leading 0'}`;
  }
  if (digits.length > E164_MAX) return `${NOT_A_PHONE}: at most ${E164_MAX} digits after the +`;
  return national.length < 4 ? NOT_A_PHONE : '';
}

/**
 * A phone number the way the pages show it. International (+…): the country
 * code, then the national number grouped as that country writes it, e.g.
 * “+33 1 99 00 12 34”, “+1 514 555 0123”, “+44 20 7946 0000”; for a country
 * without a plan, as typed when it was typed with spaces, else in groups of
 * three and two. National (no +): as typed. Expects a usable number (legalPhone).
 */
export function formatPhone(value) {
  const phone = oneLine(value);
  if (!phone.startsWith('+')) return phone;
  const digits = internationalDigits(phone);
  const code = callingCode(digits);
  const national = digits.slice(code.length);
  const plan = PHONE_PLANS[code];
  if (plan) return `+${code} ${plan.format(national)}`;
  return /\d\D+\d/.test(afterCode(phone, code)) ? phone : `+${code} ${plainGroups(national)}`;
}

/** A phone number from the configuration, as the pages show it (formatPhone), or '' when it isn't one. */
export function legalPhone(value) {
  return phoneProblem(value) ? '' : formatPhone(value);
}

/** The publisher's details from a runtime configuration; blank or invalid values become ''. */
export function legalDetails(config = {}) {
  const text = key => configText(config, key);
  return {
    email: legalEmail(text('SUPPORT_EMAIL')),
    privacyEmail: legalEmail(text('PRIVACY_EMAIL')),
    phone: legalPhone(text('LEGAL_PHONE')),
    address: oneLine(text('LEGAL_ADDRESS')),
    registration: oneLine(text('LEGAL_REGISTRATION'))
  };
}

/**
 * Why a configured value is left out of the pages, in a few words (“not a
 * plain email address”, “not a phone number”, with the digits a known
 * country expects: phoneProblem); '' when it is used or blank.
 */
export function legalValueProblem(key, value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (EMAIL_KEYS.includes(key)) return legalEmail(text) ? '' : 'not a plain email address';
  if (key === 'LEGAL_PHONE') return phoneProblem(text);
  return '';
}

/**
 * The address that answers a topic: 'privacy' (the privacy policy, the
 * cookies page) goes to PRIVACY_EMAIL, else SUPPORT_EMAIL; anything else
 * (the terms, the legal notice) to SUPPORT_EMAIL. '' means the question form.
 */
export function contactEmail(details, topic = 'support') {
  return (topic === 'privacy' && details?.privacyEmail) || details?.email || '';
}

/** Where to write without an address: the “Ask a question” form, on the Contact page. */
export const askHref = (root = '../') => `${root}${ASK_PATH}`;

const mailLink = email => `<a href="mailto:${esc(email)}">${esc(email)}</a>`;
const formLink = root => `<a href="${esc(askHref(root))}">“Ask a question” form</a>`;

/** How to reach us about a topic, as the value of a row: the address, or the question form. */
export function contactHtml(details, root = '../', topic = 'support') {
  const email = contactEmail(details, topic);
  return email ? mailLink(email) : `the ${formLink(root)}`;
}

/** How to reach us inside a sentence (“To use these rights, …”): “email …” or “use the … form”. */
export function contactPhrase(details, root = '../', topic = 'support') {
  const email = contactEmail(details, topic);
  return email ? `email ${mailLink(email)}` : `use the ${formLink(root)}`;
}

/**
 * A phone number as a tel: link: the digits, with the leading + of an
 * international number (E.164: tel:+33199001234), which also drops the
 * national “(0)” of “+33 (0)6 …”. A national number keeps its 0, even
 * written “(0)6 …”.
 */
export function telHref(phone) {
  const text = String(phone ?? '').trim();
  return `tel:${text.startsWith('+') ? `+${internationalDigits(text)}` : text.replace(/\D/g, '')}`;
}

export const phoneHtml = phone => `<a href="${esc(telHref(phone))}">${esc(phone)}</a>`;

/**
 * The publisher block. The legal notice (`page` 'notice'): Publisher,
 * Address and Registration when set, Email (SUPPORT_EMAIL, or Contact: the
 * form), Phone when set, Director of publication. The privacy policy
 * ('privacy'): the data controller, Address and Registration when set, and
 * where to write about privacy (PRIVACY_EMAIL, else SUPPORT_EMAIL, else the form).
 */
export function detailRows(details, root = '../', page = 'notice') {
  const privacy = page === 'privacy';
  const topic = privacy ? 'privacy' : 'support';
  return [
    [privacy ? 'Data controller' : 'Publisher', esc(PUBLISHER)],
    details.address ? ['Address', esc(details.address)] : null,
    details.registration ? ['Registration', esc(details.registration)] : null,
    [contactEmail(details, topic) ? 'Email' : 'Contact', contactHtml(details, root, topic)],
    !privacy && details.phone ? ['Phone', phoneHtml(details.phone)] : null,
    privacy ? null : ['Director of publication', esc(DIRECTOR)]
  ].filter(Boolean);
}

export const detailsHtml = rows => rows.map(([label, value]) => `<div class="lg-dl__row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('');

/**
 * A legal page's HTML with the publisher's details written in, as legal.js
 * writes them in the browser: each `<dl … data-legal-details="notice|privacy">`
 * gets its rows and each `<span data-legal-contact="support|privacy">` its
 * phrase, for the page's `data-root`. The build applies it to dist/ only:
 * the source pages keep the blank fallback (the question form).
 */
export function staticLegalHtml(html, config = {}) {
  const details = legalDetails(config);
  const root = /<body[^>]*\sdata-root="([./]*)"/.exec(html)?.[1] || '../';
  return String(html)
    .replace(/(<dl\b[^>]*\sdata-legal-details="(notice|privacy)"[^>]*>)[\s\S]*?(<\/dl>)/g, (_, open, page, close) => `${open}${detailsHtml(detailRows(details, root, page))}${close}`)
    .replace(/(<span\b[^>]*\sdata-legal-contact="(support|privacy)"[^>]*>)[\s\S]*?(<\/span>)/g, (_, open, topic, close) => `${open}${contactPhrase(details, root, topic)}${close}`);
}
