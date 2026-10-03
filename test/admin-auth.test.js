const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminGuard } = require('../lib/admin-auth');

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('admin guard rejects access when no admin token is configured', () => {
  const guard = createAdminGuard('');
  const req = { get: () => undefined };
  const res = createResponse();
  guard(req, res, () => assert.fail('next should not be called'));
  assert.equal(res.statusCode, 503);
});

test('admin guard accepts only the x-admin-token header', () => {
  const guard = createAdminGuard('secret');
  let called = false;
  const req = { get: name => name === 'x-admin-token' ? 'secret' : undefined };
  const res = createResponse();
  guard(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});

test('admin guard rejects a missing or incorrect header token', () => {
  const guard = createAdminGuard('secret');
  for (const supplied of [undefined, 'wrong']) {
    const req = { get: () => supplied, query: { token: 'secret' }, body: { token: 'secret' } };
    const res = createResponse();
    guard(req, res, () => assert.fail('next should not be called'));
    assert.equal(res.statusCode, 401);
  }
});

test('admin guard locks out a client after repeated wrong tokens, but not on success', () => {
  let clock = 0;
  const guard = createAdminGuard('secret', { maxFailures: 3, windowMs: 1000, now: () => clock });
  const attempt = (token, ip = '1.1.1.1') => {
    const res = createResponse();
    res.set = () => res;
    let passed = false;
    guard({ ip, get: () => token }, res, () => { passed = true; });
    return { passed, status: res.statusCode };
  };
  for (let i = 0; i < 5; i++) assert.equal(attempt('secret').passed, true); // successes never count
  for (let i = 0; i < 3; i++) assert.equal(attempt('wrong').status, 401);
  assert.equal(attempt('wrong').status, 429);
  assert.equal(attempt('secret').status, 429); // locked even with the right token
  assert.equal(attempt('secret', '2.2.2.2').passed, true); // other clients unaffected
  clock += 1001;
  assert.equal(attempt('secret').passed, true);
});

test('admin guard compares tokens of different lengths and types without throwing', () => {
  const guard = createAdminGuard('secret');
  for (const supplied of ['s', 'secret-but-longer', '', ['secret'], 123]) {
    const res = createResponse();
    guard({ get: () => supplied }, res, () => assert.fail('must not pass'));
    assert.equal(res.statusCode, 401);
  }
});
