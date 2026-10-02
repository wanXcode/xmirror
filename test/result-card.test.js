const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { createResultRenderer, buildPill, sized, primaryQualityLabel } = require('../public/js/result-card');
const en = require('../lib/content/en');
const zh = require('../lib/content/zh');

const variant = (h, extra = {}) => ({ url: `https://video.twimg.com/v/${h}.mp4`, bitrate: h * 2000, width: Math.round(h * 16 / 9), height: h, resolution: `${Math.round(h * 16 / 9)}x${h}`, content_type: 'video/mp4', ...extra });
const video = (heights = [1080, 720, 360], extra = {}) => ({ type: 'video', thumbnail: 'https://pbs.twimg.com/amplify_video_thumb/1/img/t.jpg', duration: 42, width: 1920, height: 1080, variants: heights.map(h => variant(h)), ...extra });
const gif = { type: 'gif', thumbnail: null, duration: 6, width: 480, height: 270, variants: [{ url: 'https://video.twimg.com/tweet_video/g.mp4', bitrate: 0, width: 480, height: 270, resolution: '480x270', content_type: 'video/mp4' }] };
const photo = n => ({ url: `https://pbs.twimg.com/media/P${n}.jpg`, orig_url: `https://pbs.twimg.com/media/P${n}?format=jpg&name=orig`, width: 1200, height: 800 });
const post = (extra = {}) => ({ success: true, id: '20', url: 'https://x.com/i/status/20', author: { name: 'Jack', screen_name: 'jack', avatar_url: 'https://pbs.twimg.com/profile_images/1/a.jpg' }, text: 'hello world', videos: [], gifs: [], images: [], quote: null, ...extra });

function fakeTimers() {
  const timeouts = []; const intervals = [];
  return {
    timeouts, intervals,
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms, live: true }); return timeouts.length; },
    clearTimeout: id => { if (timeouts[id - 1]) timeouts[id - 1].live = false; },
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    clearInterval: id => { intervals[id - 1] = null; },
    fireLast(ms) { const t = [...timeouts].reverse().find(item => item.live && (ms === undefined || item.ms === ms)); if (t) { t.live = false; t.fn(); } }
  };
}

function bodyResponse(bytes, headers = {}) {
  return new Response(new Blob([new Uint8Array(bytes)]), { headers: { 'content-length': String(bytes), 'content-type': 'application/octet-stream', ...headers } });
}

function setup({ lang = 'en', ua = 'Mozilla/5.0 (Windows NT 10.0)', sizes = {}, fetchImpl, nav = {}, platform } = {}) {
  const { document, window } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>');
  const timers = fakeTimers();
  const saved = [];
  const fetched = [];
  const navigations = [];
  const viewSaves = [];
  const detect = platform || (/iPhone/.test(ua) ? { ios: true, android: false, mobile: true } : /Android/.test(ua) ? { ios: false, android: true, mobile: true } : { ios: false, android: false, mobile: false });
  const renderer = createResultRenderer({
    doc: document, win: window, text: (lang === 'zh' ? zh : en).result, lang, timers, platform: detect,
    nav: { userAgent: ua, ...nav }, File, downloadBase: '/dl', shortcutHref: '/ios-shortcut',
    fetch: async (url, options) => { fetched.push(url); return (fetchImpl ? fetchImpl(url, options) : bodyResponse(100)); },
    fetchSizes: async urls => Object.fromEntries(urls.map(url => [url, sizes[url] || null])),
    saveBlob: (blob, name) => saved.push({ blob, name }),
    navigate: url => navigations.push(url),
    onViewSave: url => viewSaves.push(url)
  });
  const host = document.getElementById('host');
  const mount = data => { const card = renderer.render(data); host.appendChild(card); return card; };
  const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  return { document, window, renderer, mount, click, flush, timers, saved, fetched, navigations, viewSaves, host };
}

