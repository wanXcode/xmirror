const test = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../lib/seo');
const post = (changes = {}) => ({ id: 1, short_code: 'Ab1234', author: 'Alice', author_handle: 'alice', tweet_time: '2026-09-27T01:00:00Z', url: 'https://x.com/i/status/123', content: '<p>' + '自然语言内容'.repeat(40) + '</p>', images: '[]', video_status: 'none', ...changes });

test('quality admits substantial text without images and uses Unicode units', () => {
  assert.equal(seo.evaluate(post(), { moderation: 'allow' }).status, 'index');
  assert.equal(seo.units('中文 a verylongword https://example.com/x 😀'), 4);
  assert.equal(seo.units('日本語 한국어'), 6);
  assert.equal(seo.plainText('one<br>two<p>three</p>four'), 'one two three four');
});
test('threshold boundaries and transient missing data remain explicit', () => {
  for (const [n, expected] of [[0, 'noindex'], [39, 'noindex'], [40, 'noindex'], [159, 'noindex'], [160, 'index']]) {
    assert.equal(seo.evaluate(post({ content: '字'.repeat(n) }), { moderation: 'allow' }).status, expected);
  }
  assert.equal(seo.evaluate(post({ tweet_time: null }), { moderation: 'allow' }).status, 'review');
  assert.equal(seo.evaluate(post({ content: 'word '.repeat(80), video_status: 'queued' }), { moderation: 'allow' }).status, 'review');
  assert.equal(seo.evaluate(post({ video_status: 'failed' }), { moderation: 'allow' }).status, 'index');
});
test('hard blocks, duplicate and unknown moderation cannot be overridden', () => {
  const overridden = post({ seo_override: 'index' });
  assert.equal(seo.evaluate(overridden, { moderation: 'reject' }).status, 'noindex');
  assert.equal(seo.evaluate(overridden, { moderation: 'allow', duplicate: true }).status, 'noindex');
  assert.equal(seo.evaluate(overridden).status, 'review');
  assert.equal(seo.evaluate(post({ seo_blocked: 1, seo_override: 'index' }), { moderation: 'allow' }).status, 'noindex');
  assert.equal(seo.evaluate(post({ seo_override: 'noindex' }), { moderation: 'allow' }).status, 'noindex');
  assert.equal(seo.evaluate(post(), { moderation: 'allow', autoIndex: false }).status, 'review');
});
test('hash includes destination and media; metadata decodes and escapes safely', () => {
  assert.equal(seo.contentHash(post()), seo.contentHash(post({ id: 42, short_code: 'Xy5678' })));
  assert.notEqual(seo.contentHash(post()), seo.contentHash(post({ images: '["/images/test.jpg"]' })));
  assert.equal(seo.metadata(post({ content: '<h1>A &amp; B</h1><p>Test</p>' })).title, 'A & B');
  assert.equal(seo.escape('"<x>&'), '&quot;&lt;x&gt;&amp;');
});
test('share images only include safe local files and sitemap excludes blocked/unknown pages', () => {
  assert.deepEqual(seo.imagesFor({ images: '["/images/a.jpg","https://evil.test/a.jpg","/images/../x"]' }), ['/images/a.jpg']);
  assert.deepEqual(seo.imagesFor({ images: 'broken' }), []);
  const xml = seo.sitemap([post({ seo_status: 'index' }), post({ short_code: 'De5678', seo_status: 'review' }), post({ short_code: 'Gh9012', seo_status: 'index', seo_blocked: 1 })], 'https://xput.app');
  assert.match(xml, /https:\/\/xput.app\/Ab1234/);
  assert.doesNotMatch(xml, /De5678|Gh9012|lastmod/);
  assert.equal(seo.robotsFor({}), 'noindex, follow');
});

test('historical Unix seconds and milliseconds are valid without inventing missing dates', () => {
  for (const tweet_time of ['1770736224',1770736224000,'2026-02-10T12:30:24Z']) assert.equal(seo.evaluate(post({tweet_time}),{moderation:'allow'}).status,'index');
  for (const tweet_time of ['',null,'garbage',' ']) assert.equal(seo.evaluate(post({tweet_time}),{moderation:'allow'}).status,'review');
});
test('informative short content needs preserved media and readable structure to qualify',()=>{
 const content='<p>'+'信息'.repeat(50)+'</p>';
 assert.equal(seo.evaluate(post({content}),{moderation:'allow',hasMedia:true}).status,'index');
 assert.notEqual(seo.evaluate(post({content}),{moderation:'allow',hasMedia:false}).status,'index');
 assert.notEqual(seo.evaluate(post({content:'<p>'+'信息'.repeat(30)+'</p>'}),{moderation:'allow',hasMedia:true}).status,'index');
});
