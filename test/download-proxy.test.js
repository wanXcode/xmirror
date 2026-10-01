const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const express = require('express');
const { createDownloadProxy } = require('../lib/download-proxy');
const { createMediaInfo } = require('../lib/media-info');

let core;
test.before(async () => { core = await import('../workers/download-proxy/core.mjs'); });

const MP4 = 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/a.mp4';
const request = (path, method = 'GET') => `https://xput.app/dl${path}`;

test('only https media on *.twimg.com can be proxied', () => {
  for (const ok of [MP4, 'https://pbs.twimg.com/media/A?format=jpg&name=orig', 'https://ton.twimg.com/x.jpg']) assert.equal(core.isAllowedMediaUrl(ok), true, ok);
  for (const bad of [
    'http://video.twimg.com/a.mp4', 'https://evil.com/a.mp4', 'https://twimg.com.evil.com/a.mp4', 'https://eviltwimg.com/a.mp4',
    'https://video.twimg.com@evil.com/a.mp4', 'https://user:pw@video.twimg.com/a.mp4', 'https://video.twimg.com:8443/a.mp4',
    'https://127.0.0.1/a.mp4', 'https://localhost/a', 'file:///etc/passwd', 'javascript:alert(1)', '', 'not a url'
  ]) assert.equal(core.isAllowedMediaUrl(bad), false, bad);
});

test('request parsing: method, target and file name', () => {
  const ok = core.parseDownloadRequest(request(`?u=${encodeURIComponent(MP4)}&n=${encodeURIComponent('xput 1080p.mp4')}`));
  assert.equal(ok.ok, true);
  assert.equal(ok.target, MP4);
  assert.equal(ok.filename, 'xput_1080p.mp4');
  assert.equal(core.parseDownloadRequest(request(`?u=${encodeURIComponent(MP4)}`)).filename, 'xput-download.mp4', 'default name keeps the extension');
  assert.equal(core.parseDownloadRequest(request(`?u=${encodeURIComponent('https://pbs.twimg.com/media/A?format=png&name=orig')}`)).filename, 'xput-download.png', 'extension falls back to the format parameter');
  for (const [url, status] of [[request(''), 400], [request('?u=https://evil.com/a.mp4'), 400], [request(`?u=${'a'.repeat(3000)}`), 400]]) {
    const bad = core.parseDownloadRequest(url);
    assert.equal(bad.ok, false);
    assert.equal(bad.response.status, status);
    assert.equal(JSON.parse(bad.response.body).success, false);
  }
  const post = core.parseDownloadRequest(request(`?u=${encodeURIComponent(MP4)}`), 'POST');
  assert.equal(post.response.status, 405);
  assert.equal(post.response.headers.Allow, 'GET, HEAD');
});

test('file names cannot inject headers or paths', () => {
  assert.equal(core.sanitizeFilename('../../etc/passwd'), 'etc_passwd');
  assert.equal(core.sanitizeFilename('a"\r\nSet-Cookie: x=1.mp4'), 'a_Set-Cookie_x_1.mp4');
  assert.equal(core.sanitizeFilename('...'), 'xput-download');
  assert.equal(core.sanitizeFilename('.hidden.mp4'), 'hidden.mp4');
  assert.equal(core.sanitizeFilename('视频.mp4'), 'xput-download.mp4', 'the extension survives a name with nothing usable in it');
  assert.equal(core.sanitizeFilename(''), 'xput-download');
  assert.equal(core.sanitizeFilename(null, 'fallback'), 'fallback');
  assert.equal(core.sanitizeFilename('x'.repeat(500)).length, 100);
  const header = core.contentDisposition('a"b.mp4');
  assert.match(header, /^attachment; filename="a_b\.mp4"; filename\*=UTF-8''a_b\.mp4$/);
  assert.doesNotMatch(header, /[\r\n]/);
});

test('upstream requests carry nothing from the visitor except a valid range', () => {
  const headers = core.upstreamHeaders(name => ({ cookie: 'secret=1', authorization: 'Bearer x', range: 'bytes=0-99', referer: 'https://xput.app' }[name]));
  assert.deepEqual(Object.keys(headers).sort(), ['Accept', 'Accept-Encoding', 'Range', 'User-Agent']);
  assert.equal(headers['Accept-Encoding'], 'identity');
  assert.equal('Range' in core.upstreamHeaders(() => 'bytes=0-1,5-9'), false);
  assert.equal('Range' in core.upstreamHeaders(() => undefined), false);
});

test('upstream answers are checked: status, media type and size', () => {
  const h = values => name => values[name];
  assert.equal(core.checkUpstream(200, h({ 'content-type': 'video/mp4', 'content-length': '100' })).ok, true);
  assert.equal(core.checkUpstream(206, h({ 'content-type': 'image/jpeg' })).ok, true);
  assert.equal(core.checkUpstream(302, h({ 'content-type': 'video/mp4' })).response.status, 502, 'redirects are refused');
  assert.equal(core.checkUpstream(404, h({})).response.status, 404);
  assert.equal(core.checkUpstream(200, h({ 'content-type': 'text/html' })).response.status, 502);
  assert.equal(core.checkUpstream(200, h({ 'content-type': 'application/json' })).ok, false);
  assert.equal(core.checkUpstream(200, h({ 'content-type': 'video/mp4', 'content-length': String(core.MAX_BYTES + 1) })).response.status, 413);
});

test('download headers force a save, never cache, and expose the length for progress', () => {
  const headers = core.downloadHeaders(name => ({ 'content-type': 'video/mp4', 'content-length': '2048', 'content-range': 'bytes 0-1/2048' }[name]), 'clip.mp4');
  assert.match(headers['Content-Disposition'], /^attachment;/);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Content-Length'], '2048');
  assert.equal(headers['Content-Range'], 'bytes 0-1/2048');
  assert.equal(headers['Content-Type'], 'video/mp4');
  assert.match(headers['Access-Control-Expose-Headers'], /Content-Length/);
});

