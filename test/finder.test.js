const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { renderDocument } = require('../lib/views/layout');
const { createTranslator } = require('../lib/i18n');
const { renderHome } = require('../lib/views/pages/home');
const { renderViewer } = require('../lib/views/pages/viewer');
const { createFinder } = require('../public/js/finder');

const POST = 'https://x.com/jack/status/20';
const CANONICAL = 'https://x.com/i/status/20';

function reply(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: name => headers[name] ?? headers[name.toLowerCase()] ?? null }, json: async () => body };
}

// Builds the real server-rendered page, then drives it with fakes.
function setup({ lang = 'en', mode = 'home', routes = {}, clipboard, permissions } = {}) {
  const t = createTranslator(lang);
  const body = mode === 'home' ? renderHome({ t, lang }) : renderViewer({ t, lang });
  const { document, window } = parseHTML(String(renderDocument({ lang, baseUrl: 'https://xput.app', page: mode === 'home' ? 'home' : 'viewer', title: 't', body })));
  const calls = [];
  const navigations = [];
  const intervals = [];
  const timeouts = [];
  const fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected ${url}`);
    return typeof handler === 'function' ? handler(JSON.parse(options.body)) : handler;
  };
  const timers = {
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    clearInterval: id => { intervals[id - 1] = null; },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; }
  };
  const root = document.querySelector('[data-finder]');
  const finder = createFinder({ root, doc: document, win: window, fetch, navigate: url => navigations.push(url), timers, clipboard, permissions });
  const q = selector => root.querySelector(selector);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { document, window, root, finder, q, calls, navigations, intervals, timeouts, flush, text: t('input') };
}

const resolveOk = (extra = {}) => reply(200, {
  success: true, id: '20', sensitive: false, requires_age_confirmation: false, author: { name: 'Jack', screen_name: 'jack' },
  videos: [{ type: 'video', variants: [{ url: 'https://video.twimg.com/v/1280x720/a.mp4', resolution: '1280x720', bitrate: 2000 }, { url: 'https://video.twimg.com/v/640x360/b.mp4', resolution: '640x360', bitrate: 500 }] }],
  gifs: [], images: [{ url: 'https://pbs.twimg.com/media/A.jpg', orig_url: 'https://pbs.twimg.com/media/A?format=jpg&name=orig' }], ...extra
});

test('the idle page ships the empty state; viewer mode has a single View post button', () => {
  const home = setup();
  assert.equal(home.root.getAttribute('data-state'), 'idle');
  assert.ok(home.q('.empty'));
  assert.ok(home.q('[data-action="download"]') && home.q('[data-action="view"]'));
  const viewer = setup({ mode: 'viewer' });
  assert.equal(viewer.q('[data-action="download"]'), null);
  assert.equal(viewer.q('[data-action="view"] .btn__label').textContent, 'View post');
});

test('invalid links are explained inline, mark the field, and never call the API', async () => {
  const s = setup();
  for (const [value, message] of [['https://example.com/watch/12', s.text.errInvalid], ['https://x.com/jack', s.text.errNotSingle], ['', s.text.errEmpty]]) {
    s.q('[data-input]').value = value;
    await s.finder.runDownload();
    assert.equal(s.root.getAttribute('data-state'), 'invalid');
    assert.equal(s.q('[data-message]').hidden, false);
    assert.match(s.q('[data-message]').textContent, new RegExp(message.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(s.q('[data-input]').getAttribute('aria-invalid'), 'true');
    assert.ok(s.q('.finder__field').classList.contains('is-invalid'));
  }
  assert.equal(s.calls.length, 0);
  s.q('[data-input]').value = POST; // typing clears the error and restores the empty state
  s.q('[data-input]').dispatchEvent(new s.window.Event('input', { bubbles: true }));
  assert.equal(s.root.getAttribute('data-state'), 'idle');
  assert.equal(s.q('[data-message]').hidden, true);
  assert.equal(s.q('[data-input]').getAttribute('aria-invalid'), null);
});

test('Download resolves the canonical link, shows loading, then the links', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = setup({ routes: { '/api/resolve': async () => { await gate; return resolveOk(); } } });
  s.q('[data-input]').value = 'twitter.com/jack/status/20?s=20';
  const running = s.finder.runDownload();
  assert.equal(s.root.getAttribute('data-state'), 'loading');
  assert.equal(s.q('[data-action="download"] .btn__label').textContent, 'Fetching…');
  assert.ok(s.q('[data-action="download"]').classList.contains('is-loading'));
  assert.ok(s.q('[data-action="view"]').classList.contains('is-disabled'));
  assert.ok(s.q('.skeleton'));
  release();
  await running;
  assert.deepEqual(s.calls, [{ url: '/api/resolve', body: { url: CANONICAL } }]);
  assert.equal(s.root.getAttribute('data-state'), 'result');
  const links = [...s.root.querySelectorAll('.result-temp__list a')];
  assert.deepEqual(links.map(a => a.textContent), ['Video 1280x720', 'Video 640x360', 'Image (original) #1']);
  assert.equal(links[2].getAttribute('href'), 'https://pbs.twimg.com/media/A?format=jpg&name=orig');
  assert.equal(s.q('[data-action="download"] .btn__label').textContent, 'Download');
  assert.equal(s.q('[data-action="download"]').disabled, false);
});

test('only https media links are rendered', async () => {
  const s = setup({ routes: { '/api/resolve': resolveOk({ images: [{ orig_url: 'javascript:alert(1)' }], videos: [] }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runDownload();
  assert.equal(s.root.querySelectorAll('.result-temp__list a').length, 0);
});

test('API failures map to the right states: unavailable, rejected, busy (5xx and network)', async () => {
  for (const [response, state] of [
    [reply(404, { code: 'SOURCE_UNAVAILABLE' }), 'unavailable'],
    [reply(422, { code: 'CONTENT_MODERATION_REJECTED' }), 'rejected'],
    [reply(503, { code: 'SERVICE_UNAVAILABLE' }), 'busy'],
    [reply(504, { code: 'REQUEST_TIMEOUT' }), 'busy']
  ]) {
    const s = setup({ routes: { '/api/resolve': response } });
    s.q('[data-input]').value = POST;
    await s.finder.runDownload();
    assert.equal(s.root.getAttribute('data-state'), state);
    assert.equal(s.q('[data-action="download"]').disabled, false, 'buttons are usable again');
  }
  const offline = setup({ routes: { '/api/resolve': () => { throw new TypeError('fetch failed'); } } });
  offline.q('[data-input]').value = POST;
  await offline.finder.runDownload();
  assert.equal(offline.root.getAttribute('data-state'), 'busy');
});

test('Try again reruns the same request', async () => {
  let attempts = 0;
  const s = setup({ routes: { '/api/resolve': () => (++attempts === 1 ? reply(503, {}) : resolveOk()) } });
  s.q('[data-input]').value = POST;
  await s.finder.runDownload();
  assert.equal(s.root.getAttribute('data-state'), 'busy');
  s.q('.status-card button').dispatchEvent(new s.window.Event('click', { bubbles: true }));
  await s.flush();
  assert.equal(s.root.getAttribute('data-state'), 'result');
  assert.equal(attempts, 2);
});

test('too many requests: countdown from Retry-After, then the retry button unlocks', async () => {
  const s = setup({ routes: { '/api/resolve': reply(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '3' }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runDownload();
  assert.equal(s.root.getAttribute('data-state'), 'tooMany');
  const retry = () => s.q('.status-card button');
  assert.equal(retry().textContent, 'Try again in 0:03');
  assert.equal(retry().disabled, true);
  s.intervals.at(-1)(); s.intervals.at(-1)();
  assert.equal(retry().textContent, 'Try again in 0:01');
  s.intervals.at(-1)();
  assert.equal(retry().textContent, 'Try again');
  assert.equal(retry().disabled, false);
  assert.equal(s.intervals.at(-1), null, 'the timer is stopped');
});

test('sensitive posts show only the author until the age is confirmed, then retry through the cookie endpoint', async () => {
  const hidden = { success: true, id: '20', sensitive: true, requires_age_confirmation: true, author: { name: '<img src=x onerror=alert(1)>', screen_name: 'jack' }, videos: [], gifs: [], images: [], quote: null };
  let resolves = 0;
  const s = setup({ routes: {
    '/api/resolve': () => (++resolves === 1 ? reply(200, hidden) : resolveOk({ sensitive: true })),
    '/api/age-confirm': reply(200, { success: true })
  } });
  s.q('[data-input]').value = POST;
  await s.finder.runDownload();
  assert.equal(s.root.getAttribute('data-state'), 'sensitive');
  assert.equal(s.q('.sensitive__title').textContent, 'Sensitive content');
  assert.match(s.q('.sensitive__text').textContent, /get the download links/);
  assert.equal(s.q('.sensitive__names strong').textContent, '<img src=x onerror=alert(1)>', 'author name is text, never markup');
  assert.equal(s.root.querySelector('.sensitive img'), null);
  assert.equal(s.root.querySelectorAll('.result-temp a').length, 0);

  s.q('.sensitive__actions .btn--primary').dispatchEvent(new s.window.Event('click', { bubbles: true }));
  await s.flush(); await s.flush();
  assert.deepEqual(s.calls.map(call => call.url), ['/api/resolve', '/api/age-confirm', '/api/resolve']);
  assert.equal(s.root.getAttribute('data-state'), 'result');
});

test('Go back from the age check clears the box', async () => {
  const s = setup({ routes: { '/api/resolve': reply(200, { success: true, requires_age_confirmation: true, author: { name: 'a', screen_name: 'b' } }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runDownload();
  s.q('.sensitive__actions .btn--outline').dispatchEvent(new s.window.Event('click', { bubbles: true }));
  assert.equal(s.root.getAttribute('data-state'), 'idle');
  assert.equal(s.q('[data-input]').value, '');
});

test('the viewer mode asks for confirmation with the viewer wording', async () => {
  const s = setup({ mode: 'viewer', routes: { '/api/archive': reply(422, { code: 'CONTENT_MODERATION_REJECTED' }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runView();
  assert.equal(s.root.getAttribute('data-state'), 'rejected');
});

test('View saves a copy, keeps the saving screen up for a moment, then opens it', async () => {
  const s = setup({ routes: { '/api/archive': reply(200, { success: true, url: '/h0b9Ls', cached: false, saved_at: '2026-10-01T00:00:00.000Z' }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runView();
  assert.deepEqual(s.calls, [{ url: '/api/archive', body: { url: CANONICAL } }]);
  assert.equal(s.root.getAttribute('data-state'), 'saving');
  assert.equal(s.q('.saving__title').textContent, 'Saving a copy…');
  assert.ok(s.q('.saving__art svg'));
  assert.ok(s.q('[data-action="view"]').classList.contains('is-loading'), 'still busy while leaving');
  assert.deepEqual(s.navigations, []);
  s.timeouts.at(-1).fn();
  assert.deepEqual(s.navigations, ['/h0b9Ls']);
  assert.ok(s.timeouts.at(-1).ms <= 1200);
});

test('a post that was saved before shows its date and then opens the copy', async () => {
  const s = setup({ routes: { '/api/archive': reply(200, { success: true, url: '/h0b9Ls', cached: true, saved_at: '2026-03-04T10:00:00.000Z' }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runView();
  assert.equal(s.root.getAttribute('data-state'), 'alreadySaved');
  assert.match(s.q('.status-card__title').textContent, /^Already saved on .*2026/);
  assert.equal(s.q('.status-card__text').textContent, 'Opening the saved copy…');
  s.timeouts.at(-1).fn();
  assert.deepEqual(s.navigations, ['/h0b9Ls']);
});

test('a malformed archive answer is not followed as a redirect', async () => {
  const s = setup({ routes: { '/api/archive': reply(200, { success: true, url: 'https://evil.test/x' }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runView();
  assert.deepEqual(s.navigations, []);
  assert.equal(s.root.getAttribute('data-state'), 'busy');
});

test('Check for a saved copy opens a saved one, or says there is none', async () => {
  const found = setup({ routes: { '/api/resolve': reply(404, { code: 'SOURCE_UNAVAILABLE' }), '/api/saved-copy': reply(200, { success: true, found: true, url: '/h0b9Ls', saved_at: '2026-01-01T00:00:00.000Z' }) } });
  found.q('[data-input]').value = POST;
  await found.finder.runDownload();
  found.q('.status-card .btn--outline').dispatchEvent(new found.window.Event('click', { bubbles: true }));
  await found.flush();
  assert.deepEqual(found.calls.map(c => c.url), ['/api/resolve', '/api/saved-copy']);
  assert.equal(found.root.getAttribute('data-state'), 'alreadySaved');

  const none = setup({ routes: { '/api/resolve': reply(404, { code: 'SOURCE_UNAVAILABLE' }), '/api/saved-copy': reply(200, { success: true, found: false }) } });
  none.q('[data-input]').value = POST;
  await none.finder.runDownload();
  none.q('.status-card .btn--outline').dispatchEvent(new none.window.Event('click', { bubbles: true }));
  await none.flush();
  assert.equal(none.root.getAttribute('data-state'), 'unavailable');
  assert.equal(none.q('.status-card__text').textContent, none.text.unavailable.textNoCopy);
});

test('Paste fills the box from the clipboard; failures show the long-press hint', async () => {
  const ok = setup({ clipboard: { readText: async () => `  ${POST}\n` } });
  await ok.finder.paste();
  assert.equal(ok.q('[data-input]').value, POST);

  const denied = setup({ clipboard: { readText: async () => { throw new Error('denied'); } } });
  await denied.finder.paste();
  assert.equal(denied.q('[data-message]').textContent, 'Long-press the box to paste');
  assert.equal(denied.q('[data-input]').value, '');

  const unsupported = setup({ clipboard: undefined });
  await unsupported.finder.paste();
  assert.equal(unsupported.q('[data-message]').hidden, false);
});

test('clipboard hint appears only when access is already granted and the content is an X post link', async () => {
  const granted = { query: async () => ({ state: 'granted' }) };
  const withLink = setup({ clipboard: { readText: async () => POST }, permissions: granted });
  await withLink.flush();
  assert.equal(withLink.q('[data-clipboard]').hidden, false);
  assert.equal(withLink.calls.length, 0, 'never submits on its own');
  withLink.q('[data-clipboard]').dispatchEvent(new withLink.window.Event('click', { bubbles: true }));
  assert.equal(withLink.q('[data-input]').value, POST);
  assert.equal(withLink.q('[data-clipboard]').hidden, true);

  for (const [clipboard, permissions] of [
    [{ readText: async () => 'just some text' }, granted],
    [{ readText: async () => POST }, { query: async () => ({ state: 'prompt' }) }],
    [{ readText: async () => POST }, { query: async () => { throw new Error('unsupported'); } }],
    [{ readText: async () => POST }, undefined]
  ]) {
    const s = setup({ clipboard, permissions });
    await s.flush();
    assert.equal(s.q('[data-clipboard]').hidden, true);
  }
});

test('Chinese pages use Chinese state text', async () => {
  const s = setup({ lang: 'zh', routes: { '/api/resolve': reply(404, { code: 'SOURCE_UNAVAILABLE' }) } });
  s.q('[data-input]').value = POST;
  await s.finder.runDownload();
  assert.equal(s.q('.status-card__title').textContent, '该帖子无法查看');
});
