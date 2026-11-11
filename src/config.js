import { emailAddress } from './lib/text.js';

export const snap = 15;
export const minTaskSlots = 3;
export const scheduleTopPad = 14;
export const scheduleBottomPad = 16;
const runtimeConfig = globalThis.__DAILY_PLANNER_CONFIG__ && typeof globalThis.__DAILY_PLANNER_CONFIG__ === 'object'
  ? globalThis.__DAILY_PLANNER_CONFIG__
  : {};
const runtimeValue = key => typeof runtimeConfig[key] === 'string' ? runtimeConfig[key].trim() : '';
// The address in an email setting typed “<support@example.com>” or “Support
// <support@example.com>” (src/lib/text.js, the one rule everywhere).
export { emailAddress };

export const PROJECT_GITHUB_URL = runtimeValue('PROJECT_GITHUB_URL');
export const GITHUB_SPONSOR_URL = runtimeValue('GITHUB_SPONSOR_URL');
export const SOCIAL_X_URL = runtimeValue('SOCIAL_X_URL');
export const SOCIAL_LINKEDIN_URL = runtimeValue('SOCIAL_LINKEDIN_URL');
export const CLOUD_API_URL = runtimeValue('CLOUD_API_URL');
export const GOOGLE_CLIENT_ID = runtimeValue('GOOGLE_CLIENT_ID');
// Personal sync through Dropbox (1.38): the App Console's app key (public, like
// the Google client ID). Blank, or not the form of an app key: the Dropbox
// option is hidden and no Dropbox request is made (src/sync/dropbox.js).
export const DROPBOX_APP_KEY = /^[a-z0-9]{10,32}$/.test(runtimeValue('DROPBOX_APP_KEY')) ? runtimeValue('DROPBOX_APP_KEY') : '';
// Optional feedback / waitlist / anonymous-count endpoint (e.g. "/api" on Cloudflare Pages).
// Blank means the planner never calls it.
export const PLANNER_API_URL = runtimeValue('PLANNER_API_URL').replace(/\/+$/, '');
// Legal pages (legal/): the publisher's contact address, the address for
// privacy questions, phone number, postal address and registration (e.g.
// SIRET or VAT number). Blank details are left out of the pages; without
// SUPPORT_EMAIL they point to the “Ask a question” form, and privacy
// questions go to PRIVACY_EMAIL, else SUPPORT_EMAIL, else the form.
// legal/legal.js checks each one before showing it (a plain address, a phone
// number of digits, spaces and + ( ) - . only). The two addresses may be typed
// “<support@example.com>” or “Support <support@example.com>”: only the address is kept.
export const SUPPORT_EMAIL = emailAddress(runtimeValue('SUPPORT_EMAIL'));
export const PRIVACY_EMAIL = emailAddress(runtimeValue('PRIVACY_EMAIL'));
export const LEGAL_PHONE = runtimeValue('LEGAL_PHONE');
export const LEGAL_ADDRESS = runtimeValue('LEGAL_ADDRESS');
export const LEGAL_REGISTRATION = runtimeValue('LEGAL_REGISTRATION');
// Kept in step with package.json by scripts/check.mjs; feedback is grouped by it.
export const APP_VERSION = '1.39.2';
// Public/project links are deployment configuration, not repository defaults.


export const palette = [
  { group: 'Muted', name: 'Brick', value: '#8f5f59' },
  { group: 'Muted', name: 'Cinnamon', value: '#9a704e' },
  { group: 'Muted', name: 'Olive', value: '#7a7950' },
  { group: 'Muted', name: 'Moss', value: '#5f755b' },
  { group: 'Muted', name: 'Eucalyptus', value: '#54766f' },
  { group: 'Muted', name: 'Slate', value: '#5f7084' },
  { group: 'Muted', name: 'Iris', value: '#716786' },
  { group: 'Muted', name: 'Mauve', value: '#8a6578' },
  { group: 'Muted', name: 'Stone', value: '#746e67' },
  { group: 'Rich', name: 'Burgundy', value: '#7b3440' },
  { group: 'Rich', name: 'Copper', value: '#a5522e' },
  { group: 'Rich', name: 'Mustard', value: '#a47d19' },
  { group: 'Rich', name: 'Forest', value: '#3f6a43' },
  { group: 'Rich', name: 'Petrol', value: '#2f6d70' },
  { group: 'Rich', name: 'Cobalt', value: '#3e5f96' },
  { group: 'Rich', name: 'Plum', value: '#694a83' },
  { group: 'Rich', name: 'Berry', value: '#8a4566' },
  { group: 'Rich', name: 'Charcoal', value: '#575b60' },
  { group: 'Bright', name: 'Coral', value: '#d75d54' },
  { group: 'Bright', name: 'Tangerine', value: '#df7a31' },
  { group: 'Bright', name: 'Sunflower', value: '#d5a91f' },
  { group: 'Bright', name: 'Leaf', value: '#5aa64d' },
  { group: 'Bright', name: 'Turquoise', value: '#35a59e' },
  { group: 'Bright', name: 'Azure', value: '#4b86c6' },
  { group: 'Bright', name: 'Violet', value: '#8264c7' },
  { group: 'Bright', name: 'Fuchsia', value: '#c35c94' },
  { group: 'Bright', name: 'Graphite', value: '#6b737d' }
];

export const defaultCategories = [
  { id: 'deep-work', name: 'Deep work', color: '#5f7084' },
  { id: 'admin', name: 'Admin', color: '#746e67' },
  { id: 'health', name: 'Health', color: '#5f755b' },
  { id: 'learning', name: 'Learning', color: '#716786' },
  { id: 'personal', name: 'Personal', color: '#9a704e' }
];
