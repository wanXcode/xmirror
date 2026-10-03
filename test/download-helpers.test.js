const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../public/js/download');
const { createZip, crc32 } = require('../public/js/zip');

test('byte and duration formatting', () => {
  assert.equal(D.formatBytes(25300000), '24.1 MB');
  assert.equal(D.formatBytes(3800000), '3.6 MB');
  assert.equal(D.formatBytes(850 * 1024), '850 KB');
  assert.equal(D.formatBytes(10), '1 KB');
  assert.equal(D.formatBytes(2.5 * 1024 ** 3), '2.5 GB');
  for (const bad of [0, -1, null, undefined, 'x', NaN]) assert.equal(D.formatBytes(bad), '', String(bad));
  assert.equal(D.formatDuration(42), '0:42');
  assert.equal(D.formatDuration(61), '1:01');
  assert.equal(D.formatDuration(3725), '1:02:05');
  assert.equal(D.formatDuration(0.4), '');
  assert.equal(D.formatDuration(null), '');
});

test('quality labels come from height, then resolution, then bitrate', () => {
  assert.equal(D.qualityOf({ height: 1080 }), '1080p');
  assert.equal(D.qualityOf({ resolution: '640x360' }), '640x360');
  assert.equal(D.qualityOf({ bitrate: 950000 }), '950 kbps');
  assert.equal(D.qualityOf({}), 'MP4');
});

test('the in-card preview uses the largest variant up to 720p', () => {
  const v = h => ({ height: h, url: `u${h}` });
  assert.equal(D.pickPreviewVariant([v(1080), v(720), v(360)]).url, 'u720');
  assert.equal(D.pickPreviewVariant([v(1080)]).url, 'u1080', 'a single large variant is still used');
  assert.equal(D.pickPreviewVariant([{ url: 'unknown' }]).url, 'unknown');
});

test('proxy URLs encode the target and the name; file names are safe', () => {
  assert.equal(D.proxyUrl('/dl', 'https://video.twimg.com/a b.mp4?x=1&y=2', 'clip 1.mp4'),
    '/dl?u=https%3A%2F%2Fvideo.twimg.com%2Fa%20b.mp4%3Fx%3D1%26y%3D2&n=clip%201.mp4');
  assert.match(D.proxyUrl('https://dl.example/proxy?token=1', 'https://x', 'a'), /^https:\/\/dl\.example\/proxy\?token=1&u=/);
  assert.equal(D.fileName(['xput', '20', '', '1080p'], 'mp4'), 'xput_20_1080p.mp4');
  assert.equal(D.fileName(['a/b', '../c'], 'jpg'), 'a_b_c.jpg');
  assert.equal(D.fileName([], 'zip'), 'xput.zip');
  assert.equal(D.extensionOf('https://pbs.twimg.com/media/A?format=png&name=orig', 'jpg'), 'png');
  assert.equal(D.extensionOf('https://pbs.twimg.com/media/A.webp', 'jpg'), 'webp');
  assert.equal(D.extensionOf('https://pbs.twimg.com/media/A', 'jpg'), 'jpg');
});

test('platform detection', () => {
  assert.deepEqual(D.detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), { ios: true, android: false, mobile: true });
  assert.equal(D.detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }).ios, true, 'iPadOS pretends to be a Mac');
  assert.equal(D.detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }).mobile, false);
  assert.deepEqual(D.detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' }), { ios: false, android: true, mobile: true });
  assert.equal(D.detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }).mobile, false);
  assert.equal(D.detectPlatform(undefined).mobile, false);
});

test('canShareFiles needs both share and canShare, and survives exceptions', () => {
  assert.equal(D.canShareFiles({ share() {}, canShare: () => true }, []), true);
  assert.equal(D.canShareFiles({ share() {}, canShare: () => false }, []), false);
  assert.equal(D.canShareFiles({ share() {} }, []), false);
  assert.equal(D.canShareFiles({ share() {}, canShare() { throw new Error('x'); } }, []), false);
  assert.equal(D.canShareFiles(undefined, []), false);
});

test('fetchBlob reports progress, and turns HTTP errors into DownloadError with Retry-After', async () => {
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
  const response = new Response(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }), { headers: { 'content-length': '5', 'content-type': 'video/mp4' } });
  const seen = [];
  const blob = await D.fetchBlob(async () => response, '/dl?x', (done, total) => seen.push([done, total]));
  assert.deepEqual(seen, [[3, 5], [5, 5]]);
  assert.equal(blob.size, 5);
  assert.equal(blob.type, 'video/mp4');

  await assert.rejects(D.fetchBlob(async () => new Response('', { status: 429, headers: { 'retry-after': '42' } }), '/dl'), error => error.name === 'DownloadError' && error.status === 429 && error.retryAfter === 42);
  await assert.rejects(D.fetchBlob(async () => new Response('', { status: 502 }), '/dl'), error => error.status === 502 && error.retryAfter === 60);
});

test('zip: CRC32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip: the archive is valid for a real unzip tool, with names, bytes and UTF-8 intact', { skip: spawnSync('python3', ['--version']).error ? 'python3 is not installed' : false }, () => {
  const files = [
    { name: 'xput_20_1.jpg', data: new Uint8Array([0xFF, 0xD8, 0xFF, 1, 2, 3]) },
    { name: '图片 2.jpg', data: new TextEncoder().encode('second file '.repeat(500)) },
    { name: 'empty.bin', data: new Uint8Array(0) }
  ];
  const archive = createZip(files, new Date(2026, 9, 1, 12, 30, 10));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-zip-'));
  const file = path.join(dir, 'a.zip');
  fs.writeFileSync(file, archive);
  const script = `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
names = z.namelist()
assert names == ['xput_20_1.jpg', '图片 2.jpg', 'empty.bin'], names
assert z.read(names[0]) == bytes([0xFF, 0xD8, 0xFF, 1, 2, 3])
assert z.read(names[1]) == ('second file ' * 500).encode()
assert z.read(names[2]) == b''
assert z.infolist()[0].date_time[:3] == (2026, 10, 1), z.infolist()[0].date_time
print('ok')`;
  const result = spawnSync('python3', ['-c', script, file], { encoding: 'utf8' });
  assert.equal(result.stdout.trim(), 'ok', result.stderr);
});
