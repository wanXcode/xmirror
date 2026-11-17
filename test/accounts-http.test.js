const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const sqlite3 = require('sqlite3');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const free = async () => {
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const { port } = listener.address(); await new Promise(resolve => listener.close(resolve));
  return port;
};

// A stand-in for Google: /token and /userinfo only.
async function fakeGoogle(t, profile) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/token') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        const form = new URLSearchParams(body);
        if (form.get('code') !== 'good-code' || form.get('client_secret') !== 'test-secret') { res.statusCode = 400; return res.end('{"error":"invalid_grant"}'); }
        res.end('{"access_token":"fake-access"}');
      });
    } else if (req.url === '/userinfo' && req.headers.authorization === 'Bearer fake-access') res.end(JSON.stringify(profile));
    else { res.statusCode = 401; res.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function startServer(t, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-acct-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const port = await free();
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ARCHIVES_DIR: path.join(dir, 'archives'), SQLITE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_BASE_URL: 'https://xput.app', MODERATION_ADMIN_TOKEN: 'test-only-token', ...extraEnv };
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const db = new sqlite3.Database(path.join(dir, 'db.sqlite'));
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, e => e ? reject(e) : resolve()));
  for (let i = 0; i < 100; i += 1) { try { await run('SELECT 1 FROM user_archives LIMIT 1'); break; } catch { await new Promise(r => setTimeout(r, 50)); } }
  for (const [id, content, code] of [['71', 'first saved post', 'Aaa071'], ['72', 'second saved post', 'Bbb072'], ['73', 'third saved post', 'Ccc073']]) {
    await run('INSERT INTO posts(url,author,author_handle,content,images,short_code,html_file) VALUES(?,?,?,?,?,?,?)', [`https://x.com/i/status/${id}`, 'Author', 'example', content, '[]', code, `post_${id}.html`]);
  }
  await new Promise(resolve => db.close(resolve));
  return base;
}

const cookieOf = response => response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const json = (base, url, { cookie, method = 'GET', body } = {}) => fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

async function signIn(base, google, next = '/zh/me') {
  const start = await fetch(`${base}/auth/google?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const done = await fetch(`${base}/auth/google/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { cookie: cookieOf(start) } });
  return { start, done, state };
}

