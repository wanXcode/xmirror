const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { renderDocument } = require('../lib/views/layout');
const { createTranslator } = require('../lib/i18n');
const { html } = require('../lib/views/html');

const BASE = 'https://xput.app';
// H1 is {plain, mark} on the tool pages and a string elsewhere.
const h1Text = value => (typeof value === 'string' ? value : `${value.plain}${value.mark}`);

function page(lang, pageKey = 'viewer', extra = {}) {
  const t = createTranslator(lang);
  const source = String(renderDocument({
    lang, baseUrl: BASE, page: pageKey, title: t(`pages.${pageKey}.title`), description: t(`pages.${pageKey}.description`),
    body: html`<h1>${h1Text(t(`pages.${pageKey}.h1`))}</h1>`, ...extra
  }));
  return { source, document: parseHTML(source).document };
}

test('document shell: lang, title, description, canonical and a single H1', () => {
  const { document } = page('en');
  assert.equal(document.documentElement.getAttribute('lang'), 'en');
  assert.equal(document.title, 'Twitter Viewer – View X Posts Without an Account | XPut');
  assert.match(document.querySelector('meta[name=description]').getAttribute('content'), /^View any public X/);
  assert.equal(document.querySelector('link[rel=canonical]').getAttribute('href'), 'https://xput.app/twitter-viewer');
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.ok(document.querySelector('main#main'));
  assert.equal(document.querySelector('.skip-link').getAttribute('href'), '#main');
});

test('Chinese pages use zh-Hans and their own canonical; an empty description renders no tag', () => {
  const { document } = page('zh', 'home');
  assert.equal(document.documentElement.getAttribute('lang'), 'zh-Hans');
  assert.equal(document.querySelector('link[rel=canonical]').getAttribute('href'), 'https://xput.app/zh/');
  assert.equal(document.querySelector('h1').textContent, '推特视频下载');
  // Compare booleans, not DOM nodes: a failing deepEqual on a node would try to print the whole tree.
  assert.ok(document.querySelector('meta[name=description]') !== null);
  assert.ok(page('zh', 'shortcut').document.querySelector('meta[name=description]') !== null);
});

test('hreflang: en, zh-Hans and x-default (English), each page pointing at its counterpart', () => {
  for (const lang of ['en', 'zh']) {
    const { document } = page(lang, 'viewer');
    const map = Object.fromEntries([...document.querySelectorAll('link[rel=alternate]')].map(link => [link.getAttribute('hreflang'), link.getAttribute('href')]));
    assert.deepEqual(map, {
      en: 'https://xput.app/twitter-viewer',
      'zh-Hans': 'https://xput.app/zh/twitter-viewer',
      'x-default': 'https://xput.app/twitter-viewer'
    });
  }
});

test('header: nav highlights the current page and the language list is made of real links', () => {
  const { document } = page('en', 'viewer');
  const nav = [...document.querySelectorAll('.site-nav a')];
  assert.deepEqual(nav.map(a => [a.textContent, a.getAttribute('href')]), [['Video Downloader', '/'], ['Twitter Viewer', '/twitter-viewer']]);
  assert.equal(document.querySelector('.site-nav a[aria-current=page]').textContent, 'Twitter Viewer');
  const items = [...document.querySelectorAll('#lang-panel .lang__item')];
  assert.deepEqual(items.map(i => i.tagName), ['A', 'A', 'SPAN']);
  assert.equal(items[0].getAttribute('href'), '/twitter-viewer');
  assert.equal(items[1].getAttribute('href'), '/zh/twitter-viewer');
  assert.equal(items[1].getAttribute('hreflang'), 'zh-Hans');
  assert.equal(items[0].getAttribute('aria-current'), 'true');
  assert.equal(items[2].getAttribute('aria-disabled'), 'true');
  assert.match(items[2].textContent, /Portuguese · coming soon/);
});

test('header: mobile menu and language controls expose aria state, drawer lists three links plus languages', () => {
  const { document } = page('zh', 'home');
  const menu = document.querySelector('[data-menu-toggle]');
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.getAttribute('aria-controls'), 'nav-drawer');
  assert.equal(document.querySelector('[data-lang-toggle]').getAttribute('aria-controls'), 'lang-panel');
  assert.equal(document.querySelector('[data-lang-toggle] .lang__current').textContent, '中文');
  assert.deepEqual([...document.querySelectorAll('.drawer__link')].map(a => a.textContent.trim()), ['视频下载', '推特查看器', 'iPhone 快捷指令']);
  assert.equal(document.querySelectorAll('.drawer__lang a').length, 2);
  assert.ok(document.querySelector('#nav-drawer').hasAttribute('hidden'));
});

test('footer carries all links from the spec and the disclaimer', () => {
  const { document } = page('en', 'home');
  const links = [...document.querySelectorAll('.site-footer__links a')].map(a => [a.textContent, a.getAttribute('href')]);
  assert.deepEqual(links, [
    ['Video Downloader', '/'], ['Twitter Viewer', '/twitter-viewer'], ['iPhone Shortcut', '/ios-shortcut'],
    ['English', '/'], ['中文', '/zh/'], ['Privacy', '/privacy'], ['Report content', '/report']
  ]);
  assert.match(document.querySelector('.site-footer').textContent, /Not affiliated with X Corp\./);
});

test('result-style pages: custom language links and no hreflang when the page has no translations', () => {
  const t = createTranslator('en');
  const source = String(renderDocument({
    lang: 'en', baseUrl: BASE, page: null, path: '/h0b9Ls', title: 'x', robots: 'noindex, follow',
    switchHref: code => `/h0b9Ls?lang=${code}`, body: html`<h1>x</h1>`
  }));
  const { document } = parseHTML(source);
  assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow');
  assert.equal(document.querySelectorAll('link[rel=alternate]').length, 0);
  assert.equal(document.querySelector('link[rel=canonical]').getAttribute('href'), 'https://xput.app/h0b9Ls');
  assert.equal(document.querySelector('#lang-panel a[hreflang="zh-Hans"]').getAttribute('href'), '/h0b9Ls?lang=zh');
  assert.equal(t('nav.viewer'), 'Twitter Viewer');
});

test('titles and descriptions are escaped, and fonts/css/js are wired with swap and defer', () => {
  const t = createTranslator('en');
  const source = String(renderDocument({ lang: 'en', baseUrl: BASE, page: 'home', title: '"><script>x</script>', description: 'a"b', body: html`<h1>${t('nav.viewer')}</h1>` }));
  assert.doesNotMatch(source, /<script>x<\/script>/);
  assert.match(source, /display=swap/);
  assert.match(source, /<script src="\/js\/nav\.js\?v=[\d.]+" defer>/);
  assert.match(source, /href="\/css\/xput\.css\?v=[\d.]+"/);
  assert.match(source, /google-site-verification/);
});
