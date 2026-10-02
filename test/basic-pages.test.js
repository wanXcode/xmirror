const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { parseHTML } = require('linkedom');
const sqlite3 = require('sqlite3');
const { qrSvg } = require('../lib/qr');
const { RENDERERS } = require('../lib/routes/pages');
const copyLink = require('../public/js/copy-link');
const report = require('../public/js/report');
const en = require('../lib/content/en');
const zh = require('../lib/content/zh');

const ICLOUD = 'https://www.icloud.com/shortcuts/e2c41e2726044bc38dc57c8fbd45c734';

// ---------- server (one per file) ----------
const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) await fn(); });
let shared;
const server = () => (shared ||= start());
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-basic-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ARCHIVES_DIR: path.join(dir, 'archives'), SQLITE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_BASE_URL: 'https://xput.app', MODERATION_ADMIN_TOKEN: 'test-only-token' };
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanups.push(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const db = new sqlite3.Database(env.SQLITE_PATH);
  cleanups.push(() => new Promise(resolve => db.close(resolve)));
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, error => (error ? reject(error) : resolve())));
  return { base, run };
}
const doc = async (base, route, headers = {}) => {
  const response = await fetch(base + route, { headers, redirect: 'manual' });
  const text = await response.text();
  return { response, text, document: parseHTML(text).document };
};

// ---------- QR ----------
test('QR code: inline SVG, deterministic, different links differ, label is escaped', () => {
  const svg = qrSvg(ICLOUD, { label: 'Scan "me" <now>' });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.ok(svg.includes('role="img" aria-label="Scan &quot;me&quot; &lt;now&gt;"'));
  assert.equal(svg, qrSvg(ICLOUD, { label: 'Scan "me" <now>' }));
  assert.notEqual(qrSvg(ICLOUD), qrSvg(`${ICLOUD}x`));
  assert.ok(qrSvg(ICLOUD).includes('aria-hidden="true"'), 'no label means decorative');
  assert.ok(!/<script|<image|href=/.test(svg));
});

// ---------- shortcut page ----------
test('shortcut page (en): H1, QR for the iCloud link, phone button, steps, banner, FAQ with answers', { timeout: 60000 }, async () => {
  const s = await server();
  const { response, document, text } = await doc(s.base, '/ios-shortcut');
  assert.equal(response.status, 200);
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.equal(document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim(), 'Save X videos on iPhone in one tap');
  assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'index, follow');
  assert.equal(document.querySelector('meta[name=description]').getAttribute('content'), en.pages.shortcut.description);
  assert.ok(document.querySelector('svg.qr'), 'QR code');
  const hrefs = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  assert.equal(hrefs.filter(href => href === ICLOUD).length, 2, 'phone button and desktop "Open iCloud link"');
  assert.equal(document.querySelector('[data-copy]').getAttribute('data-copy'), ICLOUD);
  assert.equal(document.querySelectorAll('.step').length, 3);
  assert.equal(document.querySelectorAll('.faq details').length, 5);
  assert.ok([...document.querySelectorAll('.faq p')].every(p => p.textContent.trim().length > 20), 'every FAQ item has an answer');
  assert.ok(hrefs.includes('/'), 'banner links to the downloader');
  assert.ok(text.includes('/js/copy-link.js'));
});

test('shortcut page (zh): Chinese copy, hreflang pair', { timeout: 60000 }, async () => {
  const s = await server();
  const { document } = await doc(s.base, '/zh/ios-shortcut');
  assert.equal(document.querySelector('html').getAttribute('lang'), 'zh-Hans');
  assert.equal(document.querySelector('h1').textContent.replace(/\s+/g, ''), '在iPhone上一键保存X视频');
  assert.equal(document.title, 'iPhone 一键保存推特视频 – XPut 快捷指令');
  const alternates = [...document.querySelectorAll('link[rel=alternate]')].map(l => `${l.getAttribute('hreflang')} ${l.getAttribute('href')}`);
  assert.ok(alternates.includes('en https://xput.app/ios-shortcut'));
  assert.ok(alternates.includes('zh-Hans https://xput.app/zh/ios-shortcut'));
  assert.ok(document.querySelector('.get__title').textContent.includes('扫码'));
});

