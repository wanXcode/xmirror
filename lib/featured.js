const fs = require('node:fs');
const path = require('node:path');
const { detectContentLanguage } = require('./translation');
const { getLanguage } = require('./i18n');
const { plainText } = require('./post-view');

// Featured pages: a saved post whose page is opened to search engines, with an
// AI-assisted summary and context written (or checked) by a person. Nothing becomes
// indexable by itself: every gate below must hold, a person must have reviewed it, and
// at most `dailyCap` pages go live per day.

function loadFeaturedConfig(file = path.join(__dirname, '..', 'config', 'featured.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const normalize = text => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

function tokens(text) {
  const clean = normalize(text);
  // Words for spaced scripts, characters for CJK.
  return new Set([...(clean.match(/[a-z0-9']+/g) || []), ...(clean.match(/[㐀-鿿぀-ヿ가-힯]/g) || [])]);
}

function similarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / left.size; // how much of the summary is just the post again
}

/** Quality gate for the AI-assisted content. Returns a list of problems (empty = fine). */
function checkAiContent(row, postText, config) {
  const problems = [];
  const keyPoints = parseKeyPoints(row.key_points);
  if (!row.ai_title || row.ai_title.trim().length < 8) problems.push('ai_title_missing');
  if (!row.summary || row.summary.trim().length < 40) problems.push('summary_too_short');
  if (!row.context || row.context.trim().length < 40) problems.push('context_too_short');
  if (keyPoints.length < config.minKeyPoints) problems.push('key_points_missing');
  if (Number(row.needs_fix) === 1) problems.push('flagged_for_fixes');
  const text = normalize(postText);
  if (row.summary && text && (normalize(row.summary) === text || (text.length > 40 && normalize(row.summary).includes(text)))) problems.push('summary_repeats_post');
  else if (row.summary && text.length > 60 && similarity(row.summary, postText) > 0.85) problems.push('summary_repeats_post');
  if (new Set(keyPoints.map(normalize)).size !== keyPoints.length) problems.push('key_points_repeat');
  return problems;
}

function parseKeyPoints(value) {
  try { const list = JSON.parse(value || '[]'); return Array.isArray(list) ? list.filter(item => typeof item === 'string' && item.trim()) : []; } catch { return []; }
}

/**
 * Everything that must be true for a page to be (or stay) featured.
 * `facts`: { post, row, openReport, liveToday, now }
 * Returns { passed, reasons } where reasons lists the failing gates.
 */
function evaluateGates({ post, row, openReport, config, requireReview = true }) {
  const reasons = [];
  if ((Number(post.view_count) || 0) + (Number(post.share_count) || 0) < config.minInteractions) reasons.push('not_enough_interactions');
  if (post.author_followers === null || post.author_followers === undefined) reasons.push('followers_unknown');
  else if (Number(post.author_followers) < config.minFollowers) reasons.push('not_enough_followers');
  if (Number(post.sensitive) === 1) reasons.push('sensitive');
  if (Number(post.seo_blocked) === 1) reasons.push('blocked');
  if (openReport) reasons.push('open_report');
  if (row) {
    reasons.push(...checkAiContent(row, plainText(post.content), config));
    if (requireReview && Number(row.reviewed) !== 1) reasons.push('not_reviewed');
  } else {
    reasons.push('no_content');
  }
  return { passed: reasons.length === 0, reasons };
}

// Gates that can take a live page away again at any time (not "reviewed" or counts).
const HARD_STOPS = new Set(['sensitive', 'blocked', 'open_report', 'flagged_for_fixes']);

function validateInput(input, config) {
  const { limits } = config;
  const errors = [];
  const text = (name, max, required = true) => {
    const value = typeof input[name] === 'string' ? input[name].trim() : '';
    if (required && !value) errors.push(`${name}_required`);
    if (value.length > max) errors.push(`${name}_too_long`);
    return value;
  };
  const ai_title = text('ai_title', limits.title);
  const topic = text('topic', limits.topic);
  const summary = text('summary', limits.summary);
  const context = text('context', limits.context);
  const keyPoints = Array.isArray(input.key_points) ? input.key_points.map(item => String(item).trim()).filter(Boolean) : [];
  if (keyPoints.length < config.minKeyPoints || keyPoints.length > config.maxKeyPoints) errors.push('key_points_count');
  if (keyPoints.some(item => item.length > limits.keyPoint)) errors.push('key_point_too_long');
  return { errors, value: { ai_title, topic, summary, context, key_points: keyPoints } };
}

function contentLanguage(postText) {
  const detected = detectContentLanguage(postText);
  return getLanguage(detected) ? detected : 'en';
}

function createFeaturedService({ db, store, config = loadFeaturedConfig(), now = () => new Date() }) {
  const today = () => now().toISOString().slice(0, 10);

  async function liveToday() {
    const row = await db.get("SELECT COUNT(*) AS n FROM post_featured WHERE status='live' AND substr(live_at,1,10)=?", [today()]);
    return row ? row.n : 0;
  }

  async function evaluate(post, row, options = {}) {
    return evaluateGates({ post, row, openReport: await store.hasOpenReport(post.id), config, ...options });
  }

  async function setStatus(postId, status, liveAt = null) {
    if (liveAt) await db.run('UPDATE post_featured SET status=?, updated_at=CURRENT_TIMESTAMP, live_at=? WHERE post_id=?', [status, liveAt, postId]);
    else await db.run('UPDATE post_featured SET status=?, updated_at=CURRENT_TIMESTAMP WHERE post_id=?', [status, postId]);
  }

  return {
    config,

    /** The row to render as a featured page, or null. A live page that fails a hard stop is withdrawn on the spot. */
    async pageFor(post) {
      const row = await store.featuredFor(post.id);
      if (!row || row.status !== 'live') return null;
      const verdict = await evaluate(post, row, { requireReview: false });
      if (verdict.reasons.some(reason => HARD_STOPS.has(reason) || reason.endsWith('_missing') || reason.endsWith('_too_short'))) {
        await setStatus(post.id, 'withdrawn');
        return null;
      }
      return { ...row, key_points: parseKeyPoints(row.key_points) };
    },

    /** Other live featured pages by the same author or on the same topic. */
    async related(post, row) {
      const rows = await db.all(
        `SELECT p.id, p.short_code, p.author, p.author_handle, p.tweet_time, p.created_at, p.images, p.video_poster, f.ai_title, f.lang
         FROM post_featured f JOIN posts p ON p.id=f.post_id
         WHERE f.status='live' AND f.post_id<>? AND (p.author_handle=? OR (f.topic<>'' AND lower(f.topic)=lower(?)))
         ORDER BY (p.author_handle=?) DESC, f.live_at DESC LIMIT ?`,
        [post.id, post.author_handle, row.topic || '', post.author_handle, config.relatedLimit]
      );
      return rows;
    },

    async upsertContent(postId, input) {
      const post = await db.get('SELECT * FROM posts WHERE id=?', [postId]);
      if (!post) return { status: 404, error: 'post_not_found' };
      const { errors, value } = validateInput(input || {}, config);
      if (errors.length) return { status: 400, error: 'invalid_content', details: errors };
      const lang = contentLanguage(plainText(post.content));
      // Editing means someone has to look again: review is reset and a live page is taken down until then.
      await db.run(
        `INSERT INTO post_featured(post_id, status, lang, ai_title, topic, summary, context, key_points, ai_generated_at, needs_fix, reviewed)
         VALUES(?, 'draft', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0)
         ON CONFLICT(post_id) DO UPDATE SET status=CASE WHEN status='live' THEN 'draft' ELSE status END, lang=excluded.lang, ai_title=excluded.ai_title,
           topic=excluded.topic, summary=excluded.summary, context=excluded.context, key_points=excluded.key_points,
           ai_generated_at=CURRENT_TIMESTAMP, needs_fix=excluded.needs_fix, reviewed=0, reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP`,
        [postId, lang, value.ai_title, value.topic, value.summary, value.context, JSON.stringify(value.key_points), input.needs_fix ? 1 : 0]
      );
      return this.describe(postId);
    },

    async setReviewed(postId, reviewed, note = '') {
      const row = await store.featuredFor(postId);
      if (!row) return { status: 404, error: 'no_content' };
      await db.run('UPDATE post_featured SET reviewed=?, reviewed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP END, review_note=?, updated_at=CURRENT_TIMESTAMP WHERE post_id=?',
        [reviewed ? 1 : 0, reviewed ? 1 : 0, String(note).slice(0, 500), postId]);
      if (!reviewed && row.status === 'live') await setStatus(postId, 'draft');
      return this.describe(postId);
    },

    async publish(postId) {
      const post = await db.get('SELECT * FROM posts WHERE id=?', [postId]);
      const row = await store.featuredFor(postId);
      if (!post || !row) return { status: 404, error: 'no_content' };
      if (row.status === 'live') return this.describe(postId);
      const verdict = await evaluate(post, row);
      if (!verdict.passed) return { status: 409, error: 'gates_failed', reasons: verdict.reasons };
      if ((await liveToday()) >= config.dailyCap) return { status: 429, error: 'daily_cap_reached', cap: config.dailyCap };
      await setStatus(postId, 'live', now().toISOString());
      return this.describe(postId);
    },

    async withdraw(postId) {
      const row = await store.featuredFor(postId);
      if (!row) return { status: 404, error: 'no_content' };
      await setStatus(postId, 'withdrawn');
      return this.describe(postId);
    },

    async setFollowers(postId, followers) {
      const value = Number(followers);
      if (!Number.isSafeInteger(value) || value < 0) return { status: 400, error: 'invalid_followers' };
      await db.run('UPDATE posts SET author_followers=? WHERE id=?', [value, postId]);
      return this.describe(postId);
    },

    async describe(postId) {
      const post = await db.get('SELECT * FROM posts WHERE id=?', [postId]);
      if (!post) return { status: 404, error: 'post_not_found' };
      const row = await store.featuredFor(postId);
      const verdict = await evaluate(post, row);
      return {
        status: 200,
        post: { id: post.id, short_code: post.short_code, author: post.author, author_handle: post.author_handle, views: post.view_count, shares: post.share_count, followers: post.author_followers },
        featured: row ? { ...row, key_points: parseKeyPoints(row.key_points) } : null,
        gates: verdict,
        liveToday: await liveToday(),
        dailyCap: config.dailyCap
      };
    },

    /** Posts worth a look: enough interactions, or already in the pipeline. */
    async candidates(status = '') {
      const rows = await db.all(
        `SELECT p.id FROM posts p LEFT JOIN post_featured f ON f.post_id=p.id
         WHERE (f.post_id IS NOT NULL OR (p.view_count + p.share_count) >= ?) ${status ? 'AND f.status=?' : ''}
         ORDER BY (p.view_count + p.share_count) DESC LIMIT 50`,
        status ? [config.minInteractions, status] : [config.minInteractions]
      );
      const out = [];
      for (const { id } of rows) out.push(await this.describe(id));
      return out;
    }
  };
}

module.exports = { HARD_STOPS, checkAiContent, createFeaturedService, evaluateGates, loadFeaturedConfig, parseKeyPoints, similarity, validateInput };
