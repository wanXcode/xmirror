const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { renderDocument } = require('../lib/views/layout');
const { renderPost } = require('../lib/views/pages/post');
const { buildPostView } = require('../lib/post-view');
const { createTranslator } = require('../lib/i18n');
const { initPostPage } = require('../public/js/post-page');

const row = (extra = {}) => ({
  id: 7, short_code: 'Ab1234', url: 'https://x.com/i/status/20', author: 'Jack', author_handle: 'jack', content: 'hello',
  images: '["/images/a.jpg","/images/b.jpg"]', video: '/videos/v.mp4', video_status: 'completed',
  tweet_time: '2026-09-30T10:00:00.000Z', created_at: '2026-10-01 09:00:00', ...extra
});

function reply(status, body) { return { ok: status < 300, status, json: async () => body, headers: { get: () => null } }; }

function setup({ lang = 'en', post = {}, routes = {}, nav = {}, phone = false, ageConfirmed = true } = {}) {
  const t = createTranslator(lang);
  const view = buildPostView(row(post));
  const source = String(renderDocument({ lang, baseUrl: 'https://xput.app', page: null, path: '/Ab1234', title: 't',
    body: renderPost({ t, lang, view, downloadBase: '/dl', ageConfirmed, shareUrl: 'https://xput.app/Ab1234', title: 'Jack on X' }) }));
  const { document, window } = parseHTML(source);
  const calls = [];
  const timeouts = [];
  const intervals = [];
  const reloads = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    const handler = routes[url];
    if (!handler) return reply(200, { sizes: {}, success: true });
    return typeof handler === 'function' ? handler() : handler;
  };
  const timers = {
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    clearInterval: id => { intervals[id - 1] = null; }
  };
  const page = initPostPage({
    doc: document, win: window, fetch, timers, nav, isPhone: () => phone, reload: () => reloads.push(1),
    result: { File, saveBlob: () => {} }
  });
  const q = sel => document.querySelector(sel);
  const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  return { document, window, page, q, click, flush, calls, timeouts, intervals, reloads };
}

test('desktop: Copy link copies the page URL, shows the confirmation, counts the share and then restores itself', async () => {
  const written = [];
  const s = setup({ nav: { clipboard: { writeText: async value => { written.push(value); } } } });
  const button = s.q('[data-share]');
  assert.equal(s.q('[data-toast]').hidden, true);
  s.click(button);
  await s.flush();
  assert.deepEqual(written, ['https://xput.app/Ab1234']);
  assert.equal(button.textContent, 'Link copied');
  assert.ok(button.classList.contains('is-copied'));
  assert.equal(s.q('[data-toast]').hidden, false);
  assert.match(s.q('[data-toast]').textContent, /Link copied — paste it anywhere to share/);
  assert.deepEqual(s.calls.filter(c => c.url === '/api/posts/Ab1234/share').length, 1);
  s.timeouts.at(-1).fn();
  assert.ok(!button.classList.contains('is-copied'));
  assert.equal(s.q('[data-toast]').hidden, true);
  assert.match(button.textContent, /Copy link/);
});

test('phone: Share link opens the system share sheet with the page URL; cancelling does nothing', async () => {
  const shared = [];
  const s = setup({ phone: true, nav: { share: async data => { shared.push(data); } } });
  s.click(s.q('[data-share]'));
  await s.flush();
  assert.deepEqual(shared, [{ title: 'Jack on X', url: 'https://xput.app/Ab1234' }]);
  assert.equal(s.calls.filter(c => c.url === '/api/posts/Ab1234/share').length, 1);

  const cancelled = setup({ phone: true, nav: { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } } });
  cancelled.click(cancelled.q('[data-share]'));
  await cancelled.flush();
  assert.equal(cancelled.calls.filter(c => c.url === '/api/posts/Ab1234/share').length, 0, 'a cancelled share is not counted');
  assert.ok(!cancelled.q('[data-share]').classList.contains('is-copied'));
});

test('without clipboard access the button still confirms instead of failing silently', async () => {
  const s = setup({ nav: {} });
  s.click(s.q('[data-share]'));
  await s.flush();
  assert.equal(s.q('[data-share]').textContent, 'Link copied');
});

test('download drawer: opens, loads the original media from /api/resolve and shows its blocks', async () => {
  const resolved = { success: true, id: '20', url: 'https://x.com/i/status/20', author: { name: 'Jack' }, requires_age_confirmation: false, gifs: [], images: [],
    videos: [{ type: 'video', thumbnail: null, duration: 5, width: 1280, height: 720, variants: [{ url: 'https://video.twimg.com/v/720.mp4', bitrate: 1, width: 1280, height: 720, resolution: '1280x720' }, { url: 'https://video.twimg.com/v/360.mp4', bitrate: 1, width: 640, height: 360, resolution: '640x360' }] }] };
  const s = setup({ routes: { '/api/resolve': reply(200, resolved) } });
  assert.equal(s.q('[data-sheet]').hidden, true);
  s.click(s.q('[data-open-drawer]'));
  assert.equal(s.q('[data-sheet]').hidden, false);
  assert.equal(s.q('[data-sheet-overlay]').hidden, false);
  assert.ok(s.document.documentElement.classList.contains('has-overlay'));
  await s.flush();
  assert.deepEqual(s.calls.filter(c => c.url === '/api/resolve'), [{ url: '/api/resolve', body: { url: 'https://x.com/i/status/20' } }]);
  assert.equal(s.q('[data-sheet-body] .dl__label').textContent, 'HD 720p');
  assert.equal(s.q('[data-sheet-body] .note'), null, 'no fallback note when X answered');
  s.click(s.q('[data-sheet-close]'));
  assert.equal(s.q('[data-sheet]').hidden, true);
  assert.ok(!s.document.documentElement.classList.contains('has-overlay'));
  s.click(s.q('[data-open-drawer]'));
  await s.flush();
  assert.equal(s.calls.filter(c => c.url === '/api/resolve').length, 1, 'loaded once');
});