test('copy-link script: copies the value, confirms, clears the confirmation', async () => {
  const { document, window } = parseHTML(`<div data-copy-root data-copied="Copied"><button data-copy="https://x.test/a">Copy</button><p data-copy-status></p></div>`);
  const written = []; const timers = []; 
  assert.equal(copyLink.init(document, { clipboard: { writeText: async value => { written.push(value); } } }, { setTimeout: fn => timers.push(fn) }), 1);
  document.querySelector('button').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(written, ['https://x.test/a']);
  assert.equal(document.querySelector('[data-copy-status]').textContent, 'Copied');
  timers[0]();
  assert.equal(document.querySelector('[data-copy-status]').textContent, '');
});

// ---------- privacy ----------
test('privacy page: one H1, TOC anchors match sections, short version, link to the report page; zh too', { timeout: 60000 }, async () => {
  const s = await server();
  for (const [route, copy, reportHref] of [['/privacy', en, '/report'], ['/zh/privacy', zh, '/zh/report']]) {
    const { response, document, text } = await doc(s.base, route);
    assert.equal(response.status, 200, route);
    assert.equal(document.querySelectorAll('h1').length, 1);
    const ids = [...document.querySelectorAll('.legal__section')].map(node => node.getAttribute('id'));
    assert.equal(ids.length, copy.pages.privacy.sections.length);
    const toc = [...document.querySelectorAll('.legal__toc a')].map(a => a.getAttribute('href').slice(1));
    assert.deepEqual(toc, ids);
    assert.equal(document.querySelectorAll('.legal__short li').length, 4);
    assert.ok([...document.querySelectorAll('.legal__section a')].some(a => a.getAttribute('href') === reportHref));
    assert.ok(!/\[(Paragraph|date|time)/.test(text), 'no placeholder text left');
    assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'index, follow');
  }
});

// ---------- report ----------
test('report page: form fields, reasons, steps, noindex; zh; no placeholders', { timeout: 60000 }, async () => {
  const s = await server();
  for (const [route, copy] of [['/report', en], ['/zh/report', zh]]) {
    const { response, document, text } = await doc(s.base, route);
    assert.equal(response.status, 200);
    assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow');
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.equal(document.querySelectorAll('input[name=reason]').length, 4);
    assert.equal(document.querySelector('input[name=reason]:checked').getAttribute('value'), 'author');
    for (const name of ['url', 'contact', 'details', 'confirm', 'website']) assert.ok(document.querySelector(`[name=${name}]`), name);
    assert.equal(document.querySelectorAll('.next__list li').length, 3);
    assert.ok(!/\[time\]|\{time\}/.test(text));
    assert.ok(text.includes(copy.pages.report.time));
    assert.ok(text.includes('/js/report.js'));
  }
});

