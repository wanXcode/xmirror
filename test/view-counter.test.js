const test = require('node:test');
const assert = require('node:assert/strict');
const { createViewCounter, isBot } = require('../lib/view-counter');

test('counts are batched per post and flushed together', async () => {
  const batches = [];
  const counter = createViewCounter({ flush: async batch => batches.push([...batch]) });
  counter.view(1); counter.view(1); counter.view(2); counter.share(1);
  assert.equal(counter.size(), 2);
  assert.equal(await counter.flush(), 2);
  assert.deepEqual(batches, [[[1, { views: 2, shares: 1 }], [2, { views: 1, shares: 0 }]]]);
  assert.equal(counter.size(), 0);
  assert.equal(await counter.flush(), 0, 'nothing to write');
  assert.equal(batches.length, 1);
});

test('a failed write keeps the counts for the next flush', async () => {
  let fail = true;
  const written = [];
  const counter = createViewCounter({ flush: async batch => { if (fail) throw new Error('db busy'); written.push([...batch]); } });
  counter.view(5); counter.share(5);
  await assert.rejects(counter.flush(), /db busy/);
  counter.view(5);
  fail = false;
  await counter.flush();
  assert.deepEqual(written, [[[5, { views: 2, shares: 1 }]]]);
});

test('the timer flushes on its interval and can be stopped', async () => {
  const intervals = [];
  const flushed = [];
  const counter = createViewCounter({
    flush: async batch => flushed.push(batch.size), intervalMs: 1000,
    timers: { setInterval: (fn, ms) => { intervals.push({ fn, ms }); return { unref() {} }; }, clearInterval: () => { intervals.length = 0; } }
  });
  counter.start(); counter.start();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 1000);
  counter.view(1);
  intervals[0].fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(flushed, [1]);
  counter.stop();
  assert.equal(intervals.length, 0);
});

test('crawlers, link previews and tools are not counted as readers', () => {
  for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'TelegramBot', 'curl/8.0', 'Slackbot-LinkExpanding', 'HeadlessChrome', '', undefined]) {
    assert.equal(isBot(ua), true, String(ua));
  }
  assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'), false);
  assert.equal(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36'), false);
});