test('pill text follows the design: single type, counted when mixed, quoted when only the quote has media', () => {
  const t = en.result;
  assert.equal(buildPill(post({ videos: [video()] }), t), 'Video');
  assert.equal(buildPill(post({ videos: [video(), video()] }), t), '2 videos');
  assert.equal(buildPill(post({ gifs: [gif] }), t), 'GIF');
  assert.equal(buildPill(post({ images: [photo(1), photo(2), photo(3), photo(4)] }), t), '4 photos');
  assert.equal(buildPill(post({ images: [photo(1)] }), t), '1 photo');
  assert.equal(buildPill(post({ videos: [video()], images: [photo(1), photo(2)] }), t), '1 video · 2 photos');
  assert.equal(buildPill(post({ quote: { videos: [video()], gifs: [], images: [] } }), t), 'Quoted video');
  assert.equal(buildPill(post({ quote: { videos: [], gifs: [gif], images: [] } }), t), 'Quoted GIF');
  assert.equal(buildPill(post({ quote: { videos: [], gifs: [], images: [photo(1)] } }), t), 'Quoted photos');
  assert.equal(buildPill(post({ quote: { videos: [video()], gifs: [], images: [photo(1)] } }), t), 'Quoted media');
  assert.equal(buildPill(post(), t), '');
  assert.equal(buildPill(post({ quote: { id: '1', text: 'only text' } }), t), '', 'a quote without media adds nothing');
  assert.equal(buildPill(post({ videos: [video()], quote: { videos: [video()], gifs: [], images: [] } }), t), 'Video', 'own media wins');
  assert.equal(buildPill(post({ videos: [video()] }), zh.result), '视频');
});

test('image size variants and quality labels', () => {
  assert.equal(sized('https://pbs.twimg.com/media/P?format=jpg&name=orig', 'medium'), 'https://pbs.twimg.com/media/P?format=jpg&name=medium');
  assert.equal(sized('https://example.com/a.jpg', 'large'), 'https://example.com/a.jpg');
  assert.equal(primaryQualityLabel({ height: 1080 }, en.result), 'Download HD · 1080p');
  assert.equal(primaryQualityLabel({ height: 720 }, en.result), 'Download HD · 720p');
  assert.equal(primaryQualityLabel({ height: 480 }, en.result), 'Download · 480p');
  assert.equal(primaryQualityLabel({ height: 1080 }, zh.result), '下载高清 1080p');
});

test('video card: header, label, preview, best-quality button and other qualities open by default', async () => {
  const s = setup({ sizes: { 'https://video.twimg.com/v/1080.mp4': 25300000, 'https://video.twimg.com/v/720.mp4': 13200000 } });
  const card = s.mount(post({ videos: [video()] }));
  await s.flush();
  assert.equal(card.querySelector('.card__names strong').textContent, 'Jack');
  assert.equal(card.querySelector('.card__names span').textContent, '@jack');
  assert.equal(card.querySelector('.pill').textContent, 'Video');
  assert.equal(card.querySelector('.rcard__text').textContent, 'hello world');
  assert.equal(card.querySelector('.block__label').textContent, 'Video · 1080p · 24.1 MB', 'info line: type, quality and size (the duration lives on the thumbnail)');
  assert.equal(card.querySelector('.preview__duration').textContent, '0:42');
  assert.equal(card.querySelector('.dl__label').textContent, 'Download HD · 1080p');
  assert.equal(card.querySelector('.dl__size').textContent, '24.1 MB', 'size arrives from /api/media-info');
  const toggle = card.querySelector('.toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'other qualities are open by default');
  assert.equal(card.querySelector('.variants').hidden, false);
  s.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'and can be folded away');
  assert.equal(card.querySelector('.variants').hidden, true);
  s.click(toggle);
  assert.equal(card.querySelector('.variants').hidden, false);
  const rows = [...card.querySelectorAll('.variant')];
  assert.deepEqual(rows.map(r => r.querySelector('.variant__name').textContent), ['720p · MP4', '360p · MP4']);
  assert.equal(rows[0].querySelector('.variant__status').textContent, 'Download · 12.6 MB');
  assert.equal(rows[1].querySelector('.variant__status').textContent, 'Download', 'unknown sizes are not invented');
  assert.equal(card.querySelector('.rcard__foot a').getAttribute('href'), 'https://x.com/i/status/20');
  assert.equal(card.querySelector('.rcard__foot a').getAttribute('rel'), 'noopener noreferrer');
});

test('a single-quality video has no "other qualities" control', () => {
  const card = setup().mount(post({ videos: [video([720])] }));
  assert.equal(card.querySelector('.toggle'), null);
});

test('play swaps the poster for a muted, controlled preview from a light variant', () => {
  const s = setup();
  const card = s.mount(post({ videos: [video()] }));
  assert.ok(card.querySelector('.preview__poster'));
  s.click(card.querySelector('.preview__play'));
  const player = card.querySelector('.preview__video');
  assert.equal(player.getAttribute('src'), 'https://video.twimg.com/v/720.mp4');
  assert.ok(player.hasAttribute('muted') && player.hasAttribute('autoplay') && player.hasAttribute('playsinline'));
  assert.ok(player.hasAttribute('controls'));
  assert.equal(card.querySelector('.preview__play'), null);
});

