// Download helpers: formatting, file names, proxy URLs, platform detection and the
// fetch-with-progress / save / share primitives. DOM and network are passed in.
(function (root) {
  var LARGE_BYTES = 150 * 1024 * 1024; // above this, let the browser download natively instead of buffering in memory

  function formatBytes(bytes) {
    var value = Number(bytes);
    if (!isFinite(value) || value <= 0) return '';
    if (value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + ' MB';
    return (value / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function formatDuration(seconds) {
    var total = Math.round(Number(seconds));
    if (!isFinite(total) || total <= 0) return '';
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  // "1080p" from the variant's height; falls back to the resolution string or the bitrate.
  function qualityOf(variant) {
    if (variant.height) return variant.height + 'p';
    if (variant.resolution) return variant.resolution;
    if (variant.bitrate) return Math.round(variant.bitrate / 1000) + ' kbps';
    return 'MP4';
  }

  // The preview plays muted in the card, so pick something light: the largest variant up to 720p.
  function pickPreviewVariant(variants) {
    var fit = variants.filter(function (v) { return !v.height || v.height <= 720; });
    return (fit[0] || variants[variants.length - 1]);
  }

  function proxyUrl(base, target, name) {
    return base + (base.indexOf('?') === -1 ? '?' : '&') + 'u=' + encodeURIComponent(target) + '&n=' + encodeURIComponent(name);
  }

  function fileName(parts, extension) {
    var base = parts.filter(function (part) { return part !== null && part !== undefined && part !== ''; }).join('_')
      .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return (base || 'xput') + '.' + extension;
  }

  function extensionOf(url, fallback) {
    var match = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(String(url).split('?')[0]) || /[?&]format=([a-z0-9]{2,4})/i.exec(String(url));
    return match ? match[1].toLowerCase() : fallback;
  }

  function detectPlatform(nav) {
    var ua = (nav && nav.userAgent) || '';
    var ipadOs = /Macintosh/.test(ua) && nav && nav.maxTouchPoints > 1;
    var ios = /iPhone|iPad|iPod/.test(ua) || ipadOs;
    var android = /Android/.test(ua);
    return { ios: ios, android: android, mobile: ios || android };
  }

  function canShareFiles(nav, files) {
    try { return !!(nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: files })); }
    catch (error) { return false; }
  }

  function DownloadError(status, retryAfter, message) {
    var error = new Error(message || 'download failed');
    error.name = 'DownloadError';
    error.status = status;
    error.retryAfter = retryAfter;
    return error;
  }

  // Reads the body with progress (percent known when Content-Length is present).
  function fetchBlob(fetchFn, url, onProgress) {
    return fetchFn(url, { credentials: 'omit' }).then(function (response) {
      if (!response.ok) {
        var retry = response.headers && response.headers.get ? Number(response.headers.get('Retry-After')) : 0;
        throw DownloadError(response.status, retry > 0 ? retry : 60);
      }
      var total = Number(response.headers.get('Content-Length')) || 0;
      var type = response.headers.get('Content-Type') || '';
      if (!response.body || !response.body.getReader) {
        return response.blob().then(function (blob) { if (onProgress) onProgress(blob.size, blob.size); return blob; });
      }
      var reader = response.body.getReader();
      var chunks = [];
      var received = 0;
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) return new Blob(chunks, { type: type });
          chunks.push(step.value);
          received += step.value.length;
          if (onProgress) onProgress(received, total);
          return pump();
        });
      }
      return pump();
    });
  }

  function saveBlob(doc, win, blob, name) {
    var url = win.URL.createObjectURL(blob);
    var link = doc.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    link.remove();
    win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 60000);
  }

  var api = {
    LARGE_BYTES: LARGE_BYTES, formatBytes: formatBytes, formatDuration: formatDuration, qualityOf: qualityOf,
    pickPreviewVariant: pickPreviewVariant, proxyUrl: proxyUrl, fileName: fileName, extensionOf: extensionOf,
    detectPlatform: detectPlatform, canShareFiles: canShareFiles, fetchBlob: fetchBlob, saveBlob: saveBlob, DownloadError: DownloadError
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XPutDownload = api;
})(typeof window !== 'undefined' ? window : globalThis);
