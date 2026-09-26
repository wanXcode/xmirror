const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const home = require('../public/home-state');

function element() {
  const attrs = {};
  const listeners = {};
  return {
    value: '', innerHTML: '', textContent: '', hidden: false, children: [], dataset: {},
    setAttribute: (key, value) => { attrs[key] = value; },
    removeAttribute: key => { delete attrs[key]; },
    getAttribute: key => attrs[key],
    addEventListener: (event, callback) => { listeners[event] = callback; },
    appendChild(node) { this.children.push(node); },
    replaceChildren() { this.children = []; this.innerHTML = ''; },
    focus() {}, listeners
  };
}

function harness({ archiveFetch, historyFetch, storage } = {}) {
  const elements = new Map();
  const get = key => {
    if (!elements.has(key)) elements.set(key, element());
    return elements.get(key);
  };
  let value = null;
  const timers = new Map();
  const requests = [];
  const context = vm.createContext({
    XPutHome: home, URL, AbortController, Date, console,
    i18n: { currentLang: 'zh', t: key => key },
    localStorage: storage || { getItem: () => value, setItem: (_key, next) => { value = next; } },
    document: {
      documentElement: get('root'), getElementById: get, querySelector: get,
      createElement: element, addEventListener() {}
    },
    DOMParser: class { parseFromString(content) { return { querySelector: () => null, body: { textContent: content.replace(/<[^>]*>/g, '') } }; } },
    window: { location: { origin: 'https://xput.app' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    setTimeout(fn, ms) { const id = Symbol(); timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options });
      return url.startsWith('/api/posts')
        ? historyFetch ? historyFetch(url, options) : reply({ posts: [], has_more: false })
        : archiveFetch(url, options);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context);
  return { get, requests, timers, run: code => vm.runInContext(code, context) };
}
function reply(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
const success = { success: true, id: 7, title: 'A title', author: 'Author', url: '/Ab1234', video_status: 'queued' };
const url = 'https://x.com/example/status/123';

test('submission blocks duplicate requests and stores successful video-pending archives', async () => {
  let resolve;
  const page = harness({ archiveFetch: () => new Promise(done => { resolve = done; }) });
  page.get('url').value = url;
  const pending = page.run('archive()');
  await page.run('archive()');
  assert.equal(page.requests.filter(request => request.url === '/api/archive').length, 1);
  assert.equal(page.get('submit').disabled, true);
  assert.equal(page.get('loading').hidden, false);
  resolve(reply(success));
  await pending;
  assert.equal(page.get('submit').disabled, false);
  assert.equal(page.get('loading').hidden, true);
  assert.equal(page.get('url').value, '');
  assert.equal(page.get('localPanel').hidden, false);
  assert.match(page.get('localHistoryList').innerHTML, /A title/);
  assert.ok(page.get('result').children.some(node => node.textContent === 'videoPending'));
  assert.equal(page.run('localRecords.length'), 1);
});

test('invalid input is preserved and never sent to the archive API', async () => {
  const page = harness();
  page.get('url').value = 'https://x.com/home';
  await page.run('archive()');
  assert.equal(page.get('url').value, 'https://x.com/home');
  assert.match(page.get('result').innerHTML, /errorInvalidUrl/);
  assert.equal(page.requests.some(request => request.url === '/api/archive'), false);
});

test('failed requests retain input and only transient errors offer retry', async () => {
  for (const code of ['SOURCE_UNAVAILABLE', 'CONTENT_UNSUPPORTED', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE']) {
    const page = harness({ archiveFetch: () => reply({ success: false, code }, 400) });
    page.get('url').value = url;
    await page.run('archive()');
    assert.equal(page.get('url').value, url);
    assert.equal(page.get('submit').disabled, false);
    assert.equal(page.get('result').children.some(node => node.textContent === 'retry'), home.failureFor(code).retryable);
  }
});

test('non-JSON server errors and connection failures have friendly retryable messages', async () => {
  for (const [archiveFetch, message] of [
    [() => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('<html>'); } }), 'errorService'],
    [() => { throw new TypeError('Failed to fetch'); }, 'errorNetwork']
  ]) {
    const page = harness({ archiveFetch });
    page.get('url').value = url;
    await page.run('archive()');
    assert.match(page.get('result').innerHTML, new RegExp(message));
    assert.doesNotMatch(page.get('result').innerHTML, /html|Failed to fetch/);
    assert.equal(page.get('url').value, url);
  }
});

test('the 120 second timeout reports an unconfirmed result and releases submission', async () => {
  const page = harness({ archiveFetch: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
  }) });
  page.get('url').value = url;
  const pending = page.run('archive()');
  [...page.timers.values()].find(timer => timer.ms === 120000).fn();
  await pending;
  assert.match(page.get('result').innerHTML, /errorTimeout/);
  assert.equal(page.get('submit').disabled, false);
  assert.equal(page.get('url').value, url);
});

test('storage failure keeps the successful result and shows an explicit warning', async () => {
  const page = harness({
    archiveFetch: () => reply(success),
    storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
  });
  page.get('url').value = url;
  await page.run('archive()');
  assert.match(page.get('result').innerHTML, /Ab1234/);
  assert.ok(page.get('result').children.some(node => node.textContent === 'storageUnavailable'));
  assert.equal(page.run('localRecords.length'), 1);
});

test('pagination failure keeps loaded posts and retries the same offset', async () => {
  let count = 0;
  const page = harness({ historyFetch: () => {
    count += 1;
    if (count === 2) return reply({}, 503);
    return reply({ posts: [{ id: count, short_url: '/Ab1234', content: `Post ${count}`, author: 'Author', created_at: '2026-09-26' }], has_more: true });
  } });
  // Complete the initial page started by initialization.
  await new Promise(resolve => setImmediate(resolve));
  await page.run('loadHistory()');
  assert.match(page.get('historyList').innerHTML, /Post 1/);
  assert.equal(page.get('historyRetry').hidden, false);
  await page.run('loadHistory()');
  assert.match(page.get('historyList').innerHTML, /Post 1/);
  assert.match(page.get('historyList').innerHTML, /Post 3/);
  assert.equal(page.get('historyRetry').hidden, true);
  assert.deepEqual(page.requests.map(request => request.url), [
    '/api/posts?limit=10&offset=0', '/api/posts?limit=10&offset=1', '/api/posts?limit=10&offset=1'
  ]);
});
