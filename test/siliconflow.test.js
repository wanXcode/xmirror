const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatCompletion, isDisabledModelError, TranslationProviderError } = require('../lib/siliconflow');

test('recognizes SiliconFlow disabled-model response', () => {
  assert.equal(isDisabledModelError(403, '{"code":30003,"message":"Model disabled."}'), true);
  assert.equal(isDisabledModelError(401, '{"code":30003,"message":"Model disabled."}'), false);
});

test('falls back only when the selected model is disabled', async () => {
  const requestedModels = [];
  const fetchImpl = async (_url, options) => {
    const { model } = JSON.parse(options.body);
    requestedModels.push(model);
    if (model === 'old-model') {
      return {
        ok: false,
        status: 403,
        text: async () => '{"code":30003,"message":"Model disabled."}'
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] })
    };
  };

  const result = await createChatCompletion({
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    models: ['old-model', 'new-model'],
    body: { messages: [] },
    fetchImpl
  });

  assert.deepEqual(requestedModels, ['old-model', 'new-model']);
  assert.equal(result.model, 'new-model');
});

test('does not hide authentication errors behind a fallback', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Invalid token'
  });

  await assert.rejects(
    createChatCompletion({
      baseUrl: 'https://example.test/v1',
      apiKey: 'bad-key',
      models: ['first-model', 'fallback-model'],
      body: { messages: [] },
      fetchImpl
    }),
    /翻译服务错误\(401\)/
  );
});

test('aborts a provider request after the configured timeout', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

  await assert.rejects(
    createChatCompletion({
      baseUrl: 'https://example.test/v1', apiKey: 'key', models: ['model'],
      body: { messages: [] }, fetchImpl, timeoutMs: 5
    }),
    error => error instanceof TranslationProviderError && error.providerCode === 'TIMEOUT'
  );
});

test('wraps a successful HTTP response with invalid JSON as a provider error', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
  await assert.rejects(
    createChatCompletion({
      baseUrl: 'https://example.test/v1', apiKey: 'key', models: ['model'],
      body: { messages: [] }, fetchImpl
    }),
    error => error instanceof TranslationProviderError && error.providerCode === 'INVALID_RESPONSE'
  );
});
