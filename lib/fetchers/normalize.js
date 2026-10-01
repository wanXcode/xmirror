// Normalizers turn each source's payload into one shape:
//
// {
//   id, url, source,
//   author: { name, screen_name, avatar_url },
//   text, created_at (ISO string | null),
//   sensitive: boolean,
//   photos: [{ url, orig_url, width, height }],
//   videos: [{ type: 'video' | 'gif', thumbnail, duration, width, height,
//              variants: [{ url, bitrate, width, height, resolution, content_type }] }],
//   quote: { id, url, author, text, sensitive } | null,
//   article, media_entities   // X Article passthrough (fxtwitter only)
// }
//
// Variants are sorted by bitrate, highest first. GIFs are videos with type 'gif'.

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric < 1e12 ? numeric * 1000 : numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolutionFromUrl(url = '') {
  const match = String(url).match(/\/(\d{2,5})x(\d{2,5})\//);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

// pbs.twimg.com/media/<id>.jpg -> pbs.twimg.com/media/<id>?format=jpg&name=orig
function origImageUrl(url = '') {
  let parsed;
  try { parsed = new URL(url); } catch { return url; }
  if (parsed.hostname !== 'pbs.twimg.com' || !parsed.pathname.startsWith('/media/')) return url;
  const match = parsed.pathname.match(/^(\/media\/[^./]+)(?:\.([A-Za-z0-9]+))?$/);
  if (!match) return url;
  const format = match[2] || parsed.searchParams.get('format') || 'jpg';
  return `${parsed.origin}${match[1]}?format=${format}&name=orig`;
}

function normalizePhoto(photo) {
  if (!photo?.url) return null;
  return { url: photo.url, orig_url: origImageUrl(photo.url), width: photo.width || null, height: photo.height || null };
}

function normalizeVariants(list, fallbackUrl, size = {}) {
  const variants = [];
  for (const item of list || []) {
    const contentType = item.content_type || (item.container ? `video/${item.container}` : 'video/mp4');
    if (!item?.url || contentType !== 'video/mp4') continue; // skip HLS playlists
    const res = resolutionFromUrl(item.url) || {};
    variants.push({
      url: item.url,
      bitrate: Number(item.bitrate) || 0,
      width: res.width || item.width || null,
      height: res.height || item.height || null,
      content_type: 'video/mp4'
    });
  }
  if (!variants.length && fallbackUrl) {
    const res = resolutionFromUrl(fallbackUrl) || {};
    variants.push({
      url: fallbackUrl, bitrate: 0,
      width: res.width || size.width || null, height: res.height || size.height || null,
      content_type: 'video/mp4'
    });
  }
  variants.sort((a, b) => b.bitrate - a.bitrate || (b.height || 0) - (a.height || 0));
  for (const v of variants) v.resolution = v.width && v.height ? `${v.width}x${v.height}` : null;
  return variants;
}

function dedupeVideos(videos) {
  const seen = new Set();
  return videos.filter(video => {
    const key = video.variants[0]?.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFxQuote(quote) {
  if (!quote?.author && !quote?.text) return null;
  return {
    id: quote.id || null,
    url: quote.url || null,
    author: { name: quote.author?.name || '', screen_name: quote.author?.screen_name || '' },
    text: quote.text || '',
    sensitive: quote.possibly_sensitive === true
  };
}

function normalizeFxtwitter(tweet, source = 'fxtwitter') {
  if (!tweet || typeof tweet !== 'object') return null;
  const media = tweet.media || {};
  const videos = dedupeVideos((media.videos || []).map(video => ({
    type: video.type === 'gif' ? 'gif' : 'video',
    thumbnail: video.thumbnail_url || null,
    duration: Number(video.duration) || null,
    width: video.width || null,
    height: video.height || null,
    variants: normalizeVariants(video.variants || video.formats, video.url, video)
  })).filter(video => video.variants.length));

  return {
    id: String(tweet.id || ''),
    url: tweet.url || null,
    source,
    author: {
      name: tweet.author?.name || '',
      screen_name: tweet.author?.screen_name || '',
      avatar_url: tweet.author?.avatar_url || ''
    },
    text: tweet.text || '',
    created_at: toIso(tweet.created_timestamp ?? tweet.created_at),
    sensitive: tweet.possibly_sensitive === true,
    photos: (media.photos || []).map(normalizePhoto).filter(Boolean),
    videos,
    quote: normalizeFxQuote(tweet.quote),
    article: tweet.article || null,
    media_entities: tweet.media_entities || null
  };
}

function expandSyndicationText(tweet) {
  let text = String(tweet.text || tweet.full_text || '');
  const range = tweet.display_text_range;
  if (Array.isArray(range) && range.length === 2) text = Array.from(text).slice(range[0], range[1]).join('');
  for (const entity of tweet.entities?.urls || []) {
    if (entity.url && entity.expanded_url) text = text.split(entity.url).join(entity.expanded_url);
  }
  return text.trim();
}

function normalizeSyndication(tweet, source = 'syndication') {
  if (!tweet || typeof tweet !== 'object' || tweet.__typename === 'TweetTombstone') return null;
  const photos = [];
  const videos = [];
  for (const item of tweet.mediaDetails || []) {
    if (item.type === 'photo') {
      const photo = normalizePhoto({
        url: item.media_url_https,
        width: item.original_info?.width,
        height: item.original_info?.height
      });
      if (photo) photos.push(photo);
    } else if (item.type === 'video' || item.type === 'animated_gif') {
      const size = item.original_info || {};
      const variants = normalizeVariants(item.video_info?.variants, null, size);
      if (!variants.length) continue;
      videos.push({
        type: item.type === 'animated_gif' ? 'gif' : 'video',
        thumbnail: item.media_url_https || null,
        duration: item.video_info?.duration_millis ? item.video_info.duration_millis / 1000 : null,
        width: size.width || null,
        height: size.height || null,
        variants
      });
    }
  }

  const quoted = tweet.quoted_tweet;
  const screenName = tweet.user?.screen_name || '';
  return {
    id: String(tweet.id_str || tweet.id || ''),
    url: screenName && tweet.id_str ? `https://x.com/${screenName}/status/${tweet.id_str}` : null,
    source,
    author: {
      name: tweet.user?.name || '',
      screen_name: screenName,
      avatar_url: tweet.user?.profile_image_url_https || ''
    },
    text: expandSyndicationText(tweet),
    created_at: toIso(tweet.created_at),
    sensitive: tweet.possibly_sensitive === true,
    photos,
    videos: dedupeVideos(videos),
    quote: quoted ? {
      id: quoted.id_str || null,
      url: quoted.user?.screen_name && quoted.id_str ? `https://x.com/${quoted.user.screen_name}/status/${quoted.id_str}` : null,
      author: { name: quoted.user?.name || '', screen_name: quoted.user?.screen_name || '' },
      text: expandSyndicationText(quoted),
      sensitive: quoted.possibly_sensitive === true
    } : null,
    // Syndication truncates long posts; callers can surface this to users.
    truncated: Boolean(tweet.note_tweet),
    article: null,
    media_entities: null
  };
}

// A payload is usable only if it says who wrote what. Empty text is fine
// (media-only tweets), a missing author or id means a broken response.
function isComplete(tweet, expectedId) {
  if (!tweet || !tweet.id || !tweet.author?.screen_name) return false;
  return !expectedId || String(tweet.id) === String(expectedId);
}

module.exports = {
  isComplete,
  normalizeFxtwitter,
  normalizeSyndication,
  origImageUrl,
  resolutionFromUrl,
  toIso
};
