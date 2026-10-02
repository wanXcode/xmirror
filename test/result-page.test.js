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

const robotsOf = async (s, post) => (await page(s, post.short_code)).document.querySelector('meta[name=robots]').getAttribute('content');
const ldTypes = document => [...document.querySelectorAll('script[type="application/ld+json"]')].map(n => JSON.parse(n.textContent)['@type']);

test('indexable = AI featured (live) or selected by the SEO mechanism (seo_status index); everything else is noindex', { timeout: 60000 }, async () => {
  const seo = require('../lib/seo');
  const s = await server();
  const old = await seed(s, { seo_status: 'index', legacy_indexed: 1, content: 'An old archive that was already in the list' });
  const fresh = await seed(s, { seo_status: 'index', content: 'A newly saved archive that scored well' });
  const review = await seed(s, { seo_status: 'review' });
  const noindex = await seed(s, { seo_status: 'noindex' });
  for (const post of [old, fresh]) {
    const { document, response } = await page(s, post.short_code);
    assert.equal(response.status, 200);
    assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'index, follow', post.short_code);
    assert.equal(document.title, `${seo.metadata(post).title} | XPut`, 'keeps its SEO title');
    assert.equal(document.querySelector('meta[name=description]').getAttribute('content'), seo.metadata(post).description);
    assert.ok(ldTypes(document).includes('SocialMediaPosting'), 'structured data');
    assert.equal(document.querySelector('.xput-notes'), null, 'ordinary template, not the AI featured one');
    const ld = JSON.parse([...document.querySelectorAll('script[type="application/ld+json"]')].map(n => n.textContent).find(t => t.includes('SocialMediaPosting')));
    assert.equal(ld.url, `https://xput.app/${post.short_code}`);
    assert.equal(ld.isBasedOn, post.url);
    assert.equal(ld.author.name, 'Jack');
  }
  for (const post of [review, noindex]) {
    const { document } = await page(s, post.short_code);
    assert.equal(await robotsOf(s, post), 'noindex, follow');
    assert.ok(!ldTypes(document).includes('SocialMediaPosting'));
  }
});

test('selected archives lose indexing when blocked, reported, sensitive or removed', { timeout: 60000 }, async () => {
  const s = await server();
  const ok = await seed(s, { seo_status: 'index' });
  const blocked = await seed(s, { seo_status: 'index', seo_blocked: 1 });
  const reported = await seed(s, { seo_status: 'index' });
  const sensitive = await seed(s, { seo_status: 'index', sensitive: 1 });
  const removed = await seed(s, { seo_status: 'index' });
  await s.run("INSERT INTO content_reports(post_id, short_code, kind, reason, status) VALUES(?, ?, 'other', 'x', 'open')", [reported.id, reported.short_code]);
  await s.run("INSERT OR REPLACE INTO removed_posts(short_code, post_id, reference) VALUES(?, ?, 'REF')", [removed.short_code, removed.id]);
  assert.equal(await robotsOf(s, ok), 'index, follow');
  for (const post of [blocked, reported, sensitive]) assert.equal(await robotsOf(s, post), 'noindex, follow', post.short_code);
  // (normally a taken-down copy has no row at all and answers 410; a row that still has a tombstone must not be indexable either)
  assert.equal(await robotsOf(s, removed), 'noindex, follow');
  await s.run("UPDATE content_reports SET status='closed' WHERE post_id=?", [reported.id]);
  assert.equal(await robotsOf(s, reported), 'index, follow', 'a closed report no longer blocks indexing');
});

test('an AI featured page that is also selected uses the featured template', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { seo_status: 'index', view_count: 60, share_count: 3, author_followers: 5000 });
  assert.equal((await feature(s, post)).status, 200);
  const { document } = await page(s, post.short_code);
  assert.ok(document.querySelector('.xput-notes'));
  assert.equal(document.querySelectorAll('script[type="application/ld+json"]').length >= 1, true);
  assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'index, follow');
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

