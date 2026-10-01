// Link parsing and small helpers shared by the finder script. No DOM access, so
// it runs unchanged in the browser and in node tests.
(function (root) {
  var HOSTS = ['x.com', 'twitter.com'];
  var POST_PATH = /\/(?:status|statuses|article)\/(\d{1,25})(?:[/?#]|$)/;

  // Returns { status: 'ok', id, url } | { status: 'empty' | 'invalid' | 'profile' }.
  //  - 'profile' means an X link that is not a single post (profile, home, search...)
  //  - 'invalid' means anything that is not an X link at all
  function parseXLink(raw) {
    var value = String(raw == null ? '' : raw).trim();
    if (!value) return { status: 'empty' };
    var candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'https://' + value;
    var url;
    try { url = new URL(candidate); } catch (error) { return { status: 'invalid' }; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { status: 'invalid' };
    var host = url.hostname.toLowerCase().replace(/^(?:www\.|mobile\.)/, '');
    if (HOSTS.indexOf(host) === -1) return { status: 'invalid' };
    var match = POST_PATH.exec(url.pathname + '/');
    if (!match) return { status: 'profile' };
    return { status: 'ok', id: match[1], url: 'https://x.com/i/status/' + match[1] };
  }

  // 42 -> "0:42", 75 -> "1:15"
  function formatCountdown(totalSeconds) {
    var seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;
    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }

  function fillTemplate(text, values) {
    return String(text).replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole;
    });
  }

  // Retry-After seconds, clamped to something a person will wait for.
  function retryAfterSeconds(header) {
    var seconds = parseInt(header, 10);
    if (!isFinite(seconds) || seconds < 1) return 60;
    return Math.min(seconds, 3600);
  }

  // Map an API failure to the state the page shows.
  function classifyFailure(status, code) {
    if (status === 429 || code === 'RATE_LIMITED') return 'tooMany';
    if (code === 'INVALID_URL' || status === 400) return 'invalid';
    if (code === 'SOURCE_UNAVAILABLE' || status === 404) return 'unavailable';
    if (code === 'CONTENT_MODERATION_REJECTED' || code === 'CONTENT_MODERATION_PENDING' || status === 422 || status === 409) return 'rejected';
    return 'busy';
  }

  var api = { parseXLink: parseXLink, formatCountdown: formatCountdown, fillTemplate: fillTemplate, retryAfterSeconds: retryAfterSeconds, classifyFailure: classifyFailure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XPutLink = api;
})(typeof window !== 'undefined' ? window : globalThis);
