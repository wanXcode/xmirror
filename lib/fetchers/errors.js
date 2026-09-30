// Errors raised by tweet sources. `kind` drives fallback and retry decisions:
//   not_found   - the source answered definitively (404/401/403, tombstone)
//   rate_limit  - 429
//   upstream    - 5xx or an unexpected status
//   timeout     - no answer within the per-request deadline
//   network     - DNS / connection failures
//   incomplete  - the answer was 200 but missing data we need
class FetchError extends Error {
  constructor(kind, message, { status = null, source = null, cause } = {}) {
    super(message || kind, cause ? { cause } : undefined);
    this.name = 'FetchError';
    this.kind = kind;
    this.status = status;
    this.source = source;
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
