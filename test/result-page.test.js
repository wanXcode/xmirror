const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const sqlite3 = require('sqlite3');
const { parseHTML } = require('linkedom');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) await fn(); });

// One server for the whole file: every test seeds its own rows (distinct short codes).
let shared;
const server = () => (shared ||= startServer());

async function startServer(extraEnv = {}) {
  const t = { after: fn => cleanups.push(fn) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-result-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, ARCHIVES_DIR: path.join(dir, 'archives'), SQLITE_PATH: path.join(dir, 'db.sqlite'), PUBLIC_BASE_URL: 'https://xput.app', MODERATION_ADMIN_TOKEN: 'test-only-token', VIEW_COUNTER_FLUSH_MS: '100', ...extraEnv };
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
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, error => (error ? reject(error) : resolve())));
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => (error ? reject(error) : resolve(row))));
  return { base, dir, run, get };
}

let counter = 0;
// Inserts a post with a unique id, short code and URL; returns the stored values.
async function seed(s, row = {}) {
  counter += 1;
  const post = {
    id: counter, url: `https://x.com/i/status/${1000 + counter}`, short_code: `T${String(counter).padStart(5, '0')}`, author: 'Jack', author_handle: 'jack',
    content: 'Hello world', images: '[]', video_status: 'none', tweet_time: '2026-09-30T10:00:00.000Z', created_at: '2026-10-01 09:00:00',
    reply_count: 12, html_file: `post_${counter}.html`, ...row
  };
  const keys = Object.keys(post);
  await s.run(`INSERT INTO posts(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(k => post[k]));
  return post;
}

const page = async (s, code, headers = {}) => {
  const response = await fetch(`${s.base}/${code}`, { headers, redirect: 'manual' });
  const text = await response.text();
  return { response, text, document: parseHTML(text).document };
};

test('a normal saved post: noindex, one H1, title and description, OG tags, dates, replies and actions', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { content: 'Hello world, this is a post.<br>Second line.' });
  const code = post.short_code;
  const { response, document, text } = await page(s, code);
  assert.equal(response.status, 200);
  assert.equal(document.title, 'Jack on X: "Hello world, this is a post. Second line." | XPut');
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.equal(document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim(), 'Jack on X');
  assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow');
  assert.equal(document.querySelector('link[rel=canonical]').getAttribute('href'), `https://xput.app/${code}`);
  assert.equal(document.querySelectorAll('link[rel=alternate]').length, 0, 'saved posts have no hreflang');
  assert.equal(document.querySelector('meta[name=description]').getAttribute('content'), 'Hello world, this is a post. Second line.');
  assert.equal(document.querySelector('meta[property="og:image"]').getAttribute('content'), `https://xput.app/og/${code}.png`);
  assert.equal(document.querySelector('meta[property="og:type"]').getAttribute('content'), 'article');
  assert.equal(document.querySelector('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
  assert.equal(document.querySelector('meta[property="article:published_time"]').getAttribute('content'), '2026-09-30T10:00:00.000Z');
  assert.match(document.querySelector('.post__text').textContent, /Hello world, this is a post\.\s*Second line\./);
  assert.deepEqual([...document.querySelectorAll('.post__meta span')].map(span => span.textContent), ['Sep 30, 2026 · Saved by XPut on Oct 1, 2026', '12 replies']);
  assert.equal(document.querySelector('.post__note').textContent, 'This is a saved copy. The original post may have changed or been removed.');
  assert.equal(document.querySelector('.post__actions a').getAttribute('href'), post.url);
  assert.equal(document.querySelector('[data-open-drawer]'), null, 'no media, nothing to download');
  assert.equal(document.querySelector('h2').textContent, 'Save or view another post');
  assert.match(response.headers.get('vary'), /Cookie/);
  assert.doesNotMatch(text, /,\s*<\/head>/, 'no stray text from the head slot');
});

test('posts with media: gallery, local video, download button; a pending video says so', { timeout: 60000 }, async () => {
  const s = await server();
  const photos = await seed(s, { images: '["/images/a.jpg","/images/b.jpg"]', content: 'pics<br><img src="/images/a.jpg" style="x"><img src="/images/b.jpg">' });
  const video = await seed(s, { video: '/videos/v.mp4', video_status: 'completed', video_poster: '/images/poster.jpg', content: 'a video' });
  const pending = await seed(s, { video_status: 'downloading', video_source_url: 'https://video.twimg.com/v.mp4', content: 'wait' });

  const gallery = (await page(s, photos.short_code)).document;
  assert.equal(gallery.querySelectorAll('.photo__open').length, 2);
  assert.equal(gallery.querySelectorAll('.post__text img').length, 0, 'gallery images are not repeated inside the text');
  assert.ok(gallery.querySelector('[data-open-drawer]'));

  const player = (await page(s, video.short_code)).document;
  assert.equal(player.querySelector('video source').getAttribute('src'), '/videos/v.mp4');
  assert.equal(player.querySelector('video').getAttribute('poster'), '/images/poster.jpg');
  assert.ok(player.querySelector('video').hasAttribute('controls'));

  const waiting = await page(s, pending.short_code);
  assert.match(waiting.document.querySelector('[data-video-pending]').textContent, /still being saved/);
  const config = JSON.parse(waiting.document.querySelector('[data-post-config]').textContent);
  assert.equal(config.videoPending, true);
  assert.equal(config.endpoints.videoStatus, `/api/posts/${pending.id}/video-status`);
});

test('the page config carries the original link, local files for the drawer fallback and the result strings', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { images: '["/images/a.jpg"]', video: '/videos/v.mp4', video_status: 'completed', content: 'x' });
  const config = JSON.parse((await page(s, post.short_code)).document.querySelector('[data-post-config]').textContent);
  assert.equal(config.url, post.url);
  assert.equal(config.shareUrl, `https://xput.app/${post.short_code}`);
  assert.equal(config.local.videos[0].variants[0].url, '/videos/v.mp4');
  assert.equal(config.local.images[0].orig_url, '/images/a.jpg');
  assert.equal(config.result.zip, 'Download {n} photos (ZIP)');
  assert.equal(config.downloadBase, '/dl');
});

