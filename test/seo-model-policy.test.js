const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFreeModels, createFreeModelPolicy } = require('../lib/seo-model-policy');
const pricing = fs.readFileSync(path.join(__dirname, 'fixtures/provider-pricing.html'), 'utf8');

test('pricing parser accepts only zero-priced JSON-capable candidates', () => {
  assert.deepEqual(parseFreeModels(pricing), ['THUDM/GLM-4-9B-0414', 'Qwen/Qwen2.5-7B-Instruct']);
  assert.deepEqual(parseFreeModels(pricing.replace('"inputPrice":"0"', '"inputPrice":"1"')), ['THUDM/GLM-4-9B-0414', 'Qwen/Qwen2.5-7B-Instruct']);
});

test('policy fails closed when pricing cannot be confirmed', async () => {
  const policy = createFreeModelPolicy({ fetchImpl: async () => ({ ok: false, headers: new Headers(), body: null }), now: () => new Date('2026-09-29T00:00:00Z') });
  assert.equal(await policy.select(), null);
  assert.equal(policy.summary().status, 'unavailable');
});

test('policy selects preferred verified free candidate and excludes it after provider failure', async () => {
  let html = pricing;
  const policy = createFreeModelPolicy({ preferred: 'Qwen/Qwen2.5-7B-Instruct', fetchImpl: async () => ({ ok: true, headers: new Headers(), body: null, text: async () => html }), now: () => new Date('2026-09-29T00:00:00Z') });
  assert.equal(await policy.select(), 'Qwen/Qwen2.5-7B-Instruct');
  policy.exclude('Qwen/Qwen2.5-7B-Instruct');
  assert.equal(await policy.select(), 'THUDM/GLM-4-9B-0414');
  html = '<html></html>';
  assert.equal(policy.summary().status, 'verified');
});
