const test = require('node:test');
const assert = require('node:assert/strict');
const { isBrokenArticleArchive, normalizeXTimestamp, renderTweetContent } = require('../lib/x-post');

const escapeHtml = text => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

test('structured X Article takes priority over its internal URL in tweet.text', () => {
  const tweet = {
    text: 'https://x.com/i/article/2095431394029707267',
    article: {
      title: '完整文章标题',
      content: {
        blocks: [
          { type: 'header-one', text: '完整文章标题', entityRanges: [] },
          { type: 'unstyled', text: '这是正文内容', entityRanges: [] }
        ],
        entityMap: []
      },
      media_entities: []
    }
  };

  const result = renderTweetContent({ tweet, escapeHtml });
  assert.match(result.htmlContent, /完整文章标题/);
  assert.match(result.htmlContent, /这是正文内容/);
  assert.doesNotMatch(result.htmlContent, /x\.com\/i\/article/);
});

test('ordinary tweets still use tweet.text and attached images', () => {
  const result = renderTweetContent({
    tweet: { text: '普通推文', media_entities: [] },
    localImages: ['/images/example.jpg'],
    escapeHtml
  });

  assert.match(result.htmlContent, /普通推文/);
  assert.match(result.htmlContent, /\/images\/example\.jpg/);
});

test('Unix seconds are normalized to a valid ISO date', () => {
  assert.equal(normalizeXTimestamp(1788428618), '2026-09-03T09:43:38.000Z');
  assert.equal(normalizeXTimestamp('1788428618'), '2026-09-03T09:43:38.000Z');
});

test('broken article-only archives are detected for one-time refresh', () => {
  const broken = 'https://x.com/i/article/2095431394029707267<br><br><img src="/images/a.jpg">';
  assert.equal(isBrokenArticleArchive(broken), true);
  assert.equal(isBrokenArticleArchive('<p>正常正文</p><img src="/images/a.jpg">'), false);
});