test('download: progress, saved state with the file, restore after three seconds, no double click', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = setup({ fetchImpl: async () => { await gate; return bodyResponse(100); } });
  const card = s.mount(post({ videos: [video()] }));
  const button = card.querySelector('.block--video .dl');
  s.click(button);
  await s.flush();
  assert.ok(button.classList.contains('is-busy'));
  assert.equal(button.disabled, true);
  assert.equal(card.querySelector('.dl__label').textContent, 'Downloading…');
  s.click(button); // ignored while busy
  release();
  await s.flush();
  assert.equal(s.fetched.length, 1, 'one request even though the button was clicked twice');
  assert.equal(s.fetched[0], '/dl?u=https%3A%2F%2Fvideo.twimg.com%2Fv%2F1080.mp4&n=xput_20_1080p.mp4');
  assert.deepEqual(s.saved.map(item => [item.name, item.blob.size]), [['xput_20_1080p.mp4', 100]]);
  assert.ok(button.classList.contains('is-saved'));
  assert.equal(card.querySelector('.dl__label').textContent, 'Saved');
  s.timers.fireLast(3000);
  assert.ok(!button.classList.contains('is-saved'));
  assert.equal(card.querySelector('.dl__label').textContent, 'Download HD · 1080p');
  assert.equal(button.disabled, false);
});

test('download shows a percentage while the body streams', async () => {
  const labels = [];
  let step;
  const stream = new ReadableStream({ start(controller) { step = (n, close) => { if (n) controller.enqueue(new Uint8Array(n)); if (close) controller.close(); }; } });
  const s = setup({ fetchImpl: async () => new Response(stream, { headers: { 'content-length': '100', 'content-type': 'video/mp4' } }) });
  const card = s.mount(post({ videos: [video([720])] }));
  s.click(card.querySelector('.dl'));
  await s.flush();
  step(46);
  await s.flush();
  labels.push(card.querySelector('.dl__label').textContent);
  step(54, true);
  await s.flush();
  assert.deepEqual(labels, ['Downloading… 46%']);
  assert.equal(card.querySelector('.dl__label').textContent, 'Saved');
});

test('a failed download says so, can be retried, and recovers on its own', async () => {
  let fail = true;
  const s = setup({ fetchImpl: async () => (fail ? new Response('', { status: 502 }) : bodyResponse(10)) });
  const card = s.mount(post({ videos: [video([720])] }));
  const button = card.querySelector('.dl');
  s.click(button);
  await s.flush();
  assert.ok(button.classList.contains('is-failed'));
  assert.equal(card.querySelector('.dl__label').textContent, 'Download failed — tap to try again');
  assert.equal(button.disabled, false);
  fail = false;
  s.click(button);
  await s.flush();
  assert.equal(card.querySelector('.dl__label').textContent, 'Saved');
});

test('too many downloads: countdown from Retry-After, then the button works again', async () => {
  const s = setup({ fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '3' } }) });
  const card = s.mount(post({ videos: [video([720])] }));
  const button = card.querySelector('.dl');
  s.click(button);
  await s.flush();
  assert.equal(card.querySelector('.dl__label').textContent, 'Try again in 0:03');
  assert.equal(button.disabled, true);
  s.timers.intervals.at(-1)();
  assert.equal(card.querySelector('.dl__label').textContent, 'Try again in 0:02');
  s.timers.intervals.at(-1)(); s.timers.intervals.at(-1)();
  assert.equal(card.querySelector('.dl__label').textContent, 'Download HD · 720p');
  assert.equal(button.disabled, false);
  assert.equal(s.timers.intervals.at(-1), null, 'the countdown stops');
});

test('very large files are handed to the browser download manager instead of being buffered', async () => {
  const url = 'https://video.twimg.com/v/1080.mp4';
  const s = setup({ sizes: { [url]: 400 * 1024 * 1024 } });
  const card = s.mount(post({ videos: [video()] }));
  await s.flush();
  s.click(card.querySelector('.block--video .dl'));
  await s.flush();
  assert.deepEqual(s.navigations, ['/dl?u=https%3A%2F%2Fvideo.twimg.com%2Fv%2F1080.mp4&n=xput_20_1080p.mp4']);
  assert.equal(s.fetched.length, 0);
  assert.equal(card.querySelector('.dl__label').textContent, 'Saved');
});