test('download drawer falls back to the files saved with the copy when X cannot be reached', async () => {
  for (const routes of [{ '/api/resolve': reply(404, { success: false, code: 'SOURCE_UNAVAILABLE' }) }, { '/api/resolve': () => { throw new TypeError('offline'); } }]) {
    const s = setup({ routes });
    s.click(s.q('[data-open-drawer]'));
    await s.flush();
    assert.match(s.q('[data-sheet-body] .note').textContent, /original post is not reachable/);
    assert.equal(s.q('[data-sheet-body] .block--video .dl__label').textContent, 'MP4', 'a saved file has no known resolution');
    assert.ok(s.q('[data-sheet-body] .block--photos'));
  }
  const gated = setup({ routes: { '/api/resolve': reply(200, { success: true, requires_age_confirmation: true, videos: [], gifs: [], images: [] }) } });
  gated.click(gated.q('[data-open-drawer]'));
  await gated.flush();
  assert.ok(gated.q('[data-sheet-body] .note'), 'the saved files are offered instead of anything X withheld');
});

test('saved files download straight from this server, not through the proxy', async () => {
  const saved = [];
  const s = setup({ routes: { '/api/resolve': reply(404, {}), '/videos/v.mp4': () => new Response(new Uint8Array(10), { headers: { 'content-length': '10', 'content-type': 'video/mp4' } }) } });
  s.document.defaultView.File = File;
  s.click(s.q('[data-open-drawer]'));
  await s.flush();
  s.click(s.q('[data-sheet-body] .block--video .dl'));
  await s.flush();
  assert.ok(s.calls.some(c => c.url === '/videos/v.mp4'), 'requests the saved file directly');
  assert.ok(!s.calls.some(c => String(c.url).startsWith('/dl')), 'never through /dl');
});

test('Escape and the overlay close the drawer', async () => {
  const s = setup({ routes: { '/api/resolve': reply(404, {}) } });
  s.click(s.q('[data-open-drawer]'));
  const esc = new s.window.Event('keydown', { bubbles: true }); esc.key = 'Escape';
  s.document.dispatchEvent(esc);
  assert.equal(s.q('[data-sheet]').hidden, true);
  s.click(s.q('[data-open-drawer]'));
  s.click(s.q('[data-sheet-overlay]'));
  assert.equal(s.q('[data-sheet]').hidden, true);
});

test('tapping a gallery photo opens it full screen', () => {
  const s = setup();
  s.click(s.document.querySelectorAll('[data-lightbox]')[1]);
  const box = s.document.querySelector('.lightbox');
  assert.equal(box.querySelector('.lightbox__counter').textContent, '2 / 2');
  assert.match(box.querySelector('.lightbox__image').getAttribute('src'), /\/images\/b\.jpg$/);
});

test('the age check posts to the cookie endpoint and reloads the page', async () => {
  const s = setup({ post: { sensitive: 1 }, ageConfirmed: false, routes: { '/api/age-confirm': reply(200, { success: true }) } });
  s.click(s.q('[data-age-confirm]'));
  await s.flush();
  assert.deepEqual(s.calls.map(c => c.url), ['/api/age-confirm']);
  assert.equal(s.reloads.length, 1);
  const failed = setup({ post: { sensitive: 1 }, ageConfirmed: false, routes: { '/api/age-confirm': reply(500, {}) } });
  failed.click(failed.q('[data-age-confirm]'));
  await failed.flush();
  assert.equal(failed.reloads.length, 0);
});

test('a video that is still being saved is polled and the page reloads when it is ready', async () => {
  let status = 'downloading';
  const s = setup({ post: { video: null, video_status: 'downloading', video_source_url: 'https://video.twimg.com/v.mp4' }, routes: { '/api/posts/7/video-status': () => reply(200, { status }) } });
  assert.equal(s.intervals.length, 1, 'polling starts only for a pending video');
  s.intervals[0]();
  await s.flush();
  assert.equal(s.reloads.length, 0);
  status = 'completed';
  s.intervals[0]();
  await s.flush();
  assert.equal(s.reloads.length, 1);
  assert.equal(s.intervals[0], null, 'polling stops');

  assert.equal(setup().intervals.length, 0, 'a finished video is not polled');
});

test('Chinese interface strings reach the page script', async () => {
  const s = setup({ lang: 'zh', nav: { clipboard: { writeText: async () => {} } } });
  s.click(s.q('[data-share]'));
  await s.flush();
  assert.equal(s.q('[data-share]').textContent, '链接已复制');
  assert.equal(s.q('[data-sheet] h2').textContent, '下载媒体');
});
