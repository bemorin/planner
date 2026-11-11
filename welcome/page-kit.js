// Imported as a namespace so a value missing from an older config.js reads as
// undefined instead of failing the whole module.
import * as config from '../src/config.js';
import { setupTopMenu } from './top-menu.js';

/* ============================================================================
   Small pieces shared by the welcome pages (/welcome/ and /contact/): DOM
   helpers, the header that gains a hairline once the page scrolls (and its
   menu on a phone), the footer's social links, and the project's own links
   (its source code and GitHub Sponsors) wherever a page has room for them.
   No page logic here.
   ============================================================================ */

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

export const CHECK_ICON = '<svg class="i"><use href="#i-check"/></svg>';

// Same rule as the server: a plain domain (letters, digits, dots, hyphens).
export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"?&=%/#]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,188}[a-z0-9])?\.[a-z]{2,24}$/i;

export const httpsUrl = value => (typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/.test(value.trim()) ? value.trim() : '');

/** A string from runtime-config.js / config.js, trimmed; '' when it isn't set (or an older config lacks it). */
export const configText = key => (typeof config[key] === 'string' ? config[key].trim() : '');

/**
 * The address in an email setting typed “<support@example.com>” or
 * “Support <support@example.com>” (config.js emailAddress); anything else
 * trimmed, for EMAIL_RE to check.
 */
export const emailAddress = value => (typeof config.emailAddress === 'function' ? config.emailAddress(value) : String(value ?? '').trim());

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === false || value == null) return;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  children.flat().forEach(child => { if (child != null) node.append(child instanceof Node ? child : String(child)); });
  return node;
}

/**
 * The header gains its hairline once the page has scrolled; below 960px its
 * Menu button opens the section links (welcome/top-menu.js).
 */
export function setupTopBar() {
  const top = qs('[data-top]');
  if (!top) return;
  setupTopMenu(top);
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      top.classList.toggle('is-scrolled', window.scrollY > 4);
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* Footer: the configured social links ---------------------------------------

   Every footer repeats nothing its page's top bar already has (1.32). Above,
   the brand and “By Ben Morin”, with these links across from it once one is
   set; below, the legal pages and Contact, then “What this page counts”. No support address: the Contact page shows it when SUPPORT_EMAIL
   is set, and so does the legal notice.

   Each social link is a small button that says where it leads (1.33.2: “X”
   alone read as a stray letter), with the sprite's arrow turned to ↗ for a
   new tab; no brand logos. Its name starts with what it shows (for voice
   control), then whose it is and the new tab. Ben Morin's profiles carry
   rel="me"; the project's page is the project's, not him. */

const SOCIAL_LINKS = [
  { key: 'SOCIAL_X_URL', label: 'Follow on X', owner: 'Ben Morin', me: true },
  { key: 'SOCIAL_LINKEDIN_URL', label: 'LinkedIn', owner: 'Ben Morin', me: true },
  { key: 'PROJECT_GITHUB_URL', label: 'GitHub', owner: 'Daily Planner', me: false }
];

/** The footer's social links that are set (https only), in order: [{ href, label, name, rel }]. */
export function socialLinks(read = configText) {
  return SOCIAL_LINKS.map(link => ({ ...link, href: httpsUrl(read(link.key)) }))
    .filter(link => link.href)
    .map(({ href, label, owner, me }) => ({ href, label, name: `${label} (${owner}, opens in a new tab)`, rel: me ? 'me noopener' : 'noopener' }));
}

const OUT_ICON = '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-arrow"/></svg>';

export function renderFooter() {
  const social = qs('[data-social]');
  const links = socialLinks().map(({ href, label, name, rel }) => {
    const link = el('a', { class: 'foot__btn', href, rel, target: '_blank', 'aria-label': name }, label);
    link.insertAdjacentHTML('beforeend', OUT_ICON);
    return link;
  });
  if (social && links.length) {
    social.replaceChildren(...links);
    social.hidden = false;
    // Their group waits hidden until it has something to show.
    const group = social.closest('.foot__links');
    if (group) group.hidden = false;
  }
}

/* The project's own links: its source code and GitHub Sponsors ------------

   Both come from the runtime configuration (PROJECT_GITHUB_URL and
   GITHUB_SPONSOR_URL), https only, and both are blank in the repository: a
   copy built without them shows neither. `[data-config-link="github"]` and
   `[data-config-link="sponsor"]` get the address and show; whatever waits
   for one (`[data-config-show="…"]`, such as the sentence around a link)
   shows with it. Nothing is ever shown without its address. */

const PROJECT_LINKS = Object.freeze({ github: 'PROJECT_GITHUB_URL', sponsor: 'GITHUB_SPONSOR_URL' });

/** The project's links that are set (https only): { github, sponsor }, '' for each one that isn't. */
export function projectLinks(read = configText) {
  return Object.fromEntries(Object.entries(PROJECT_LINKS).map(([name, key]) => [name, httpsUrl(read(key))]));
}

/** Gives each project link its address and shows it, with whatever waits for it; the others stay hidden. */
export function renderProjectLinks(root = document, links = projectLinks()) {
  qsa('[data-config-link]', root).forEach(link => {
    const href = links[link.dataset.configLink] || '';
    if (href) link.href = href;
    else link.removeAttribute('href');
    // A link inside a sentence shows with that sentence; a link on its own shows by itself.
    if (!link.closest('[data-config-show]')) link.hidden = !href;
  });
  qsa('[data-config-show]', root).forEach(node => { node.hidden = !links[node.dataset.configShow]; });
}