test('the in-memory limit is 150 MB: a file at the limit is buffered and saved, one byte over goes to the browser; unknown sizes are buffered', async () => {
  const url = 'https://video.twimg.com/v/1080.mp4';
  const LIMIT = 150 * 1024 * 1024;
  for (const [size, native] of [[LIMIT, false], [LIMIT + 1, true], [undefined, false]]) {
    const s = setup({ sizes: size === undefined ? {} : { [url]: size } });
    const card = s.mount(post({ videos: [video()] }));
    await s.flush();
    s.click(card.querySelector('.block--video .dl'));
    await s.flush();
    assert.equal(s.navigations.length, native ? 1 : 0, `size ${size}`);
    assert.equal(s.saved.length, native ? 0 : 1, `size ${size}`);
    assert.equal(card.querySelector('.dl__label').textContent, 'Saved');
    if (native) assert.ok(s.navigations[0].startsWith('/dl?u='), 'the browser downloads through the attachment proxy');
  }
});

test('other qualities download their own file', async () => {
  const s = setup();
  const card = s.mount(post({ videos: [video()] }));
  s.click(card.querySelector('.toggle'));
  s.click(card.querySelectorAll('.variant')[1]);
  await s.flush();
  assert.deepEqual(s.saved.map(item => item.name), ['xput_20_360p.mp4']);
  assert.equal(card.querySelectorAll('.variant')[1].querySelector('.variant__status').textContent, 'Saved');
});

test('GIF card: looping muted preview, MP4 download and the explanation', async () => {
  const s = setup({ sizes: { 'https://video.twimg.com/tweet_video/g.mp4': 1250000 } });
  const card = s.mount(post({ gifs: [gif] }));
  await s.flush();
  assert.equal(card.querySelector('.pill').textContent, 'GIF');
  assert.equal(card.querySelector('.block__label').textContent, 'GIF · 1.2 MB');
  const player = card.querySelector('.preview__video');
  assert.ok(player.hasAttribute('loop') && player.hasAttribute('muted') && player.hasAttribute('autoplay'));
  assert.equal(card.querySelector('.preview__tag').textContent, 'GIF · loops');
  assert.equal(card.querySelector('.dl__label').textContent, 'Download GIF (MP4)');
  assert.equal(card.querySelector('.dl__size').textContent, '1.2 MB');
  assert.match(card.querySelector('.block__note').textContent, /saves as MP4/);
  s.click(card.querySelector('.dl'));
  await s.flush();
  assert.deepEqual(s.saved.map(item => item.name), ['xput_20_gif.mp4']);
});

test('photos on a computer: select circles drive the ZIP label, and the ZIP holds only the chosen originals', async () => {
  const s = setup({ fetchImpl: async url => bodyResponse(50, { 'content-type': 'image/jpeg' }) });
  const card = s.mount(post({ images: [photo(1), photo(2), photo(3), photo(4)] }));
  assert.equal(card.querySelector('.block__label').textContent, '4 photos · original size');
  assert.equal(card.querySelector('.block--photos .dl__label').textContent, 'Download 4 photos (ZIP)');
  assert.equal(card.querySelector('.block--photos .dl__size').textContent, 'Original size');
  assert.match(card.querySelector('.block__note').textContent, /Tap a photo to view it full screen/);
  const checks = [...card.querySelectorAll('.photo__check')];
  assert.ok(checks.every(c => c.getAttribute('aria-checked') === 'true'));
  s.click(checks[1]); s.click(checks[3]);
  assert.equal(checks[1].getAttribute('aria-checked'), 'false');
  assert.equal(card.querySelector('.block--photos .dl__label').textContent, 'Download 2 photos (ZIP)');
  s.click(card.querySelector('.block--photos .dl'));
  await s.flush();
  assert.deepEqual(s.fetched.map(url => decodeURIComponent(url).match(/P\d/)[0]), ['P1', 'P3']);
  assert.ok(s.fetched.every(url => decodeURIComponent(url).includes('name=orig')), 'originals, not previews');
  assert.equal(s.saved.length, 1);
  assert.equal(s.saved[0].name, 'xput_20_photos.zip');
  assert.equal(s.saved[0].blob.type, 'application/zip');
  const bytes = new Uint8Array(await s.saved[0].blob.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'PK\u0003\u0004');
});

test('deselecting every photo disables the button; a single photo downloads as a plain file', async () => {
  const s = setup({ fetchImpl: async () => bodyResponse(30, { 'content-type': 'image/jpeg' }) });
  const card = s.mount(post({ images: [photo(1), photo(2)] }));
  const [a, b] = [...card.querySelectorAll('.photo__check')];
  s.click(a); s.click(b);
  assert.equal(card.querySelector('.block--photos .dl__label').textContent, 'Select photos to download');
  assert.equal(card.querySelector('.block--photos .dl').disabled, true);
  s.click(b);
  assert.equal(card.querySelector('.block--photos .dl__label').textContent, 'Download photo');
  s.click(card.querySelector('.block--photos .dl'));
  await s.flush();
  assert.deepEqual(s.saved.map(item => item.name), ['xput_20_2.jpg']);
});

