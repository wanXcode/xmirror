const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const seo = require('../lib/seo');
const auto = require('../lib/seo-auto');
const { createSeoStore } = require('../lib/seo-store');

const words = tag => '<p>' + Array.from({ length: 180 }, (_, i) => `${tag}word${i}`).join(' ') + '</p>';
const base = (n, extra = {}) => ({ id: n, content: words(`p${n}x`), url: `https://x.com/i/status/${1000 + n}`,
  short_code: `Ab${String(1000 + n)}`, author: 'Author', author_handle: 'author', tweet_time: '2026-09-28T00:00:00Z',
  images: '[]', seo_quality_version: '3', ...extra });

async function setup(t, autoConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-auto-'));
  const db = new sqlite3.Database(':memory:');
  const store = createSeoStore(db, { dataDir: dir, moderator: { moderateArchivedContent: () => ({ action: 'allow' }) }, autoConfig });
  await store.run('CREATE TABLE posts(id INTEGER PRIMARY KEY,url TEXT,short_code TEXT,content TEXT,images TEXT,video TEXT,video_status TEXT,author TEXT,author_handle TEXT,tweet_time TEXT,sensitive INTEGER NOT NULL DEFAULT 0)');
  await store.migrate();
  t.after(async () => { await new Promise(r => db.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const insert = async post => {
    const keys = Object.keys(post);
    await store.run(`INSERT INTO posts(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, Object.values(post));
    await store.refresh(post.id);
    return store.get('SELECT * FROM posts WHERE id=?', [post.id]);
  };
  return { store, insert };
}

test('config loads defaults and environment overrides', () => {
  assert.deepEqual(auto.load({}), { dailyCap: 20, blockSensitive: true });
  assert.deepEqual(auto.load({ SEO_AUTO_INDEX_DAILY_CAP: '5', SEO_AUTO_INDEX_BLOCK_SENSITIVE: 'false' }), { dailyCap: 5, blockSensitive: false });
  assert.equal(auto.load({ SEO_AUTO_INDEX_DAILY_CAP: 'abc' }).dailyCap, 20);
  assert.equal(auto.load({ SEO_AUTO_INDEX_DAILY_CAP: '0' }).dailyCap, 0);
});

test('possibly_sensitive posts (incl. a sensitive quote) are never auto-collected', () => {
  const post = { ...base(1), seo_override: null, sensitive: 1 };
  const result = seo.evaluate(post, { moderation: 'allow' });
  assert.equal(result.status, 'noindex');
  assert.ok(result.reasons.includes('x_sensitive'));
  assert.equal(seo.evaluate({ ...post, sensitive: 0 }, { moderation: 'allow' }).status, 'index');
  assert.equal(seo.evaluate(post, { moderation: 'allow', blockSensitive: false }).status, 'index');
});

test('daily cap defers the overflow, manual picks are exempt, next day releases it', async t => {
  const { store, insert } = await setup(t, { dailyCap: 2, blockSensitive: true });
  const rows = [];
  for (let n = 1; n <= 4; n++) rows.push(await insert(base(n)));
  assert.deepEqual(rows.map(r => r.seo_status), ['index', 'index', 'review', 'review']);
  assert.ok(JSON.parse(rows[2].seo_reason).includes('daily_cap_deferred'));
  assert.ok(rows[2].seo_next_check > new Date().toISOString());
  // A manual pick is not limited by the cap.
  const manual = await store.override(3, 'index');
  assert.equal(manual.status, 'index');
  // Re-evaluating an already-indexed post never counts it again.
  await store.refresh(1);
  assert.equal((await store.get('SELECT seo_status s FROM posts WHERE id=1')).s, 'index');
  // Next day: the counter is per UTC day, so yesterday's inclusions free the cap.
  await store.run("UPDATE posts SET seo_auto_indexed_at='2000-01-01T00:00:00.000Z'");
  await store.refresh(4);
  assert.equal((await store.get('SELECT seo_status s FROM posts WHERE id=4')).s, 'index');
});

test('a sensitive post stays out even with the cap free; admin block still wins', async t => {
  const { store, insert } = await setup(t, { dailyCap: 20, blockSensitive: true });
  assert.equal((await insert(base(1, { sensitive: 1 }))).seo_status, 'noindex');
  assert.equal((await insert(base(2))).seo_status, 'index');
  const blocked = await store.override(2, null, true);
  assert.equal(blocked.status, 'noindex');
});

test('ops/audit-indexable.js lists indexable archives read-only (old schema, no sensitive column)', async t => {
  const { execFileSync } = require('node:child_process');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seo-audit-')), 'db.sqlite');
  const db = new sqlite3.Database(file);
  const run = (sql, args = []) => new Promise((res, rej) => db.run(sql, args, e => e ? rej(e) : res()));
  await run('CREATE TABLE posts(id INTEGER PRIMARY KEY,short_code TEXT,author TEXT,author_handle TEXT,content TEXT,images TEXT,video TEXT,video_status TEXT,seo_status TEXT,seo_blocked INTEGER)');
  await run("INSERT INTO posts VALUES(1,'Aa1111','Ann','ann','<p>Hello\tworld</p>','[\"/images/a.jpg\"]',NULL,NULL,'index',0)");
  await run("INSERT INTO posts VALUES(2,'Bb2222','Bob','bob',?, '[]',NULL,NULL,'index',0)", ['x'.repeat(300)]);
  await run("INSERT INTO posts VALUES(3,'Cc3333','Cy','cy','blocked','[]',NULL,NULL,'index',1)");
  await run("INSERT INTO posts VALUES(4,'Dd4444','Di','di','review','[]',NULL,NULL,'review',0)");
  await new Promise(r => db.close(r));
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  const out = execFileSync('node', [path.join(__dirname, '..', 'ops', 'audit-indexable.js'), file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
  assert.equal(out.length, 3);
  assert.deepEqual(out[1].split('\t'), ['1', 'Aa1111', 'Ann (@ann)', 'Hello world', '1']);
  const second = out[2].split('\t');
  assert.equal(second[3].length, 100);
  assert.equal(second[4], '0');
});
