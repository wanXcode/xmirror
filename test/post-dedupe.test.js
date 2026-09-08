const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDedupePlan, summarizeDedupePlan } = require('../lib/post-dedupe');

test('groups URL variants by tweet ID and keeps the oldest post', () => {
  const plan = buildDedupePlan([
    { id: 2, url: 'https://x.com/user/status/123/photo/1', short_code: 'BBBBBB', created_at: '2026-01-02' },
    { id: 1, url: 'https://twitter.com/user/status/123?s=20', short_code: 'AAAAAA', created_at: '2026-01-01' },
    { id: 3, url: 'https://x.com/user/status/456', short_code: 'CCCCCC', created_at: '2026-01-03' }
  ]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].tweetId, '123');
  assert.equal(plan[0].survivor.id, 1);
  assert.deepEqual(plan[0].duplicates.map(post => post.id), [2]);
  assert.deepEqual(summarizeDedupePlan(plan), { groups: 1, duplicateRecords: 1 });
});

test('uses id as a stable fallback when timestamps are absent or equal', () => {
  const plan = buildDedupePlan([
    { id: 9, url: 'https://x.com/i/status/999', short_code: 'IIIIII' },
    { id: 4, url: 'https://x.com/user/status/999#fragment', short_code: 'DDDDDD' }
  ]);
  assert.equal(plan[0].survivor.id, 4);
});