// ---- featured pages ----
const ADMIN = { 'x-admin-token': 'test-only-token', 'content-type': 'application/json' };
const FEATURED = {
  ai_title: 'Jack says the roadmap changes next quarter',
  topic: 'Product roadmap',
  summary: 'Jack announces that the product roadmap will change next quarter, with the new editor shipping first and the mobile app following later in the year.',
  context: 'The announcement follows weeks of user feedback about the editor and comes just before the annual planning meeting of the company.',
  key_points: ['The editor ships first', 'The mobile app follows later', 'Feedback drove the change']
};
const admin = (s, path, body, method = 'POST') => fetch(`${s.base}${path}`, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, json: await r.json() }));

async function feature(s, post) {
  assert.equal((await admin(s, `/api/admin/featured/${post.id}`, FEATURED)).status, 200);
  assert.equal((await admin(s, `/api/admin/featured/${post.id}/review`, { reviewed: true, note: 'ok' })).status, 200);
  return admin(s, `/api/admin/featured/${post.id}/publish`);
}

test('featured admin API needs the token and validates input', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { view_count: 60, share_count: 3, author_followers: 5000 });
  assert.equal((await fetch(`${s.base}/api/admin/featured`)).status, 401);
  assert.equal((await admin(s, '/api/admin/featured/abc', FEATURED)).status, 400);
  assert.equal((await admin(s, `/api/admin/featured/${post.id}`, { ...FEATURED, key_points: ['a'] })).status, 400);
  assert.equal((await admin(s, '/api/admin/featured?status=nope', null, 'GET')).status, 400);
  assert.equal((await admin(s, `/api/admin/featured/${post.id}/publish`)).status, 404, 'no content yet');
  const listed = await admin(s, '/api/admin/featured', null, 'GET');
  assert.equal(listed.status, 200);
  assert.ok(listed.json.candidates.some(item => item.post.id === post.id));
});

test('a featured page is indexable, with AI notes, JSON-LD, related pages and the original post', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { content: 'We are changing the roadmap next quarter.', view_count: 60, share_count: 3, author_followers: 5000 });
  const sibling = await seed(s, { content: 'Another note from Jack about the editor.', view_count: 60, share_count: 3, author_followers: 5000 });
  const published = await feature(s, post);
  assert.equal(published.status, 200, JSON.stringify(published.json));
  // the second one lives on a later "day" only if the cap allows; the default cap is high enough
  assert.equal((await feature(s, sibling)).status, 200);

  const { response, document, text } = await page(s, post.short_code);
  assert.equal(response.status, 200);
  assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'), 'index, follow');
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.match(document.querySelector('h1').textContent, /Jack says the roadmap changes next quarter/);
  assert.match(document.title, /Jack says the roadmap changes next quarter \| XPut/);
  assert.match(text, /We are changing the roadmap next quarter/, 'original post text is still there');
  for (const key of FEATURED.key_points) assert.ok(text.includes(key), key);
  assert.ok(document.querySelector('.xput-notes'), 'AI notes section');
  assert.ok(document.querySelector('.related'), 'related list');
  assert.ok(document.querySelector('.related').innerHTML.includes(sibling.short_code));
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(n => JSON.parse(n.textContent));
  const posting = ld.flat().find(item => item['@type'] === 'SocialMediaPosting');
  assert.ok(posting, 'SocialMediaPosting JSON-LD');
  assert.equal(posting.author.name, 'Jack');
  assert.match(posting.sharedContent?.url || posting.url, /x\.com|twitter\.com/);
});

test('editing a live featured page, or a new open report, takes it out of the index', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { view_count: 60, share_count: 3, author_followers: 5000 });
  assert.equal((await feature(s, post)).status, 200);
  assert.equal((await page(s, post.short_code)).document.querySelector('meta[name=robots]').getAttribute('content'), 'index, follow');
  await admin(s, `/api/admin/featured/${post.id}`, { ...FEATURED, summary: `${FEATURED.summary} Edited.` });
  assert.equal((await page(s, post.short_code)).document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow');
  assert.equal((await admin(s, `/api/admin/featured/${post.id}/publish`)).status, 409, 'review needed again');
});

