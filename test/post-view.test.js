const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPostView, cleanContent, excerpt, isArticleLike, localDownloads, plainText } = require('../lib/post-view');

const post = (extra = {}) => ({
  id: 7, short_code: 'Ab1234', url: 'https://x.com/i/status/20', author: 'Jack', author_handle: 'jack',
  author_avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg', content: 'hello', images: '[]', video: null, video_status: 'none',
  tweet_time: '2026-09-30T10:00:00.000Z', created_at: '2026-10-01 09:00:00', reply_count: 3, ...extra
});

test('ordinary posts: gallery images leave the text and are listed separately', () => {
  const view = buildPostView(post({ content: 'look<br><br><img src="/images/20_0.jpg" style="max-width:100%"><img src="/images/20_1.jpg">', images: '["/images/20_0.jpg","/images/20_1.jpg"]' }));
  assert.equal(view.textHtml, 'look');
  assert.deepEqual(view.images.map(i => i.src), ['/images/20_0.jpg', '/images/20_1.jpg']);
  assert.equal(view.plainText, 'look');
  assert.equal(view.hasMedia, true);
});

test('articles keep their inline pictures (cleaned) and drop the gallery', () => {
  const content = '<h1>Title</h1><p>one</p><img src="/images/9_0.jpg" style="x" onerror="boom()"><h2>Sub</h2><p>two</p><img src="https://evil.test/x.jpg"><img src="javascript:alert(1)">';
  assert.equal(isArticleLike(content), true);
  const view = buildPostView(post({ content, images: '["/images/9_0.jpg"]' }));
  assert.match(view.textHtml, /<h2>Title<\/h2><p>one<\/p><img[^>]*src="\/images\/9_0\.jpg"/, 'h1 becomes h2: the page already has an H1');
  assert.match(view.textHtml, /<img[^>]*loading="lazy"/);
  assert.match(view.textHtml, /<h3>Sub<\/h3>/);
  assert.doesNotMatch(view.textHtml, /evil\.test|javascript:|onerror|style=/);
  assert.deepEqual(view.images, []);
});

test('cleaning removes scripts, event handlers and non-http links, and hardens real links', () => {
  const html = cleanContent('<p onclick="x()">a <a href="javascript:alert(1)">bad</a> <a href="https://example.com/p">good</a><script>alert(1)</script></p>', { keepImages: false });
  assert.doesNotMatch(html, /script|onclick|javascript:/);
  const link = html.match(/<a [^>]*href="https:\/\/example\.com\/p"[^>]*>good<\/a>/)[0];
  assert.match(link, /rel="noopener noreferrer nofollow"/);
  assert.match(link, /target="_blank"/);
  assert.match(html, /<a>bad<\/a>/, 'a javascript: link keeps its text but loses the link');
});

test('plain text and excerpts', () => {
  assert.equal(plainText('a<br>b<br><p>c</p><blockquote class="quoted-post"><p>d</p></blockquote>'), 'a b c d');
  assert.equal(excerpt('short text', 50), 'short text');
  assert.equal(excerpt('The quick brown fox jumps over the lazy dog and keeps going', 30), 'The quick brown fox jumps over…');
  assert.equal(excerpt('一二三四五六七八九十', 5), '一二三四五…');
  assert.equal(excerpt('  spaced   out  ', 50), 'spaced out');
  assert.equal(excerpt('', 10), '');
});

test('video states: ready, pending, failed, none; GIF flag and poster; unsafe paths are ignored', () => {
  assert.deepEqual(buildPostView(post({ video: '/videos/20_video.mp4', video_status: 'completed', video_poster: '/images/20_poster.jpg', video_is_gif: 1 })).video,
    { state: 'ready', src: '/videos/20_video.mp4', poster: '/images/20_poster.jpg', isGif: true });
  assert.equal(buildPostView(post({ video_status: 'downloading', video_source_url: 'https://video.twimg.com/a.mp4' })).video.state, 'pending');
  assert.equal(buildPostView(post({ video_status: 'queued', video_source_url: 'x' })).video.state, 'pending');
  assert.equal(buildPostView(post({ video_status: 'failed' })).video.state, 'failed');
  assert.equal(buildPostView(post()).video.state, 'none');
  assert.equal(buildPostView(post()).hasMedia, false);
  assert.equal(buildPostView(post({ video: '../../etc/passwd', video_status: 'completed' })).video.state, 'none');
  assert.equal(buildPostView(post({ video: '/videos/a.mp4', video_status: 'completed', video_poster: 'https://evil.test/p.jpg' })).video.poster, null);
});

test('extra videos report their own state', () => {
  const view = buildPostView(post({ extra_videos: JSON.stringify([{ type: 'gif', path: '/videos/20_video_1.mp4', status: 'completed' }, { type: 'video', status: 'queued' }, { type: 'video', status: 'failed' }]) }));
  assert.deepEqual(view.extraVideos.map(v => [v.state, v.isGif, v.src]), [['ready', true, '/videos/20_video_1.mp4'], ['pending', false, null], ['failed', false, null]]);
  assert.equal(buildPostView(post({ extra_videos: 'not json' })).extraVideos.length, 0);
});

test('dates, replies, sensitivity and avatar come through; non-https avatars are dropped', () => {
  const view = buildPostView(post({ sensitive: 1, author_avatar: 'http://evil.test/a.jpg', reply_count: 0 }));
  assert.equal(view.postedAt, '2026-09-30T10:00:00.000Z');
  assert.equal(view.savedAt, '2026-10-01T09:00:00.000Z');
  assert.equal(view.replies, 0);
  assert.equal(view.sensitive, true);
  assert.equal(view.author.avatar, '');
  assert.equal(buildPostView(post({ reply_count: null })).replies, null);
  assert.equal(buildPostView(post({ tweet_time: null })).postedAt, null);
});

test('downloads of the saved files, in the shape the result cards use', () => {
  const view = buildPostView(post({
    images: '["/images/20_0.jpg"]', video: '/videos/20_video.mp4', video_status: 'completed',
    extra_videos: JSON.stringify([{ type: 'gif', path: '/videos/20_video_1.mp4', status: 'completed' }, { type: 'video', status: 'queued' }])
  }));
  const local = localDownloads(view);
  assert.deepEqual(local.videos.map(v => v.variants[0].url), ['/videos/20_video.mp4']);
  assert.deepEqual(local.gifs.map(v => v.variants[0].url), ['/videos/20_video_1.mp4']);
  assert.deepEqual(local.images, [{ url: '/images/20_0.jpg', orig_url: '/images/20_0.jpg', width: null, height: null }]);
});
