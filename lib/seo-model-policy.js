// This module reads public provider pricing as data. Never eval page scripts.
const PRICING_URL = 'https://www.siliconflow.cn/pricing';
const CANDIDATES = Object.freeze(['THUDM/GLM-4-9B-0414', 'Qwen/Qwen2.5-7B-Instruct']);
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_PRICING_BYTES = 4 * 1024 * 1024;

function parseFreeModels(html) {
  if (Buffer.byteLength(html, 'utf8') > MAX_PRICING_BYTES) throw new Error('pricing_too_large');
  // The provider publishes its structured catalogue in Next.js Flight chunks.
  // Decode only JSON push arrays, then resolve the exact referenced price rows.
  let flight = '';
  for (const match of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    const chunk = JSON.parse(match[1]);
    if (chunk[0] === 1 && typeof chunk[1] === 'string') flight += chunk[1];
  }
  const rows = new Map();
  for (const line of flight.split('\n')) {
    const match = /^([a-f0-9]+):([\[{].*)$/.exec(line);
    if (!match) continue;
    try {
      const value = JSON.parse(match[2]);
      if (rows.has(match[1])) throw new Error('duplicate_row');
      rows.set(match[1], value);
    } catch (error) {
      if (error.message === 'duplicate_row') throw error;
      // Non-JSON Flight records are irrelevant; unresolved prices fail closed.
    }
  }
  const resolve = value => typeof value === 'string' && /^\$[a-f0-9]+$/.test(value) ? rows.get(value.slice(1)) : value;
  const zero = value => (typeof value === 'number' && value === 0) || (typeof value === 'string' && /^0(?:\.0+)?$/.test(value));
  const free = [];
  let matched = 0;
  for (const name of CANDIDATES) {
    const models = [...rows.values()].filter(row => row?.modelName === name);
    if (models.length !== 1) continue;
    matched++;
    const model = models[0], prices = resolve(model.pricing);
    if (model.status !== 'normal' || model.type !== 'text' || model.subType !== 'chat' ||
        model.jsonModeSupport !== true || model.currency !== '¥' || model.priceUnit !== '/ M Tokens' ||
        !zero(model.inputPrice) || !zero(model.price) || !Array.isArray(prices)) continue;
    const entries = prices.map(resolve);
    if (!entries.length || entries.some(row => !row || !zero(row.price) || row.unitOfGood !== '/ M Tokens')) continue;
    if (!['prompt','completion'].every(kind => entries.some(row => row.specification === kind))) continue;
    free.push(name);
  }
  if (!matched) throw new Error('pricing_unrecognized');
  return free;
}

async function readPricing(response) {
  if (!response.ok) throw new Error('pricing_http');
  if (Number(response.headers?.get('content-length')) > MAX_PRICING_BYTES) throw new Error('pricing_too_large');
  if (!response.body) return response.text();
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_PRICING_BYTES) throw new Error('pricing_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createFreeModelPolicy({ preferred = CANDIDATES[0], fetchImpl = fetch, now = () => new Date() } = {}) {
  const order = [...new Set([preferred, ...CANDIDATES])].filter(name => CANDIDATES.includes(name));
  let state = { status:'pending', checkedAt:null, nextCheckAt:null, models:[] };
  let nextCheck = 0, selected = null, inFlight;
  const excluded = new Map();
  async function refresh() {
    try {
      const response = await fetchImpl(PRICING_URL, { signal:AbortSignal.timeout(10000), redirect:'error', cache:'no-store' });
      const free = parseFreeModels(await readPricing(response));
      state = { ...state, status:free.length ? 'verified' : 'no_free_model', models:free };
    } catch {
      state = { ...state, status:'unavailable', models:[] };
    }
    const time = now().getTime();
    nextCheck = time + CHECK_INTERVAL_MS;
    state.checkedAt = new Date(time).toISOString();
    state.nextCheckAt = new Date(nextCheck).toISOString();
  }
  async function select() {
    if (now().getTime() >= nextCheck) {
      if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
      await inFlight;
    }
    selected = order.find(name => state.models.includes(name) && (excluded.get(name) || 0) <= now().getTime()) || null;
    return selected;
  }
  function exclude(model, retryAfter) {
    const seconds = Number(retryAfter);
    excluded.set(model, now().getTime() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.max(60, seconds)) * 1000 : CHECK_INTERVAL_MS));
    if (selected === model) selected = null;
  }
  function summary() {
    const fresh = now().getTime() < nextCheck;
    const model = fresh ? order.find(name => state.models.includes(name) && (excluded.get(name) || 0) <= now().getTime()) || null : null;
    return { ...state, status:!fresh && state.checkedAt ? 'pending' : state.status, model, source:PRICING_URL };
  }
  return { select, exclude, summary };
}
module.exports = { createFreeModelPolicy, parseFreeModels, PRICING_URL, CANDIDATES, CHECK_INTERVAL_MS };
