const fs = require('node:fs');
const path = require('node:path');
const seo = require('./seo');

function createSeoStore(db, { dataDir, moderator, autoIndex = true }) {
  const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows)));
  const get = async (sql, args = []) => (await all(sql, args))[0];
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(e) { e ? reject(e) : resolve(this); }));
  let queue = Promise.resolve();
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  async function migrate() {
    const cols = new Set((await all('PRAGMA table_info(posts)')).map(c => c.name));
    for (const [name, definition] of Object.entries({
      seo_status: "TEXT NOT NULL DEFAULT 'review'", seo_score: 'INTEGER NOT NULL DEFAULT 0',
      seo_reason: "TEXT NOT NULL DEFAULT '[]'", seo_checked_at: 'TEXT', seo_updated_at: 'TEXT',
      seo_rule_version: 'TEXT', content_hash: 'TEXT', seo_override: 'TEXT', seo_blocked: 'INTEGER NOT NULL DEFAULT 0',
      seo_managed: 'INTEGER NOT NULL DEFAULT 0', seo_next_check: 'TEXT', seo_attempts: 'INTEGER NOT NULL DEFAULT 0', seo_error: 'TEXT'
    })) if (!cols.has(name)) await run(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
    await run('CREATE INDEX IF NOT EXISTS idx_posts_seo_status ON posts(seo_status,id)');
    await run('CREATE INDEX IF NOT EXISTS idx_posts_content_hash ON posts(content_hash,id)');
    await run('CREATE INDEX IF NOT EXISTS idx_posts_seo_schedule ON posts(seo_managed,seo_next_check)');
    await run('CREATE INDEX IF NOT EXISTS idx_posts_seo_author ON posts(author_handle,seo_status,id)');
    await run("UPDATE posts SET seo_managed=1 WHERE seo_checked_at IS NOT NULL AND seo_managed=0");
  }
  function mediaExists(url) {
    if (!/^\/(images|videos)\/[A-Za-z0-9_.-]+$/.test(url || '')) return false;
    try { const stat = fs.statSync(path.join(dataDir, url)); return stat.isFile() && stat.size > 0; } catch { return false; }
  }
  async function assess(post, { duplicate } = {}) {
    let moderation = 'unknown';
    try {
      const response = moderator.moderateArchivedContent({ url: post.url, authorHandle: post.author_handle, authorName: post.author, content: post.content });
      moderation = response.action;
    } catch (e) { if (e.code === 'CONTENT_MODERATION_REJECTED') moderation = 'reject'; }
    const hash = seo.contentHash(post);
    if (duplicate === undefined) duplicate = !!(await get('SELECT id FROM posts WHERE content_hash=? AND id<? LIMIT 1', [hash, post.id]));
    return seo.evaluate(post, { moderation, duplicate, autoIndex,
      hasMedia: seo.imagesFor(post).some(mediaExists) || (post.video_status === 'completed' && mediaExists(post.video)) });
  }
  async function evaluateId(id, options) {
    const post = await get('SELECT * FROM posts WHERE id=?', [id]);
    if (!post) return null;
    const result = await assess(post, options);
    const now = new Date().toISOString();
    // A concurrent repair/download must not receive a stale decision.
    const update = await run(`UPDATE posts SET seo_status=?,seo_score=?,seo_reason=?,seo_checked_at=?,
      seo_updated_at=?,seo_rule_version=?,content_hash=?,seo_managed=1,seo_error=NULL,seo_attempts=0,seo_next_check=?
      WHERE id=? AND content IS ? AND images IS ? AND video IS ? AND video_status IS ?
      AND seo_override IS ? AND seo_blocked=? AND author IS ? AND author_handle IS ? AND tweet_time IS ? AND url IS ? AND short_code IS ?`, [result.status, result.score, JSON.stringify(result.reasons), now,
      post.seo_status === result.status ? post.seo_updated_at : now, result.version, result.hash, new Date(Date.now() + (result.reasons.includes('moderation_unknown') ? 15 * 60000 : 86400000)).toISOString(),
      id, post.content, post.images, post.video, post.video_status, post.seo_override, post.seo_blocked, post.author, post.author_handle, post.tweet_time, post.url, post.short_code]);
    if (!update.changes) throw new Error('SEO_SOURCE_CHANGED');
    return { id, ...result };
  }
  const refresh = (id, options) => serial(async () => {
    try { return await evaluateId(id, options); }
    catch (error) {
      await run("UPDATE posts SET seo_status='review',seo_managed=1,seo_error=?,seo_attempts=seo_attempts+1,seo_next_check=? WHERE id=?", [error.message === 'SEO_SOURCE_CHANGED' ? 'source_changed' : 'evaluation_failed', new Date(Date.now()+15*60000).toISOString(), id]);
      throw error;
    }
  });
  const invalidate = id => run("UPDATE posts SET seo_status='review',seo_checked_at=NULL,seo_managed=1,seo_next_check=NULL,seo_error=NULL,seo_attempts=0 WHERE id=?", [id]);
  const override = (id, value, blocked) => serial(async () => {
    const post = await get('SELECT id,seo_blocked FROM posts WHERE id=?', [id]);
    if (!post) return null;
    // Gate first, so a failed reassessment never leaves an old index decision exposed.
    await run("UPDATE posts SET seo_override=?,seo_blocked=?,seo_status='review' WHERE id=?", [value, blocked === undefined ? post.seo_blocked : blocked ? 1 : 0, id]);
    return evaluateId(id);
  });
  const eligible = (limit = 50000, offset = 0, query = '') => {
    const term = String(query || '').trim();
    if (!term) return all("SELECT id,short_code,content,author,seo_status,seo_blocked FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id LIMIT ? OFFSET ?", [limit, offset]);
    return all(`SELECT id,short_code,content,author,seo_status,seo_blocked FROM posts
      WHERE seo_status='index' AND seo_blocked=0 AND (
        instr(lower(COALESCE(content,'')),lower(?))>0 OR
        instr(lower(COALESCE(author,'')),lower(?))>0 OR
        instr(lower(COALESCE(author_handle,'')),lower(?))>0
      ) ORDER BY id LIMIT ? OFFSET ?`, [term, term, term, limit, offset]);
  };
  const sitemapRows = (limit, offset = 0) => all("SELECT short_code,seo_status,seo_blocked FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id LIMIT ? OFFSET ?", [limit, offset]);
  async function backfillHashes(limit = 100, after = 0) {
    const rows = await all('SELECT * FROM posts WHERE id>? AND content_hash IS NULL ORDER BY id LIMIT ?', [after, limit]);
    for (const post of rows) await run('UPDATE posts SET content_hash=? WHERE id=? AND content IS ? AND images IS ? AND video IS ?', [seo.contentHash(post), post.id, post.content, post.images, post.video]);
    return { scanned: rows.length, lastId: rows.at(-1)?.id || after };
  }
  let sweeping = false;
  async function sweep(limit = 20) {
    if (sweeping) return { processed: 0 };
    sweeping = true;
    try {
      await backfillHashes(100);
      // Historical records are admitted explicitly; daily rechecks only cover managed rows.
      const rows = await all(`SELECT id FROM posts WHERE seo_managed=1 AND seo_attempts<6
        AND (seo_next_check IS NULL OR seo_next_check<=? OR (seo_error IS NULL AND seo_rule_version IS NOT ?))
        ORDER BY COALESCE(seo_next_check,''),id LIMIT ?`, [new Date().toISOString(), seo.rules.version, limit]);
      let failed = 0;
      for (const row of rows) { try { await refresh(row.id); } catch { failed++; } }
      return { processed: rows.length, failed };
    } finally { sweeping = false; }
  }
  const related = post => all("SELECT short_code,content,author FROM posts WHERE author_handle=? AND id!=? AND seo_status='index' AND seo_blocked=0 ORDER BY id DESC LIMIT 3", [post.author_handle, post.id]);
  return { migrate, refresh, invalidate, override, assess, eligible, sitemapRows, backfillHashes, sweep, related, all, get, run };
}
module.exports = { createSeoStore };
