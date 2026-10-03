// Download proxy rules shared by the Cloudflare Worker (index.js) and the local
// Node version (lib/download-proxy.js). Pure functions only, no I/O, so both
// runtimes and the tests exercise exactly the same decisions.
//
// A request looks like:  GET /dl?u=<https://video.twimg.com/...mp4>&n=<file name>
// The response streams the upstream body with Content-Disposition: attachment,
// so the browser saves the file instead of opening it in a tab.

export const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB: far above any X video, still a hard stop
export const RATE_LIMIT_RETRY_SECONDS = 60;

// Only X's media CDN may be proxied. Anything else would make this an open proxy.
export function isAllowedMediaUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === 'twimg.com' || host.endsWith('.twimg.com');
}

// Keep names safe for headers and file systems. The extension survives even when the
// rest of the name has nothing usable in it (e.g. a name made only of CJK characters).
export function sanitizeFilename(name, fallback = 'xput-download') {
  const text = String(name ?? '');
  const extension = text.match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  const base = (extension ? text.slice(0, -(extension.length + 1)) : text)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 100);
  if (!base && !extension) return fallback;
  return `${base || 'xput-download'}${extension ? `.${extension}` : ''}`;
}

export function contentDisposition(filename) {
  const safe = sanitizeFilename(filename);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function errorResponse(status, code, message, extra = {}) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...extra }, body: JSON.stringify({ success: false, code, error: message }) };
}

// -> { ok: true, target, filename } or { ok: false, response }
export function parseDownloadRequest(requestUrl, method = 'GET') {
  if (method !== 'GET' && method !== 'HEAD') {
    return { ok: false, response: errorResponse(405, 'METHOD_NOT_ALLOWED', 'Use GET.', { Allow: 'GET, HEAD' }) };
  }
  const url = new URL(requestUrl);
  const target = url.searchParams.get('u');
  if (!target || target.length > 2048 || !isAllowedMediaUrl(target)) {
    return { ok: false, response: errorResponse(400, 'INVALID_TARGET', 'Only media files from X can be downloaded.') };
  }
  const extension = new URL(target).pathname.match(/\.([A-Za-z0-9]{2,4})$/)?.[1] || (new URL(target).searchParams.get('format') || 'bin');
  const filename = sanitizeFilename(url.searchParams.get('n'), `xput-download.${extension}`);
  return { ok: true, target, filename };
}

// Headers sent upstream: nothing from the visitor except a range request.
// identity encoding keeps Content-Length exact, which the page uses for progress.
export function upstreamHeaders(getHeader) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; XPut/1.0)', 'Accept-Encoding': 'identity', Accept: '*/*' };
  const range = getHeader('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  return headers;
}

// Upstream must be a plain media answer; redirects and HTML pages are refused.
export function checkUpstream(status, getHeader) {
  if (status !== 200 && status !== 206) {
    return { ok: false, response: errorResponse(status === 404 ? 404 : 502, 'UPSTREAM_ERROR', 'The file is not available from X.') };
  }
  const type = String(getHeader('content-type') || '').toLowerCase();
  if (!/^(?:video|image)\//.test(type)) {
    return { ok: false, response: errorResponse(502, 'UPSTREAM_TYPE', 'The source is not a media file.') };
  }
  const length = Number(getHeader('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) {
    return { ok: false, response: errorResponse(413, 'TOO_LARGE', 'The file is too large.') };
  }
  return { ok: true };
}

export function downloadHeaders(getHeader, filename) {
  const headers = {
    'Content-Type': getHeader('content-type'),
    'Content-Disposition': contentDisposition(filename),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'Accept-Ranges': getHeader('accept-ranges') || 'bytes',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition'
  };
  for (const name of ['content-length', 'content-range']) {
    const value = getHeader(name);
    if (value) headers[name.replace(/(^|-)(\w)/g, (_m, dash, letter) => dash + letter.toUpperCase())] = value;
  }
  return headers;
}
