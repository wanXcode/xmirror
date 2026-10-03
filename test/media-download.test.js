const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { downloadImage, imageExtension, isTwimgUrl } = require('../lib/media-download');

function serve(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/img` }));
  });
}

const allow = () => true;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xput-img-'));
const opts = (dir, extra = {}) => ({ dir, filename: 'a.jpg', isAllowedUrl: allow, request: http.get, ...extra });

test('saves a valid image atomically under the given directory', async () => {
  const dir = tmp();
  const { server, url } = await serve((_, res) => { res.setHeader('content-type', 'image/jpeg'); res.end('JPEGDATA'); });
  try {
    assert.equal(await downloadImage(url, opts(dir)), '/images/a.jpg');
    assert.equal(fs.readFileSync(path.join(dir, 'a.jpg'), 'utf8'), 'JPEGDATA');
    assert.deepEqual(fs.readdirSync(dir), ['a.jpg']);
  } finally { server.close(); }
});

test('rejects non-200 responses instead of saving the error page as an image', async () => {
  const dir = tmp();
  const { server, url } = await serve((_, res) => { res.statusCode = 403; res.setHeader('content-type', 'image/jpeg'); res.end('denied'); });
  try {
    await assert.rejects(downloadImage(url, opts(dir)), /HTTP 403/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { server.close(); }
});

test('rejects non-image content types', async () => {
  const dir = tmp();
  const { server, url } = await serve((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<html>'); });
  try {
    await assert.rejects(downloadImage(url, opts(dir)), /not an image/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { server.close(); }
});

test('rejects oversized bodies, whether declared or streamed, and cleans up', async () => {
  const dir = tmp();
  const declared = await serve((_, res) => { res.setHeader('content-type', 'image/png'); res.setHeader('content-length', '5000'); res.end('x'.repeat(5000)); });
  const chunked = await serve((_, res) => { res.setHeader('content-type', 'image/png'); res.write('x'.repeat(600)); res.write('x'.repeat(600)); res.end(); });
  try {
    await assert.rejects(downloadImage(declared.url, opts(dir, { maxBytes: 1000 })), /too large/);
    await assert.rejects(downloadImage(chunked.url, opts(dir, { maxBytes: 1000 })), /too large/);
    // the partial file is removed right after the rejection; give a busy machine a moment
    for (let i = 0; i < 40 && fs.readdirSync(dir).length; i += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { declared.server.close(); chunked.server.close(); }
});

test('times out a stalled download and leaves no partial file', async () => {
  const dir = tmp();
  const { server, url } = await serve((_, res) => { res.setHeader('content-type', 'image/jpeg'); res.write('abc'); });
  try {
    await assert.rejects(downloadImage(url, opts(dir, { timeoutMs: 100 })), /timed out/);
    for (let i = 0; i < 40 && fs.readdirSync(dir).length; i += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { server.closeAllConnections(); server.close(); }
});

test('only X CDN https hosts and safe filenames are accepted by default', async () => {
  assert.equal(isTwimgUrl('https://pbs.twimg.com/media/a.jpg'), true);
  assert.equal(isTwimgUrl('https://video.twimg.com/a.mp4'), true);
  for (const bad of ['http://pbs.twimg.com/a.jpg', 'https://evil-twimg.com/a.jpg', 'https://twimg.com.evil.test/a.jpg', 'https://127.0.0.1/a', 'nonsense']) {
    assert.equal(isTwimgUrl(bad), false, bad);
  }
  const dir = tmp();
  await assert.rejects(downloadImage('https://example.com/a.jpg', { dir, filename: 'a.jpg' }), /not allowed/);
  await assert.rejects(downloadImage('https://pbs.twimg.com/a.jpg', { dir, filename: '../evil.jpg' }), /invalid image filename/);
});

test('image extension comes from the path or format query and is whitelisted', () => {
  assert.equal(imageExtension('https://pbs.twimg.com/media/X.PNG'), 'png');
  assert.equal(imageExtension('https://pbs.twimg.com/media/X?format=webp&name=orig'), 'webp');
  assert.equal(imageExtension('https://pbs.twimg.com/media/X.php'), 'jpg');
  assert.equal(imageExtension('garbage'), 'jpg');
});
