const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-pages-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ARCHIVES_DIR: path.join(dir, 'archives'), SQLITE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_BASE_URL: 'https://xput.app', MODERATION_ADMIN_TOKEN: 'test-only-token' };
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${output}`);
}

test('fixed pages are served before short codes, per language, with the shared shell', { timeout: 30000 }, async t => {
  const base = await startServer(t);

  const redirect = await fetch(`${base}/zh`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/zh/');

  const cases = [
    ['/zh/', '推特视频下载器 – X（Twitter）高清视频在线下载 | XPut', 'zh-Hans'],
    ['/twitter-viewer', 'Twitter Viewer – View X Posts Without an Account | XPut', 'en'],
    ['/zh/twitter-viewer', '推特在线查看器 – 无需登录查看 X 推文 | XPut', 'zh-Hans'],
    ['/ios-shortcut', 'Download Twitter Videos on iPhone – One-Tap Shortcut | XPut', 'en'],
    ['/zh/ios-shortcut', 'iPhone 一键保存推特视频 – XPut 快捷指令', 'zh-Hans']
  ];
  for (const [route, title, lang] of cases) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const body = await response.text();
    assert.ok(body.includes(`<title>${title}</title>`), `${route} title`);
    assert.ok(body.includes(`<html lang="${lang}">`), `${route} lang`);
    assert.equal(body.match(/<h1[\s>]/g).length, 1, `${route} has one h1`);
    assert.match(body, /rel="alternate" hreflang="x-default"/);
    assert.match(body, /<footer class="site-footer">/);
  }
});

test('the shared stylesheet and nav script are served, and existing routes keep working', { timeout: 30000 }, async t => {
  const base = await startServer(t);
  const css = await fetch(`${base}/css/xput.css`);
  assert.equal(css.status, 200);
  assert.match(await css.text(), /--primary: #1747C9/);
  assert.equal((await fetch(`${base}/js/nav.js`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);          // current home stays until its template lands
  assert.equal((await fetch(`${base}/report`)).status, 200);    // 6-letter fixed page is not shadowed by the short code route
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/Zz9Zz9`)).status, 404);    // unknown short code
});