test('report client: payload mapping, validation, success, and error statuses', async () => {
  const { document, window } = parseHTML(String(RENDERERS.report({ t: require('../lib/i18n').createTranslator('en'), lang: 'en' })));
  const reasons = en.pages.report.form.reasons;
  const payload = report.buildPayload({ url: ' https://xput.app/Ab1234 ', reason: 'copyright', reasonLabel: 'Copyright infringement (DMCA)', details: ' my work ', contact: 'a@b.co', website: '' }, reasons);
  assert.deepEqual(payload, { url: 'https://xput.app/Ab1234', kind: 'copyright', reason: '[copyright] Copyright infringement (DMCA) — my work', contact: 'a@b.co', website: '' });
  assert.equal(report.buildPayload({ reason: 'zzz', url: '', contact: '' }, reasons).kind, 'other', 'unknown reason falls back to other');
  assert.ok(report.buildPayload({ reason: 'other', reasonLabel: '其他' }, reasons).reason.length >= 10, 'short zh labels still pass the server minimum');

  const calls = [];
  let next = { status: 201, body: { success: true, id: 42 } };
  const fakeWin = { location: { search: '?post=Ab1234', origin: 'https://xput.app' }, URLSearchParams };
  const api = report.init(document, fakeWin, async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { status: next.status, json: async () => next.body }; });
  assert.equal(document.querySelector('[name=url]').value, 'https://xput.app/Ab1234', 'prefilled from ?post=');
  const form = document.querySelector('[data-report-form]');
  const status = document.querySelector('[data-status]');
  const submit = () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); return new Promise(resolve => setTimeout(resolve, 20)); };

  await submit();
  assert.equal(calls.length, 0, 'email and confirmation are required');
  assert.equal(status.textContent, en.pages.report.result.invalid);
  assert.ok(status.classList.contains('is-error'));

  form.querySelector('[name=contact]').value = 'me@example.com';
  form.querySelector('[name=confirm]').checked = true;
  form.querySelector('[name=details]').value = 'please remove';
  await submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/reports');
  assert.equal(calls[0].body.kind, 'other');
  assert.ok(calls[0].body.reason.startsWith('[author] '));
  assert.ok(status.textContent.includes('42'));
  assert.ok(!status.classList.contains('is-error'));
  assert.equal(document.querySelector('[data-submit]').disabled, false);

  for (const [code, key] of [[404, 'notFound'], [429, 'tooMany'], [400, 'invalid'], [500, 'failed']]) {
    next = { status: code, body: {} };
    form.querySelector('[name=contact]').value = 'me@example.com'; form.querySelector('[name=confirm]').checked = true; form.querySelector('[name=url]').value = 'x';
    await submit();
    assert.equal(status.textContent, en.pages.report.result[key], String(code));
  }
});