test('Google sign-in, shortcut key, ownership, claim, list page and sign-out work end to end', { timeout: 60000 }, async t => {
  const google = await fakeGoogle(t, { sub: 'sub-1', email: 'v@example.com', email_verified: true, name: 'V Tester' });
  const base = await startServer(t, { GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_AUTH_URL: `${google}/auth`, GOOGLE_TOKEN_URL: `${google}/token`, GOOGLE_USERINFO_URL: `${google}/userinfo` });

  // Signed out: the page offers Google sign-in and is never indexed or cached.
  const anon = await fetch(`${base}/zh/me`);
  assert.equal(anon.status, 200);
  assert.match(anon.headers.get('cache-control'), /no-store/);
  const anonHtml = await anon.text();
  assert.match(anonHtml, /name="robots" content="noindex, nofollow"/);
  assert.ok(anonHtml.includes('href="/auth/google?next=%2Fzh%2Fme"'));
  assert.equal((await json(base, '/api/me')).status, 401);
  // Settings need a sign-in; the header entry is on every page.
  const bounced = await fetch(`${base}/zh/me/settings`, { redirect: 'manual' });
  assert.equal(bounced.status, 302);
  assert.equal(bounced.headers.get('location'), '/zh/me');
  const home = await (await fetch(`${base}/zh/`)).text();
  assert.match(home, /<div class="site-header__end">\s*<a class="account-link" href="\/zh\/me" aria-label="我的存档">/);

  // Sign-in redirects to Google with a state, and a wrong state is refused.
  const start = await fetch(`${base}/auth/google?next=${encodeURIComponent('//evil.test')}`, { redirect: 'manual' });
  const location = new URL(start.headers.get('location'));
  assert.equal(location.origin, google);
  assert.equal(location.searchParams.get('client_id'), 'test-id');
  assert.match(start.headers.get('set-cookie'), /HttpOnly/);
  const bad = await fetch(`${base}/auth/google/callback?code=good-code&state=forged`, { redirect: 'manual', headers: { cookie: cookieOf(start) } });
  assert.equal(bad.headers.get('location'), '/me?login=failed');
  assert.ok(!bad.headers.getSetCookie().some(c => c.startsWith('xput_session=') && !/Expires=Thu, 01 Jan 1970/.test(c)));

  const { done } = await signIn(base, google);
  assert.equal(done.status, 302);
  assert.equal(done.headers.get('location'), '/zh/me');
  const session = done.headers.getSetCookie().find(c => c.startsWith('xput_session='));
  assert.match(session, /HttpOnly/); assert.match(session, /SameSite=Lax/);
  const cookie = session.split(';')[0];

  const me = await (await json(base, '/api/me', { cookie })).json();
  assert.equal(me.user.name, 'V Tester'); assert.equal(me.key, null); assert.equal(me.archives, 0);

  // Key: wrong key is refused before anything is saved; right key records ownership.
  assert.equal((await json(base, '/api/archive/quick?format=json&key=xk_wrong&url=' + encodeURIComponent('https://x.com/example/status/71'))).status, 401);
  assert.equal((await json(base, '/api/me/key', { method: 'POST', body: {} })).status, 401);
  const { key } = await (await json(base, '/api/me/key', { cookie, method: 'POST', body: {} })).json();
  assert.match(key, /^xk_/);
  const quick = await fetch(`${base}/api/archive/quick?format=json&key=${key}&url=${encodeURIComponent('https://x.com/example/status/71')}`);
  assert.equal(quick.status, 200);
  assert.equal((await quick.json()).short_code, 'Aaa071');
  // Same via header, and an old shortcut without a key still works and is not recorded.
  assert.equal((await fetch(`${base}/api/archive/quick?format=text&url=${encodeURIComponent('https://x.com/example/status/72')}`, { headers: { 'x-xput-key': key } })).status, 200);
  assert.equal((await fetch(`${base}/api/archive/quick?format=text&url=${encodeURIComponent('https://x.com/example/status/73')}`)).status, 200);
  // Saving from the website while signed in is recorded too.
  await json(base, '/api/archive', { cookie, method: 'POST', body: { url: 'https://x.com/example/status/71' } });

  let list = await (await json(base, '/api/me/archives', { cookie })).json();
  assert.deepEqual(list.archives.map(item => item.short_code).sort(), ['Aaa071', 'Bbb072']);
  assert.deepEqual(list.archives.map(item => item.source).sort(), ['shortcut', 'shortcut']);

  // Claim: short link, X link, junk and a missing one.
  const claim = await (await json(base, '/api/me/archives/claim', { cookie, method: 'POST', body: { text: 'https://xput.app/Ccc073\nhttps://x.com/example/status/71\nhttps://xput.app/Zzz999\nhello' } })).json();
  assert.deepEqual([claim.found, claim.added, claim.already, claim.missing], [2, 1, 1, 1]);
  assert.equal((await json(base, '/api/me/archives/claim', { cookie, method: 'POST', body: {} })).status, 400);

  // The page lists them, in either language, with search.
  const page = await (await fetch(`${base}/zh/me`, { headers: { cookie } })).text();
  assert.match(page, /我的存档/); assert.ok(page.includes('href="/Ccc073"')); assert.ok(page.includes('data-me-remove="Aaa071"'));
  assert.ok(page.includes('class="me-tab is-active" href="/zh/me"'));
  assert.ok(!page.includes('data-me-key') && !page.includes('data-me-claim'), 'key and claim live under Settings');
  const settings = await fetch(`${base}/zh/me/settings`, { headers: { cookie } });
  assert.equal(settings.status, 200);
  assert.match(settings.headers.get('cache-control'), /no-store/);
  const settingsHtml = await settings.text();
  assert.ok(settingsHtml.includes('<title>设置 – 我的存档 | XPut</title>'));
  assert.ok(settingsHtml.includes('data-me-key') && settingsHtml.includes('data-me-claim') && settingsHtml.includes('data-me-logout'));
  assert.ok(!settingsHtml.includes('data-me-remove'));
  assert.ok(settingsHtml.includes('class="me-tab is-active" href="/zh/me/settings"'));
  assert.equal((await fetch(`${base}/me/settings`, { headers: { cookie } })).status, 200);
  const found = await (await fetch(`${base}/me?q=${encodeURIComponent('status/71')}`, { headers: { cookie } })).text();
  assert.ok(found.includes('href="/Aaa071"')); assert.ok(!found.includes('href="/Bbb072"'));
  assert.equal((await fetch(`${base}/me?page=9`, { headers: { cookie } })).status, 404);

  // Removing only unlinks; the saved copy is still there for everyone.
  assert.equal((await (await json(base, '/api/me/archives/Bbb072', { cookie, method: 'DELETE' })).json()).removed, true);
  list = await (await json(base, '/api/me/archives', { cookie })).json();
  assert.deepEqual(list.archives.map(item => item.short_code).sort(), ['Aaa071', 'Ccc073']);
  assert.equal((await fetch(`${base}/Bbb072`)).status, 200);

  // A cross-site POST is refused, signing out ends the session.
  const cross = await fetch(`${base}/api/me/key`, { method: 'POST', headers: { cookie, origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(cross.status, 403);
  assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, origin: 'https://evil.test' } })).status, 403);
  assert.equal((await json(base, '/auth/logout', { cookie, method: 'POST', body: {} })).status, 200);
  assert.equal((await json(base, '/api/me', { cookie })).status, 401);
  // The key keeps working for the shortcut after signing out of the browser.
  assert.equal((await fetch(`${base}/api/archive/quick?format=text&key=${key}&url=${encodeURIComponent('https://x.com/example/status/72')}`)).status, 200);
});

test('without Google credentials the account page says sign-in is unavailable and nothing else changes', { timeout: 30000 }, async t => {
  const base = await startServer(t);
  const page = await (await fetch(`${base}/me`)).text();
  assert.match(page, /Sign-in is not available right now\./);
  assert.ok(!page.includes('href="/auth/google'));
  assert.equal((await fetch(`${base}/auth/google`, { redirect: 'manual' })).headers.get('location'), '/me');
  assert.equal((await fetch(`${base}/api/archive/quick?format=text&url=${encodeURIComponent('https://x.com/example/status/71')}`)).status, 200);
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok(!sitemap.includes('/me'));
});
