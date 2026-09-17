const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHealthPayload,
  healthzHandler,
  registerHealthRoute
} = require('../lib/health');

function createResponse() {
  return {
    statusCode: null,
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

test('health payload clearly identifies the xmirror service', () => {
  assert.deepEqual(createHealthPayload(), {
    status: 'ok',
    service: 'xmirror'
  });
});

test('health handler returns a 200 JSON response', () => {
  const response = createResponse();
  healthzHandler({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    status: 'ok',
    service: 'xmirror'
  });
});

test('health route is registered at GET /healthz', () => {
  let registeredPath;
  let registeredHandler;
  const app = {
    get(routePath, handler) {
      registeredPath = routePath;
      registeredHandler = handler;
    }
  };

  registerHealthRoute(app);

  assert.equal(registeredPath, '/healthz');
  assert.equal(registeredHandler, healthzHandler);
});
