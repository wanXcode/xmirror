const test = require('node:test');
const assert = require('node:assert/strict');
const { parseXLink, formatCountdown, fillTemplate, retryAfterSeconds, classifyFailure } = require('../public/js/link');

test('accepts post links from x.com, twitter.com, mobile and www hosts, with or without a scheme', () => {
  const ok = [
    'https://x.com/jack/status/20',
    'http://twitter.com/jack/status/20',
    'https://mobile.twitter.com/jack/status/20',
    'https://www.x.com/jack/status/20',
    'x.com/jack/status/20',
    '  https://x.com/jack/status/20?s=20&t=abc#frag  ',
    'https://x.com/i/status/20',
    'https://x.com/i/web/status/20',
    'https://x.com/jack/status/20/photo/1',
    'https://twitter.com/jack/statuses/20',
    'https://x.com/jack/article/20'
  ];
  for (const value of ok) {
    assert.deepEqual(parseXLink(value), { status: 'ok', id: '20', url: 'https://x.com/i/status/20' }, value);
  }
});

test('profile-like X links are "profile", everything else that is not an X link is "invalid"', () => {
  for (const value of ['https://x.com/jack', 'https://x.com/', 'https://x.com/home', 'https://x.com/search?q=cats', 'https://twitter.com/jack/likes', 'x.com/jack/status/', 'https://x.com/jack/status/abc']) {
    assert.equal(parseXLink(value).status, 'profile', value);
  }
  for (const value of ['https://example.com/watch/12', 'hello world', 'ftp://x.com/jack/status/20', 'javascript:alert(1)', 'https://x.com.evil.test/jack/status/20', 'https://notx.com/a/status/1', 'https://evil.test/?u=x.com/a/status/1']) {
    assert.equal(parseXLink(value).status, 'invalid', value);
  }
});

test('empty input is reported separately', () => {
  for (const value of ['', '   ', null, undefined]) assert.deepEqual(parseXLink(value), { status: 'empty' });
});

test('a numeric id is capped so absurd input is not treated as a post', () => {
  assert.equal(parseXLink('https://x.com/a/status/' + '9'.repeat(26)).status, 'profile');
  assert.equal(parseXLink('https://x.com/a/status/' + '9'.repeat(25)).status, 'ok');
});

test('countdown formatting', () => {
  assert.equal(formatCountdown(42), '0:42');
  assert.equal(formatCountdown(75), '1:15');
  assert.equal(formatCountdown(60), '1:00');
  assert.equal(formatCountdown(0.2), '0:01');
  assert.equal(formatCountdown(-5), '0:00');
  assert.equal(formatCountdown('x'), '0:00');
});

test('templates fill known placeholders and leave unknown ones alone', () => {
  assert.equal(fillTemplate('Try again in {time}', { time: '0:42' }), 'Try again in 0:42');
  assert.equal(fillTemplate('{a} {b}', { a: 1 }), '1 {b}');
});

test('Retry-After is parsed, defaulted and clamped', () => {
  assert.equal(retryAfterSeconds('42'), 42);
  assert.equal(retryAfterSeconds(null), 60);
  assert.equal(retryAfterSeconds('abc'), 60);
  assert.equal(retryAfterSeconds('0'), 60);
  assert.equal(retryAfterSeconds('999999'), 3600);
});

test('API failures map to the states in the design', () => {
  assert.equal(classifyFailure(429, 'RATE_LIMITED'), 'tooMany');
  assert.equal(classifyFailure(429, undefined), 'tooMany');
  assert.equal(classifyFailure(400, 'INVALID_URL'), 'invalid');
  assert.equal(classifyFailure(404, 'SOURCE_UNAVAILABLE'), 'unavailable');
  assert.equal(classifyFailure(422, 'CONTENT_MODERATION_REJECTED'), 'rejected');
  assert.equal(classifyFailure(409, 'CONTENT_MODERATION_PENDING'), 'rejected');
  assert.equal(classifyFailure(503, 'SERVICE_UNAVAILABLE'), 'busy');
  assert.equal(classifyFailure(504, 'REQUEST_TIMEOUT'), 'busy');
  assert.equal(classifyFailure(undefined, undefined), 'busy');
});
