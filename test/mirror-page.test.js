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

function installDom({ dark = true, video = false } = {}) {
  const root = element();
  const origin = element({ textContent: 'Hello world', classes: ['active'] });
  const translated = element();
  const button = element();
  const status = element();
  const post = element();
  post.dataset = { postId: '1', sourceLang: 'en' };
  let placeholder;
  if (video) {
    const title = element();
    const bar = element();
    bar.style = {};
    const progressText = element();
    placeholder = element();
    placeholder.dataset = { videoStatus: 'downloading' };
    placeholder.querySelector = selector => ({
      '.video-placeholder-title': title,
      '.video-progress-bar': bar,
      '.video-progress-text': progressText
    }[selector] || null);
    placeholder.outerHTML = '';
  }
  const elements = { originContent: origin, translatedContent: translated, translateBtn: button, translateStatus: status };
  let schemeListener;
  const scheme = { matches: dark, addEventListener(_name, listener) { schemeListener = listener; } };
  global.document = {
    readyState: 'loading', documentElement: root,
    getElementById: id => elements[id], querySelector: selector => selector === '.post' ? post : (selector === '.video-placeholder' ? placeholder : null),
    addEventListener() {}
  };
  global.window = { matchMedia: () => scheme };
  global.localStorage = { removed: [], removeItem(key) { this.removed.push(key); } };
  return { root, origin, translated, button, status, placeholder, getSchemeListener: () => schemeListener };
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
  assert.match(serverSource, /\/api\/posts\/:id\/subtitles/);
  assert.match(serverSource, /subtitleSelect/);
  assert.doesNotMatch(serverSource, /function escapeTranslatedText\(value\).*replace\(\/\\n\/g/s);
});

test('home and archive pages advertise the shared site icon', () => {
  const projectRoot = path.join(__dirname, '..');
  const homeSource = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');

  for (const source of [homeSource, serverSource]) {
    assert.match(source, /<link rel="icon" href="\/favicon\.svg\?v=2" type="image\/svg\+xml">/);
    assert.match(source, /<link rel="icon" href="\/favicon-16x16\.png\?v=2" sizes="16x16" type="image\/png">/);
    assert.match(source, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png\?v=2">/);
    assert.match(source, /<link rel="mask-icon" href="\/safari-pinned-tab\.svg\?v=2" color="#667eea">/);
    assert.match(source, /<link rel="manifest" href="\/site\.webmanifest\?v=2">/);
  }

  for (const asset of [
    'favicon.svg',
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'favicon-192x192.png',
    'favicon-512x512.png',
    'safari-pinned-tab.svg'
  ]) {
    assert.equal(fs.existsSync(path.join(projectRoot, 'public', asset)), true, `${asset} should exist`);
  }
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

test('video status polling replaces the placeholder only with a local video', async () => {
  const dom = installDom({ dark: false, video: true });
  const page = require('../public/mirror-page');
  let requestedUrl;
  global.fetch = async url => {
    requestedUrl = url;
    return { ok: true, status: 200, json: async () => ({
      success: true, status: 'completed', percent: 100, video: '/videos/1_video.mp4'
    }) };
  };
  const done = await page.pollVideoStatus();
  assert.equal(done, true);
  assert.equal(requestedUrl, '/api/posts/1/video-status');
  assert.match(dom.placeholder.outerHTML, /source src="\/videos\/1_video\.mp4"/);
});

test('video status polling does not inject a remote video URL', async () => {
  const dom = installDom({ dark: false, video: true });
  const page = require('../public/mirror-page');
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    success: true, status: 'completed', percent: 100, video: 'https://video.twimg.com/unsafe.mp4'
  }) });
  const done = await page.pollVideoStatus();
  assert.equal(done, true);
  assert.equal(dom.placeholder.outerHTML, '');
});
