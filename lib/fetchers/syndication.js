const { FetchError, errorFromStatus } = require('./errors');
const { normalizeSyndication } = require('./normalize');

const BASE_URL = 'https://cdn.syndication.twimg.com/tweet-result';

// The endpoint rejects requests without a token derived from the tweet id.
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}

function createSyndicationSource({ baseUrl = BASE_URL } = {}) {
  return {
    name: 'syndication',
    async fetch(id, { signal, fetch: fetchImpl = fetch }) {
      const url = `${baseUrl}?id=${encodeURIComponent(id)}&lang=en&token=${syndicationToken(id)}`;
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal
      });
      if (response.status !== 200) throw errorFromStatus(response.status, 'syndication');

      let json = null;
      try { json = await response.json(); } catch { /* handled below */ }
      // Deleted, protected and age-restricted posts come back as tombstones or {}.
      if (!json || json.__typename === 'TweetTombstone' || !Object.keys(json).length) {
        throw new FetchError('not_found', 'tombstone', { status: 200, source: 'syndication' });
      }
      const tweet = normalizeSyndication(json);
      if (!tweet) throw new FetchError('incomplete', 'unreadable payload', { source: 'syndication' });
      return tweet;
    }
  };
}

module.exports = { createSyndicationSource, syndicationToken };
