const test = require('node:test');
const assert = require('node:assert/strict');
const { cacheKey, clip, cleanText, dataUri, imageType, renderOgImage } = require('../lib/og-image');
const { isTwimg } = require('../lib/routes/og');

const isPng = buffer => buffer.length > 1000 && buffer.toString('latin1', 1, 4) === 'PNG';
const size = buffer => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

test('text is cleaned: emoji and links removed, whitespace collapsed', () => {
  assert.equal(cleanText('Hi 🚀  there\n https://t.co/abc 👨‍👩‍👧 ok'), 'Hi there ok');
});

test('clip cuts at a word boundary, adds an ellipsis, and handles CJK without spaces', () => {
  const long = 'word '.repeat(60);
  const out = clip(long, 120);
  assert.ok(out.endsWith('…') && [...out].length <= 121);
  assert.ok(!/\bwor…$/.test(out), 'no half word');
  assert.equal(clip('short text'), 'short text');
  assert.equal([...clip('字'.repeat(200))].length, 121);
});

test('image sniffing only accepts png, jpeg and gif', () => {
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/png');
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(imageType(Buffer.from('GIF89a000000')), 'image/gif');
  assert.equal(imageType(Buffer.from('<svg xmlns="x"></svg>')), null);
  assert.equal(dataUri(Buffer.from('RIFF....WEBPVP8 ')), null);
});

test('avatars are only fetched from twimg.com over https', () => {
  assert.equal(isTwimg('https://pbs.twimg.com/a.jpg'), true);
  assert.equal(isTwimg('http://pbs.twimg.com/a.jpg'), false);
  assert.equal(isTwimg('https://evil.example/twimg.com'), false);
  assert.equal(isTwimg('https://twimg.com.evil.example/a.jpg'), false);
  assert.equal(isTwimg('not a url'), false);
});

test('cache key changes with the drawn content, not with unrelated fields', () => {
  const base = { author: 'A', handle: 'a', text: 'hello', media: false };
  assert.equal(cacheKey('ABC123', base), cacheKey('ABC123', { ...base, extra: 1 }));
  assert.notEqual(cacheKey('ABC123', base), cacheKey('ABC123', { ...base, text: 'hello!' }));
  assert.notEqual(cacheKey('ABC123', base), cacheKey('ABC123', { ...base, media: true }));
});

test('renders 1200x630 PNGs for English, Chinese, and media layouts', { timeout: 60000 }, async () => {
  for (const input of [
    { author: 'Jack 🚀', handle: 'jack', text: 'Hello world '.repeat(30), media: false },
    { author: '张三', handle: 'zs', text: '下个季度我们将调整产品路线图。', media: true, thumb: { src: null, video: true } },
    { author: '', handle: '', text: '', media: false }
  ]) {
    const png = await renderOgImage(input);
    assert.ok(isPng(png));
    assert.deepEqual(size(png), { width: 1200, height: 630 });
  }
});