// ---- the Node proxy, driven with a fake upstream ----
function fakeUpstream({ status = 200, headers = { 'content-type': 'video/mp4', 'content-length': '11' }, body = 'hello world', error } = {}) {
  const seen = [];
  const request = (url, options, callback) => {
    seen.push({ url: String(url), options });
    const req = new PassThrough();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => {
      if (error) return setImmediate(() => req.emit('error', error));
      const upstream = new PassThrough();
      upstream.statusCode = status;
      upstream.headers = headers;
      setImmediate(() => { callback(upstream); upstream.end(body); });
    };
    return req;
  };
  return { request, seen };
}

async function withProxy(upstreamOptions, run) {
  const upstream = fakeUpstream(upstreamOptions);
  const app = express();
  const proxy = createDownloadProxy({ request: upstream.request });
  app.get('/dl', (req, res, next) => proxy(req, res).catch(next));
  app.head('/dl', (req, res, next) => proxy(req, res).catch(next));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}/dl`, upstream.seen); } finally { server.close(); }
}

test('node proxy streams the file with attachment headers and sends no visitor cookies upstream', async () => {
  await withProxy({}, async (base, seen) => {
    const response = await fetch(`${base}?u=${encodeURIComponent(MP4)}&n=clip.mp4`, { headers: { Cookie: 'session=secret' } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'hello world');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="clip\.mp4"/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, MP4);
    assert.equal(JSON.stringify(seen[0].options.headers).includes('secret'), false);
  });
});

test('node proxy refuses other hosts without contacting anyone, and HEAD returns headers only', async () => {
  await withProxy({}, async (base, seen) => {
    const bad = await fetch(`${base}?u=${encodeURIComponent('https://evil.com/a.mp4')}`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'INVALID_TARGET');
    assert.equal(seen.length, 0);
    const head = await fetch(`${base}?u=${encodeURIComponent(MP4)}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '11');
    assert.equal(await head.text(), '');
  });
});

test('node proxy maps upstream failures to JSON errors', async () => {
  await withProxy({ status: 404, headers: { 'content-type': 'text/html' } }, async base => {
    const response = await fetch(`${base}?u=${encodeURIComponent(MP4)}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'UPSTREAM_ERROR');
  });
  await withProxy({ headers: { 'content-type': 'text/html' } }, async base => {
    assert.equal((await fetch(`${base}?u=${encodeURIComponent(MP4)}`)).status, 502);
  });
  await withProxy({ error: new Error('boom') }, async base => {
    const response = await fetch(`${base}?u=${encodeURIComponent(MP4)}`);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'UPSTREAM_UNREACHABLE');
  });
});

test('Worker entry applies the same rules, rate limit and redirect policy', async () => {
  const worker = (await import('../workers/download-proxy/index.js')).default;
  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url, init });
    return new Response('bytes', { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '5' } });
  };
  try {
    const ask = (path, env = {}, init = {}) => worker.fetch(new Request(`https://xput.app/dl${path}`, init), env);
    const ok = await ask(`?u=${encodeURIComponent(MP4)}&n=a.mp4`, { RATE_LIMITER: { limit: async () => ({ success: true }) } }, { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-disposition'), /^attachment/);
    assert.equal(await ok.text(), 'bytes');
    assert.equal(upstreamCalls[0].init.redirect, 'manual');

    let limitedKey;
    const limited = await ask(`?u=${encodeURIComponent(MP4)}`, { RATE_LIMITER: { limit: async ({ key }) => { limitedKey = key; return { success: false }; } } }, { headers: { 'CF-Connecting-IP': '9.9.9.9' } });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal(limitedKey, '9.9.9.9');
    assert.equal(upstreamCalls.length, 1, 'a limited request never reaches X');

    const head = await ask(`?u=${encodeURIComponent(MP4)}`, { RATE_LIMITER: { limit: async () => { throw new Error('HEAD must not count'); } } }, { method: 'HEAD' });
    assert.equal(head.status, 200);

    assert.equal((await ask('?u=https://evil.com/x.mp4')).status, 400);
    assert.equal((await ask(`?u=${encodeURIComponent(MP4)}`, {}, { method: 'POST' })).status, 405);

    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.com' } });
    assert.equal((await ask(`?u=${encodeURIComponent(MP4)}`)).status, 502);
    globalThis.fetch = async () => { throw new TypeError('network'); };
    assert.equal((await ask(`?u=${encodeURIComponent(MP4)}`)).status, 502);
  } finally { globalThis.fetch = originalFetch; }
});

test('media-info asks the CDN with HEAD only, caches answers, and ignores non-X hosts', async () => {
  const asked = [];
  const request = (url, options, callback) => {
    asked.push({ url: String(url), method: options.method });
    const req = new PassThrough();
    req.end = () => setImmediate(() => callback(Object.assign(new PassThrough(), { statusCode: String(url).includes('missing') ? 404 : 200, headers: { 'content-length': '2048' } })));
    return req;
  };
  const info = createMediaInfo({ request });
  const first = await info.sizes([MP4, MP4, 'https://evil.com/a.mp4', 'https://video.twimg.com/missing.mp4']);
  assert.deepEqual(first, { [MP4]: 2048, 'https://evil.com/a.mp4': null, 'https://video.twimg.com/missing.mp4': null });
  assert.deepEqual(asked.map(a => a.method), ['HEAD', 'HEAD']);
  await info.sizes([MP4]);
  assert.equal(asked.length, 2, 'the second lookup is served from the cache');
});
