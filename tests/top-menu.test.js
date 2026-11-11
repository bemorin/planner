import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { arrowIndex, setupTopMenu, trappedIndex } from '../welcome/top-menu.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// The public pages whose top bar hides its section links below 960px, and the script that sets the bar up.
const PAGES = [
  { file: 'welcome/index.html', script: 'welcome/landing.js', label: 'Sections' },
  { file: 'contact/index.html', script: 'contact/contact.js', label: 'Sections' }
];
const MENU_BUTTON = '<button class="top__menu" type="button" aria-label="Menu" aria-expanded="false" aria-controls="top-nav" data-top-menu><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 8.5h15"/><path d="M4.5 15.5h15"/></svg></button>';

test('Tab stays inside the open menu, wrapping both ways', () => {
  assert.equal(trappedIndex(0, 4), 1);
  assert.equal(trappedIndex(3, 4), 0, 'from the last link back to the button');
  assert.equal(trappedIndex(0, 4, true), 3, 'Shift+Tab from the button to the last link');
  assert.equal(trappedIndex(2, 4, true), 1);
  assert.equal(trappedIndex(-1, 4), 0, 'focus elsewhere: the first stop');
  assert.equal(trappedIndex(-1, 4, true), 3, 'or the last one going back');
  assert.equal(trappedIndex(0, 0), -1, 'nothing to focus');
});

test('the arrow keys, Home and End move between the menu’s links', () => {
  assert.equal(arrowIndex('ArrowDown', 0, 7), 1);
  assert.equal(arrowIndex('ArrowDown', 6, 7), 0, 'wraps to the first');
  assert.equal(arrowIndex('ArrowUp', 0, 7), 6, 'and to the last');
  assert.equal(arrowIndex('ArrowDown', -1, 7), 0, 'from the button: the first link');
  assert.equal(arrowIndex('ArrowUp', -1, 7), 6);
  assert.equal(arrowIndex('Home', 4, 7), 0);
  assert.equal(arrowIndex('End', 1, 7), 6);
  assert.equal(arrowIndex('Enter', 1, 7), -1, 'any other key is left alone');
  assert.equal(arrowIndex('ArrowDown', 0, 0), -1);
});

test('every public page whose top bar hides its links on a phone has the Menu button, and only those', () => {
  for (const { file, script, label } of PAGES) {
    const page = read(file);
    const top = /<header class="top" data-top>[\s\S]*?<\/header>/.exec(page)?.[0];
    assert.ok(top, `${file}: the bar is set up by setupTopBar (data-top)`);
    assert.match(top, new RegExp(`<nav class="top__nav" id="top-nav" aria-label="${label}">`), `${file}: the links the menu opens`);
    const actions = /<div class="top__actions">([\s\S]*?)\n {6}<\/div>/.exec(top)[1];
    assert.ok(actions.trim().endsWith(MENU_BUTTON), `${file}: the Menu button, last in the bar`);
    assert.equal(page.split('data-top-menu').length, 2, `${file}: one menu`);
    // The menu opens the bar's own links: nothing is written twice.
    assert.equal(page.split('id="top-nav"').length, 2);
    assert.match(read(script), /^ *setupTopBar\(\);$/m, `${script} sets up the bar, and with it the menu`);
  }
});

test('the Menu button and its panel exist below 960px only, never on a desktop; motion only when welcome', () => {
  const css = read('welcome/landing.css');
  assert.match(css, /@media \(min-width: 960px\) \{\n {2}\.top__menu \{ display: none; \}\n\}/, 'no Menu button on a desktop');
  assert.match(css, /@media \(min-width: 960px\) \{\n {2}\.top__nav \{ display: flex; margin-right: 8px; \}/, 'where the links sit in the bar');
  const panel = /\n@media \(max-width: 959\.98px\) \{\n {2}\.top__nav \{[\s\S]*?\n\}\n/.exec(css)?.[0] || '';
  assert.ok(panel, 'the panel, below 960px only');
  assert.match(panel, /\.top\.is-menu-open \.top__nav \{ display: flex; \}/);
  assert.match(panel, /\.top::after \{ content: ""; position: absolute;[^}]*background: var\(--scrim\);/, 'over a scrim that belongs to the bar');
  assert.match(css, /\.top__menu:not\(\.is-ready\) \{ visibility: hidden; \}/, 'its room kept from the first paint: nothing moves when it shows');
  assert.match(css, /html\.has-menu \{ overflow: hidden; padding-right: var\(--scrollbar-gap, 0px\); \}/, 'the page under it doesn’t scroll');
  const motion = /@media \(prefers-reduced-motion: no-preference\) \{\n {2}\.top__nav,\n {2}\.top::after \{ transition:[^}]*\}\n {2}\.top__menu path \{ transition:[^}]*\}\n\}/.exec(css);
  assert.ok(motion, 'it fades and slides only when motion is welcome');
  // No shortcut beside the bar's button any more (the Teams page's, until 1.38): nothing to make room for.
  assert.doesNotMatch(css, /\.top__teams/);
  // The script's desktop is the stylesheet's.
  assert.match(read('welcome/top-menu.js'), /const DESKTOP = '\(min-width: 960px\)';/);
  const kit = read('welcome/page-kit.js');
  assert.match(kit, /import \{ setupTopMenu \} from '\.\/top-menu\.js';/);
  assert.match(kit, /const top = qs\('\[data-top\]'\);\n {2}if \(!top\) return;\n {2}setupTopMenu\(top\);/);
});