test('photos on a phone use the system share sheet with real files; no tip afterwards', async () => {
  const shared = [];
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
  const s = setup({ ua, fetchImpl: async () => bodyResponse(30, { 'content-type': 'image/jpeg' }), nav: { canShare: () => true, share: async data => { shared.push(data); } } });
  const card = s.mount(post({ images: [photo(1), photo(2)] }));
  assert.equal(card.querySelector('.block--photos .dl__label').textContent, 'Save 2 photos to Photos');
  s.click(card.querySelector('.block--photos .dl'));
  await s.flush();
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].files.map(f => [f.name, f.type, f.size]), [['xput_20_1.jpg', 'image/jpeg', 30], ['xput_20_2.jpg', 'image/jpeg', 30]]);
  assert.equal(s.saved.length, 0);
  assert.equal(s.document.querySelector('.toast'), null, 'the share sheet is the feedback');
  assert.ok(card.querySelector('.block--photos .dl').classList.contains('is-saved'));
});

test('cancelling the share sheet is not an error; a broken share falls back to file downloads', async () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';
  const fetchImpl = async () => bodyResponse(30, { 'content-type': 'image/jpeg' });
  const cancelled = setup({ ua, fetchImpl, nav: { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } } });
  const cardA = cancelled.mount(post({ images: [photo(1)] }));
  cancelled.click(cardA.querySelector('.dl'));
  await cancelled.flush();
  assert.ok(!cardA.querySelector('.dl').classList.contains('is-failed') && !cardA.querySelector('.dl').classList.contains('is-saved'));
  assert.equal(cancelled.saved.length, 0);
  assert.equal(cancelled.document.querySelector('.toast'), null);

  const broken = setup({ ua, fetchImpl, nav: { canShare: () => true, share: async () => { throw new Error('NotAllowedError'); } } });
  const cardB = broken.mount(post({ images: [photo(1), photo(2)] }));
  broken.click(cardB.querySelector('.block--photos .dl'));
  await broken.flush();
  assert.deepEqual(broken.saved.map(item => item.name), ['xput_20_1.jpg', 'xput_20_2.jpg']);
  assert.equal(broken.document.querySelector('.toast .toast__title').textContent, 'Saved to Downloads');

  const noShare = setup({ ua, fetchImpl, nav: {} });
  const cardC = noShare.mount(post({ images: [photo(1)] }));
  noShare.click(cardC.querySelector('.dl'));
  await noShare.flush();
  assert.equal(noShare.saved.length, 1, 'browsers without file sharing download the photo');
});

test('full-screen photos: counter, wrap-around navigation, keyboard, swipe, close and save', async () => {
  const s = setup({ fetchImpl: async () => bodyResponse(30, { 'content-type': 'image/jpeg' }) });
  const card = s.mount(post({ images: [photo(1), photo(2), photo(3), photo(4)] }));
  s.click(card.querySelectorAll('.photo__open')[1]);
  const box = () => s.document.querySelector('.lightbox');
  assert.equal(box().getAttribute('role'), 'dialog');
  assert.equal(box().getAttribute('aria-modal'), 'true');
  assert.equal(box().querySelector('.lightbox__counter').textContent, '2 / 4');
  assert.match(box().querySelector('.lightbox__image').getAttribute('src'), /P2\?format=jpg&name=large$/);
  assert.equal(box().querySelector('.lightbox__hint').textContent, 'Or press and hold the photo to save it');
  s.click(box().querySelector('.lightbox__nav--next'));
  assert.equal(box().querySelector('.lightbox__counter').textContent, '3 / 4');
  s.click(box().querySelector('.lightbox__nav--prev')); s.click(box().querySelector('.lightbox__nav--prev')); s.click(box().querySelector('.lightbox__nav--prev'));
  assert.equal(box().querySelector('.lightbox__counter').textContent, '4 / 4', 'wraps backwards');
  const press = key => { const e = new s.window.Event('keydown', { bubbles: true }); e.key = key; s.document.dispatchEvent(e); };
  press('ArrowRight');
  assert.equal(box().querySelector('.lightbox__counter').textContent, '1 / 4');
  const touch = (type, x) => { const e = new s.window.Event(type, { bubbles: true }); e[type === 'touchstart' ? 'touches' : 'changedTouches'] = [{ clientX: x }]; box().dispatchEvent(e); };
  touch('touchstart', 200); touch('touchend', 100);
  assert.equal(box().querySelector('.lightbox__counter').textContent, '2 / 4', 'swipe left goes forward');
  touch('touchstart', 100); touch('touchend', 110);
  assert.equal(box().querySelector('.lightbox__counter').textContent, '2 / 4', 'a tiny movement is not a swipe');

  s.click(box().querySelector('.lightbox__save'));
  await s.flush();
  assert.deepEqual(s.saved.map(item => item.name), ['xput_20_2.jpg'], 'saves the photo that is on screen, as an original');
  assert.ok(decodeURIComponent(s.fetched[0]).includes('P2?format=jpg&name=orig'));

  press('Escape');
  assert.equal(box(), null);
  assert.ok(!s.document.documentElement.classList.contains('has-lightbox'));
});

