const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { migrateFrontendSchema, POST_COLUMNS } = require('../lib/frontend-schema');

function open() {
  const db = new sqlite3.Database(':memory:');
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (error) { return error ? reject(error) : resolve(this); }));
  const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => (error ? reject(error) : resolve(rows))));
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => (error ? reject(error) : resolve(row))));
  return { db, run, all, get };
}

test('adds the columns and tables once, and is safe to run again', async t => {
  const { db, run, all, get } = open();
  t.after(() => db.close());
  await run('CREATE TABLE posts (id INTEGER PRIMARY KEY, short_code TEXT, seo_status TEXT)');
  await migrateFrontendSchema({ run, all, get });
  await migrateFrontendSchema({ run, all, get });
  const columns = (await all('PRAGMA table_info(posts)')).map(c => c.name);
  for (const [name] of POST_COLUMNS) assert.ok(columns.includes(name), name);
  const tables = (await all("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
  for (const name of ['removed_posts', 'post_featured', 'app_meta']) assert.ok(tables.includes(name), name);
  const defaults = await get("INSERT INTO posts(short_code) VALUES('x') RETURNING view_count, share_count, sensitive, legacy_indexed");
  assert.deepEqual(defaults, { view_count: 0, share_count: 0, sensitive: 0, legacy_indexed: 0 });
});

test('archives that were indexable before the redesign are marked once; later ones are not', async t => {
  const { db, run, all, get } = open();
  t.after(() => db.close());
  await run('CREATE TABLE posts (id INTEGER PRIMARY KEY, short_code TEXT, seo_status TEXT)');
  await run("INSERT INTO posts(short_code, seo_status) VALUES ('old1', 'index'), ('old2', 'noindex'), ('old3', 'review')");
  await migrateFrontendSchema({ run, all, get });
  await run("INSERT INTO posts(short_code, seo_status) VALUES ('new1', 'index')");
  await migrateFrontendSchema({ run, all, get });
  const rows = Object.fromEntries((await all('SELECT short_code, legacy_indexed FROM posts')).map(r => [r.short_code, r.legacy_indexed]));
  assert.deepEqual(rows, { old1: 1, old2: 0, old3: 0, new1: 0 });
});

test('legacy removal records migrate to unknown without guessing from reference', async t => {
  const {db, run, all, get} = open(); t.after(() => db.close());
  await run('CREATE TABLE posts (id INTEGER PRIMARY KEY, short_code TEXT, seo_status TEXT)');
  await run('CREATE TABLE removed_posts (short_code TEXT PRIMARY KEY, post_id INTEGER, reference TEXT, removed_at TEXT)');
  await run("INSERT INTO removed_posts VALUES('Old001', 1, 'MOD-example', '2026-01-01')");
  await migrateFrontendSchema({run, all, get});
  assert.equal((await get("SELECT reason FROM removed_posts WHERE short_code='Old001'")).reason, 'unknown');
  await run("UPDATE removed_posts SET reason='rights' WHERE short_code='Old001'");
  await migrateFrontendSchema({run, all, get});
  assert.deepEqual(await get("SELECT reason,reference,removed_at FROM removed_posts WHERE short_code='Old001'"), {reason:'rights',reference:'MOD-example',removed_at:'2026-01-01'});
  await run("INSERT INTO removed_posts(short_code) VALUES('Old002')");
  assert.equal((await get("SELECT reason FROM removed_posts WHERE short_code='Old002'")).reason, 'unknown');
});
