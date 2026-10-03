const net = require('node:net');

// Peers allowed to tell us the real client address: the local nginx (or any
// private-network proxy). A request reaching the origin from a public address
// is never trusted, so CF-Connecting-IP cannot be spoofed by hitting it directly.
const trustedPeers = new net.BlockList();
for (const [address, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]]) {
  trustedPeers.addSubnet(address, prefix, 'ipv4');
}
trustedPeers.addAddress('::1', 'ipv6');
trustedPeers.addSubnet('fc00::', 7, 'ipv6');
trustedPeers.addSubnet('fe80::', 10, 'ipv6');

function stripMapped(address = '') {
  return String(address).replace(/^::ffff:/i, '');
}

function isTrustedPeer(address) {
  const value = stripMapped(address);
  const family = net.isIP(value);
  return family !== 0 && trustedPeers.check(value, family === 6 ? 'ipv6' : 'ipv4');
}

// Cloudflare sets CF-Connecting-IP to the visitor address. nginx forwards it.
function resolveClientIp(req) {
  const peer = req.socket?.remoteAddress || '';
  if (isTrustedPeer(peer)) {
    const header = String(req.get?.('cf-connecting-ip') || req.headers?.['cf-connecting-ip'] || '').trim();
    if (net.isIP(header)) return header;
  }
  return stripMapped(req.ip || peer) || 'unknown';
}

// Overrides req.ip so every consumer (rate limiters, logs) sees the visitor.
function clientIpMiddleware(req, res, next) {
  const ip = resolveClientIp(req);
  Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
  next();
}

// express `trust proxy` setting: trust loopback/private hops (nginx) so that
// X-Forwarded-For is honoured as a fallback when CF-Connecting-IP is absent.
const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

module.exports = { DEFAULT_TRUST_PROXY, clientIpMiddleware, isTrustedPeer, resolveClientIp };