test('/api/reports accepts the original X post link and the XPut link', { timeout: 60000 }, async () => {
  const s = await server();
  await s.run("INSERT INTO posts(id,url,short_code,author,author_handle,content,images,video_status) VALUES(9001,'https://x.com/i/status/777001','Rp0001','A','a','hi','[]','none')");
  const post = body => fetch(`${s.base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'other', reason: '[author] please remove this copy', contact: 'a@b.co', ...body }) });
  assert.equal((await post({ url: 'https://xput.app/Rp0001' })).status, 201);
  assert.equal((await post({ url: 'https://x.com/jack/status/777001?s=20' })).status, 201);
  assert.equal((await post({ url: 'https://x.com/jack/status/555' })).status, 404, 'no saved copy of that post');
  assert.equal((await post({ url: 'https://example.com/x' })).status, 400);
});

// ---------- 404 ----------
test('unknown paths get a friendly localized 404 page with the finder; API and assets get plain 404s', { timeout: 60000 }, async () => {
  const s = await server();
  const en404 = await doc(s.base, '/no/such/page');
  assert.equal(en404.response.status, 404);
  assert.equal(en404.document.querySelector('h1').textContent, 'Page not found');
  assert.equal(en404.document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow');
  assert.ok(en404.document.querySelector('[data-finder]'));
  const zh404 = await doc(s.base, '/zh/nothing-here');
  assert.equal(zh404.response.status, 404);
  assert.equal(zh404.document.querySelector('h1').textContent, '页面未找到');
  const cookie = await doc(s.base, '/missing', { cookie: 'xput_lang=zh' });
  assert.equal(cookie.document.querySelector('h1').textContent, '页面未找到');
  for (const route of ['/api/nope', '/images/none.jpg', '/js/none.js']) {
    const response = await fetch(s.base + route);
    assert.equal(response.status, 404, route);
    assert.ok(!(response.headers.get('content-type') || '').includes('html'), route);
  }
  assert.equal((await fetch(`${s.base}/archives/x.html`, { redirect: 'manual' })).status, 404);
});

test('every page carries Organization JSON-LD; sitemap index and robots.txt are served', { timeout: 60000 }, async () => {
  const s = await server();
  for (const route of ['/', '/zh/', '/privacy', '/report', '/nope']) {
    const { document } = await doc(s.base, route);
    const types = [...document.querySelectorAll('script[type="application/ld+json"]')].map(n => JSON.parse(n.textContent)['@type']);
    assert.ok(types.includes('Organization'), route);
  }
  const index = await (await fetch(`${s.base}/sitemap.xml`)).text();
  assert.deepEqual([...index.matchAll(/<loc>([^<]+)/g)].map(m => m[1]), ['https://xput.app/sitemap-main.xml', 'https://xput.app/sitemap-copies-1.xml']);
  assert.match(await (await fetch(`${s.base}/sitemap-main.xml`)).text(), /xhtml:link/);
  assert.equal((await fetch(`${s.base}/sitemap-copies-2.xml`)).status, 404);
  assert.equal((await fetch(`${s.base}/sitemap-copies-x.xml`)).status, 404);
  assert.match(await (await fetch(`${s.base}/robots.txt`)).text(), /Sitemap: https:\/\/xput.app\/sitemap.xml/);
});

test('site settings: analytics domain/script, analytics name and contact email come from config or env', () => {
  const { renderDocument } = require('../lib/views/layout');
  const { html } = require('../lib/views/html');
  const { createTranslator } = require('../lib/i18n');
  const saved = { ...process.env };
  const render = (page, lang = 'en') => parseHTML(String(page === 'doc'
    ? renderDocument({ lang, baseUrl: BASE_URL, page: 'home', title: 't', body: html`<h1>x</h1>` })
    : `<html><body>${RENDERERS[page]({ t: createTranslator(lang), lang })}</body></html>`)).document;
  const BASE_URL = 'https://xput.app';
  try {
    for (const key of ['ANALYTICS_DOMAIN', 'ANALYTICS_SRC', 'ANALYTICS_NAME', 'CONTACT_EMAIL']) delete process.env[key];
    let script = render('doc').querySelector('script[data-domain]');
    assert.equal(script.getAttribute('data-domain'), 'xput.app', 'domain is xput.app, not xmirror.app');
    process.env.ANALYTICS_SRC = 'https://stats.example/js/s.js'; process.env.ANALYTICS_DOMAIN = 'example.test';
    script = render('doc').querySelector('script[data-domain]');
    assert.deepEqual([script.getAttribute('data-domain'), script.getAttribute('src')], ['example.test', 'https://stats.example/js/s.js']);
    process.env.ANALYTICS_SRC = '';
    assert.equal(render('doc').querySelector('script[data-domain]'), null, 'empty script URL turns analytics off');

    let privacy = render('privacy'); let report = render('report');
    assert.ok(privacy.body.textContent.includes('a privacy-friendly analytics tool'));
    assert.equal(privacy.querySelector('a[href^="mailto:"]'), null);
    assert.equal(report.querySelector('a[href^="mailto:"]'), null);
    process.env.ANALYTICS_NAME = 'Plausible'; process.env.CONTACT_EMAIL = 'help@example.test';
    privacy = render('privacy'); report = render('report', 'zh');
    assert.ok(privacy.body.textContent.includes('We also use Plausible to count visits'));
    assert.equal(privacy.querySelector('.legal__section#contact a[href="mailto:help@example.test"]').textContent, 'help@example.test');
    assert.ok(privacy.querySelector('#contact').textContent.includes('copyright complaints and removal requests'));
    assert.equal(report.querySelector('.report__intro a[href="mailto:help@example.test"]').textContent, 'help@example.test');
    assert.ok(report.querySelector('.report__intro').textContent.includes('版权投诉和删除请求'));
  } finally {
    for (const key of ['ANALYTICS_DOMAIN', 'ANALYTICS_SRC', 'ANALYTICS_NAME', 'CONTACT_EMAIL']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('zh meta descriptions for the home and viewer pages are the approved copy', () => {
  assert.equal(zh.pages.home.description, '免费在线下载推特（X）高清视频，支持 MP4、图片和 GIF。无需登录、无弹窗，粘贴链接即可保存到手机或电脑。');
  assert.equal(zh.pages.viewer.description, '免登录、匿名查看任何公开的 X（推特）帖子。原帖被删除后，保存过的链接依然可以打开。');
});
