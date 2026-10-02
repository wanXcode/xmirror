#!/usr/bin/env node
// Local preview data: sample saved posts for every page state. Run AFTER the server has started once
// (it creates the tables). Local use only; it refuses to run when NODE_ENV=production.
//
//   node ops/seed-local.js            (uses ./data/db.sqlite, or SQLITE_PATH / DATA_DIR)
//   MODERATION_ADMIN_TOKEN=... PORT=3000 node ops/seed-local.js   (also publishes a featured page)
//
// Short codes created: DEMO01 normal text post, DEMO02 sensitive (age gate), DEMO03 removed (410),
// DEMO04 featured (indexable), DEMO05 normal post that links to an old-style archive alias.
const path = require('node:path');
const sqlite3 = require('sqlite3');

if (process.env.NODE_ENV === 'production') { console.error('Refusing to seed in production.'); process.exit(1); }
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new sqlite3.Database(process.env.SQLITE_PATH || path.join(dataDir, 'db.sqlite'));
const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, error => (error ? reject(error) : resolve())));

const POSTS = [
  { code: 'DEMO01', id: 9101, text: '<p>A normal saved post. It is noindex until featured.</p>', views: 3 },
  { code: 'DEMO02', id: 9102, text: '<p>This post is marked sensitive.</p>', sensitive: 1 },
  { code: 'DEMO04', id: 9104, text: '<p>We are changing the roadmap next quarter and the editor ships first.</p>', views: 60 },
  { code: 'DEMO05', id: 9105, text: '<p>Post that also answers to an old alias code.</p>', views: 1 }
];

(async () => {
  for (const post of POSTS) {
    await run(`INSERT OR REPLACE INTO posts(id,url,short_code,author,author_handle,content,images,video_status,tweet_time,created_at,html_file,view_count,share_count,reply_count,author_followers,sensitive)
      VALUES(?,?,?,?,?,?,'[]','none','2026-09-30T10:00:00Z','2026-10-01 09:00:00',?,?,2,5,?,?)`,
    [post.id, `https://x.com/i/status/${post.id}`, post.code, 'Demo Author', 'demo_author', post.text, `post_${post.id}.html`, post.views || 0, 5000, post.sensitive || 0]);
  }
  await run("INSERT OR REPLACE INTO post_aliases(alias_code, target_post_id) VALUES('OLD001', 9105)").catch(() => console.warn('post_aliases table missing; skipped the alias demo'));
  await run("INSERT OR REPLACE INTO removed_posts(short_code, post_id, reference) VALUES('DEMO03', NULL, 'DEMO-REF-1')");
  db.close();

  const token = process.env.MODERATION_ADMIN_TOKEN;
  if (token) {
    const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const call = (suffix, body) => fetch(`${base}/api/admin/featured/9104${suffix}`, { method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.status);
    console.log('featured content', await call('', { ai_title: 'Demo: the roadmap changes next quarter', topic: 'Product roadmap', summary: 'The author announces that the product roadmap will change next quarter, with the new editor shipping first and the mobile app following later in the year.', context: 'The announcement follows weeks of user feedback about the editor and comes just before the annual planning meeting of the company.', key_points: ['The editor ships first', 'The mobile app follows later', 'Feedback drove the change'] }));
    console.log('review', await call('/review', { reviewed: true, note: 'local demo' }));
    console.log('publish', await call('/publish'));
  } else console.log('No MODERATION_ADMIN_TOKEN given: DEMO04 was not published as a featured page.');
  console.log('Done. Try /DEMO01 /DEMO02 /DEMO03 /DEMO04 /OLD001');
})().catch(error => { console.error(error.message); process.exit(1); });
