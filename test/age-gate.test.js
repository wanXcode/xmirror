const test = require('node:test');
const assert = require('node:assert/strict');
const { AGE_COOKIE, hasAgeConfirmation, setAgeConfirmation } = require('../lib/age-gate');

test('age confirmation is read only from the exact session cookie value', () => {
  const req = cookie => ({ headers: { cookie } });
  assert.equal(hasAgeConfirmation(req(`${AGE_COOKIE}=1`)), true);
  assert.equal(hasAgeConfirmation(req(`a=b; ${AGE_COOKIE}=1; c=d`)), true);
  for (const bad of [undefined, '', `${AGE_COOKIE}=0`, `${AGE_COOKIE}=true`, `x${AGE_COOKIE}=1`, 'other=1']) {
    assert.equal(hasAgeConfirmation(req(bad)), false, String(bad));
  }
  assert.equal(hasAgeConfirmation({ headers: {} }), false);
});

test('the cookie is a session cookie: httpOnly, lax, no expiry, secure only over https', () => {
  const calls = [];
  const res = { cookie: (...args) => calls.push(args) };
  setAgeConfirmation(res, { secure: true });
  setAgeConfirmation(res);
  assert.deepEqual(calls[0], [AGE_COOKIE, '1', { httpOnly: true, sameSite: 'lax', secure: true, path: '/' }]);
  assert.equal(calls[1][2].secure, false);
  for (const [, , options] of calls) assert.equal('maxAge' in options || 'expires' in options, false);
});
