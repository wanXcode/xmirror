const { FetchError } = require('./errors');
const { createFxtwitterSource } = require('./fxtwitter');
const { createSyndicationSource } = require('./syndication');
const { isComplete } = require('./normalize');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function defaultLog(entry) {
  console.log(`[fetch] ${JSON.stringify(entry)}`);
}

// Run one source once under a hard deadline.
async function attempt(source, id, { timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await source.fetch(id, { signal: controller.signal, fetch: fetchImpl });
  } catch (error) {
    if (error instanceof FetchError) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new FetchError('timeout', `timeout after ${timeoutMs}ms`, { source: source.name, cause: error });
    }
    throw new FetchError('network', error?.cause?.code || error?.code || 'network error', { source: source.name, cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build `fetchTweet(id)`: try each source in order, retrying retryable
 * failures, and fall through to the next source on any failure or incomplete
 * payload. Throws an AggregateFetchError when every source failed.
 */
function createFetcher({
  sources = [createFxtwitterSource(), createSyndicationSource()],
  timeoutMs = 10000,
  retries = 1,
  backoffMs = 400,
  fetchImpl,
  log = defaultLog,
  sleepImpl = sleep
} = {}) {
  async function fromSource(source, id) {
    let lastError;
    for (let n = 0; n <= retries; n += 1) {
      const started = Date.now();
      try {
        const tweet = await attempt(source, id, { timeoutMs, fetchImpl });
        if (!isComplete(tweet, id)) throw new FetchError('incomplete', 'incomplete data', { source: source.name });
        log({ id, source: source.name, ok: true, attempt: n + 1, ms: Date.now() - started });
        return tweet;
      } catch (error) {
        lastError = error;
        log({ id, source: source.name, ok: false, attempt: n + 1, ms: Date.now() - started, error: error.kind || 'error', status: error.status ?? undefined });
        if (!error.retryable || n === retries) break;
        await sleepImpl(backoffMs * 2 ** n + Math.floor(Math.random() * backoffMs / 4));
      }
    }
    throw lastError;
  }

  return async function fetchTweet(id) {
    if (!/^\d{1,25}$/.test(String(id))) throw new FetchError('not_found', 'invalid id');
    const failures = [];
    for (const source of sources) {
      try {
        return await fromSource(source, String(id));
      } catch (error) {
        failures.push(error);
      }
    }
    throw new AggregateFetchError(failures);
  };
}

class AggregateFetchError extends Error {
  constructor(failures) {
    super(`all sources failed: ${failures.map(f => `${f.source || '?'}:${f.kind}`).join(', ')}`);
    this.name = 'AggregateFetchError';
    this.failures = failures;
    // The post is "unavailable" only if every source said so definitively.
    this.code = failures.length && failures.every(f => f.kind === 'not_found') ? 'SOURCE_UNAVAILABLE'
      : failures.some(f => f.kind === 'timeout') && failures.every(f => ['timeout', 'not_found'].includes(f.kind)) ? 'REQUEST_TIMEOUT'
        : failures.every(f => ['network', 'not_found'].includes(f.kind)) ? 'NETWORK_ERROR'
          : 'SERVICE_UNAVAILABLE';
  }
}

module.exports = { createFetcher, AggregateFetchError, FetchError };
