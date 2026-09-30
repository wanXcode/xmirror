const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUrl, buildResolveResponse } = require('../lib/resolve');
const { normalizeFxtwitter } = require('../lib/fetchers/normalize');
const { ModerationRejectError } = require('../lib/moderation');

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tweet(overrides = {}) {
  return {
    ...normalizeFxtwitter({
      id: '100', text: 'hi <b>', created_timestamp: 1700000000,
      author: { name: 'Alice', screen_name: 'alice', avatar_url: 'a' },
      media: {
        photos: [{ url: 'https://pbs.twimg.com/media/P1.jpg', width: 10, height: 10 }],
        videos: [
          { type: 'video', url: 'https://video.twimg.com/v/avc1/640x360/a.mp4', formats: [
            { url: 'https://video.twimg.com/v/avc1/640x360/a.mp4', container: 'mp4', bitrate: 500 },
            { url: 'https://video.twimg.com/v/avc1/1280x720/b.mp4', container: 'mp4', bitrate: 2000 }] },
          { type: 'gif', url: 'https://video.twimg.com/tweet_video/G.mp4', width: 100, height: 100 }
        ]
      }
    }),
    ...overrides
  };
}

const deps = (t, extra = {}) => ({ fetchTweet: async () => t, escapeHtml, ...extra });

test('resolve returns sorted video variants, separate gifs and original image links', async () => {
  const body = await resolveUrl('https://twitter.com/alice/status/100?s=20', {}, deps(tweet()));
  assert.equal(body.success, true);
  assert.equal(body.url, 'https://x.com/i/status/100');
  assert.equal(body.sensitive, false);
  assert.equal(body.videos.length, 1);
  assert.deepEqual(body.videos[0].variants.map(v => [v.bitrate, v.resolution]), [[2000, '1280x720'], [500, '640x360']]);
  assert.equal(body.gifs.length, 1);
  assert.equal(body.gifs[0].type, 'gif');
  assert.equal(body.images[0].orig_url, 'https://pbs.twimg.com/media/P1?format=jpg&name=orig');
  assert.equal(body.text, 'hi <b>');
});

test('sensitive posts hide links and text until the age is confirmed', async () => {
  const t = tweet({ sensitive: true });
  const locked = await resolveUrl('https://x.com/a/status/100', {}, deps(t));
  assert.equal(locked.sensitive, true);
  assert.equal(locked.requires_age_confirmation, true);
  assert.deepEqual([locked.videos, locked.gifs, locked.images], [[], [], []]);
  assert.equal(locked.text, '');
  assert.equal(JSON.stringify(locked).includes('video.twimg.com'), false);

  const open = await resolveUrl('https://x.com/a/status/100', { confirmAge: true }, deps(t));
  assert.equal(open.sensitive, true);
  assert.equal(open.requires_age_confirmation, false);
  assert.equal(open.videos.length, 1);
});

test('a sensitive quoted post also requires confirmation', () => {
  const t = tweet({ quote: { id: '1', url: null, author: { name: 'b', screen_name: 'b' }, text: 'q', sensitive: true } });
  assert.equal(buildResolveResponse(t, { canonicalUrl: 'u' }).requires_age_confirmation, true);
});

test('moderation runs before any links are returned and can reject or hold', async () => {
  const seen = [];
  const reject = async () => { throw new ModerationRejectError('no'); };
  await assert.rejects(resolveUrl('https://x.com/a/status/100', {}, deps(tweet(), { assess: reject })), { code: 'CONTENT_MODERATION_REJECTED' });

  await assert.rejects(resolveUrl('https://x.com/bad/status/100', {}, deps(tweet(), {
    precheck: () => { throw new ModerationRejectError('blocked handle'); },
    fetchTweet: async () => { seen.push('fetched'); return tweet(); }
  })), { code: 'CONTENT_MODERATION_REJECTED' });
  assert.deepEqual(seen, []); // precheck stops before any upstream request

  let payload;
  await resolveUrl('https://x.com/a/status/100', {}, deps(tweet(), { assess: async p => { payload = p; } }));
  assert.equal(payload.authorHandle, 'alice');
  assert.match(payload.content, /hi &lt;b&gt;/);
});

test('invalid links are rejected before any fetch', async () => {
  await assert.rejects(resolveUrl('https://example.com/a/status/1', {}, deps(tweet())), { code: 'INVALID_URL' });
  await assert.rejects(resolveUrl(undefined, {}, deps(tweet())), { code: 'INVALID_URL' });
});
