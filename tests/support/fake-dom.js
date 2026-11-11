// A small stand-in for the DOM, for features that only look elements up by selector, toggle them and listen to
// them (tests/personal-sync-feature.test.js, tests/sync-status.test.js). Elements are found by the exact selector
// the feature asks for; clicks run the listeners in order and resolve once they have.

export class FakeElement {
  constructor(name = 'element', { doc = null, tag = 'div' } = {}) {
    this.name = name;
    this.tagName = tag.toUpperCase();
    this.doc = doc;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.textContent = '';
    this.id = '';
    this.className = '';
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.parent = null;
    this.isConnected = true;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(item => classes.add(item)),
      remove: (...names) => names.forEach(item => classes.delete(item)),
      toggle: (item, force) => { const on = force ?? !classes.has(item); if (on) classes.add(item); else classes.delete(item); return on; },
      contains: item => classes.has(item)
    };
    const props = {};
    this.style = { setProperty: (key, value) => { props[key] = String(value); }, getPropertyValue: key => props[key] ?? '', removeProperty: key => { delete props[key]; } };
    // Markup written in: its buttons become children (class and data-* attributes), so they can be found and clicked.
    let html = '';
    Object.defineProperty(this, 'innerHTML', {
      get: () => html,
      set: value => {
        html = String(value);
        this.children = this.children.filter(child => !child.fromMarkup);
        for (const match of html.matchAll(/<button class="([^"]*)"([^>]*)>/g)) {
          const button = new FakeElement('button', { doc: this.doc, tag: 'button' });
          button.className = match[1];
          button.fromMarkup = true;
          for (const [, key, attr] of match[2].matchAll(/data-([a-z-]+)="([^"]*)"/g)) button.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attr;
          const name = Object.keys(button.dataset)[0];
          if (name) button.name = `[data-${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}]`;
          this.append(button);
        }
      }
    });
  }

  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; }
  removeAttribute(key) { delete this.attributes[key]; }
  hasAttribute(key) { return key in this.attributes; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); }
  /** Runs the listeners for `type`; returns what they returned (promises included), all settled. */
  dispatch(type, event = {}) {
    const full = { target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...event };
    return Promise.all((this.listeners[type] || []).map(fn => fn(full)));
  }
  click() { return this.dispatch('click'); }
  focus() { if (this.doc) this.doc.activeElement = this; }
  select() {}
  querySelector(selector) { return this.children.find(child => child.matches(selector)) || null; }
  querySelectorAll(selector) { return this.children.filter(child => child.matches(selector)); }
  matches(selector) { return selector.split(',').map(item => item.trim()).some(item => item === this.name || (item.startsWith('.') && this.className.split(' ').includes(item.slice(1)))); }
  closest(selector) {
    for (let node = this; node; node = node.parent) if (node.matches(selector)) return node;
    return null;
  }
  contains(node) {
    for (let current = node; current; current = current.parent) if (current === this) return true;
    return false;
  }
  append(...nodes) { nodes.forEach(node => { node.parent = this; node.isConnected = true; this.children.push(node); }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; this.isConnected = false; }
  getBoundingClientRect() { return { left: 900, top: 20, right: 1100, bottom: 54, width: 200, height: 34 }; }
}

/** A document whose querySelector finds what `make(selector)` registered. */
export function fakeDocument() {
  const registry = new Map();
  const doc = {
    activeElement: null,
    hidden: false,
    listeners: {},
    registry,
    documentElement: new FakeElement('html'),
    body: null,
    querySelector: selector => registry.get(selector) || null,
    querySelectorAll: selector => (registry.has(selector) ? [registry.get(selector)] : []),
    createElement: tag => new FakeElement(tag, { doc, tag }),
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); },
    make(selector, options = {}) {
      const element = new FakeElement(selector, { doc, ...options });
      registry.set(selector, element);
      return element;
    }
  };
  doc.body = new FakeElement('body', { doc });
  return doc;
}
