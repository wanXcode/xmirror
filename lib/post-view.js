const { parseHTML } = require('linkedom');
const { isTwimgUrl } = require('./media-download');
const { toIsoDate } = require('./format-date');

const LOCAL_MEDIA = /^\/(?:images|videos)\/[A-Za-z0-9_.-]+$/;

const isLocalMedia = value => typeof value === 'string' && LOCAL_MEDIA.test(value);
const isHttps = value => typeof value === 'string' && /^https:\/\//i.test(value);

// Articles (X long posts) have headings and paragraphs; their pictures belong between the
// paragraphs. Ordinary posts get their pictures as a gallery below the text instead.
function isArticleLike(content = '') {
  return /<(?:h1|h2|p)[\s>]/i.test(content);
}

// The stored content is HTML our own renderer produced from escaped text; this keeps only
// what the reading layout needs and drops inline styles and (for ordinary posts) images.
function cleanContent(html, { keepImages }) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html || ''}</div></body></html>`);
  const rootEl = document.getElementById('root');
  rootEl.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
  rootEl.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!keepImages || !(isLocalMedia(src) || isTwimgUrl(src))) { img.remove(); return; }
    ['style', 'width', 'height', 'onerror', 'onload'].forEach(name => img.removeAttribute(name));
    img.setAttribute('loading', 'lazy');
    img.setAttribute('alt', '');
  });
  rootEl.querySelectorAll('*').forEach(node => {
    for (const { name } of [...node.attributes]) {
      if (name === 'style' || name.startsWith('on')) node.removeAttribute(name);
    }
  });
  rootEl.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) a.removeAttribute('href');
    else { a.setAttribute('rel', 'noopener noreferrer nofollow'); a.setAttribute('target', '_blank'); }
  });
  // The page's own H1 is the author line, so headings inside an article start one level lower.
  for (const [from, to] of [['h2', 'h3'], ['h1', 'h2']]) {
    rootEl.querySelectorAll(from).forEach(node => {
      const heading = document.createElement(to);
      heading.innerHTML = node.innerHTML;
      node.replaceWith(heading);
    });
  }
  // Trailing <br> left behind by removed gallery images.
  let html2 = rootEl.innerHTML.replace(/(?:\s|<br\s*\/?>)+$/gi, '');
  html2 = html2.replace(/^(?:\s|<br\s*\/?>)+/i, '');
  return html2;
}

function plainText(html) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|h1|h2|li|blockquote)>/gi, ' ')}</div></body></html>`);
  return document.getElementById('root').textContent.replace(/\s+/g, ' ').trim();
}

// Cut at a word boundary when there is one close to the limit, and mark the cut.
function excerpt(text, max) {
  const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
  if (chars.length <= max) return chars.join('');
  let cut = chars.slice(0, max);
  // Back off to the last space unless the cut already falls between two words.
  if (chars[max] !== ' ') {
    const space = cut.lastIndexOf(' ');
    if (space > 0 && space > max - 20) cut = cut.slice(0, space);
  }
  return `${cut.join('').replace(/[\s,.;:，。；：、]+$/u, '')}…`;
}

function parseList(value) {
  try { const list = JSON.parse(value || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}

function videoState(post) {
  const status = post.video_status || (post.video ? 'completed' : post.video_source_url ? 'queued' : 'none');
  if (status === 'completed' && isLocalMedia(post.video)) return { state: 'ready', src: post.video };
  if (status === 'queued' || status === 'downloading') return { state: 'pending', src: null };
  if (status === 'failed') return { state: 'failed', src: null };
  return { state: 'none', src: null };
}

/** Everything the saved-post templates need, derived from a `posts` row. */
function buildPostView(post) {
  const content = post.content || '';
  const keepImages = isArticleLike(content);
  const textHtml = cleanContent(content, { keepImages });
  const images = keepImages ? [] : parseList(post.images).filter(src => isLocalMedia(src) || isTwimgUrl(src)).map(src => ({ src }));
  const primary = videoState(post);
  const poster = isLocalMedia(post.video_poster) ? post.video_poster : null;
  const extras = parseList(post.extra_videos).map(item => ({
    src: item.status === 'completed' && isLocalMedia(item.path) ? item.path : null,
    isGif: item.type === 'gif',
    state: item.status === 'completed' ? 'ready' : item.status === 'failed' ? 'failed' : 'pending'
  }));

  return {
    id: post.id,
    code: post.short_code,
    url: post.url,
    author: { name: post.author || '', handle: post.author_handle || '', avatar: isHttps(post.author_avatar) ? post.author_avatar : '' },
    textHtml,
    plainText: plainText(textHtml),
    keepImages,
    images,
    video: { ...primary, poster, isGif: Number(post.video_is_gif) === 1 },
    extraVideos: extras,
    postedAt: toIsoDate(post.tweet_time),
    savedAt: toIsoDate(post.created_at),
    replies: Number.isFinite(Number(post.reply_count)) && post.reply_count !== null ? Number(post.reply_count) : null,
    sensitive: Number(post.sensitive) === 1,
    hasMedia: primary.state !== 'none' || images.length > 0 || extras.length > 0
  };
}

// The same files in the shape the result cards expect, for the download drawer when X cannot be reached.
function localDownloads(view) {
  const video = (src, isGif, poster) => ({ type: isGif ? 'gif' : 'video', thumbnail: null, poster, duration: null, width: null, height: null, variants: [{ url: src, bitrate: 0, width: null, height: null, resolution: null, content_type: 'video/mp4' }] });
  const videos = [];
  const gifs = [];
  const all = [{ ...view.video, isGif: view.video.isGif }, ...view.extraVideos];
  for (const item of all) {
    if (item.state !== 'ready' || !item.src) continue;
    (item.isGif ? gifs : videos).push(video(item.src, item.isGif));
  }
  return { videos, gifs, images: view.images.map(image => ({ url: image.src, orig_url: image.src, width: null, height: null })) };
}

module.exports = { buildPostView, cleanContent, excerpt, isArticleLike, isLocalMedia, localDownloads, plainText };
