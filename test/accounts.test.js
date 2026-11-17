const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { createAccounts, migrateAccounts, parseClaimText, KEY_PREFIX, sha256 } = require('../lib/accounts');
const { extractXPostId, canonicalizeXPostUrl } = require('../lib/x-post');
const { safeNext } = require('../lib/routes/account');
const { isReservedShortCode, loadReservedShortCodes } = require('../lib/shortcode');
const { authorizeUrl, googleConfig } = require('../lib/google-auth');

function openDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xput-accounts-'));
  const raw = new sqlite3.Database(path.join(dir, 'db.sqlite'));
  t.after(() => { raw.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return {
    get: (sql, args = []) => new Promise((resolve, reject) => raw.get(sql, args, (e, row) => e ? reject(e) : resolve(row))),
    all: (sql, args = []) => new Promise((resolve, reject) => raw.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows || []))),
    run: (sql, args = []) => new Promise((resolve, reject) => raw.run(sql, args, function done(e) { e ? reject(e) : resolve({ lastID: this.lastID, changes: this.changes }); }))
  };
}

async function setup(t, clock) {
  const db = openDb(t);
  await db.run('CREATE TABLE posts (id INTEGER PRIMARY KEY, url TEXT, author TEXT, author_handle TEXT, content TEXT, short_code TEXT)');
  await migrateAccounts(db);
  const accounts = createAccounts(db, clock ? { now: clock } : undefined);
  for (const [id, code] of [[1, 'aaaaaa'], [2, 'bbbbbb'], [3, 'cccccc']]) {
    await db.run('INSERT INTO posts(id,url,author,author_handle,content,short_code) VALUES(?,?,?,?,?,?)', [id, `https://x.com/i/status/${id}00`, `Author ${id}`, `h${id}`, `hello world ${id}`, code]);
  }
  return { db, accounts };
}

test('Google users are upserted by subject and keep one id', async t => {
  const { accounts } = await setup(t);
  const first = await accounts.upsertGoogleUser({ sub: 'g1', email: 'a@example.com', name: 'A' });
  const again = await accounts.upsertGoogleUser({ sub: 'g1', email: 'a@example.com', name: 'A2' });
  assert.equal(first.id, again.id);
  assert.equal(again.name, 'A2');
  await assert.rejects(accounts.upsertGoogleUser({ email: 'x' }));
});

test('sessions are stored hashed, expire and can be ended', async t => {
  let now = new Date('2026-11-17T00:00:00Z');
  const { accounts, db } = await setup(t, () => now);
  const user = await accounts.upsertGoogleUser({ sub: 'g1', name: 'A' });
  const { token } = await accounts.createSession(user.id);
  assert.equal(await db.get('SELECT 1 AS x FROM user_sessions WHERE token_hash=?', [token]), undefined);
  assert.equal((await accounts.userForSession(token)).id, user.id);
  assert.equal(await accounts.userForSession('nope'), null);
  now = new Date('2026-12-30T00:00:00Z');
  assert.equal(await accounts.userForSession(token), null);
  now = new Date('2026-11-18T00:00:00Z');
  assert.equal((await accounts.userForSession(token)).id, user.id);
  await accounts.endSession(token);
  assert.equal(await accounts.userForSession(token), null);
});

test('a shortcut key works once created, the old key stops after a reset, and only its hash is stored', async t => {
  const { accounts, db } = await setup(t);
  const user = await accounts.upsertGoogleUser({ sub: 'g1' });
  const other = await accounts.upsertGoogleUser({ sub: 'g2' });
  const key = await accounts.rotateKey(user.id);
  assert.ok(key.startsWith(KEY_PREFIX));
  assert.equal((await accounts.userForKey(key)).id, user.id);
  assert.equal((await db.get('SELECT key_hash FROM user_keys WHERE user_id=?', [user.id])).key_hash, sha256(key));
  assert.equal((await accounts.keyInfo(user.id)).last4, key.slice(-4));
  const next = await accounts.rotateKey(user.id);
  assert.equal(await accounts.userForKey(key), null);
  assert.equal((await accounts.userForKey(next)).id, user.id);
  assert.equal(await accounts.userForKey('xk_wrong'), null);
  assert.equal(await accounts.userForKey(undefined), null);
  assert.equal(await accounts.keyInfo(other.id), undefined);
});

test('the list is private per user, newest first, searchable, and removal only unlinks', async t => {
  let now = new Date('2026-11-17T00:00:00Z');
  const { accounts } = await setup(t, () => now);
  const a = await accounts.upsertGoogleUser({ sub: 'g1' });
  const b = await accounts.upsertGoogleUser({ sub: 'g2' });
  await accounts.recordArchive(a.id, 1, 'shortcut');
  now = new Date('2026-11-17T01:00:00Z');
  await accounts.recordArchive(a.id, 2, 'web');
  now = new Date('2026-11-17T02:00:00Z');
  await accounts.recordArchive(a.id, 1, 'web'); // saving again keeps the first time and source
  await accounts.recordArchive(b.id, 3);
  const mine = await accounts.list(a.id);
  assert.deepEqual(mine.map(row => row.short_code), ['bbbbbb', 'aaaaaa']);
  assert.equal(mine[1].saved_source, 'shortcut');
  assert.deepEqual((await accounts.list(b.id)).map(row => row.short_code), ['cccccc']);
  assert.deepEqual((await accounts.list(a.id, { query: 'AUTHOR 2' })).map(row => row.short_code), ['bbbbbb']);
  assert.deepEqual((await accounts.list(a.id, { limit: 1, offset: 1 })).map(row => row.short_code), ['aaaaaa']);
  assert.equal(await accounts.count(a.id), 2);
  assert.equal(await accounts.removeArchive(a.id, 2), true);
  assert.equal(await accounts.removeArchive(a.id, 2), false);
  assert.equal(await accounts.count(a.id), 1);
  assert.equal(await accounts.count(b.id), 1);
});

test('claim text yields short codes and tweet ids, not random words', () => {
  const reserved = loadReservedShortCodes();
  const deps = { extractTweetId: extractXPostId, normalizeUrl: canonicalizeXPostUrl, isReserved: code => isReservedShortCode(code, reserved) };
  const parsed = parseClaimText([
    'https://xput.app/AbC123',
    'see https://old.example/zZ9yY8/ and https://x.com/someone/status/1234567890?s=20.',
    'https://twitter.com/i/status/42',
    'Shortcut',
    'Qw1Er2',
    'https://x.com/home',
    'https://xput.app/browse'
  ].join('\n'), deps);
  assert.deepEqual(parsed.codes.sort(), ['AbC123', 'Qw1Er2', 'zZ9yY8'].sort());
  assert.deepEqual(parsed.tweetIds.sort(), ['1234567890', '42'].sort());
  assert.deepEqual(parseClaimText(undefined, deps), { codes: [], tweetIds: [] });
});

test('sign-in only returns to our own account pages and asks for basic scopes', () => {
  assert.equal(safeNext('/zh/me'), '/zh/me');
  assert.equal(safeNext('/me'), '/me');
  assert.equal(safeNext('//evil.test'), '/me');
  assert.equal(safeNext('https://evil.test/me'), '/me');
  assert.equal(safeNext(undefined), '/me');
  const config = googleConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }, 'https://xput.app/');
  assert.equal(config.enabled, true);
  assert.equal(config.redirectUri, 'https://xput.app/auth/google/callback');
  const url = new URL(authorizeUrl(config, 'STATE'));
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('state'), 'STATE');
  assert.equal(googleConfig({}, 'https://xput.app').enabled, false);
});
