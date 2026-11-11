import { plannerApiEnabled, trackEvent } from '../src/lib/planner-api.js';
import { createContactForm } from '../welcome/contact-form.js';
import { CONTACT_SOURCE, cardFollows } from '../welcome/contact-model.js';
import { LANDING } from '../welcome/landing-settings.js';
import { EMAIL_RE, configText, emailAddress, qs, qsa, renderFooter, setupTopBar } from '../welcome/page-kit.js';
import { followMotion, motionWanted, setupReveal } from '../welcome/page-motion.js';

/* ============================================================================
   CONTACT (/contact/): “Ask a question”, the site's one question form —
   anyone's, about anything in the planner. Every “Ask a question” link of
   the site leads here.

   The form is welcome/contact-form.js, sent to the owner API (POST
   {PLANNER_API_URL}/contact); without the API it becomes an email to
   SUPPORT_EMAIL. Beside it, a few pointers (Help in the planner, and the
   privacy address when PRIVACY_EMAIL is set) and, when SUPPORT_EMAIL is set,
   the plain address as another way to write. “Help in the planner” opens the
   planner on How it works (/?help, src/features/help-link.js). From 960px the
   form's card keeps to the window as the page scrolls (followCard).
   ============================================================================ */

const html = document.documentElement;
const apiOn = plannerApiEnabled();
const track = name => { if (apiOn) trackEvent(name); };

/** An address from the configuration (“<…>” and “Name <…>” too), or '' when it isn't a plain one. */
const configEmail = (...values) => {
  const email = emailAddress(values.find(value => typeof value === 'string' && value.trim()) || '');
  return EMAIL_RE.test(email) ? email : '';
};

/** The plain address under the intro, and the privacy address in the list, when they are set. */
function renderAddresses() {
  const support = configEmail(LANDING.supportEmail, configText('SUPPORT_EMAIL'));
  const alt = qs('[data-support-alt]');
  if (alt && support) {
    const link = qs('[data-support-link]', alt);
    link.href = `mailto:${support}`;
    link.textContent = support;
    alt.hidden = false;
  }
  const privacy = configEmail(configText('PRIVACY_EMAIL'));
  const row = qs('[data-privacy-contact]');
  if (row && privacy) {
    qs('[data-privacy-link]', row).href = `mailto:${privacy}`;
    qs('[data-privacy-address]', row).textContent = privacy;
    row.hidden = false;
  }
}

/**
 * From 960px the card keeps to the window as the page scrolls (contact.css),
 * when all of it fits below the top bar: checked again whenever the card or
 * the window changes size (an error line, the thanks), never while scrolling.
 */
function followCard() {
  const card = qs('.ct__card');
  if (!card || typeof ResizeObserver !== 'function') return;
  const top = qs('[data-top]');
  const check = () => card.classList.toggle('is-following', cardFollows({ card: card.offsetHeight, viewport: window.innerHeight, topBar: top?.offsetHeight || 0 }));
  new ResizeObserver(check).observe(card);
  window.addEventListener('resize', check, { passive: true });
  check();
}

createContactForm({ settings: LANDING, source: CONTACT_SOURCE });
renderAddresses();
followCard();
setupTopBar();
renderFooter();
qsa('[data-counts-link]').forEach(link => { link.hidden = !apiOn; });
document.addEventListener('click', event => {
  if (event.target.closest('[data-cta="app"]')) track('landing_cta_app');
});

const motionHooks = [];
setupReveal({ motionOn: motionWanted(), motionHooks });
followMotion(motionHooks);
html.classList.add('js-ready');
