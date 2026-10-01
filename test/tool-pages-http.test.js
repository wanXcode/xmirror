const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const sqlite3 = require('sqlite3');

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-tool-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ARCHIVES_DIR: path.join(dir, 'archives'), SQLITE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_BASE_URL: 'https://xput.app', MODERATION_ADMIN_TOKEN: 'test-only-token' };
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const db = new sqlite3.Database(env.SQLITE_PATH);
  t.after(() => new Promise(resolve => db.close(resolve)));
  return { base, db };
}

const post = (base, url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, error => (error ? reject(error) : resolve())));

test('home and viewer pages put every heading, answer and step in the HTML source, in both languages', { timeout: 30000 }, async t => {
  const { base } = await startServer(t);
  const en = require('../lib/content/en');
  const zh = require('../lib/content/zh');
  const decode = value => value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const [route, page] of [['/', en.pages.home], ['/twitter-viewer', en.pages.viewer], ['/zh/', zh.pages.home], ['/zh/twitter-viewer', zh.pages.viewer]]) {
    const html = decode(await (await fetch(base + route)).text());
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, route);
    for (const item of page.faq.items) { assert.ok(html.includes(item.q), `${route}: ${item.q}`); assert.ok(html.includes(item.a), `${route}: answer of ${item.q}`); }
    for (const item of page.steps.items) assert.ok(html.includes(item.text), `${route}: step`);
    for (const heading of [page.steps.h2, page.faq.h2]) assert.match(html, new RegExp(`<h2[^>]*>${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>`), `${route}: ${heading}`);
    assert.match(html, /<details open>/);
  }
});

test('the viewer page has no account search, profile browsing or timeline controls', { timeout: 30000 }, async t => {
  const { base } = await startServer(t);
  for (const route of ['/twitter-viewer', '/zh/twitter-viewer']) {
    const html = await (await fetch(base + route)).text();
    assert.equal((html.match(/<input\b/g) || []).length, 1, 'one link box, nothing else to type into');
    assert.equal((html.match(/<form\b/g) || []).length, 1, 'only the link box form');
    assert.doesNotMatch(html, /type="search"|role="search"|name="q"/);
    // The copy may say "no timelines" (the design does); there must be no way to get to one.
    assert.doesNotMatch(html, /href="https?:\/\/(?:x|twitter)\.com\/(?:home|explore|search)/);
  }
});

test('POST /api/age-confirm sets a session cookie that the server can read back', { timeout: 30000 }, async t => {
  const { base } = await startServer(t);
  const response = await post(base, '/api/age-confirm', {});
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^xput_age=1;/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Max-Age|Expires/i);
  assert.equal((await post(base, '/api/age-confirm', {}, { Origin: 'https://evil.example' })).status, 403);
});

test('POST /api/saved-copy answers from the database only', { timeout: 30000 }, async t => {
  const { base, db } = await startServer(t);
  await run(db, 'INSERT INTO posts(id,url,short_code,content,author,author_handle,html_file,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [1, 'https://x.com/i/status/20', 'Ab1234', 'hello', 'Jack', 'jack', 'post_1.html', '2026-03-04 10:00:00']);

  const found = await (await post(base, '/api/saved-copy', { url: 'https://twitter.com/jack/status/20?s=20' })).json();
  assert.deepEqual(found, { success: true, found: true, url: '/Ab1234', saved_at: '2026-03-04T10:00:00Z' });

  const missing = await (await post(base, '/api/saved-copy', { url: 'https://x.com/jack/status/21' })).json();
  assert.deepEqual(missing, { success: true, found: false });

  const invalid = await post(base, '/api/saved-copy', { url: 'https://example.com/a/status/1' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'INVALID_URL');
});
