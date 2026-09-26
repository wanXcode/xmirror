(function (root) {
  const STORAGE_KEY = 'xput-generated-history-v1';
  const MAX_RECORDS = 200;
  const failureMessages = {
    INVALID_URL: ['errorInvalidUrl', false],
    SOURCE_UNAVAILABLE: ['errorSourceUnavailable', false],
    CONTENT_UNSUPPORTED: ['errorContentUnsupported', false],
    NETWORK_ERROR: ['errorNetwork', true],
    REQUEST_TIMEOUT: ['errorTimeout', true],
    SERVICE_UNAVAILABLE: ['errorService', true]
  };

  function validSourceUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && /^(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)
        && /\/(?:status|article)\/\d+(?:\/|$)/i.test(url.pathname);
    } catch { return false; }
  }

  function validMirrorPath(value) {
    return typeof value === 'string' && /^\/(?:[A-Za-z0-9]{6}|archives\/post_\d+\.html)$/.test(value);
  }

  function normalizeRecords(records) {
    if (!Array.isArray(records)) return [];
    const seen = new Set();
    return records.filter(record => record && Number.isSafeInteger(record.id) && record.id > 0
      && validMirrorPath(record.url) && validSourceUrl(record.source_url)
      && typeof record.generated_at === 'string' && Number.isFinite(Date.parse(record.generated_at)))
      .sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at))
      .filter(record => {
        if (seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
      }).slice(0, MAX_RECORDS).map(record => ({
        id: record.id, url: record.url, source_url: record.source_url,
        title: String(record.title || '').slice(0, 200),
        author: String(record.author || '').slice(0, 200), generated_at: record.generated_at
      }));
  }

  function readRecords(storage) {
    try { return normalizeRecords(JSON.parse(storage.getItem(STORAGE_KEY) || '[]')); }
    catch { return []; }
  }

  function saveRecord(storage, record) {
    try {
      const records = normalizeRecords([record, ...readRecords(storage).filter(item => item.id !== record.id)]);
      storage.setItem(STORAGE_KEY, JSON.stringify(records));
      return { saved: true, records };
    } catch { return { saved: false, records: [record] }; }
  }

  function failureFor(code, status) {
    const fallback = status === 400 ? 'INVALID_URL' : status === 404 ? 'SOURCE_UNAVAILABLE'
      : status === 408 || status === 504 ? 'REQUEST_TIMEOUT' : 'SERVICE_UNAVAILABLE';
    const selected = failureMessages[code] ? code : fallback;
    const [key, retryable] = failureMessages[selected];
    return { code: selected, key, retryable };
  }

  const api = { STORAGE_KEY, MAX_RECORDS, validSourceUrl, validMirrorPath, normalizeRecords, readRecords, saveRecord, failureFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XPutHome = api;
})(typeof window !== 'undefined' ? window : globalThis);
