const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { downloadVideoToFile } = require('../lib/video-download');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xput-vid-'));
// Fake https.get: `script(response, req)` runs on the next tick, after the response callback.
const fake = (script, { status = 200, headers = {} } = {}) => (url, _opts, onResponse) => {
  const req = new EventEmitter();
  req.destroy = error => { if (error) process.nextTick(() => req.emit('error', error)); };
  req.setTimeout = () => {};
  const response = new PassThrough(); response.statusCode = status; response.headers = headers;
  process.nextTick(() => { onResponse(response); script(response, req); });
  return req;
};

test('saves the video atomically and reports progress', async () => {
  const dir = tmp(); const filePath = path.join(dir, 'v.mp4'); const seen = [];
  const out = await downloadVideoToFile('u', { filePath, onProgress: (d, t) => seen.push([d, t]),
    request: fake(r => { r.write('abcd'); r.end('efgh'); }, { headers: { 'content-length': '8' } }) });
  assert.deepEqual(out, { bytes: 8, total: 8 });
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'abcdefgh');
  assert.deepEqual(fs.readdirSync(dir), ['v.mp4']);
  assert.ok(seen.length >= 1);
});

test('every failure leaves no .part file the moment it rejects (no waiting)', async () => {
  const cases = {
    'aborted upstream': [fake(r => { r.write('abc'); r.emit('aborted'); }), /中断/],
    'upstream error': [fake(r => { r.write('abc'); r.destroy(new Error('reset')); }), /reset/],
    'truncated body': [fake(r => { r.write('abc'); r.end(); }, { headers: { 'content-length': '999' } }), /不完整/],
    'bad status': [fake(r => r.end('no'), { status: 403 }), /403/],
    'request error after start': [fake((r, req) => { r.write('abc'); req.emit('error', new Error('timeout')); }), /timeout/]
  };
  for (const [name, [request, pattern]] of Object.entries(cases)) {
    for (let i = 0; i < 10; i += 1) {
      const dir = tmp();
      await assert.rejects(downloadVideoToFile('u', { filePath: path.join(dir, 'v.mp4'), request }), pattern, name);
      assert.deepEqual(fs.readdirSync(dir), [], name);
    }
  }
});

test('follows redirects, with a limit, and only to allowed hosts', async () => {
  const dir = tmp(); const filePath = path.join(dir, 'v.mp4');
  const request = (url, o, cb) => (url === 'first' ? fake(r => r.end(), { status: 302, headers: { location: 'second' } })
    : fake(r => r.end('ok'), { headers: { 'content-length': '2' } }))(url, o, cb);
  assert.deepEqual(await downloadVideoToFile('first', { filePath, request }), { bytes: 2, total: 2 });
  await assert.rejects(downloadVideoToFile('first', { filePath: path.join(dir, 'w.mp4'), request, isAllowedUrl: u => u === 'first' }), /不在允许范围/);
  const loop = fake(r => r.end(), { status: 302, headers: { location: 'again' } });
  await assert.rejects(downloadVideoToFile('again', { filePath: path.join(dir, 'x.mp4'), request: loop }), /重定向过多/);
});
