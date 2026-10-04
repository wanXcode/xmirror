const test = require('node:test');
const assert = require('node:assert/strict');
const { jsonLd, socialMediaPosting } = require('../lib/views/seo-head');
const { buildPostView } = require('../lib/post-view');

const post = extra => ({ id: 1, short_code: 'Ab1234', url: 'https://x.com/jack/status/20', author: 'Jack', author_handle: 'jack',
  content: 'hello', images: '[]', video_status: 'none', tweet_time: '2026-09-30T10:00:00.000Z', created_at: '2026-10-01 09:00:00', ...extra });
const ld = row => socialMediaPosting({ baseUrl: 'https://xput.app', view: buildPostView(row), headline: 'h', description: 'd' });

test('datePublished is the original post time, and is always present', () => {
  assert.equal(ld(post()).datePublished, '2026-09-30T10:00:00.000Z');
});

test('older stored post-time formats (X legacy string, epoch) still give the original time', () => {
  assert.equal(ld(post({ tweet_time: 'Wed Oct 01 12:00:00 +0000 2026' })).datePublished, '2026-10-01T12:00:00.000Z');
  assert.equal(ld(post({ tweet_time: '1790000000' })).datePublished, '2026-09-21T14:13:20.000Z');
});

test('without a usable post time, datePublished falls back to the time the copy was saved', () => {
  for (const tweet_time of [null, '', 'not a date']) {
    assert.equal(ld(post({ tweet_time })).datePublished, '2026-10-01T09:00:00.000Z', String(tweet_time));
  }
});

test('with no date at all, no invalid structured data is emitted', () => {
  const data = ld(post({ tweet_time: null, created_at: null }));
  assert.equal(data, null);
  assert.equal(String(jsonLd(data)), '');
});
