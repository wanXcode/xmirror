const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    contains: item => values.has(item),
    toggle(item, force) { if (force) values.add(item); else values.delete(item); }
  };
}

function element({ textContent = '', classes = [] } = {}) {
  const attrs = {};
  return {
    textContent, innerHTML: '', disabled: false, classList: classList(classes),
    setAttribute(name, value) { attrs[name] = value; },
    getAttribute(name) { return attrs[name]; }
  };
}

function installDom({ dark = true } = {}) {
  const root = element();
  const origin = element({ textContent: 'Hello world', classes: ['active'] });
  const translated = element();
  const button = element();
  const status = element();
  const post = element();
  post.dataset = { postId: '1', sourceLang: 'en' };
  const elements = { originContent: origin, translatedContent: translated, translateBtn: button, translateStatus: status };
  let schemeListener;
  const scheme = { matches: dark, addEventListener(_name, listener) { schemeListener = listener; } };
  global.document = {
    readyState: 'loading', documentElement: root,
    getElementById: id => elements[id], querySelector: selector => selector === '.post' ? post : null,
    addEventListener() {}
  };
  global.window = { matchMedia: () => scheme };
  global.localStorage = { removed: [], removeItem(key) { this.removed.push(key); } };
  return { root, origin, translated, button, status, getSchemeListener: () => schemeListener };
}

test('page script is valid JavaScript and follows the system color scheme', () => {
  const dom = installDom({ dark: true });
  const page = require('../public/mirror-page');
  page.initializeMirrorPage();
  assert.equal(dom.root.getAttribute('data-theme'), 'dark');
  assert.deepEqual(global.localStorage.removed, ['xmirror-theme']);
  dom.getSchemeListener()({ matches: false });
  assert.equal(dom.root.getAttribute('data-theme'), 'light');
});

test('generated archive pages load the external page script', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /<script src="\/mirror-page\.js" defer><\/script>/);
  assert.doesNotMatch(serverSource, /function escapeTranslatedText\(value\).*replace\(\/\\n\/g/s);
});

test('translation click calls the API and renders a successful result', async () => {
  const dom = installDom({ dark: false });
  const page = require('../public/mirror-page');
  let requestedUrl;
  global.fetch = async url => {
    requestedUrl = url;
    return { ok: true, status: 200, json: async () => ({ success: true, blocks: [{ type: 'p', text: '你好' }] }) };
  };
  await page.toggleTranslate();
  assert.equal(requestedUrl, '/api/translate/1?targetLang=zh-CN');
  assert.equal(dom.translated.innerHTML, '<p>你好</p>');
  assert.equal(dom.translated.classList.contains('active'), true);
  assert.equal(dom.button.textContent, '📝 查看原文');
  assert.equal(dom.button.disabled, false);
  assert.equal(dom.button.getAttribute('aria-busy'), 'false');
  page.setTranslateStatus('');
});
