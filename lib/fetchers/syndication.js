const { FetchError, errorFromStatus } = require('./errors');
const { normalizeSyndication } = require('./normalize');

const BASE_URL = 'https://cdn.syndication.twimg.com/tweet-result';

// The endpoint rejects requests without a token derived from the tweet id.
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}

// The tombstone's own text says why the post is gone.
function tombstoneReason(json) {
  const raw = json?.tombstone?.text;
  const text = String(typeof raw === 'string' ? raw : raw?.text || '').toLowerCase();
  if (text.includes('suspended')) return 'suspended';
  if (text.includes('deleted') || text.includes('removed')) return 'deleted';
  if (/protected|private|limit(s|ed)? who can/.test(text)) return 'private';
  return 'not_found';
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
      if (response.status !== 200) {
        const error = errorFromStatus(response.status, 'syndication');
        if (response.status === 404 || response.status === 410) { error.definitive = true; error.reason = 'not_found'; }
        throw error;
      }

      let json = null;
      try { json = await response.json(); } catch { /* handled below */ }
      // Deleted, protected and age-restricted posts come back as tombstones or {}.
      if (!json || json.__typename === 'TweetTombstone' || !Object.keys(json).length) {
        throw new FetchError('not_found', 'tombstone', { status: 200, source: 'syndication', definitive: true, reason: tombstoneReason(json) });
      }
      const tweet = normalizeSyndication(json);
      if (!tweet) throw new FetchError('incomplete', 'unreadable payload', { source: 'syndication' });
      return tweet;
    }
  };
}

module.exports = { createSyndicationSource, syndicationToken, tombstoneReason };