/* A small stand-in for the DOM: enough for the menu to open, trap focus and close. */
function fakePage({ desktop = false, reduce = true } = {}) {
  const listeners = new Map();
  const on = (owner, type, fn) => { const key = `${owner.id}:${type}`; listeners.set(key, [...(listeners.get(key) || []), fn]); };
  const off = (owner, type, fn) => { const key = `${owner.id}:${type}`; listeners.set(key, (listeners.get(key) || []).filter(item => item !== fn)); };
  let ids = 0;
  const doc = { activeElement: null };
  class Node {
    constructor(tag, attrs = {}, children = []) {
      this.id = `n${(ids += 1)}`;
      this.tagName = tag.toUpperCase();
      this.attrs = { ...attrs };
      this.children = [];
      this.parent = null;
      this.inert = false;
      this.names = new Set();
      this.style = { values: {}, setProperty: (name, value) => { this.style.values[name] = value; }, removeProperty: name => { delete this.style.values[name]; } };
      this.classList = { add: (...names) => names.forEach(name => this.names.add(name)), remove: (...names) => names.forEach(name => this.names.delete(name)), contains: name => this.names.has(name) };
      children.forEach(child => { child.parent = this; this.children.push(child); });
    }
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    contains(other) { for (let node = other; node; node = node.parent) if (node === this) return true; return false; }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    matches(selector) { return selector === 'a[href]' ? this.tagName === 'A' && 'href' in this.attrs : selector === '[data-top-menu]' ? 'data-top-menu' in this.attrs : false; }
    querySelector(selector) { return this.all().find(node => node.matches(selector)) || null; }
    querySelectorAll(selector) { return this.all().filter(node => node.matches(selector)); }
    closest(selector) { for (let node = this; node; node = node.parent) if (node.matches?.(selector)) return node; return null; }
    focus() { doc.activeElement = this; }
    addEventListener(type, fn) { on(this, type, fn); }
    removeEventListener(type, fn) { off(this, type, fn); }
  }
  const links = ['#how', '#year', '#open'].map(href => new Node('a', { href }));
  const nav = new Node('nav', { id: 'top-nav' }, links);
  const button = new Node('button', { 'data-top-menu': '', 'aria-controls': 'top-nav', 'aria-expanded': 'false' });
  const top = new Node('header', {}, [new Node('div', {}, [new Node('a', { href: '#top' }), nav, new Node('div', {}, [button])])]);
  const main = new Node('main');
  const footer = new Node('footer');
  const script = new Node('script');
  const body = new Node('body', {}, [top, main, footer, script]);
  const html = new Node('html', {}, [body]);
  html.clientWidth = 360;
  const emit = (owner, type, event = {}) => {
    const full = { preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false, ...event };
    (listeners.get(`${owner.id}:${type}`) || []).forEach(fn => fn(full));
    return full;
  };
  Object.assign(doc, { body, documentElement: html, getElementById: id => html.all().find(node => node.attrs.id === id) || null, addEventListener: (type, fn) => on(doc, type, fn), removeEventListener: (type, fn) => off(doc, type, fn), id: 'doc' });
  const media = { desktop: { matches: desktop, addEventListener: (type, fn) => on(media.desktop, type, fn), id: 'desktop' }, reduce: { matches: reduce } };
  const win = { id: 'win', innerWidth: 360, matchMedia: query => (query.includes('960') ? media.desktop : media.reduce), setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, addEventListener: (type, fn) => on(win, type, fn) };
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.requestAnimationFrame = fn => fn();
  return { doc, win, top, nav, links, button, main, footer, script, html, media, emit };
}

