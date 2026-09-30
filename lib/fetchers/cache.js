// Small in-process TTL cache. Map preserves insertion order, so re-inserting
// on read gives cheap LRU eviction once `max` entries are exceeded.
class TtlCache {
  constructor({ max = 2000, now = Date.now } = {}) {
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key, value, ttlMs) {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  delete(key) { return this.map.delete(key); }

  get size() { return this.map.size; }
}

module.exports = { TtlCache };
