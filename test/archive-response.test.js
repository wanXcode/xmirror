const test = require('node:test');
const assert = require('node:assert/strict');
const { ArchiveError, normalizeArchiveUrl, archiveErrorResponse, readSourceResponse, archiveSuccessResponse } = require('../lib/archive-response');

test('archive URL failures consistently use INVALID_URL, including missing and non-string input', () => {
  for (const input of [null, undefined, {}, 123, '', 'https://x.com/home', 'https://other.com/u/status/1', 'ftp://x.com/u/status/1']) {
    assert.throws(() => normalizeArchiveUrl(input), { code: 'INVALID_URL' });
  }
  assert.equal(normalizeArchiveUrl('https://twitter.com/user/status/123?s=20'), 'https://x.com/i/status/123');
});

test('source responses distinguish missing posts from upstream service failures', () => {
  const tweet = { text: 'hello' };
  assert.equal(readSourceResponse(200, { code: 200, tweet }), tweet);
  for (const [status, json] of [[404, {}], [200, { code: 404 }], [403, {}]]) {
    assert.throws(() => readSourceResponse(status, json), { code: 'SOURCE_UNAVAILABLE' });
  }
  for (const status of [429, 500, 502, 503]) {
    assert.throws(() => readSourceResponse(status, {}), { code: 'SERVICE_UNAVAILABLE' });
  }
  assert.throws(() => readSourceResponse(200, { code: 200 }), { code: 'SERVICE_UNAVAILABLE' });
});

test('technical error details never appear in API errors', () => {
  const secret = 'SQLITE details /path/private upstream credentials';
  for (const [code, expected, status] of [
    ['INVALID_URL', 'INVALID_URL', 400], ['CONTENT_MODERATION_REJECTED', 'CONTENT_UNSUPPORTED', 400],
    ['ECONNRESET', 'NETWORK_ERROR', 502], ['ENOTFOUND', 'NETWORK_ERROR', 502],
    ['ETIMEDOUT', 'REQUEST_TIMEOUT', 504], ['REQUEST_TIMEOUT', 'REQUEST_TIMEOUT', 504],
    ['SQLITE_ERROR', 'SERVICE_UNAVAILABLE', 503]
  ]) {
    const response = archiveErrorResponse(Object.assign(new Error(secret), { code }));
    assert.equal(response.status, status);
    assert.equal(response.body.code, expected);
    assert.equal(response.body.success, false);
    assert.ok(!JSON.stringify(response).includes(secret));
  }
  assert.equal(archiveErrorResponse(new ArchiveError('REQUEST_TIMEOUT')).body.retryable, true);
});

test('new and cached archives share complete metadata and real video state', () => {
  const post = { id: 1, short_code: 'Ab1234', content: '<h1>【A &amp; B】</h1><p>Body</p>', author: 'Author', video_status: 'downloading' };
  const created = archiveSuccessResponse(post);
  const cached = archiveSuccessResponse(post, true);
  for (const result of [created, cached]) {
    assert.equal(result.title, 'A & B');
    assert.equal(result.author, 'Author');
    assert.equal(result.video_status, 'downloading');
    assert.equal(result.url, '/Ab1234');
    assert.equal(result.id, 1);
  }
  assert.equal(created.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(archiveSuccessResponse({ ...post, video_status: null, video: '/videos/1.mp4' }).video_status, 'completed');
});
