const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveClientIp, isTrustedPeer, clientIpMiddleware } = require('../lib/client-ip');

const req = (peer, headers = {}, ip) => ({
  socket: { remoteAddress: peer },
  headers,
  ip,
  get: name => headers[name.toLowerCase()]
});

test('trusts CF-Connecting-IP only when the peer is the local/private proxy', () => {
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.9']) {
    assert.equal(isTrustedPeer(peer), true, peer);
    assert.equal(resolveClientIp(req(peer, { 'cf-connecting-ip': '203.0.113.7' }, '198.51.100.1')), '203.0.113.7');
  }
  assert.equal(isTrustedPeer('203.0.113.50'), false);
  assert.equal(isTrustedPeer('172.32.0.1'), false);
});

test('a spoofed CF-Connecting-IP from a public peer is ignored', () => {
  assert.equal(resolveClientIp(req('203.0.113.50', { 'cf-connecting-ip': '1.2.3.4' }, '203.0.113.50')), '203.0.113.50');
});

test('falls back to express req.ip, and ignores malformed header values', () => {
  assert.equal(resolveClientIp(req('127.0.0.1', {}, '198.51.100.1')), '198.51.100.1');
  assert.equal(resolveClientIp(req('127.0.0.1', { 'cf-connecting-ip': 'not-an-ip' }, '198.51.100.1')), '198.51.100.1');
  assert.equal(resolveClientIp(req('::ffff:198.51.100.2', {}, undefined)), '198.51.100.2');
  assert.equal(resolveClientIp({ socket: {}, headers: {} }), 'unknown');
});

test('supports IPv6 visitors and overrides req.ip for downstream limiters', () => {
  const r = req('127.0.0.1', { 'cf-connecting-ip': '2001:db8::1' }, '::1');
  clientIpMiddleware(r, {}, () => {});
  assert.equal(r.ip, '2001:db8::1');
});
