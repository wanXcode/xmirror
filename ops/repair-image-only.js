#!/usr/bin/env node
// Run after deployment and a SQLite backup. Default is a read-only dry run.
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { renderTweetContent } = require('../lib/x-post');
const apply = process.argv.includes('--apply');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new sqlite3.Database(process.env.SQLITE_PATH || path.join(dataDir, 'db.sqlite'), apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
db.configure('busyTimeout', 10000);
const all = sql => new Promise((resolve, reject) => db.all(sql, (e, rows) => e ? reject(e) : resolve(rows)));
const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(e) { e ? reject(e) : resolve(this.changes); }));

async function main() {
  const rows = await all("SELECT id,short_code,content,images FROM posts WHERE trim(coalesce(content,''))='' ORDER BY id");
  const repairs = [];
  for (const row of rows) {
    let images;
    try { images = JSON.parse(row.images || '[]'); } catch { continue; }
    if (!Array.isArray(images) || !images.length) continue;
    // Do not introduce remote fallbacks or silently omit missing images.
    if (!images.every(image => typeof image === 'string' && /^\/images\/[A-Za-z0-9_.-]+$/.test(image) && fs.existsSync(path.join(dataDir, image)))) {
      console.log(`SKIP ${row.id}: invalid or missing local image`);
      continue;
    }
    const { htmlContent } = renderTweetContent({ tweet: {}, localImages: images, escapeHtml: text => text });
    repairs.push({ ...row, htmlContent });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: repairs.length, posts: repairs.map(row => ({ id: row.id, shortCode: row.short_code })) }));
  if (!apply) return;
  await run('BEGIN IMMEDIATE');
  try {
    for (const row of repairs) {
      const count = await run("UPDATE posts SET content=? WHERE id=? AND content IS ? AND images=?", [row.htmlContent, row.id, row.content, row.images]);
      if (count !== 1) throw new Error(`Post ${row.id} changed during repair`);
    }
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
