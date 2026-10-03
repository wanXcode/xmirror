const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15000;
const FILENAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

// Media only ever lives on X's CDN hosts; refusing everything else stops a
// crafted upstream response from turning the downloader into an SSRF proxy.
function isTwimgUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'twimg.com' || url.hostname.endsWith('.twimg.com'));
  } catch {
    return false;
  }
}

function imageExtension(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return 'jpg'; }
  const fromPath = parsed.pathname.match(/\.([A-Za-z0-9]{2,5})$/)?.[1];
  const candidate = (fromPath || parsed.searchParams.get('format') || 'jpg').toLowerCase();
  return /^(?:jpe?g|png|webp|gif)$/.test(candidate) ? candidate : 'jpg';
}

/**
 * Download one image into `dir`. Rejects on a non-200 status, a non-image
 * Content-Type, an oversized body, a stalled connection, or a disallowed host,
 * and never leaves a partial file behind.
 * Resolves to the public path `/images/<filename>`.
 */
function downloadImage(url, {
  dir,
  filename,
  maxBytes = MAX_IMAGE_BYTES,
  timeoutMs = IMAGE_TIMEOUT_MS,
  isAllowedUrl = isTwimgUrl,
  request = https.get
}) {
  return new Promise((resolve, reject) => {
    if (!FILENAME_PATTERN.test(filename || '') || filename.startsWith('.')) return reject(new Error('invalid image filename'));
    if (!isAllowedUrl(url)) return reject(new Error('image host not allowed'));

    const finalPath = path.join(dir, filename);
    const tempPath = `${finalPath}.part`;
    let settled = false;
    let file;
    let req;

    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req?.destroy();
      const finish = () => { try { fs.unlinkSync(tempPath); } catch { /* nothing to remove */ } reject(error); };
      // createWriteStream opens its file asynchronously, so destroying it and unlinking straight away can
      // run before the file exists and leave `.part` behind. Reject only after the stream has closed.
      if (!file || file.closed) return finish();
      file.once('close', finish);
      file.destroy();
    };
    // Overall deadline so a slow trickle cannot hold a download slot forever.
    const deadline = setTimeout(() => fail(new Error('image download timed out')), timeoutMs);

    req = request(url, { headers: { 'User-Agent': 'XPut/1.0' } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        return fail(new Error(`image download failed: HTTP ${response.statusCode}`));
      }
      if (!/^image\//i.test(String(response.headers['content-type'] || ''))) {
        response.resume();
        return fail(new Error('image download failed: not an image'));
      }
      if (Number(response.headers['content-length']) > maxBytes) {
        response.resume();
        return fail(new Error('image too large'));
      }

      fs.mkdirSync(dir, { recursive: true });
      file = fs.createWriteStream(tempPath);
      let received = 0;
      const declared = Number(response.headers['content-length']) || 0;
      response.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) fail(new Error('image too large'));
      });
      response.on('error', fail);
      response.on('aborted', () => fail(new Error('image download aborted')));
      file.on('error', fail);
      file.on('finish', () => {
        if (settled) return;
        if (declared && received < declared) return fail(new Error('image download incomplete'));
        try {
          fs.renameSync(tempPath, finalPath);
        } catch (error) {
          return fail(error);
        }
        settled = true;
        clearTimeout(deadline);
        resolve(`/images/${filename}`);
      });
      response.pipe(file);
    });
    req.on('error', fail);
  });
}

module.exports = { MAX_IMAGE_BYTES, downloadImage, imageExtension, isTwimgUrl };
