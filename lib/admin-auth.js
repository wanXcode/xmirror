const crypto = require('node:crypto');

function safeEqual(supplied, expected) {
  if (typeof supplied !== 'string') return false;
  // Hash both sides so lengths match and timingSafeEqual never throws.
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Only failed attempts count, so a legitimate admin is never locked out by
// normal use, while guessing the token is capped per client address.
function createAdminGuard(adminToken, { maxFailures = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const failures = new Map();

  function recent(key) {
    const list = (failures.get(key) || []).filter(at => now() - at < windowMs);
    if (list.length) failures.set(key, list); else failures.delete(key);
    return list;
  }

  return function requireAdmin(req, res, next) {
    if (!adminToken) {
      return res.status(503).json({ error: '后台未配置 MODERATION_ADMIN_TOKEN' });
    }

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const previous = recent(key);
    if (previous.length >= maxFailures) {
      res.set?.('Retry-After', String(Math.ceil((windowMs - (now() - previous[0])) / 1000)));
      return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
    }

    if (!safeEqual(req.get('x-admin-token'), adminToken)) {
      previous.push(now());
      failures.set(key, previous);
      if (failures.size > 10000) for (const other of failures.keys()) recent(other);
      return res.status(403).json({ error: '无权限访问后台' });
    }

    return next();
  };
}

module.exports = { createAdminGuard };
