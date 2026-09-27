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
      seo_rule_version: 'TEXT', content_hash: 'TEXT', seo_override: 'TEXT', seo_blocked: 'INTEGER NOT NULL DEFAULT 0'
    })) if (!cols.has(name)) await run(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
    await run('CREATE INDEX IF NOT EXISTS idx_posts_seo_status ON posts(seo_status,id)');
    await run('CREATE INDEX IF NOT EXISTS idx_posts_content_hash ON posts(content_hash,id)');
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
      seo_updated_at=?,seo_rule_version=?,content_hash=?
      WHERE id=? AND content IS ? AND images IS ? AND video IS ? AND video_status IS ?
      AND seo_override IS ? AND seo_blocked=?`, [result.status, result.score, JSON.stringify(result.reasons), now,
      post.seo_status === result.status ? post.seo_updated_at : now, result.version, result.hash,
      id, post.content, post.images, post.video, post.video_status, post.seo_override, post.seo_blocked]);
    if (!update.changes) throw new Error('SEO_SOURCE_CHANGED');
    return { id, ...result };
  }
  const refresh = (id, options) => serial(() => evaluateId(id, options));
  const invalidate = id => run("UPDATE posts SET seo_status='review',seo_checked_at=NULL WHERE id=?", [id]);
  const override = (id, value, blocked) => serial(async () => {
    const post = await get('SELECT id,seo_blocked FROM posts WHERE id=?', [id]);
    if (!post) return null;
    // Gate first, so a failed reassessment never leaves an old index decision exposed.
    await run("UPDATE posts SET seo_override=?,seo_blocked=?,seo_status='review' WHERE id=?", [value, blocked === undefined ? post.seo_blocked : blocked ? 1 : 0, id]);
    return evaluateId(id);
  });
  const eligible = (limit = 50000, offset = 0) => all("SELECT id,short_code,content,author,seo_status,seo_blocked FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id LIMIT ? OFFSET ?", [limit, offset]);
  const sitemapRows = (limit, offset = 0) => all("SELECT short_code,seo_status,seo_blocked FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id LIMIT ? OFFSET ?", [limit, offset]);
  return { migrate, refresh, invalidate, override, assess, eligible, sitemapRows, all, get };
}
module.exports = { createSeoStore };
