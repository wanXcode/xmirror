const test = require('node:test');
const assert = require('node:assert/strict');
const home = require('../public/home-state');

function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}
function record(id, extra = {}) {
  return {
    id, title: `Title ${id}`, author: 'Author', url: '/Ab1234',
    source_url: `https://x.com/example/status/${id}`, generated_at: new Date(1700000000000 + id * 1000).toISOString(), ...extra
  };
}

test('generated records persist and a duplicate is updated and moved to the top', () => {
  const local = storage();
  home.saveRecord(local, record(1));
  home.saveRecord(local, record(2));
  const updated = record(1, { title: 'Updated', generated_at: '2026-09-26T10:00:00Z' });
  assert.equal(home.saveRecord(local, updated).saved, true);
  assert.deepEqual(home.readRecords(local), [updated, record(2)]);
});

test('history retains only the newest 200 records', () => {
  const local = storage(JSON.stringify(Array.from({ length: 201 }, (_, i) => record(i + 1))));
  const records = home.saveRecord(local, record(202)).records;
  assert.equal(records.length, 200);
  assert.equal(records[0].id, 202);
  assert.equal(records.at(-1).id, 3);
});

test('corrupt or unavailable browser storage never prevents a successful archive', () => {
  const corrupt = storage('{broken');
  assert.deepEqual(home.readRecords(corrupt), []);
  assert.equal(home.saveRecord(corrupt, record(1)).saved, true);
  for (const local of [
    { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    { getItem: () => '[]', setItem() { throw new Error('quota'); } }
  ]) {
    assert.deepEqual(home.readRecords(local), []);
    assert.equal(home.saveRecord(local, record(1)).saved, false);
  }
});

test('untrusted history is validated and normalized before use', () => {
  const records = home.normalizeRecords([
    record(1), record(1), record(2, { url: 'javascript:alert(1)' }),
    record(3, { source_url: 'https://other.com/user/status/3' }),
    record(4, { generated_at: 'bad' }), null, { title: 'invalid' }
  ]);
  assert.deepEqual(records, [record(1)]);
});

test('URL validation accepts supported variants but rejects misleading or non-post links', () => {
  for (const url of ['https://x.com/user/status/123?s=20', 'https://mobile.twitter.com/user/status/123/photo/1', 'https://x.com/i/article/123']) {
    assert.equal(home.validSourceUrl(url), true, url);
  }
  for (const url of ['', 'https://x.com/user', 'https://x.com.evil.com/u/status/1', 'javascript://x.com/u/status/1', 'https://example.com/?url=x.com/u/status/1']) {
    assert.equal(home.validSourceUrl(url), false, url);
  }
});

test('recoverable failures allow retry and invalid inputs do not', () => {
  for (const code of ['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'SERVICE_UNAVAILABLE']) assert.equal(home.failureFor(code).retryable, true);
  for (const code of ['INVALID_URL', 'SOURCE_UNAVAILABLE', 'CONTENT_UNSUPPORTED']) assert.equal(home.failureFor(code).retryable, false);
  assert.equal(home.failureFor(undefined, 504).key, 'errorTimeout');
  assert.equal(home.failureFor(undefined, 502).key, 'errorService');
});
