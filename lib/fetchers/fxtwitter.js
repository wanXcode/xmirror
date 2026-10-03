const { FetchError, errorFromStatus } = require('./errors');
const { normalizeFxtwitter } = require('./normalize');

const BASE_URL = 'https://api.fxtwitter.com';

function createFxtwitterSource({ baseUrl = BASE_URL } = {}) {
  return {
    name: 'fxtwitter',
    async fetch(id, { signal, fetch: fetchImpl = fetch }) {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/status/${id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal
      });
      let json = null;
      try { json = await response.json(); } catch { /* handled below */ }

      const code = Number(json?.code) || response.status;
      if (response.status !== 200 || code !== 200) {
        const error = errorFromStatus(code !== 200 && response.status === 200 ? code : response.status, 'fxtwitter');
        // The API answered in its own JSON format: that is the post's state, not a gateway or block page.
        if (error.kind === 'not_found' && Number(json?.code) && [401, 404, 410].includes(Number(json.code))) {
          const message = String(json.message || '').toUpperCase();
          error.definitive = true;
          error.reason = message.includes('PRIVATE') || Number(json.code) === 401 ? 'private' : message.includes('SUSPEND') ? 'suspended' : 'not_found';
        }
        throw error;
      }
      if (!json?.tweet) throw new FetchError('incomplete', 'missing tweet', { source: 'fxtwitter' });
      return normalizeFxtwitter(json.tweet);
    }
  };
}

module.exports = { createFxtwitterSource };
