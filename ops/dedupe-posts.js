#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { buildDedupePlan, summarizeDedupePlan } = require('../lib/post-dedupe');

const apply = process.argv.includes('--apply');
const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'db.sqlite');
const db = new sqlite3.Database(dbPath, apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);

const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
  if (error) reject(error);
  else resolve({ changes: this.changes, lastID: this.lastID });
}));

async function main() {
  const posts = await all('SELECT id,url,short_code,created_at,html_file FROM posts ORDER BY id');
  const plan = buildDedupePlan(posts);
  const summary = summarizeDedupePlan(plan);
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${summary.groups} duplicate groups, ${summary.duplicateRecords} records to merge`);
  for (const group of plan) {
    console.log(`tweet ${group.tweetId}: keep post ${group.survivor.id} (${group.survivor.short_code})`);
    for (const duplicate of group.duplicates) {
      console.log(`  alias ${duplicate.short_code} -> post ${group.survivor.id}; remove post ${duplicate.id}`);
    }
  }
  if (!apply || plan.length === 0) return;

  await run('BEGIN IMMEDIATE');
  try {
    await run(`CREATE TABLE IF NOT EXISTS post_aliases (
      alias_code TEXT PRIMARY KEY,
      target_post_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_post_aliases_target ON post_aliases(target_post_id)');
    for (const group of plan) {
      for (const duplicate of group.duplicates) {
        await run(
          `INSERT OR IGNORE INTO translations
           (post_id,target_lang,source_lang,source_hash,translated_json,provider,created_at,updated_at)
           SELECT ?,target_lang,source_lang,source_hash,translated_json,provider,created_at,updated_at
           FROM translations WHERE post_id=?`,
          [group.survivor.id, duplicate.id]
        );
        await run('DELETE FROM translations WHERE post_id=?', [duplicate.id]);
        await run('INSERT INTO post_aliases(alias_code,target_post_id) VALUES(?,?)', [duplicate.short_code, group.survivor.id]);
        await run('DELETE FROM posts WHERE id=?', [duplicate.id]);
      }
    }
    await run('COMMIT');
    console.log('Merge committed. HTML and media files were not deleted.');
  } catch (error) {
    try { await run('ROLLBACK'); } catch {}
    throw error;
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => db.close());
