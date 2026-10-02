#!/usr/bin/env node
// One-time pre-launch review of the current "worth re-reading" set (read-only).
//   node ops/audit-indexable.js [path/to/db.sqlite] > indexable.tsv
// Prints TSV: id, short_code, author(@handle), first 100 characters of text, has_media (1/0).
// Works on the pre-migration production schema; when the newer tables exist it also applies the
// exclusions (sensitive, open report, removed) so the output matches what the new site would list.
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { plainText } = require('../lib/seo');
const dbPath = process.argv[2] || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'db.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const all = (sql, args = []) => new Promise((res, rej) => db.all(sql, args, (e, rows) => e ? rej(e) : res(rows)));
const clean = s => String(s).replace(/[\t\r\n]+/g, ' ');

(async () => {
  const cols = new Set((await all('PRAGMA table_info(posts)')).map(c => c.name));
  const tables = new Set((await all("SELECT name FROM sqlite_master WHERE type='table'")).map(t => t.name));
  const where = ["seo_status='index'", 'seo_blocked=0', 'short_code IS NOT NULL'];
  if (cols.has('sensitive')) where.push('COALESCE(sensitive,0)=0');
  if (tables.has('content_reports')) where.push("NOT EXISTS (SELECT 1 FROM content_reports r WHERE r.post_id=posts.id AND r.status='open')");
  if (tables.has('removed_posts')) where.push('NOT EXISTS (SELECT 1 FROM removed_posts x WHERE x.short_code=posts.short_code)');
  const rows = await all(`SELECT id,short_code,author,author_handle,content,images,video,video_status FROM posts WHERE ${where.join(' AND ')} ORDER BY id`);
  console.log(['id', 'short_code', 'author', 'text_first_100', 'has_media'].join('\t'));
  for (const r of rows) {
    let images = []; try { images = JSON.parse(r.images || '[]'); } catch {}
    const media = (Array.isArray(images) && images.length) || (r.video_status === 'completed' && r.video) ? 1 : 0;
    console.log([r.id, r.short_code, `${clean(r.author || '')} (@${clean(r.author_handle || '')})`,
      clean([...plainText(r.content)].slice(0, 100).join('')), media].join('\t'));
  }
  console.error(`${rows.length} indexable archives`);
  db.close();
})().catch(e => { console.error(e.message); process.exit(1); });
