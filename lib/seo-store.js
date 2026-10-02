const fs = require('node:fs');
const path = require('node:path');
const seo = require('./seo');
const { extractXPostId } = require('./x-post');

function createSeoStore(db, { dataDir, moderator, reviewService, autoIndex = true, autoConfig = require('./seo-auto').load() }) {
  const auto = require('./seo-auto');
  const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows)));
  const get = async (sql, args = []) => (await all(sql, args))[0];
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(e) { e ? reject(e) : resolve(this); }));
  let queue = Promise.resolve();
  let onEvaluated = async () => {};
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  async function migrate() {
    const cols = new Set((await all('PRAGMA table_info(posts)')).map(c => c.name));
    for (const [name, definition] of Object.entries({
      seo_status: "TEXT NOT NULL DEFAULT 'review'", seo_score: 'INTEGER NOT NULL DEFAULT 0',
      seo_reason: "TEXT NOT NULL DEFAULT '[]'", seo_checked_at: 'TEXT', seo_updated_at: 'TEXT',
      seo_rule_version: 'TEXT', content_hash: 'TEXT', seo_override: 'TEXT', seo_blocked: 'INTEGER NOT NULL DEFAULT 0',
      seo_managed: 'INTEGER NOT NULL DEFAULT 0', seo_next_check: 'TEXT', seo_attempts: 'INTEGER NOT NULL DEFAULT 0', seo_error: 'TEXT',
      seo_quality_version: "TEXT NOT NULL DEFAULT '2'", seo_revision: 'INTEGER NOT NULL DEFAULT 0', seo_moderation: 'TEXT',
      seo_ai_enabled: 'INTEGER NOT NULL DEFAULT 0', seo_title: 'TEXT', seo_description: 'TEXT', seo_title_hash: 'TEXT',
      seo_title_version: 'TEXT', seo_title_model: 'TEXT', seo_title_updated_at: 'TEXT',
      seo_title_keywords: 'TEXT', seo_title_evidence: 'TEXT', seo_auto_indexed_at: 'TEXT'
    })) if (!cols.has(name)) await run(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
    await run('CREATE INDEX IF NOT EXISTS idx_posts_seo_status ON posts(seo_status,id)');
    await run('CREATE INDEX IF NOT EXISTS idx_posts_content_hash ON posts(content_hash,id)');
    await run('CREATE INDEX IF NOT EXISTS idx_posts_seo_schedule ON posts(seo_managed,seo_next_check)');
    await run('CREATE INDEX IF NOT EXISTS idx_posts_seo_author ON posts(author_handle,seo_status,id)');
    await run("UPDATE posts SET seo_managed=1 WHERE seo_checked_at IS NOT NULL AND seo_managed=0");
    await run(`CREATE TRIGGER IF NOT EXISTS seo_source_changed AFTER UPDATE OF content,url,author,author_handle,tweet_time,images,video,video_status ON posts
      WHEN OLD.content IS NOT NEW.content OR OLD.url IS NOT NEW.url OR OLD.author IS NOT NEW.author OR OLD.author_handle IS NOT NEW.author_handle
        OR OLD.tweet_time IS NOT NEW.tweet_time OR OLD.images IS NOT NEW.images OR OLD.video IS NOT NEW.video OR OLD.video_status IS NOT NEW.video_status
      BEGIN UPDATE posts SET seo_status='review',seo_managed=1,seo_next_check=NULL,seo_error=NULL,seo_attempts=0,seo_revision=seo_revision+1 WHERE id=NEW.id; END`);
  }
  function mediaExists(url) {
    if (!/^\/(images|videos)\/[A-Za-z0-9_.-]+$/.test(url || '')) return false;
    try { const stat = fs.statSync(path.join(dataDir, url)); return stat.isFile() && stat.size > 0; } catch { return false; }
  }
  async function assess(post, { duplicate, qualityVersion } = {}) {
    let moderation = 'unknown';
    try {
      const payload = { url: post.url, authorHandle: post.author_handle, authorName: post.author, content: post.content };
      const response = reviewService ? reviewService.resolve(payload) : moderator.moderateArchivedContent(payload);
      moderation = response.action;
    } catch (e) { if (e.code === 'CONTENT_MODERATION_REJECTED') moderation = 'reject'; }
    const hash = seo.contentHash(post);
    if (duplicate === undefined) duplicate = !!(await get('SELECT id FROM posts WHERE content_hash=? AND id<? LIMIT 1', [hash, post.id]));
    return { ...seo.evaluate(post, { moderation, duplicate, autoIndex, blockSensitive: autoConfig.blockSensitive,
      config: (qualityVersion || post.seo_quality_version) === '3' ? seo.qualityRules : seo.rules,
      hasMedia: seo.imagesFor(post).some(mediaExists) || (post.video_status === 'completed' && mediaExists(post.video)) }), moderation };
  }
  async function evaluateId(id, options) {
    const post = await get('SELECT * FROM posts WHERE id=?', [id]);
    if (!post) return null;
    const result = await assess(post, options);
    const now = new Date().toISOString();
    // Daily cap: only a post becoming indexed by the automatic rule counts; manual picks and posts
    // already indexed are exempt. Overflow waits (review) and is retried after the next UTC midnight.
    let autoAt = post.seo_auto_indexed_at || null, nextCheck = null;
    if (result.status === 'index' && post.seo_status !== 'index' && !result.reasons.includes('manual_index') && !autoAt) {
      const used = (await get('SELECT COUNT(*) n FROM posts WHERE seo_auto_indexed_at>=? AND id!=?', [auto.dayStart().toISOString(), id])).n;
      if (used >= autoConfig.dailyCap) {
        result.status = 'review'; result.reasons.push('daily_cap_deferred');
        nextCheck = auto.nextDayStart().toISOString();
      } else autoAt = now;
    }
    // A concurrent repair/download must not receive a stale decision.
    const update = await run(`UPDATE posts SET seo_status=?,seo_score=?,seo_reason=?,seo_checked_at=?,
      seo_updated_at=?,seo_rule_version=?,content_hash=?,seo_managed=1,seo_error=NULL,seo_attempts=0,seo_next_check=?,seo_moderation=?,seo_auto_indexed_at=?
      WHERE id=? AND content IS ? AND images IS ? AND video IS ? AND video_status IS ?
      AND seo_override IS ? AND seo_blocked=? AND author IS ? AND author_handle IS ? AND tweet_time IS ? AND url IS ? AND short_code IS ? AND seo_revision=?`, [result.status, result.score, JSON.stringify(result.reasons), now,
      post.seo_status === result.status ? post.seo_updated_at : now, result.version, result.hash, nextCheck || new Date(Date.now() + (result.reasons.includes('moderation_unknown') ? 15 * 60000 : 86400000)).toISOString(),
      result.moderation, autoAt, id, post.content, post.images, post.video, post.video_status, post.seo_override, post.seo_blocked, post.author, post.author_handle, post.tweet_time, post.url, post.short_code,post.seo_revision]);
    if (!update.changes) throw new Error('SEO_SOURCE_CHANGED');
    await onEvaluated({ ...post, seo_status: result.status }).catch(() => {});
    return { id, ...result };
  }
  const refresh = (id, options) => serial(async () => {
    try { return await evaluateId(id, options); }
    catch (error) {
      await run("UPDATE posts SET seo_status='review',seo_managed=1,seo_error=?,seo_attempts=seo_attempts+1,seo_next_check=? WHERE id=?", [error.message === 'SEO_SOURCE_CHANGED' ? 'source_changed' : 'evaluation_failed', new Date(Date.now()+15*60000).toISOString(), id]);
      throw error;
    }
  });
  const invalidate = id => run("UPDATE posts SET seo_status='review',seo_checked_at=NULL,seo_managed=1,seo_next_check=NULL,seo_error=NULL,seo_attempts=0,seo_revision=seo_revision+1 WHERE id=?", [id]);
  const override = (id, value, blocked) => serial(async () => {
    const post = await get('SELECT id,seo_blocked FROM posts WHERE id=?', [id]);
    if (!post) return null;
    // Gate first, so a failed reassessment never leaves an old index decision exposed.
    await run("UPDATE posts SET seo_override=?,seo_blocked=?,seo_status='review',seo_revision=seo_revision+1 WHERE id=?", [value, blocked === undefined ? post.seo_blocked : blocked ? 1 : 0, id]);
    return evaluateId(id);
  });
  const eligible = (limit = 50000, offset = 0, query = '') => {
    const term = String(query || '').trim();
    if (!term) return all("SELECT * FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id LIMIT ? OFFSET ?", [limit, offset]);
    return all(`SELECT * FROM posts
      WHERE seo_status='index' AND seo_blocked=0 AND (
        instr(lower(COALESCE(content,'')),lower(?))>0 OR
        instr(lower(COALESCE(seo_title,'')),lower(?))>0 OR
        instr(lower(COALESCE(author,'')),lower(?))>0 OR
        instr(lower(COALESCE(author_handle,'')),lower(?))>0
      ) ORDER BY id LIMIT ? OFFSET ?`, [term, term, term, term, limit, offset]);
  };
  const sitemapRows = (limit = 50000, offset = 0) => all("SELECT short_code,seo_status,seo_blocked FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id LIMIT ? OFFSET ?", [limit, offset]);
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
        AND (seo_next_check IS NULL OR seo_next_check<=? OR (seo_error IS NULL AND seo_rule_version IS NOT seo_quality_version))
        ORDER BY COALESCE(seo_next_check,''),id LIMIT ?`, [new Date().toISOString(), limit]);
      let failed = 0;
      for (const row of rows) { try { await refresh(row.id); } catch { failed++; } }
      return { processed: rows.length, failed };
    } finally { sweeping = false; }
  }
  const related = post => all("SELECT * FROM posts WHERE author_handle=? AND id!=? AND seo_status='index' AND seo_blocked=0 ORDER BY id DESC LIMIT 3", [post.author_handle, post.id]);
  const decideReview = (id, action, note) => serial(async () => {
    const old = reviewService?.read(id);
    if (!old || !['allow','reject','reset'].includes(action) || typeof note !== 'string' || !note.trim() || note.length>500) throw new Error('无效审核决定或理由');
    const sourceId = extractXPostId(old.payload.url);
    const rows = (await all('SELECT id,url FROM posts WHERE url LIKE ?', [`%${sourceId}%`])).filter(p=>sourceId && extractXPostId(p.url)===sourceId);
    for (const row of rows) await invalidate(row.id);
    const record = reviewService.decide(id,action,note);
    let pending = 0;
    for (const row of rows) { try { await evaluateId(row.id); } catch { pending++; } }
    return { action:record.action,pending };
  });
  return { migrate, refresh, invalidate, override, assess, eligible, sitemapRows, backfillHashes, sweep, related, all, get, run, decideReview,
    onEvaluated: fn => { onEvaluated = fn; } };
}
module.exports = { createSeoStore };