test('a single photo has no navigation arrows in full screen', () => {
  const s = setup();
  const card = s.mount(post({ images: [photo(1)] }));
  s.click(card.querySelector('.photo__open'));
  assert.equal(s.document.querySelector('.lightbox__nav'), null);
  assert.equal(s.document.querySelector('.lightbox__counter').textContent, '1 / 1');
});

test('mixed media: separate blocks in order, counted pill, and photo labels', () => {
  const card = setup().mount(post({ videos: [video()], images: [photo(1), photo(2)] }));
  assert.equal(card.querySelector('.pill').textContent, '1 video · 2 photos');
  assert.deepEqual([...card.querySelectorAll('.block__label')].map(l => l.textContent), ['Video · 1080p', '2 photos · original size']);
});

test('quoted media sits in its own labelled box, with its own downloads', async () => {
  const s = setup();
  const card = s.mount(post({ quote: { id: '9', url: 'https://x.com/b/status/9', author: { name: 'Q', screen_name: 'quoted' }, text: 'q', videos: [video([720])], gifs: [], images: [] } }));
  assert.equal(card.querySelector('.pill').textContent, 'Quoted video');
  assert.equal(card.querySelector('.quoted__title').textContent, 'From the quoted post · @quoted');
  assert.equal(card.querySelectorAll('.quoted .dl').length, 1);
  s.click(card.querySelector('.quoted .dl'));
  await s.flush();
  assert.deepEqual(s.saved.map(item => item.name), ['xput_9_quote.mp4'], 'named after the quoted post');
});

test('text-only post: full text, the no-media note and its three actions', async () => {
  const written = [];
  const s = setup({ nav: { clipboard: { writeText: async value => { written.push(value); } } } });
  const card = s.mount(post({ text: 'The whole post, readable right away.' }));
  assert.equal(card.querySelector('.pill'), null);
  assert.equal(card.querySelector('.rcard__text--full').textContent, 'The whole post, readable right away.');
  assert.equal(card.querySelector('.note').textContent, 'This post has no video, GIF or images to download.');
  const labels = [...card.querySelectorAll('.rcard__actions > *')].map(el => el.textContent);
  assert.deepEqual(labels, ['View & save a copy', 'Copy text', 'Open on X']);
  const copy = card.querySelectorAll('.rcard__actions > *')[1];
  s.click(copy);
  await s.flush();
  assert.deepEqual(written, ['The whole post, readable right away.']);
  assert.equal(copy.textContent, 'Copied');
  s.timers.fireLast(2000);
  assert.equal(copy.textContent, 'Copy text');
  s.click(card.querySelector('.rcard__actions > *'));
  assert.deepEqual(s.viewSaves, ['https://x.com/i/status/20']);
});

test('"View & save a copy" in the footer hands the canonical link to the page', () => {
  const s = setup();
  const card = s.mount(post({ videos: [video([720])] }));
  s.click(card.querySelector('.rcard__foot .link-button'));
  assert.deepEqual(s.viewSaves, ['https://x.com/i/status/20']);
});

test('after the first download a one-time "make this link last" hint appears above the footer', async () => {
  const s = setup();
  const card = s.mount(post({ videos: [video()] }));
  assert.equal(card.querySelector('.last-hint'), null);
  s.click(card.querySelector('.block--video .dl'));
  await s.flush();
  const hint = card.querySelector('.last-hint');
  assert.match(hint.textContent, /^Want this link to last\? View & save a copy/);
  assert.equal(hint.nextElementSibling.className, 'rcard__foot');
  s.timers.fireLast(3000);
  s.click(card.querySelector('.block--video .dl'));
  await s.flush();
  assert.equal(card.querySelectorAll('.last-hint').length, 1, 'only once');
  s.click(hint.querySelector('.link-button'));
  assert.deepEqual(s.viewSaves, ['https://x.com/i/status/20']);
});

