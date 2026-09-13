const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PUBLIC_BASE_URL,
  normalizePublicBaseUrl,
  buildPublicUrl
} = require('../lib/public-url');

test('public archive URLs default to the external HTTPS origin', () => {
  assert.equal(DEFAULT_PUBLIC_BASE_URL, 'https://xmirror.app');
  assert.equal(buildPublicUrl('/CxCwBZ'), 'https://xmirror.app/CxCwBZ');
});

test('PUBLIC_BASE_URL can override the deployment origin', () => {
  assert.equal(
    buildPublicUrl('/CxCwBZ', 'https://staging.example.com/'),
    'https://staging.example.com/CxCwBZ'
  );
});

test('public base URLs reject non-HTTP protocols', () => {
  assert.throws(
    () => normalizePublicBaseUrl('file:///tmp/xmirror'),
    /must use http or https/
  );
});
