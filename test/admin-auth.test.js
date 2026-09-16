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
    assert.equal(res.statusCode, 403);
  }
});
