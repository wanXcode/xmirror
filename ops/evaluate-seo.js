#!/usr/bin/env node
// No mutations by default. Apply after backup/migration; limit is a scan batch, not a ranking claim.
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { createModerator } = require('../lib/moderation');
const { createSeoStore } = require('../lib/seo-store');
const { contentHash } = require('../lib/seo');
const apply = process.argv.includes('--apply');
function option(name, fallback) {
  const arg = process.argv.find(x => x.startsWith(`--${name}=`));
  const value = arg ? Number(arg.split('=')[1]) : fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid --${name}`);
  return value;
}
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
const db = new sqlite3.Database(process.env.SQLITE_PATH || path.join(dataDir, 'db.sqlite'), apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
db.configure('busyTimeout', 10000);
const moderator = createModerator({ rulesPath: path.join(__dirname, '../config/moderation-rules.json'), logPath: null });
const store = createSeoStore(db, { dataDir, moderator, autoIndex: process.env.SEO_AUTO_INDEX !== 'false' });
async function main() {
  const limit = option('limit', 100);
  const after = option('after-id', 0);
  if (apply) await store.migrate();
  if (process.argv.includes('--hash-only')) {
    if (!apply) throw new Error('--hash-only requires --apply; it never changes indexing decisions');
    console.log(JSON.stringify(await store.backfillHashes(limit, after)));
    return;
  }
  const rows = await store.all('SELECT * FROM posts WHERE id>? ORDER BY id LIMIT ?', [after, limit]);
  const seen = new Set();
  // Hash earlier rows for read-only preview even on a pre-migration database.
  let cursor = 0;
  while (cursor < after) {
    const previous = await store.all('SELECT * FROM posts WHERE id>? AND id<=? ORDER BY id LIMIT 200', [cursor, after]);
    if (!previous.length) break;
    previous.forEach(post => seen.add(contentHash(post)));
    cursor = previous.at(-1).id;
  }
  for (const post of rows) {
    const hash = contentHash(post);
    const result = apply ? await store.refresh(post.id, { duplicate: seen.has(hash) }) : await store.assess(post, { duplicate: seen.has(hash) });
    seen.add(hash);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', id: post.id, shortCode: post.short_code, ...result }));
  }
  console.log(JSON.stringify({ scanned: rows.length, lastId: rows.at(-1)?.id || after }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
