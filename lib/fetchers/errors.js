// Errors raised by tweet sources. `kind` drives fallback and retry decisions:
//   not_found   - the source answered definitively (404/401/403, tombstone)
//   rate_limit  - 429
//   upstream    - 5xx or an unexpected status
//   timeout     - no answer within the per-request deadline
//   network     - DNS / connection failures
//   incomplete  - the answer was 200 but missing data we need
//
// A not_found error is `definitive` when the source itself said the post is unavailable (its API
// answered 404/401/410 in its own format, or syndication returned a tombstone). `reason` says why:
// not_found (never existed or no longer served), deleted, private, suspended. A definitive answer
// is the post's state, not a source fault: no retry, no fallback to another source, and it is not
// counted as an upstream failure in the logs.
class FetchError extends Error {
  constructor(kind, message, { status = null, source = null, cause, definitive = false, reason = null } = {}) {
    super(message || kind, cause ? { cause } : undefined);
    this.name = 'FetchError';
    this.kind = kind;
    this.status = status;
    this.source = source;
    this.definitive = kind === 'not_found' && definitive;
    this.reason = kind === 'not_found' ? reason : null;
  }

  get retryable() {
    return ['rate_limit', 'upstream', 'timeout', 'network'].includes(this.kind);
  }
}

function errorFromStatus(status, source) {
  if ([401, 403, 404, 410].includes(status)) return new FetchError('not_found', `HTTP ${status}`, { status, source });
  if (status === 429) return new FetchError('rate_limit', 'HTTP 429', { status, source });
  return new FetchError('upstream', `HTTP ${status}`, { status, source });
}

module.exports = { FetchError, errorFromStatus };
