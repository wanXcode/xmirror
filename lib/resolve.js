const { extractXPostId, renderTweetContent } = require('./x-post');
const { normalizeArchiveUrl } = require('./archive-response');

function isSensitiveTweet(tweet) {
  return tweet.sensitive === true || tweet.quote?.sensitive === true;
}

function publicVideo(video) {
  return {
    type: video.type,
    thumbnail: video.thumbnail,
    duration: video.duration,
    width: video.width,
    height: video.height,
    // Highest bitrate first (already sorted by the fetcher).
    variants: video.variants.map(v => ({
      url: v.url,
      bitrate: v.bitrate,
      resolution: v.resolution,
      width: v.width,
      height: v.height,
      content_type: v.content_type
    }))
  };
}

function buildMedia(tweet) {
  return {
    videos: (tweet.videos || []).filter(v => v.type === 'video').map(publicVideo),
    gifs: (tweet.videos || []).filter(v => v.type === 'gif').map(publicVideo),
    images: (tweet.photos || []).map(p => ({ url: p.url, orig_url: p.orig_url, width: p.width, height: p.height }))
  };
}

function buildResolveResponse(tweet, { confirmAge = false, canonicalUrl } = {}) {
  const sensitive = isSensitiveTweet(tweet);
  const base = {
    success: true,
    id: tweet.id,
    url: canonicalUrl,
    source: tweet.source,
    author: tweet.author,
    sensitive,
    requires_age_confirmation: sensitive && !confirmAge
  };
  // Nothing that could be adult content leaves the server until the viewer
  // has confirmed their age; the client re-sends the request with confirm_age.
  if (base.requires_age_confirmation) {
    return { ...base, text: '', created_at: null, videos: [], gifs: [], images: [], quote: null };
  }
  return {
    ...base,
    text: tweet.text,
    created_at: tweet.created_at,
    truncated: tweet.truncated === true,
    ...buildMedia(tweet),
    // Media of the quoted post is listed separately so the page can label it as such.
    quote: tweet.quote ? {
      id: tweet.quote.id, url: tweet.quote.url, author: tweet.quote.author, text: tweet.quote.text, ...buildMedia(tweet.quote)
    } : null
  };
}

/**
 * Parse, moderate and resolve a post URL into direct media links.
 * Writes nothing: no database rows, no downloads, no HTML.
 * deps: { fetchTweet, precheck(url), assess(payload), escapeHtml }
 */
async function resolveUrl(rawUrl, { confirmAge = false } = {}, deps) {
  const canonicalUrl = normalizeArchiveUrl(rawUrl);
  deps.precheck?.(canonicalUrl);

  const tweet = await deps.fetchTweet(extractXPostId(canonicalUrl));
  if (deps.assess) {
    await deps.assess({
      url: canonicalUrl,
      authorHandle: tweet.author.screen_name,
      authorName: tweet.author.name,
      content: renderTweetContent({ tweet, escapeHtml: deps.escapeHtml }).htmlContent
    });
  }
  return buildResolveResponse(tweet, { confirmAge, canonicalUrl });
}

module.exports = { buildResolveResponse, isSensitiveTweet, resolveUrl };
