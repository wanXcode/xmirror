// Accounts for the personal archive list: Google users, browser sessions, shortcut keys and "who saved what".
// `db` is { get, all, run } (promise based). Secrets (session tokens, shortcut keys) are stored only as SHA-256 hashes.
const crypto = require('node:crypto');
const { SHORT_CODE_PATTERN } = require('./shortcode');

const SESSION_DAYS = 30;
const KEY_PREFIX = 'xk_';
const MAX_CLAIM_ITEMS = 200;

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = bytes => crypto.randomBytes(bytes).toString('base64url');

async function migrateAccounts(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    picture TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)');
  // One active shortcut key per user; rotating replaces it.
  await db.run(`CREATE TABLE IF NOT EXISTS user_keys (
    user_id INTEGER PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    last4 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Posts are shared by everyone (one row per tweet), so "mine" is a link table.
  await db.run(`CREATE TABLE IF NOT EXISTS user_archives (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id)
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_user_archives_user ON user_archives(user_id, created_at)');
}

function sqliteTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function createAccounts(db, { now = () => new Date() } = {}) {
  return {
    migrate: () => migrateAccounts(db),

    async upsertGoogleUser({ sub, email, name, picture }) {
      if (!sub) throw new Error('Google profile has no subject');
      const stamp = sqliteTime(now());
      await db.run(
        `INSERT INTO users(google_sub,email,name,picture,created_at,last_login_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture, last_login_at=excluded.last_login_at`,
        [String(sub), email || null, name || null, picture || null, stamp, stamp]
      );
      return db.get('SELECT id, email, name, picture FROM users WHERE google_sub=?', [String(sub)]);
    },

    async createSession(userId) {
      const token = randomToken(32);
      const expires = new Date(now().getTime() + SESSION_DAYS * 86400000);
      await db.run('INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', [sha256(token), userId, sqliteTime(expires)]);
      return { token, expires };
    },

    async userForSession(token) {
      if (!token || typeof token !== 'string' || token.length > 200) return null;
      return (await db.get(
        `SELECT u.id, u.email, u.name, u.picture FROM user_sessions s JOIN users u ON u.id=s.user_id
         WHERE s.token_hash=? AND s.expires_at>?`,
        [sha256(token), sqliteTime(now())]
      )) || null;
    },

    async endSession(token) {
      if (token && typeof token === 'string') await db.run('DELETE FROM user_sessions WHERE token_hash=?', [sha256(token)]);
    },

    async purgeExpiredSessions() {
      await db.run('DELETE FROM user_sessions WHERE expires_at<=?', [sqliteTime(now())]);
    },

    // The plain key is returned once; only its hash is kept.
    async rotateKey(userId) {
      const key = KEY_PREFIX + randomToken(24);
      await db.run(
        `INSERT INTO user_keys(user_id,key_hash,last4,created_at) VALUES(?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET key_hash=excluded.key_hash, last4=excluded.last4, created_at=excluded.created_at`,
        [userId, sha256(key), key.slice(-4), sqliteTime(now())]
      );
      return key;
    },

    keyInfo(userId) {
      return db.get('SELECT last4, created_at FROM user_keys WHERE user_id=?', [userId]);
    },

    async userForKey(key) {
      if (!key || typeof key !== 'string' || !key.startsWith(KEY_PREFIX) || key.length > 100) return null;
      return (await db.get('SELECT u.id, u.email, u.name FROM user_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=?', [sha256(key)])) || null;
    },

    // Keeps the first time and source; saving the same post again changes nothing.
    async recordArchive(userId, postId, source = 'web') {
      await db.run('INSERT OR IGNORE INTO user_archives(user_id,post_id,source,created_at) VALUES(?,?,?,?)', [userId, postId, source, sqliteTime(now())]);
    },

    async list(userId, { limit = 20, offset = 0, query = '' } = {}) {
      const term = String(query || '').trim();
      const filter = term
        ? `AND (instr(lower(COALESCE(p.content,'')),lower(?))>0 OR instr(lower(COALESCE(p.author,'')),lower(?))>0 OR instr(lower(COALESCE(p.author_handle,'')),lower(?))>0 OR instr(lower(COALESCE(p.url,'')),lower(?))>0)`
        : '';
      const args = term ? [term, term, term, term] : [];
      return db.all(
        `SELECT p.*, a.created_at AS saved_by_me_at, a.source AS saved_source
         FROM user_archives a JOIN posts p ON p.id=a.post_id
         WHERE a.user_id=? AND p.short_code IS NOT NULL ${filter}
         ORDER BY a.created_at DESC, a.post_id DESC LIMIT ? OFFSET ?`,
        [userId, ...args, limit, offset]
      );
    },

    async count(userId) {
      const row = await db.get('SELECT COUNT(*) AS n FROM user_archives a JOIN posts p ON p.id=a.post_id WHERE a.user_id=? AND p.short_code IS NOT NULL', [userId]);
      return row ? row.n : 0;
    },

    // Only removes it from "my list"; the saved copy itself stays for everyone.
    async removeArchive(userId, postId) {
      const result = await db.run('DELETE FROM user_archives WHERE user_id=? AND post_id=?', [userId, postId]);
      return result.changes > 0;
    }
  };
}

// Pull candidate references out of pasted text: URLs (short links or X posts) and lines that are exactly a short code.
function parseClaimText(text, { extractTweetId, normalizeUrl, isReserved = () => false }) {
  const codes = new Set();
  const tweetIds = new Set();
  const input = String(text || '').slice(0, 50000);
  for (const match of input.match(/https?:\/\/[^\s<>"'，。；、）)]+/gi) || []) {
    let url;
    try { url = new URL(match); } catch { continue; }
    const single = url.pathname.match(/^\/([A-Za-z0-9]{6})\/?$/);
    if (single && !/^(?:x|twitter|mobile\.twitter)\.com$/i.test(url.hostname.replace(/^www\./, ''))) {
      if (!isReserved(single[1])) codes.add(single[1]);
      continue;
    }
    try {
      const id = extractTweetId(normalizeUrl(match));
      if (id) tweetIds.add(String(id));
    } catch { /* not an X link */ }
  }
  for (const line of input.split(/\r?\n/)) {
    const bare = line.trim();
    if (SHORT_CODE_PATTERN.test(bare) && !isReserved(bare)) codes.add(bare);
  }
  return { codes: [...codes].slice(0, MAX_CLAIM_ITEMS), tweetIds: [...tweetIds].slice(0, MAX_CLAIM_ITEMS) };
}

module.exports = { createAccounts, migrateAccounts, parseClaimText, sha256, KEY_PREFIX, MAX_CLAIM_ITEMS, SESSION_DAYS };