test('the menu opens the bar’s links, keeps focus and the page out of reach, and gives everything back on close', () => {
  const page = fakePage();
  const menu = setupTopMenu(page.top);
  assert.ok(page.button.classList.contains('is-ready'), 'shown once it works');
  assert.equal(menu.open, false);

  page.emit(page.button, 'click');
  assert.equal(menu.open, true);
  assert.equal(page.button.getAttribute('aria-expanded'), 'true');
  assert.ok(page.top.classList.contains('is-menu-open') && page.top.classList.contains('is-menu-shown'));
  assert.ok(page.html.classList.contains('has-menu'), 'the page doesn’t scroll under it');
  assert.equal(page.doc.activeElement, page.links[0], 'focus on the first link');
  assert.deepEqual([page.main.inert, page.footer.inert, page.script.inert, page.top.inert], [true, true, false, false], 'only the page under it is out of reach');

  // Tab goes round the links and the button; the arrows move between the links.
  const tab = shiftKey => page.emit(page.doc, 'keydown', { key: 'Tab', shiftKey });
  tab(); tab();
  assert.equal(page.doc.activeElement, page.links[2]);
  assert.ok(tab().defaultPrevented);
  assert.equal(page.doc.activeElement, page.button, 'from the last link to the button');
  tab(true);
  assert.equal(page.doc.activeElement, page.links[2]);
  page.emit(page.doc, 'keydown', { key: 'Home' });
  assert.equal(page.doc.activeElement, page.links[0]);
  page.emit(page.doc, 'keydown', { key: 'ArrowUp' });
  assert.equal(page.doc.activeElement, page.links[2]);
  assert.equal(page.emit(page.doc, 'keydown', { key: 'a' }).defaultPrevented, false, 'other keys are left alone');

  // Escape closes it and focus returns to the button.
  page.emit(page.doc, 'keydown', { key: 'Escape' });
  assert.equal(menu.open, false);
  assert.equal(page.button.getAttribute('aria-expanded'), 'false');
  assert.ok(!page.top.classList.contains('is-menu-open') && !page.top.classList.contains('is-menu-shown'));
  assert.ok(!page.html.classList.contains('has-menu'));
  assert.equal(page.html.style.values['--scrollbar-gap'], undefined);
  assert.deepEqual([page.main.inert, page.footer.inert], [false, false]);
  assert.equal(page.doc.activeElement, page.button);
  assert.equal(page.emit(page.doc, 'keydown', { key: 'Tab' }).defaultPrevented, false, 'Tab is free again once closed');
});

test('a link, a tap outside, the button again or a desktop-wide window close the menu', () => {
  const page = fakePage();
  const menu = setupTopMenu(page.top);
  page.emit(page.button, 'click');
  page.emit(page.nav, 'click', { target: page.links[1] });
  assert.equal(menu.open, false, 'a link leads on');

  page.emit(page.button, 'click');
  page.emit(page.doc, 'pointerdown', { target: page.links[0] });
  assert.equal(menu.open, true, 'a tap inside keeps it open');
  page.emit(page.doc, 'pointerdown', { target: page.top });
  assert.equal(menu.open, false, 'a tap on the scrim closes it');
  assert.equal(page.doc.activeElement, page.button, 'focus was inside: back to the button');

  page.emit(page.button, 'click');
  page.emit(page.button, 'click');
  assert.equal(menu.open, false, 'the button toggles it');

  page.emit(page.button, 'click');
  page.media.desktop.matches = true;
  page.emit(page.media.desktop, 'change');
  assert.equal(menu.open, false, 'the desktop bar shows the links itself');
  page.emit(page.button, 'click');
  assert.equal(menu.open, false, 'and never opens there');

  page.media.desktop.matches = false;
  page.emit(page.button, 'click');
  page.emit(page.win, 'pagehide');
  assert.equal(menu.open, false, 'a page kept in memory comes back closed');
});

test('a page without the menu’s markup is left alone', () => {
  const page = fakePage();
  page.button.attrs['aria-controls'] = 'elsewhere';
  assert.equal(setupTopMenu(page.top), null);
  assert.equal(setupTopMenu(null), null);
  assert.ok(!page.button.classList.contains('is-ready'), 'its button never shows');
});
