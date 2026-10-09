'use strict';
// Re-run the current moderation rules over archived posts and list what would be rejected or held for review.
// Usage: node ops/moderation-backtest.js [path/to/sqlite.db]   (read-only; prints ids and matched rule names, never post text)
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { createModerator } = require('../lib/moderation');

const dbPath = process.argv[2] || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'database.db');
const moderator = createModerator({ rulesPath: path.join(__dirname, '..', 'config', 'moderation-rules.json'), logPath: null });
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => { if (err) { console.error(err.message); process.exit(1); } });

db.all('SELECT id, url, author, author_handle, content FROM posts', (err, rows) => {
  if (err) { console.error(err.message); process.exit(1); }
  const tally = { allow: 0, review: 0, reject: 0 };
  for (const row of rows) {
    let result;
    try { result = moderator.moderateArchivedContent({ url: row.url, authorName: row.author, authorHandle: row.author_handle, content: row.content }); }
    catch (e) { if (e.code !== 'CONTENT_MODERATION_REJECTED') throw e; result = { action: 'reject', matched: e.details.matched }; }
    tally[result.action]++;
    if (result.action !== 'allow') console.log(`${result.action}\tid=${row.id}\t${result.matched.map(m => `${m.type}:${m.value}`).join(',')}`);
  }
  console.log(`total=${rows.length} allow=${tally.allow} review=${tally.review} reject=${tally.reject}`);
  db.close();
});
