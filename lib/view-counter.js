// Counts page views and shares in memory and writes them to the database in small batches,
// so a busy page does not cost one database write per visit.
function createViewCounter({ flush, intervalMs = 30000, timers = { setInterval, clearInterval } } = {}) {
  let pending = new Map(); // postId -> { views, shares }
  let timer = null;

  function bump(postId, field) {
    const entry = pending.get(postId) || { views: 0, shares: 0 };
    entry[field] += 1;
    pending.set(postId, entry);
  }

  async function flushNow() {
    if (!pending.size) return 0;
    const batch = pending;
    pending = new Map();
    try {
      await flush(batch);
    } catch (error) {
      // Put the counts back so a failed write loses nothing.
      for (const [id, entry] of batch) {
        const again = pending.get(id) || { views: 0, shares: 0 };
        again.views += entry.views; again.shares += entry.shares;
        pending.set(id, again);
      }
      throw error;
    }
    return batch.size;
  }

  return {
    view: postId => bump(postId, 'views'),
    share: postId => bump(postId, 'shares'),
    flush: flushNow,
    size: () => pending.size,
    start() {
      if (!timer) { timer = timers.setInterval(() => flushNow().catch(() => {}), intervalMs); timer.unref?.(); }
    },
    stop() { if (timer) { timers.clearInterval(timer); timer = null; } }
  };
}

// Crawlers and link-preview fetchers are not readers.
const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|skype|wget|curl|python-requests|headless/i;
const isBot = userAgent => !userAgent || BOT_PATTERN.test(userAgent);

module.exports = { createViewCounter, isBot };