test('iPhone tip after a video download: where it went, the shortcut link, dismiss', async () => {
  const s = setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
  const card = s.mount(post({ videos: [video([720])] }));
  s.click(card.querySelector('.dl'));
  await s.flush();
  const toast = s.document.querySelector('.toast');
  assert.equal(toast.getAttribute('role'), 'status');
  assert.equal(toast.querySelector('.toast__title').textContent, 'Saved to Files');
  assert.equal(toast.querySelector('.toast__text').textContent, 'Open Files → Downloads, tap Share → Save Video to add it to Photos.');
  assert.equal(toast.querySelector('.toast__link').getAttribute('href'), '/ios-shortcut');
  s.click(toast.querySelector('.toast__close'));
  assert.equal(s.document.querySelector('.toast'), null);
});

test('Android tip, auto-dismiss, and no tip at all on a computer', async () => {
  const android = setup({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' });
  const cardA = android.mount(post({ videos: [video([720])] }));
  android.click(cardA.querySelector('.dl'));
  await android.flush();
  const toast = android.document.querySelector('.toast');
  assert.equal(toast.querySelector('.toast__title').textContent, 'Saved to Downloads');
  assert.equal(toast.querySelector('.toast__text').textContent, "You'll also find it in your Gallery.");
  assert.equal(toast.querySelector('.toast__link'), null, 'the shortcut is an iPhone thing');
  android.timers.fireLast(12000);
  assert.equal(android.document.querySelector('.toast'), null);

  const desktop = setup();
  const cardD = desktop.mount(post({ videos: [video([720])] }));
  desktop.click(cardD.querySelector('.dl'));
  await desktop.flush();
  assert.equal(desktop.document.querySelector('.toast'), null);
});

test('Chinese result card uses Chinese labels', () => {
  const card = setup({ lang: 'zh' }).mount(post({ videos: [video()], images: [photo(1), photo(2)] }));
  assert.equal(card.querySelector('.pill').textContent, '1 个视频 · 2 张图片');
  assert.equal(card.querySelector('.dl__label').textContent, '下载高清 1080p');
  assert.equal(card.querySelector('.rcard__foot .link-button').textContent, '查看并保存副本');
});

test('everything from the post is shown as text; non-https images are never loaded', () => {
  const s = setup();
  const card = s.mount(post({
    author: { name: '<img src=x onerror=alert(1)>', screen_name: 'a"b', avatar_url: 'javascript:alert(1)' },
    text: '<script>alert(1)</script>',
    videos: [video([720], { thumbnail: 'http://evil.test/t.jpg' })]
  }));
  assert.equal(card.querySelector('.card__names strong').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(card.querySelector('.rcard__text').textContent, '<script>alert(1)</script>');
  assert.equal(card.querySelector('script'), null);
  assert.equal(card.querySelector('.card__avatar').tagName, 'SPAN', 'a javascript: avatar falls back to the blank circle');
  assert.equal(card.querySelector('.preview__poster'), null, 'an http thumbnail is dropped');
});

// ---- the download list used by the saved-post dialog: same controls, compact rows ----
const mountRows = (s, data) => { const rows = s.renderer.renderBlocks(data); s.host.appendChild(rows); return rows; };

test('download list: one compact row per media type with the info line, thumbnail badges and no per-button size', async () => {
  const s = setup({ sizes: { 'https://video.twimg.com/v/1080.mp4': 11.4 * 1048576, 'https://video.twimg.com/tweet_video/g.mp4': 1.2 * 1048576 } });
  const rows = mountRows(s, post({ videos: [video()], gifs: [gif], images: [photo(1), photo(2)] }));
  await s.flush();
  assert.deepEqual([...rows.querySelectorAll('.row')].map(r => r.className.split(' ')[1]), ['row--video', 'row--gif', 'row--photos']);
  const videoRow = rows.querySelector('.row--video');
  assert.equal(videoRow.querySelector('.row__info strong').textContent, 'Video');
  assert.equal(videoRow.querySelector('.row__meta').textContent, '1080p · 0:42 · 11.4 MB');
  assert.equal(videoRow.querySelector('.thumb__duration').textContent, '0:42');
  assert.equal(videoRow.querySelector('.dl__label').textContent, 'Download HD · 1080p');
  assert.equal(videoRow.querySelector('.toggle .toggle__arrow').textContent, '▴', '"Other qualities" sits under the row, open');
  const gifRow = rows.querySelector('.row--gif');
  assert.equal(gifRow.querySelector('.row__info strong').textContent, 'GIF');
  assert.equal(gifRow.querySelector('.row__meta').textContent, 'Saved as MP4 · 1.2 MB');
  assert.equal(gifRow.querySelector('.thumb__tag').textContent, 'GIF');
  assert.equal(gifRow.querySelector('.dl__label').textContent, 'Download GIF');
});

test('download list: photo thumbnails are ticks; the count and the button follow them (computer: ZIP, phone: Photos)', async () => {
  for (const [ua, label, one] of [['Mozilla/5.0 (Windows NT 10.0)', 'Download {n} (ZIP)', 'Download photo'], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'Save {n} to Photos', 'Save photo to Photos']]) {
    const s = setup({ ua });
    const rows = mountRows(s, post({ images: [1, 2, 3, 4].map(photo) }));
    const row = rows.querySelector('.row--photos');
    assert.equal(row.querySelector('.row__head strong').textContent, '4 photos');
    assert.equal(row.querySelector('.row__note').textContent, ' · original size');
    assert.equal(row.querySelector('.row__count').textContent, '4 selected');
    assert.equal(row.querySelector('.dl__label').textContent, label.replace('{n}', '4'));
    s.click(row.querySelectorAll('.thumb')[1]);        // tapping the thumbnail toggles it
    s.click(row.querySelectorAll('.photo__check')[3]); // so does the tick itself
    assert.equal(row.querySelector('.row__count').textContent, '2 selected');
    assert.equal(row.querySelector('.dl__label').textContent, label.replace('{n}', '2'));
    assert.deepEqual([...row.querySelectorAll('.photo__check')].map(c => c.getAttribute('aria-checked')), ['true', 'false', 'true', 'false']);
    s.click(row.querySelectorAll('.photo__check')[2]);
    assert.equal(row.querySelector('.dl__label').textContent, one);
    s.click(row.querySelectorAll('.photo__check')[0]);
    assert.equal(row.querySelector('.dl__label').textContent, 'Select photos to download');
    assert.equal(row.querySelector('.dl').disabled, true);
  }
});

test('download list reuses the card code: states, saving and the after-download tip are the same', async () => {
  const s = setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  const rows = mountRows(s, post({ videos: [video()] }));
  const button = rows.querySelector('.row--video > .dl');
  s.click(button);
  assert.ok(button.classList.contains('is-busy'));
  await s.flush();
  assert.ok(button.classList.contains('is-saved'));
  assert.equal(button.querySelector('.dl__label').textContent, 'Saved');
  assert.deepEqual(s.saved.map(item => item.name), ['xput_20_1080p.mp4']);
  assert.ok(s.document.querySelector('.toast'), 'the "Saved to Files" tip appears here too');
  s.timers.fireLast(3000);
  assert.equal(button.querySelector('.dl__label').textContent, 'Download HD · 1080p');
});

test('result card: info line and shape variables for the thumbnail (portrait stays narrow)', () => {
  const s = setup();
  const card = s.mount(post({ videos: [video([1080, 720], { width: 720, height: 1280 })] }));
  const preview = card.querySelector('.preview');
  assert.match(preview.getAttribute('style'), /--ratio:720 \/ 1280;--rnum:0\.5625/);
  assert.equal(card.querySelector('.block__label').textContent, 'Video · 1080p');
  assert.equal(card.querySelector('.block--video').children[0], card.querySelector('.block__label'), 'info line first, then the thumbnail, then the button');
  assert.equal(card.querySelector('.block--video').children[2], card.querySelector('.dl'));
  assert.equal(card.querySelector('.dl').nextElementSibling, card.querySelector('.toggle'), '"Other qualities" directly under the button');
  assert.equal(card.querySelector('.preview__duration').textContent, '0:42');
  assert.equal(card.querySelectorAll('.preview__duration').length, 1, 'the duration is only on the thumbnail');
});

test('primary button wording: HD from 720p up, plain below; Chinese too', () => {
  assert.equal(primaryQualityLabel({ height: 1080 }, en.result), 'Download HD · 1080p');
  assert.equal(primaryQualityLabel({ height: 720 }, en.result), 'Download HD · 720p');
  assert.equal(primaryQualityLabel({ height: 360 }, en.result), 'Download · 360p');
  assert.equal(primaryQualityLabel({ height: 1080 }, zh.result), '下载高清 1080p');
  assert.equal(primaryQualityLabel({ height: 360 }, zh.result), '下载 360p');
});