test('language: ?lang= is remembered and the clean URL is shown; the cookie then drives the interface', { timeout: 60000 }, async () => {
  const s = await server();
  const { short_code: code } = await seed(s, { content: '你好，世界。这是一条测试推文。' });
  const switched = await fetch(`${s.base}/${code}?lang=zh`, { redirect: 'manual' });
  assert.equal(switched.status, 302);
  assert.equal(switched.headers.get('location'), `/${code}`);
  assert.match(switched.headers.get('set-cookie'), /^xput_lang=zh;/);
  assert.equal((await fetch(`${s.base}/${code}?lang=xx`, { redirect: 'manual' })).headers.get('set-cookie'), null, 'unknown languages are ignored');

  const zh = (await page(s, code, { Cookie: 'xput_lang=zh' })).document;
  assert.equal(zh.documentElement.getAttribute('lang'), 'zh-Hans');
  assert.equal(zh.title, 'Jack 的 X 帖子：“你好，世界。这是一条测试推文。” | XPut');
  assert.equal(zh.querySelector('h1').textContent.replace(/\s+/g, ' ').trim(), 'Jack 的 X 帖子');
  assert.match(zh.querySelector('.post__meta').textContent, /XPut 保存于 2026年10月1日/);
  assert.equal(zh.querySelector('.post__note').textContent, '这是保存的副本，原帖可能已修改或删除。');
  assert.equal(zh.querySelector('h2').textContent, '下载或查看其他帖子');
  assert.match(zh.querySelector('.post__text').textContent, /你好，世界/, 'the post text is never translated');
  assert.equal(zh.querySelector('#lang-panel a[hreflang="en"]').getAttribute('href'), `/${code}?lang=en`);

  const fromBrowser = (await page(s, code, { 'Accept-Language': 'zh-CN,zh;q=0.9' })).document;
  assert.equal(fromBrowser.documentElement.getAttribute('lang'), 'zh-Hans');
  const saved = (await page(s, code, { 'Accept-Language': 'zh-CN', Cookie: 'xput_lang=en' })).document;
  assert.equal(saved.documentElement.getAttribute('lang'), 'en', 'the saved choice beats the browser');
});

