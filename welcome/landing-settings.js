/* ============================================================================
   WELCOME PAGES — copy the owner may want to change without touching markup,
   shared by the landing page (/welcome/) and the Contact page (/contact/).

   Left blank on purpose:
   - `replyDelay`: no response time is promised;
   - `contactEmail` and `supportEmail`: fill them in yourself, or set
     DAILY_PLANNER_SUPPORT_EMAIL when building, which the legal pages use too.
   ============================================================================ */
export const LANDING = Object.freeze({
  // When PLANNER_API_URL is blank, questions become an email to this address,
  // or, left blank, to the site's SUPPORT_EMAIL (runtime config). Without
  // either, the form stays visible but cannot be sent.
  // “<support@example.com>” and “Support <support@example.com>” work too.
  contactEmail: '',
  // A reachable support address, shown on the Contact page ("Prefer email?
  // Write to …") when set; the legal notice shows SUPPORT_EMAIL too. No
  // footer shows it. Blank here: the site's SUPPORT_EMAIL (runtime config) is
  // used instead.
  supportEmail: '',
  // Optional promise shown after a question is sent, e.g. 'within two working days'.
  replyDelay: ''
});
