// Database additions for the saved-post pages, featured pages and removal notices.
// Safe to run on every start: it only adds what is missing.

const POST_COLUMNS = [
  ['reply_count', 'INTEGER'],
  ['view_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['share_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['author_followers', 'INTEGER'],
  ['video_poster', 'TEXT'],
  ['sensitive', 'INTEGER NOT NULL DEFAULT 0'],
  ['legacy_indexed', 'INTEGER NOT NULL DEFAULT 0']
];

async function migrateFrontendSchema({ run, all, get }) {
  const columns = await all('PRAGMA table_info(posts)');
  for (const [name, definition] of POST_COLUMNS) {
    if (!columns.some(column => column.name === name)) await run(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
  }

  // Short code -> removal notice, so a removed copy says so instead of "does not exist".
  await run(`CREATE TABLE IF NOT EXISTS removed_posts (
    short_code TEXT PRIMARY KEY,
    post_id INTEGER,
    reference TEXT,
    removed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // One row per post that has (or had) a featured version. See lib/featured.js.
  await run(`CREATE TABLE IF NOT EXISTS post_featured (
    post_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft',
    lang TEXT,
    ai_title TEXT,
    topic TEXT,
    summary TEXT,
    context TEXT,
    key_points TEXT,
    ai_generated_at TEXT,
    needs_fix INTEGER NOT NULL DEFAULT 0,
    reviewed INTEGER NOT NULL DEFAULT 0,
    reviewed_at TEXT,
    review_note TEXT,
    live_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_post_featured_status ON post_featured(status, live_at)');

  await run('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)');
  // Archives that were already indexable before the redesign keep their status ("legacy
  // indexed"); everything saved from now on is noindex until it is promoted to a featured page.
  const done = await get("SELECT value FROM app_meta WHERE key='legacy_indexed_v1'");
  if (!done) {
    await run("UPDATE posts SET legacy_indexed=1 WHERE seo_status='index'");
    await run("INSERT INTO app_meta(key,value) VALUES('legacy_indexed_v1', CURRENT_TIMESTAMP)");
  }
}

module.exports = { POST_COLUMNS, migrateFrontendSchema };
