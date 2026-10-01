const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { renderDocument } = require('../lib/views/layout');
const { html } = require('../lib/views/html');
const { init } = require('../public/js/nav');

function setup({ phone = true } = {}) {
  const source = String(renderDocument({ lang: 'en', baseUrl: 'https://xput.app', page: 'home', title: 't', body: html`<h1>x</h1>` }));
  const { document, window } = parseHTML(source);
  const listeners = [];
  window.matchMedia = () => ({ matches: phone, addEventListener: (_e, fn) => listeners.push(fn) });
  const api = init(document, window);
  const q = sel => document.querySelector(sel);
  const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const key = k => {
    const event = new window.Event('keydown', { bubbles: true });
    event.key = k;
    document.dispatchEvent(event);
  };
  return { document, window, api, q, click, key, listeners };
}

test('menu button opens the drawer with the overlay, and the close button and Esc close it', () => {
  const { q, click, key, document } = setup();
  click(q('[data-menu-toggle]'));
  assert.equal(q('[data-drawer]').hidden, false);
  assert.equal(q('[data-overlay]').hidden, false);
  assert.equal(q('[data-menu-toggle]').getAttribute('aria-expanded'), 'true');
  assert.ok(document.documentElement.classList.contains('has-overlay'));
  click(q('[data-menu-close]'));
  assert.equal(q('[data-drawer]').hidden, true);
  assert.equal(q('[data-overlay]').hidden, true);
  assert.ok(!document.documentElement.classList.contains('has-overlay'));
  click(q('[data-menu-toggle]'));
  key('Escape');
  assert.equal(q('[data-drawer]').hidden, true);
  assert.equal(q('[data-menu-toggle]').getAttribute('aria-expanded'), 'false');
});

test('language button opens one panel at a time; on phones it uses the overlay, which closes it', () => {
  const { q, click } = setup({ phone: true });
  click(q('[data-lang-toggle]'));
  assert.equal(q('[data-lang-panel]').hidden, false);
  assert.equal(q('[data-overlay]').hidden, false);
  click(q('[data-menu-toggle]'));
  assert.equal(q('[data-lang-panel]').hidden, true);
  assert.equal(q('[data-drawer]').hidden, false);
  click(q('[data-overlay]'));
  assert.equal(q('[data-drawer]').hidden, true);
  assert.equal(q('[data-overlay]').hidden, true);
});

test('on desktop the language dropdown has no overlay and closes on an outside click or Esc', () => {
  const { q, click, key, document } = setup({ phone: false });
  click(q('[data-lang-toggle]'));
  assert.equal(q('[data-lang-panel]').hidden, false);
  assert.equal(q('[data-overlay]').hidden, true);
  click(q('#lang-panel a'));            // inside the panel: stays open
  assert.equal(q('[data-lang-panel]').hidden, false);
  click(document.body);
  assert.equal(q('[data-lang-panel]').hidden, true);
  click(q('[data-lang-toggle]'));
  key('Escape');
  assert.equal(q('[data-lang-panel]').hidden, true);
  assert.equal(q('[data-lang-toggle]').getAttribute('aria-expanded'), 'false');
});

test('init does nothing, safely, on a page without the header', () => {
  const { document, window } = parseHTML('<html><body><p>x</p></body></html>');
  assert.equal(init(document, window), null);
});
