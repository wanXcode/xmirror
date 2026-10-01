const test = require('node:test');
const assert = require('node:assert/strict');
const { createFetcher, FetchError } = require('../lib/fetchers');
const { normalizeFxtwitter, normalizeSyndication, origImageUrl, resolutionFromUrl } = require('../lib/fetchers/normalize');
const { syndicationToken } = require('../lib/fetchers/syndication');

const FX_TWEET = {
  id: '100', url: 'https://x.com/alice/status/100', text: 'hello', created_timestamp: 1700000000,
  possibly_sensitive: false,
  author: { name: 'Alice', screen_name: 'alice', avatar_url: 'https://pbs.twimg.com/a.jpg' },
  media: {
    photos: [{ type: 'photo', url: 'https://pbs.twimg.com/media/AbC_d-1.jpg', width: 800, height: 600 }],
    videos: [{
      type: 'video', url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/hi.mp4',
      thumbnail_url: 'https://pbs.twimg.com/thumb.jpg', duration: 12.5, width: 1280, height: 720,
      formats: [
        { url: 'https://video.twimg.com/x/pl/master.m3u8', container: 'm3u8', bitrate: 0 },
        { url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/640x360/lo.mp4', container: 'mp4', bitrate: 632000 },
        { url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/hi.mp4', container: 'mp4', bitrate: 2176000 }
      ]
    }, {
      type: 'gif', url: 'https://video.twimg.com/tweet_video/G1.mp4', thumbnail_url: 'https://pbs.twimg.com/g.jpg', width: 320, height: 240
    }]
  },
  quote: { id: '99', url: 'https://x.com/bob/status/99', text: 'quoted', author: { name: 'Bob', screen_name: 'bob' }, possibly_sensitive: true }
};

const SYN_TWEET = {
  id_str: '100', text: 'hello https://t.co/abc https://t.co/media', created_at: '2024-01-02T03:04:05.000Z',
  display_text_range: [0, 22],
  entities: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/page' }] },
  user: { name: 'Alice', screen_name: 'alice', profile_image_url_https: 'https://pbs.twimg.com/a.jpg' },
  mediaDetails: [
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/Photo1.png', original_info: { width: 100, height: 50 } },
    {
      type: 'animated_gif', media_url_https: 'https://pbs.twimg.com/thumb.jpg', original_info: { width: 320, height: 240 },
      video_info: { variants: [{ bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/G2.mp4' }] }
    },
    {
      type: 'video', media_url_https: 'https://pbs.twimg.com/thumb2.jpg', original_info: { width: 1920, height: 1080 },
      video_info: {
        duration_millis: 5000,
        variants: [
          { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/m.m3u8' },
          { bitrate: 950000, content_type: 'video/mp4', url: 'https://video.twimg.com/v/avc1/640x360/a.mp4' },
          { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/v/avc1/1280x720/b.mp4' }
        ]
      }
    }
  ],
  quoted_tweet: { id_str: '99', text: 'q', user: { name: 'Bob', screen_name: 'bob' } }
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Routes by hostname so one mock serves both sources.
function mockFetch(handlers, calls = []) {
  return async (url, options) => {
    const host = new URL(url).hostname;
    calls.push(host);
    const handler = handlers[host];
    if (!handler) throw new Error(`unexpected host ${host}`);
    return handler(url, options);
  };
}

const quiet = { log: () => {}, sleepImpl: async () => {}, backoffMs: 1 };

test('fxtwitter normalization sorts mp4 variants by bitrate and drops HLS', () => {
  const t = normalizeFxtwitter(FX_TWEET);
  assert.equal(t.author.screen_name, 'alice');
  assert.equal(t.created_at, '2023-11-14T22:13:20.000Z');
  assert.equal(t.sensitive, false);
  const [video, gif] = t.videos;
  assert.equal(video.type, 'video');
  assert.deepEqual(video.variants.map(v => v.bitrate), [2176000, 632000]);
  assert.equal(video.variants[0].resolution, '1280x720');
  assert.equal(video.variants[1].resolution, '640x360');
  assert.equal(gif.type, 'gif');
  assert.equal(gif.variants.length, 1);
  assert.equal(gif.variants[0].resolution, '320x240');
  assert.equal(t.photos[0].orig_url, 'https://pbs.twimg.com/media/AbC_d-1?format=jpg&name=orig');
  assert.equal(t.quote.author.screen_name, 'bob');
  assert.equal(t.quote.sensitive, true);
});

test('syndication normalization handles gifs, variants, quotes and link expansion', () => {
  const t = normalizeSyndication(SYN_TWEET);
  assert.equal(t.text, 'hello https://example.com/page');
  assert.equal(t.created_at, '2024-01-02T03:04:05.000Z');
  assert.equal(t.url, 'https://x.com/alice/status/100');
  assert.equal(t.photos[0].orig_url, 'https://pbs.twimg.com/media/Photo1?format=png&name=orig');
  assert.deepEqual(t.videos.map(v => v.type), ['gif', 'video']);
  assert.deepEqual(t.videos[1].variants.map(v => v.bitrate), [2176000, 950000]);
  assert.equal(t.videos[1].duration, 5);
  assert.equal(t.quote.text, 'q');
  assert.equal(normalizeSyndication({ __typename: 'TweetTombstone' }), null);
});

test('helpers: original image url, resolution parsing and syndication token', () => {
  assert.equal(origImageUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(origImageUrl('https://pbs.twimg.com/media/X?format=webp&name=small'), 'https://pbs.twimg.com/media/X?format=webp&name=orig');
  assert.deepEqual(resolutionFromUrl('https://v/vid/avc1/720x1280/a.mp4'), { width: 720, height: 1280 });
  assert.equal(resolutionFromUrl('https://v/a.mp4'), null);
  assert.match(syndicationToken('1700000000000000000'), /^[a-z0-9]+$/);
});

test('uses the first source when it succeeds and never calls the second', async () => {
  const calls = [];
  const fetchTweet = createFetcher({
    ...quiet, fetchImpl: mockFetch({ 'api.fxtwitter.com': () => json(200, { code: 200, tweet: FX_TWEET }) }, calls)
  });
  const tweet = await fetchTweet('100');
  assert.equal(tweet.source, 'fxtwitter');
  assert.deepEqual(calls, ['api.fxtwitter.com']);
});

test('falls back to syndication on 5xx, timeouts, network errors and incomplete data', async () => {
  const cases = {
    '5xx': () => json(503, {}),
    '429': () => json(429, {}),
    'embedded error code': () => json(200, { code: 500 }),
    'incomplete': () => json(200, { code: 200, tweet: { id: '100', text: 'x', author: {} } }),
    'network': () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); },
    'not found': () => json(404, { code: 404 })
  };
  for (const [name, fx] of Object.entries(cases)) {
    const fetchTweet = createFetcher({
      ...quiet,
      retries: 0,
      fetchImpl: mockFetch({ 'api.fxtwitter.com': fx, 'cdn.syndication.twimg.com': () => json(200, SYN_TWEET) })
    });
    assert.equal((await fetchTweet('100')).source, 'syndication', name);
  }
});

test('a hanging source is cut off at the timeout and the next source is used', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const fetchTweet = createFetcher({
    ...quiet, timeoutMs: 20, retries: 0,
    fetchImpl: mockFetch({ 'api.fxtwitter.com': hang, 'cdn.syndication.twimg.com': () => json(200, SYN_TWEET) })
  });
  const started = Date.now();
  assert.equal((await fetchTweet('100')).source, 'syndication');
  assert.ok(Date.now() - started < 1000);
});

test('retries a retryable failure once with backoff, but not a 404', async () => {
  let fxCalls = 0;
  const sleeps = [];
  const flaky = () => (++fxCalls === 1 ? json(502, {}) : json(200, { code: 200, tweet: FX_TWEET }));
  const fetchTweet = createFetcher({ log: () => {}, backoffMs: 100, sleepImpl: async ms => sleeps.push(ms), fetchImpl: mockFetch({ 'api.fxtwitter.com': flaky }) });
  assert.equal((await fetchTweet('100')).source, 'fxtwitter');
  assert.equal(fxCalls, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 100 && sleeps[0] < 130);

  let notFoundCalls = 0;
  const gone = createFetcher({
    ...quiet,
    fetchImpl: mockFetch({
      'api.fxtwitter.com': () => { notFoundCalls++; return json(404, { code: 404 }); },
      'cdn.syndication.twimg.com': () => json(200, SYN_TWEET)
    })
  });
  await gone('100');
  assert.equal(notFoundCalls, 1);
});

test('aggregate error code: unavailable only when every source says not found', async () => {
  const both = status => createFetcher({
    ...quiet, retries: 0,
    fetchImpl: mockFetch({ 'api.fxtwitter.com': () => json(status, {}), 'cdn.syndication.twimg.com': () => json(status, {}) })
  });
  await assert.rejects(both(404)('100'), { code: 'SOURCE_UNAVAILABLE' });
  await assert.rejects(both(500)('100'), { code: 'SERVICE_UNAVAILABLE' });
  const tombstone = createFetcher({
    ...quiet, retries: 0,
    fetchImpl: mockFetch({ 'api.fxtwitter.com': () => json(404, {}), 'cdn.syndication.twimg.com': () => json(200, { __typename: 'TweetTombstone' }) })
  });
  await assert.rejects(tombstone('100'), { code: 'SOURCE_UNAVAILABLE' });
  const timeouts = createFetcher({
    ...quiet, retries: 0, timeoutMs: 10,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))
  });
  await assert.rejects(timeouts('100'), { code: 'REQUEST_TIMEOUT' });
});

test('rejects a payload whose id does not match the request and invalid ids', async () => {
  const fetchTweet = createFetcher({
    ...quiet, retries: 0,
    fetchImpl: mockFetch({
      'api.fxtwitter.com': () => json(200, { code: 200, tweet: { ...FX_TWEET, id: '555' } }),
      'cdn.syndication.twimg.com': () => json(200, SYN_TWEET)
    })
  });
  assert.equal((await fetchTweet('100')).source, 'syndication');
  await assert.rejects(fetchTweet('abc'), error => error instanceof FetchError || error.code === 'SOURCE_UNAVAILABLE');
});

test('logs source, success flag and duration for every attempt without secrets', async () => {
  const entries = [];
  const fetchTweet = createFetcher({
    ...quiet, retries: 0, log: e => entries.push(e),
    fetchImpl: mockFetch({ 'api.fxtwitter.com': () => json(500, {}), 'cdn.syndication.twimg.com': () => json(200, SYN_TWEET) })
  });
  await fetchTweet('100');
  assert.deepEqual(entries.map(e => [e.source, e.ok]), [['fxtwitter', false], ['syndication', true]]);
  assert.ok(entries.every(e => typeof e.ms === 'number'));
  assert.equal(entries[0].error, 'upstream');
});

test('cache: successes live for an hour, repeated calls do not refetch', async () => {
  let clock = 1000;
  let calls = 0;
  const fetchTweet = createFetcher({
    ...quiet, now: () => clock,
    fetchImpl: mockFetch({ 'api.fxtwitter.com': () => { calls++; return json(200, { code: 200, tweet: FX_TWEET }); } })
  });
  const first = await fetchTweet('100');
  first.text = 'mutated by caller';
  assert.equal((await fetchTweet('100')).text, 'hello');
  assert.equal(calls, 1);
  clock += 59 * 60 * 1000;
  await fetchTweet('100');
  assert.equal(calls, 1);
  clock += 2 * 60 * 1000;
  await fetchTweet('100');
  assert.equal(calls, 2);
});

test('cache: failures are cached for 30 seconds only', async () => {
  let clock = 0;
  let calls = 0;
  const fetchTweet = createFetcher({
    ...quiet, retries: 0, now: () => clock,
    fetchImpl: mockFetch({
      'api.fxtwitter.com': () => { calls++; return json(404, {}); },
      'cdn.syndication.twimg.com': () => json(404, {})
    })
  });
  await assert.rejects(fetchTweet('100'), { code: 'SOURCE_UNAVAILABLE' });
  await assert.rejects(fetchTweet('100'), { code: 'SOURCE_UNAVAILABLE' });
  assert.equal(calls, 1);
  clock += 31 * 1000;
  await assert.rejects(fetchTweet('100'));
  assert.equal(calls, 2);
});

test('cache: concurrent calls share one upstream fetch and size is bounded', async () => {
  let calls = 0;
  const fetchTweet = createFetcher({
    ...quiet, cacheMaxEntries: 3,
    fetchImpl: mockFetch({
      'api.fxtwitter.com': async (url) => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        const id = url.split('/').pop();
        return json(200, { code: 200, tweet: { ...FX_TWEET, id } });
      }
    })
  });
  await Promise.all([fetchTweet('1'), fetchTweet('1'), fetchTweet('1')]);
  assert.equal(calls, 1);
  for (const id of ['2', '3', '4', '5']) await fetchTweet(id);
  assert.equal(fetchTweet.cache.size, 3);
  await fetchTweet('1'); // evicted, refetched
  assert.equal(calls, 6);
});
