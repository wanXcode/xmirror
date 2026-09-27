const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { createSeoStore } = require('../lib/seo-store');
const run = (db, sql, args=[]) => new Promise((resolve,reject) => db.run(sql,args,e=>e?reject(e):resolve()));

test('idempotent migrations, dry evaluation, overrides, duplicates and persisted sitemap agree', async t => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  await run(db, 'CREATE TABLE posts(id INTEGER PRIMARY KEY,url TEXT,short_code TEXT,content TEXT,images TEXT,video TEXT,video_status TEXT,author TEXT,author_handle TEXT,tweet_time TEXT)');
  const moderator = { moderateArchivedContent: p => { if (p.authorHandle === 'blocked') throw Object.assign(new Error('blocked'), {code:'CONTENT_MODERATION_REJECTED'}); return {action:'allow'}; } };
  const store = createSeoStore(db, { dataDir: '/tmp', moderator });
  await store.migrate(); await store.migrate();
  const content = '<p>' + 'word '.repeat(180) + '</p>';
  for (let id = 1; id <= 2; id++) await run(db, 'INSERT INTO posts(id,url,short_code,content,images,author,author_handle,tweet_time) VALUES(?,?,?,?,?,?,?,?)', [id, `https://x.com/i/status/${id}`, id===1?'Ab1234':'Cd5678',content,'[]','Alice','alice','2026-09-27T00:00:00Z']);
  assert.equal((await store.get('SELECT * FROM posts WHERE id=1')).seo_status, 'review');
  await store.assess(await store.get('SELECT * FROM posts WHERE id=1'), {duplicate:false});
  assert.equal((await store.eligible()).length, 0, 'preview never promotes');
  assert.equal((await store.refresh(1)).status, 'index');
  assert.equal((await store.refresh(2)).status, 'noindex');
  assert.equal((await store.override(1, 'index', true)).status, 'noindex');
  assert.equal((await store.eligible()).length, 0);
  assert.equal((await store.override(1, null, false)).status, 'index');
  assert.equal((await store.eligible()).length, 1);
  await run(db, "UPDATE posts SET author_handle='blocked' WHERE id=1");
  assert.equal((await store.override(1, 'index', false)).status, 'noindex');
  assert.equal((await store.eligible()).length, 0);
});
