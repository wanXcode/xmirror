const fs = require('node:fs');
const path = require('node:path');
const { buildPostView } = require('../post-view');
const { cacheKey, dataUri, renderOgImage } = require('../og-image');
const { SHORT_CODE_PATTERN } = require('../shortcode');

const AVATAR_TIMEOUT_MS = 3000;
const AVATAR_MAX_BYTES = 512 * 1024;
const MAX_CONCURRENT = 2;
const LOCAL_MEDIA = /^\/images\/[A-Za-z0-9_.-]+$/;

// Only X's own image CDN is fetched for avatars; nothing else a post says is ever requested.
function isTwimg(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && /(^|\.)twimg\.com$/.test(parsed.hostname); } catch { return false; }
}

async function fetchAvatar(url, fetchImpl) {
  if (!isTwimg(url)) return null;
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= AVATAR_MAX_BYTES ? dataUri(buffer) : null;
  } catch { return null; }
}

/**
 * GET /og/{code}.png: the 1200x630 share preview of a saved post (see lib/og-image.js).
 * Sensitive posts, unknown codes and render failures get the brand image instead, so a link
 * preview never exposes more than the page itself would before the age check.
 */
function registerOgRoutes(app, { store, dataDir, publicDir, fetchImpl = fetch }) {
  const brand = () => fs.readFileSync(path.join(publicDir, 'xput-share.png'));
  const cacheDir = path.join(dataDir, 'og');
  let active = 0;

  const sendPng = (res, buffer, maxAge) => {
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${maxAge}`, 'X-Robots-Tag': 'noindex' });
    return res.send(buffer);
  };

  app.get('/og/:file', async (req, res) => {
    const match = /^([A-Za-z0-9]{6})\.png$/.exec(req.params.file);
    if (!match || !SHORT_CODE_PATTERN.test(match[1])) return res.status(404).set('X-Robots-Tag', 'noindex').end();
    const code = match[1];
    try {
      const post = await store.findByCode(code);
      if (!post) return sendPng(res, brand(), 300);
      const view = buildPostView(post);
      if (view.sensitive) return sendPng(res, brand(), 300);

      let thumbPath = '';
      const poster = view.video.poster;
      const firstImage = view.images.find(image => LOCAL_MEDIA.test(image.src));
      const mediaPath = poster && LOCAL_MEDIA.test(poster) ? poster : firstImage?.src;
      if (mediaPath) thumbPath = mediaPath;
      const media = view.hasMedia;
      const input = { author: view.author.name, handle: view.author.handle, text: view.plainText, media, avatarUrl: view.author.avatar, thumbPath };
      const file = path.join(cacheDir, cacheKey(code, input));
      if (fs.existsSync(file)) return sendPng(res, fs.readFileSync(file), 86400);

      if (active >= MAX_CONCURRENT) return sendPng(res, brand(), 60);
      active += 1;
      try {
        const avatar = await fetchAvatar(view.author.avatar, fetchImpl);
        let source = null;
        if (media && thumbPath) {
          try { source = dataUri(fs.readFileSync(path.join(dataDir, thumbPath.replace(/^\//, '')))); } catch { source = null; }
        }
        const thumb = media ? { src: source, video: view.video.state !== 'none' } : null;
        const png = await renderOgImage({ ...input, avatar, thumb });
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(`${file}.part`, png);
        fs.renameSync(`${file}.part`, file);
        return sendPng(res, png, 86400);
      } finally { active -= 1; }
    } catch (error) {
      console.error('OG image failed:', error.message);
      return sendPng(res, brand(), 60);
    }
  });
}

module.exports = { registerOgRoutes, isTwimg };
