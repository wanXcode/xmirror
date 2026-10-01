const https = require('node:https');
const { TtlCache } = require('./fetchers/cache');
const { isTwimgUrl } = require('./media-download');

// File sizes for the "HD 1080p · 24.1 MB" labels. X does not publish them, so we ask the
// CDN with a HEAD request (headers only, no file bytes) and remember the answer.
function createMediaInfo({ request = https.request, timeoutMs = 5000, ttlMs = 60 * 60 * 1000, max = 2000, concurrency = 4 } = {}) {
  const cache = new TtlCache({ max });

  function head(url) {
    return new Promise(resolve => {
      const req = request(url, { method: 'HEAD', timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XPut/1.0)', 'Accept-Encoding': 'identity' } }, response => {
        response.resume();
        const length = Number(response.headers['content-length']);
        resolve(response.statusCode === 200 && Number.isFinite(length) && length > 0 ? length : null);
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
      req.end();
    });
  }

  // urls -> { [url]: bytes | null }; non-X URLs are answered with null without any request.
  async function sizes(urls) {
    const unique = [...new Set(urls)];
    const result = {};
    const queue = [];
    for (const url of unique) {
      if (!isTwimgUrl(url)) { result[url] = null; continue; }
      const hit = cache.get(url);
      if (hit) result[url] = hit.value;
      else queue.push(url);
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const url = queue.shift();
        const bytes = await head(url);
        // A failed lookup is cached briefly so a broken URL is not retried on every request.
        cache.set(url, bytes, bytes === null ? 30 * 1000 : ttlMs);
        result[url] = bytes;
      }
    }));
    return result;
  }

  return { sizes, cache };
}

module.exports = { createMediaInfo };
