const test = require('node:test');
const assert = require('node:assert/strict');
const { isReservedShortCode, loadReservedShortCodes, SHORT_CODE_PATTERN } = require('../lib/shortcode');
const { fixedSlugs } = require('../lib/pages');

const reserved = loadReservedShortCodes();

test('the reserved list covers every word the design spec requires', () => {
  for (const word of ['zh', 'pt', 'en', 'ios-shortcut', 'api', 'about', 'privacy', 'terms', 'report', 'help', 'blog', 'static', 'images', 'videos', 'assets']) {
    assert.ok(reserved.has(word), word);
  }
});

test('every fixed page slug is reserved, so a short code can never shadow or be shadowed by a page', () => {
  for (const slug of fixedSlugs()) assert.ok(reserved.has(slug), slug);
});

test('reserved matching ignores case, because fixed routes do too', () => {
  assert.equal(isReservedShortCode('report', reserved), true);
  assert.equal(isReservedShortCode('Report', reserved), true);
  assert.equal(isReservedShortCode('IMAGES', reserved), true);
  assert.equal(isReservedShortCode('h0b9Ls', reserved), false);
});

test('short code shape is exactly six letters or digits', () => {
  for (const ok of ['h0b9Ls', 'Ab1234']) assert.match(ok, SHORT_CODE_PATTERN);
  for (const bad of ['abc', 'abcdefg', 'ab-123', '']) assert.doesNotMatch(bad, SHORT_CODE_PATTERN);
});

test('a malformed reserved file is rejected', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rsv-')), 'r.json');
  fs.writeFileSync(file, '{"a":1}');
  assert.throws(() => loadReservedShortCodes(file), /array of strings/);
});