// ---- OG images ----
test('/og/{code}.png: a PNG for normal posts (cached, noindex); the brand image for sensitive, unknown or invalid', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { content: 'Hello from the share preview test' });
  const sensitive = await seed(s, { content: 'secret words', sensitive: 1 });
  const brand = Buffer.from(await (await fetch(`${s.base}/xput-share.png`)).arrayBuffer());

  const res = await fetch(`${s.base}/og/${post.short_code}.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  const png = Buffer.from(await res.arrayBuffer());
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.notDeepEqual(png, brand);
  assert.ok(fs.readdirSync(path.join(s.dir, 'og')).some(name => name.startsWith(post.short_code)), 'cached on disk');
  const again = Buffer.from(await (await fetch(`${s.base}/og/${post.short_code}.png`)).arrayBuffer());
  assert.deepEqual(again, png);

  for (const code of [`${sensitive.short_code}.png`, 'ZZZZZZ.png']) {
    const other = Buffer.from(await (await fetch(`${s.base}/og/${code}`)).arrayBuffer());
    assert.deepEqual(other, brand, code);
  }
  assert.equal((await fetch(`${s.base}/og/nope.png`)).status, 404);
  assert.equal((await fetch(`${s.base}/og/${post.short_code}.jpg`)).status, 404);
});

test('copies sitemap: live featured pages plus selected archives, minus blocked, sensitive, reported, removed', { timeout: 60000 }, async () => {
  const s = await server();
  const make = async extra => { const post = await seed(s, { view_count: 60, share_count: 3, author_followers: 5000, ...extra }); assert.equal((await feature(s, post)).status, 200); return post; };
  const featured = await make({});
  const selectedOld = await seed(s, { seo_status: 'index', legacy_indexed: 1 });
  const selectedNew = await seed(s, { seo_status: 'index' });
  const featuredBlocked = await make({}); await s.run('UPDATE posts SET seo_blocked=1 WHERE id=?', [featuredBlocked.id]);
  const featuredSensitive = await make({}); await s.run('UPDATE posts SET sensitive=1 WHERE id=?', [featuredSensitive.id]);
  const featuredReported = await make({});
  await s.run("INSERT INTO content_reports(post_id, short_code, kind, reason, status) VALUES(?, ?, 'other', 'x', 'open')", [featuredReported.id, featuredReported.short_code]);
  const blocked = await seed(s, { seo_status: 'index', seo_blocked: 1 });
  const sensitive = await seed(s, { seo_status: 'index', sensitive: 1 });
  const reported = await seed(s, { seo_status: 'index' });
  await s.run("INSERT INTO content_reports(post_id, short_code, kind, reason, status) VALUES(?, ?, 'other', 'x', 'open')", [reported.id, reported.short_code]);
  const removed = await seed(s, { seo_status: 'index' });
  await s.run("INSERT OR REPLACE INTO removed_posts(short_code, post_id, reference) VALUES(?, ?, 'REF')", [removed.short_code, removed.id]);
  const review = await seed(s, { seo_status: 'review' });
  const xml = await (await fetch(`${s.base}/sitemap-copies-1.xml`)).text();
  for (const post of [featured, selectedOld, selectedNew]) assert.ok(xml.includes(`/${post.short_code}<`), post.short_code);
  for (const post of [featuredBlocked, featuredSensitive, featuredReported, blocked, sensitive, reported, removed, review]) assert.ok(!xml.includes(`/${post.short_code}<`), post.short_code);
  assert.equal((xml.match(new RegExp(`/${featured.short_code}<`, 'g')) || []).length, 1, 'no duplicates');
  const main = await (await fetch(`${s.base}/sitemap-main.xml`)).text();
  assert.ok(main.includes('https://xput.app/browse<') && main.includes('https://xput.app/zh/browse<'), 'the list page is in the main sitemap');
});

// ---- "Saved posts" list ----
test('/browse and /zh/browse: new layout, indexable list of featured + selected copies, exclusions, search, pagination', { timeout: 60000 }, async () => {
  const s = await server();
  const token = 'brwz' + Math.random().toString(36).slice(2, 8);
  const selected = await seed(s, { seo_status: 'index', content: `Selected ${token} one`, author: 'List Author', author_handle: 'list_author' });
  const featuredPost = await seed(s, { view_count: 60, share_count: 3, author_followers: 5000, content: `Featured ${token} two` });
  assert.equal((await feature(s, featuredPost)).status, 200);
  const hidden = [await seed(s, { seo_status: 'review', content: `Hidden ${token} review` }), await seed(s, { seo_status: 'index', seo_blocked: 1, content: `Blocked ${token}` }),
    await seed(s, { seo_status: 'index', sensitive: 1, content: `Sensitive ${token}` })];
  const en = await page(s, '').then(() => fetch(`${s.base}/browse?q=${token}`).then(async r => ({ r, document: parseHTML(await r.text()).document })));
  assert.equal(en.r.status, 200);
  const hrefs = [...en.document.querySelectorAll('.saved-item__link')].map(a => a.getAttribute('href'));
  assert.deepEqual(hrefs.sort(), [`/${selected.short_code}`, `/${featuredPost.short_code}`].sort());
  assert.ok(![...hrefs].some(h => hidden.some(p => h === `/${p.short_code}`)));
  assert.equal(en.document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow', 'search results are noindex');
  assert.equal(en.document.querySelector('link[rel=canonical]').getAttribute('href'), 'https://xput.app/browse');
  assert.equal(en.document.querySelector('input[name=q]').getAttribute('value'), token);
  assert.ok(en.document.querySelector('.saved-item__meta').textContent.includes('@'));
  // the plain list
  const list = await page(s, 'browse');
  assert.equal(list.response.status, 200);
  assert.equal(list.document.querySelector('h1').textContent, 'Saved posts');
  assert.equal(list.document.querySelector('meta[name=robots]').getAttribute('content'), 'index, follow');
  assert.ok(list.document.querySelector('.site-header') && list.document.querySelector('.site-footer'), 'shared header and footer');
  assert.ok(list.document.querySelector('.site-footer a[href="/browse"]'), 'footer entry');
  const alternates = [...list.document.querySelectorAll('link[rel=alternate]')].map(l => `${l.getAttribute('hreflang')} ${l.getAttribute('href')}`);
  assert.ok(alternates.includes('en https://xput.app/browse') && alternates.includes('zh-Hans https://xput.app/zh/browse') && alternates.includes('x-default https://xput.app/browse'));
  assert.equal(list.document.querySelector('link[rel=canonical]').getAttribute('href'), 'https://xput.app/browse');
  // Chinese
  const zh = await page(s, 'zh/browse');
  assert.equal(zh.response.status, 200);
  assert.equal(zh.document.querySelector('html').getAttribute('lang'), 'zh-Hans');
  assert.equal(zh.document.querySelector('h1').textContent, '已保存的帖子');
  assert.equal(zh.document.title, '已保存的帖子 – XPut 上公开保存的 X（推特）帖子 | XPut');
  assert.equal(zh.document.querySelector('link[rel=canonical]').getAttribute('href'), 'https://xput.app/zh/browse');
  // search: no match, escaping
  const none = await fetch(`${s.base}/browse?q=${encodeURIComponent('<script>alert(1)</script>')}`);
  const noneText = await none.text();
  assert.ok(!noneText.includes('<script>alert(1)</script>') && noneText.includes('&lt;script&gt;'));
  assert.equal(parseHTML(noneText).document.querySelector('meta[name=robots]').getAttribute('content'), 'noindex, follow');
  // bad input
  assert.equal((await fetch(`${s.base}/browse?page=0`)).status, 404);
  assert.equal((await fetch(`${s.base}/browse?page=abc`)).status, 404);
  assert.equal((await fetch(`${s.base}/browse?page=99999`)).status, 404);
  assert.equal((await fetch(`${s.base}/browse?q=${'x'.repeat(101)}`)).status, 400);
  assert.equal((await fetch(`${s.base}/browse?q=a&q=b`)).status, 400);
});

test('/browse paginates 20 per page and keeps the search term in the links', { timeout: 60000 }, async () => {
  const s = await server();
  const token = 'pgz' + Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < 22; i += 1) await seed(s, { seo_status: 'index', content: `Pagination ${token} item ${i}` });
  const first = parseHTML(await (await fetch(`${s.base}/browse?q=${token}`)).text()).document;
  assert.equal(first.querySelectorAll('.saved-item').length, 20);
  assert.equal(first.querySelector('.pager a[rel=next]').getAttribute('href'), `/browse?q=${token}&page=2`);
  assert.equal(first.querySelector('.pager a[rel=prev]'), null);
  const second = parseHTML(await (await fetch(`${s.base}/browse?q=${token}&page=2`)).text()).document;
  assert.equal(second.querySelectorAll('.saved-item').length, 2);
  assert.equal(second.querySelector('.pager a[rel=prev]').getAttribute('href'), `/browse?q=${token}`);
  assert.equal(second.querySelector('.pager a[rel=next]'), null);
  assert.equal((await fetch(`${s.base}/browse?q=${token}&page=3`)).status, 404);
  const zh = parseHTML(await (await fetch(`${s.base}/zh/browse?q=${token}`)).text()).document;
  assert.equal(zh.querySelector('.pager a[rel=next]').getAttribute('href'), `/zh/browse?q=${token}&page=2`);
  assert.equal(zh.querySelector('.pager__page').textContent, '第 1 页');
});

// ---- cache headers (documented in docs/caching.md: keep both in step) ----
test('cache headers by type of response', { timeout: 60000 }, async () => {
  const s = await server();
  const post = await seed(s, { content: 'cache header test' });
  const sensitive = await seed(s, { content: 'secret', sensitive: 1 });
  const removed = 'RMV001';
  await s.run("INSERT OR REPLACE INTO removed_posts(short_code, post_id, reference) VALUES(?, NULL, 'REF')", [removed]);
  const head = async (route, init = {}) => { const r = await fetch(`${s.base}${route}`, { redirect: 'manual', ...init }); await r.arrayBuffer(); return r.headers; };
  const cc = async (route, init) => (await head(route, init)).get('cache-control');

  // fixed pages: language is in the URL, so they can be revalidated and shared
  for (const route of ['/', '/zh/', '/twitter-viewer', '/ios-shortcut', '/privacy', '/report', '/browse', '/zh/browse']) assert.equal(await cc(route), 'no-cache, must-revalidate', route);
  // saved-post pages depend on the visitor (language cookie, age confirmation) and a CDN ignores Vary: never cached
  for (const route of [`/${post.short_code}`, `/${sensitive.short_code}`, `/${removed}`, '/ZZZZZZ']) {
    const headers = await head(route);
    assert.equal(headers.get('cache-control'), 'private, no-store', route);
    assert.match(headers.get('vary') || '', /Cookie/);
    assert.match(headers.get('vary') || '', /Accept-Language/);
  }
  assert.equal(await cc('/no/such/page'), 'private, no-store');
  // API: never cached, including answers to bad requests
  assert.equal(await cc('/api/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), 'no-store');
  assert.equal(await cc('/api/saved-copy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), 'no-store');
  assert.equal(await cc('/api/admin/featured'), 'no-store');
  assert.equal(await cc('/api/nope'), 'no-store');
  // static assets
  const { document } = await page(s, '');
  assert.equal(await cc(document.querySelector('link[href^="/css/xput.css"]').getAttribute('href')), 'public, max-age=31536000, immutable');
  assert.equal(await cc('/css/xput.css'), 'public, max-age=0, must-revalidate');
  assert.equal(await cc('/fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2'), 'public, max-age=31536000, immutable');
  assert.equal(await cc('/favicon.ico'), 'public, max-age=0, must-revalidate');
  assert.equal(await cc('/xput-share.png'), 'public, max-age=0, must-revalidate');
  // share images, sitemaps
  assert.equal(await cc(`/og/${post.short_code}.png`), 'public, max-age=86400');
  assert.equal(await cc('/og/ZZZZZZ.png'), 'public, max-age=300');
  for (const route of ['/sitemap.xml', '/sitemap-main.xml', '/sitemap-copies-1.xml']) assert.equal(await cc(route), 'no-cache', route);
  // download proxy: never stored
  assert.equal(await cc(`/node-dl?u=${encodeURIComponent('https://evil.example/a.mp4')}`), 'no-store', 'proxy errors; successful downloads are private, no-store (see download-proxy.test.js)');
});