test('sensitive posts show only the author until the age is confirmed (session cookie), anywhere in the HTML', { timeout: 60000 }, async () => {
  const s = await server();
  const { short_code: code } = await seed(s, { sensitive: 1, content: 'adult text that must not be sent', images: '["/images/secret.jpg"]' });
  const locked = await page(s, code);
  assert.equal(locked.response.status, 200);
  assert.doesNotMatch(locked.text, /adult text that must not be sent|secret\.jpg/);
  assert.equal(locked.document.title, 'Jack on X | XPut');
  assert.equal(locked.document.querySelector('meta[property="og:image"]').getAttribute('content'), 'https://xput.app/xput-share.png');
  assert.match(locked.document.querySelector('.sensitive__text').textContent, /Confirm you are 18 or older to see it/);
  assert.ok(locked.document.querySelector('[data-age-confirm]'));
  assert.equal(locked.document.querySelector('[data-open-drawer]'), null);
  assert.equal(locked.document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow');

  const open = await page(s, code, { Cookie: 'xput_age=1' });
  assert.match(open.text, /adult text that must not be sent/);
  assert.equal(open.document.querySelector('[data-age-confirm]'), null);
});

test('removed copies answer 410 with the reference; unknown codes get the friendly 404; aliases redirect', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s);
  await s.run("INSERT INTO removed_posts(short_code, post_id, reference) VALUES('Rm1234', 9, 'RPT-42')");
  await s.run("INSERT INTO removed_posts(short_code, post_id) VALUES('Rm5678', 10)");
  await s.run("INSERT INTO post_aliases(alias_code, target_post_id) VALUES('Al1234', ?)", [post.id]);

  const removed = await page(s, 'Rm1234');
  assert.equal(removed.response.status, 410);
  assert.equal(removed.document.querySelector('h1').textContent, 'This copy was removed');
  assert.match(removed.document.querySelector('.status-card__text').textContent, /taken down at the author's or rights holder's request\. Reference: RPT-42\./);
  assert.equal(removed.document.querySelector('.status-card__actions a').getAttribute('href'), '/');
  assert.match(removed.document.querySelector('meta[name=robots]').getAttribute('content'), /noindex/);
  assert.doesNotMatch((await page(s, 'Rm5678')).text, /Reference:/);

  const missing = await page(s, 'Zz9999');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.document.querySelector('h1').textContent, "This link doesn't exist");
  assert.ok(missing.document.querySelector('[data-finder]'), 'a link box to get started');

  const alias = await fetch(`${s.base}/Al1234`, { redirect: 'manual' });
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get('location'), `/${post.short_code}`);
});

test('legacy indexable archives stay indexable; everything else is noindex', { timeout: 60000 }, async () => {
  const s = await server();
  const legacy = await seed(s, { seo_status: 'index', seo_blocked: 0, legacy_indexed: 1 });
  const fresh = await seed(s, { seo_status: 'index', seo_blocked: 0 });
  const blocked = await seed(s, { seo_status: 'index', seo_blocked: 1, legacy_indexed: 1 });
  const robots = async post => (await page(s, post.short_code)).document.querySelector('meta[name=robots]').getAttribute('content');
  assert.equal(await robots(legacy), 'index, follow');
  assert.equal(await robots(fresh), 'noindex, follow', 'saved after the redesign: noindex until featured');
  assert.equal(await robots(blocked), 'noindex, follow', 'a blocked archive is never indexable');
});

test('views and shares are counted (not for crawlers, shares once per hour per visitor)', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s);
  const browser = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36' };
  await page(s, post.short_code, browser); await page(s, post.short_code, browser);
  await page(s, post.short_code, { 'User-Agent': 'Googlebot/2.1' });
  for (let i = 0; i < 3; i += 1) assert.equal((await fetch(`${s.base}/api/posts/${post.short_code}/share`, { method: 'POST', headers: browser })).status, 204);
  assert.equal((await fetch(`${s.base}/api/posts/Zz9999/share`, { method: 'POST', headers: browser })).status, 404);
  for (let i = 0; i < 40; i += 1) {
    const row = await s.get('SELECT view_count, share_count FROM posts WHERE id=?', [post.id]);
    if (row.view_count === 2 && row.share_count === 1) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(await s.get('SELECT view_count, share_count FROM posts WHERE id=?', [post.id]), { view_count: 2, share_count: 1 });
});

test('admin delete leaves a removal notice with the report reference, and the old link says so', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s);
  const deleted = await fetch(`${s.base}/api/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'test-only-token' }, body: JSON.stringify({ id: post.id, reference: 'RPT-7' }) });
  assert.equal(deleted.status, 200);
  const removed = await page(s, post.short_code);
  assert.equal(removed.response.status, 410);
  assert.match(removed.document.querySelector('.status-card__text').textContent, /Reference: RPT-7\./);
});

test('old per-file archive links redirect to the short code', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { html_file: 'post_1700000000000.html' });
  const response = await fetch(`${s.base}/archives/post_1700000000000.html`, { redirect: 'manual' });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), `/${post.short_code}`);
  assert.equal((await fetch(`${s.base}/archives/post_424242.html`)).status, 404);
});
