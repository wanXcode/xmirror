const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STRATEGY_VERSION,
  MAX_TRANSLATABLE_CHARS,
  MAX_TRANSLATABLE_SEGMENTS,
  totalCharacters,
  nextBatch,
  progress,
  jobKey
} = require('../lib/translation-jobs');

test('translation jobs use stable identity and keep the strategy version explicit', () => {
  assert.equal(STRATEGY_VERSION, '1.7.1');
  assert.equal(jobKey({ postId: 4, targetLang: 'zh-CN', sourceHash: 'abc' }), '4:zh-CN:abc:1.7.1');
});

test('batch planner prioritizes a small first batch and limits later batches', () => {
  const segments = Array.from({ length: 12 }, () => ({ text: 'x'.repeat(100) }));
  assert.equal(nextBatch(segments, { first: true }).length, 1);
  assert.equal(nextBatch(segments, { first: false }).length, 8);
  assert.equal(totalCharacters(segments), 1200);
});

test('progress exposes pending and completed counts', () => {
  assert.deepEqual(progress(58, 12, 3), { total: 58, completed: 12, failed: 3, pending: 43, percent: 26 });
  assert.equal(MAX_TRANSLATABLE_CHARS, 100000);
  assert.equal(MAX_TRANSLATABLE_SEGMENTS, 1000);
});

test('database segments respect the character budget', () => {
  const rows = Array.from({ length: 8 }, () => ({ source_text: 'x'.repeat(800) }));
  assert.equal(nextBatch(rows).length, 1);
});
