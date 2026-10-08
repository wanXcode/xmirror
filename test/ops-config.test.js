const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { resolveDownloadConfig } = require('../lib/download-config');

async function start(extraEnv = {}, { expectExit = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-ops-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ARCHIVES_DIR: path.join(dir, 'archives'), SQLITE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_BASE_URL: 'https://xput.app', MODERATION_ADMIN_TOKEN: 'test-only-token', ...extraEnv };
  for (const key of Object.keys(extraEnv)) if (extraEnv[key] === undefined) delete env[key];
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  const stop = async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } fs.rmSync(dir, { recursive: true, force: true }); };
  const base = `http://127.0.0.1:${port}`;
  if (expectExit) { await once(child, 'exit'); fs.rmSync(dir, { recursive: true, force: true }); return { exitCode: child.exitCode, log }; }
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) return { base, stop, log: () => log }; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(log);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${log}`);
}
const pageBase = async base => JSON.parse(/data-finder[\s\S]*?<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(await (await fetch(`${base}/`)).text())[1]).downloadBase;

test('download mode table: worker in production, node fallback by switch, dev keeps /dl', () => {
  assert.deepEqual(resolveDownloadConfig({ NODE_ENV: 'production' }), { via: 'worker', base: '/dl', mountPaths: [] });
  assert.deepEqual(resolveDownloadConfig({ NODE_ENV: 'production', DOWNLOAD_VIA: 'worker' }), { via: 'worker', base: '/dl', mountPaths: [] });
  assert.deepEqual(resolveDownloadConfig({ NODE_ENV: 'production', DOWNLOAD_VIA: 'node' }), { via: 'node', base: '/node-dl', mountPaths: ['/node-dl', '/dl'] });
  assert.deepEqual(resolveDownloadConfig({ DOWNLOAD_VIA: ' Node ' }).base, '/node-dl');
  assert.deepEqual(resolveDownloadConfig({}), { via: 'node', base: '/dl', mountPaths: ['/dl', '/node-dl'] }, 'development default is unchanged');
  assert.equal(resolveDownloadConfig({ NODE_ENV: 'production', DOWNLOAD_VIA: 'worker', DOWNLOAD_PROXY_BASE: 'http://127.0.0.1:8787/dl' }).base, 'http://127.0.0.1:8787/dl');
  assert.equal(resolveDownloadConfig({ ENABLE_LOCAL_DOWNLOAD_PROXY: 'false' }).via, 'worker', 'the old switch still works');
  assert.throws(() => resolveDownloadConfig({ DOWNLOAD_VIA: 'cdn' }), /DOWNLOAD_VIA must be/);
});

test('production + DOWNLOAD_VIA unset/worker: pages use /dl and Node serves no proxy (the Worker owns it)', { timeout: 60000 }, async () => {
  for (const via of [undefined, 'worker']) {
    const s = await start({ NODE_ENV: 'production', DOWNLOAD_VIA: via });
    try {
      assert.equal(await pageBase(s.base), '/dl');
      assert.equal((await fetch(`${s.base}/dl?u=${encodeURIComponent('https://evil.example/a.mp4')}`)).status, 404);
      assert.equal((await fetch(`${s.base}/node-dl?u=${encodeURIComponent('https://evil.example/a.mp4')}`)).status, 404);
    } finally { await s.stop(); }
  }
});

test('DOWNLOAD_VIA=node (emergency switch, restart only): pages use /node-dl, which Node serves with attachment rules', { timeout: 60000 }, async () => {
  const s = await start({ NODE_ENV: 'production', DOWNLOAD_VIA: 'node' });
  try {
    assert.equal(await pageBase(s.base), '/node-dl');
    assert.match(s.log(), /下载代理: node/);
    const refused = await fetch(`${s.base}/node-dl?u=${encodeURIComponent('https://evil.example/a.mp4')}`);
    assert.equal(refused.status, 400, 'served by the Node proxy, which only accepts *.twimg.com');
    assert.equal((await refused.json()).code, 'INVALID_TARGET');
    assert.equal((await fetch(`${s.base}/node-dl?u=${encodeURIComponent('https://evil.example/a.mp4')}`, { method: 'HEAD' })).status, 400);
    assert.equal((await fetch(`${s.base}/robots.txt`).then(r => r.text())).includes('Disallow: /node-dl'), true);
  } finally { await s.stop(); }
});

test('an invalid DOWNLOAD_VIA stops the server at startup instead of silently picking a mode', { timeout: 30000 }, async () => {
  const result = await start({ DOWNLOAD_VIA: 'cdn' }, { expectExit: true });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.log, /DOWNLOAD_VIA must be/);
});

test('admin APIs: no token or a wrong token is 401, a missing server token is 503, the right token passes', { timeout: 60000 }, async () => {
  const s = await start();
  try {
    // (the guard locks an address out after 10 failures, so keep the number of bad attempts below that)
    for (const route of ['/api/admin/featured', '/api/admin/reports']) assert.equal((await fetch(s.base + route)).status, 401, route);
    assert.equal((await fetch(`${s.base}/api/admin/featured/1`, { headers: { 'x-admin-token': 'wrong' } })).status, 401);
    for (const [route, method] of [['/api/admin/featured/1', 'POST'], ['/api/admin/featured/1/publish', 'POST'], ['/api/admin/featured/1/review', 'POST'], ['/api/admin/featured/1/withdraw', 'POST'], ['/api/admin/featured/1/followers', 'POST']]) {
      assert.equal((await fetch(s.base + route, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, route);
    }
    assert.equal((await fetch(`${s.base}/api/admin/featured`, { headers: { 'x-admin-token': 'test-only-token' } })).status, 200);
    const disclosed = await (await fetch(`${s.base}/api/admin/featured`)).text();
    assert.ok(!disclosed.includes('test-only-token'));
    assert.match(await (await fetch(`${s.base}/robots.txt`)).text(), /Disallow: \/api\//);
    assert.match((await fetch(`${s.base}/api/admin/featured`)).headers.get('x-robots-tag'), /noindex/);
  } finally { await s.stop(); }
  const unconfigured = await start({ MODERATION_ADMIN_TOKEN: '' });
  try { assert.equal((await fetch(`${unconfigured.base}/api/admin/featured`, { headers: { 'x-admin-token': '' } })).status, 503); } finally { await unconfigured.stop(); }
});

test('translation and subtitle routes: separate switches; translation on by default, subtitles off in production', { timeout: 60000 }, async () => {
  const translation = [['GET', '/api/translate/1'], ['POST', '/api/translate/1/tasks'], ['GET', '/api/translate/tasks/1'], ['POST', '/api/translate/tasks/1/retry']];
  const subtitles = [['GET', '/api/posts/1/subtitles'], ['POST', '/api/posts/1/subtitles']];
  const call = (base, [method, route]) => fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const check = async (env, enabledRoutes, disabledRoutes) => {
    const s = await start(env);
    try {
      for (const route of enabledRoutes) assert.notEqual((await call(s.base, route)).body.code, 'FEATURE_DISABLED', `${JSON.stringify(env)} ${route.join(' ')}`);
      for (const route of disabledRoutes) { const r = await call(s.base, route); assert.equal(r.status, 404, route.join(' ')); assert.equal(r.body.code, 'FEATURE_DISABLED'); }
    } finally { await s.stop(); }
  };
  await check({ NODE_ENV: 'production' }, translation, subtitles);
  await check({ NODE_ENV: 'production', FEATURE_TRANSLATION: 'false' }, [], [...translation, ...subtitles]);
  // The two switches are independent.
  await check({ NODE_ENV: 'production', FEATURE_SUBTITLES: 'true' }, [...translation, ...subtitles], []);
  await check({ NODE_ENV: 'development' }, [...translation, ...subtitles], []);
});
