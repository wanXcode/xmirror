// Queries behind the saved-post pages. `db` is { get, all, run } (promise based).
const { SHORT_CODE_PATTERN } = require('./shortcode');

// Which saved copies search engines may index (and which the sitemap and "Saved posts" list show):
//   - live AI featured pages, and
//   - archives selected by the existing SEO mechanism (seo_status='index', not blocked) - the old
//     "值得再读" set, which keeps growing as new archives score well or are picked by hand;
// minus anything sensitive, blocked, under an open report, or taken down.
const MEMBER = `(f.post_id IS NOT NULL OR p.seo_status='index')
    AND p.seo_blocked=0 AND COALESCE(p.sensitive,0)=0 AND p.short_code IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM content_reports r WHERE r.post_id=p.id AND r.status='open')
    AND NOT EXISTS (SELECT 1 FROM removed_posts x WHERE x.short_code=p.short_code)`;
const FROM = `FROM posts p LEFT JOIN post_featured f ON f.post_id=p.id AND f.status='live'`;
const INDEXABLE = `SELECT p.short_code, COALESCE(f.live_at, p.seo_updated_at, p.created_at) AS lastmod ${FROM} WHERE ${MEMBER}`;

function createPostStore(db) {
  return {
    // A short code resolves directly, or through an alias created by a duplicate merge.
    async findByCode(code) {
      if (!SHORT_CODE_PATTERN.test(code)) return null;
      const post = await db.get(
        `SELECT * FROM posts WHERE short_code=?
         UNION ALL
         SELECT p.* FROM post_aliases a JOIN posts p ON p.id=a.target_post_id WHERE a.alias_code=? LIMIT 1`,
        [code, code]
      );
      return post || null;
    },

    tombstone(code) {
      return db.get('SELECT short_code, reference, removed_at FROM removed_posts WHERE short_code=?', [code]);
    },

    featuredFor(postId) {
      return db.get('SELECT * FROM post_featured WHERE post_id=?', [postId]);
    },

    // Reports that are still open keep a page out of the featured set.
    async hasOpenReport(postId) {
      const row = await db.get("SELECT 1 AS found FROM content_reports WHERE post_id=? AND status='open' LIMIT 1", [postId]).catch(() => null);
      return Boolean(row);
    },

    // Copies open to indexing: live featured pages only (they passed the gates and a human review).
    // Anything sensitive, blocked or under an open report is left out.
    async indexableCopies(limit, offset) {
      return db.all(`${INDEXABLE} ORDER BY p.id LIMIT ? OFFSET ?`, [limit, offset]);
    },
    async indexableCount() {
      const row = await db.get(`SELECT COUNT(*) AS n FROM (${INDEXABLE})`);
      return row ? row.n : 0;
    },

    // An archive chosen by the SEO mechanism (not an AI featured page: those are checked by lib/featured.js).
    async isSelected(post) {
      if (!post || post.seo_status !== 'index' || Number(post.seo_blocked) || Number(post.sensitive) || !post.short_code) return false;
      if (await this.tombstone(post.short_code)) return false;
      return !(await this.hasOpenReport(post.id));
    },

    // The public "Saved posts" list: every indexable copy, newest first, optionally filtered by a search term.
    async listSaved({ limit = 21, offset = 0, query = '' } = {}) {
      const term = String(query || '').trim();
      const filter = term
        ? `AND (instr(lower(COALESCE(p.content,'')),lower(?))>0 OR instr(lower(COALESCE(p.seo_title,'')),lower(?))>0 OR instr(lower(COALESCE(f.ai_title,'')),lower(?))>0
             OR instr(lower(COALESCE(p.author,'')),lower(?))>0 OR instr(lower(COALESCE(p.author_handle,'')),lower(?))>0)`
        : '';
      const args = term ? [term, term, term, term, term] : [];
      return db.all(`SELECT p.*, f.ai_title AS featured_title, f.summary AS featured_summary ${FROM} WHERE ${MEMBER} ${filter} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
    },

    async applyCounts(batch) {
      for (const [postId, { views, shares }] of batch) {
        await db.run('UPDATE posts SET view_count=view_count+?, share_count=share_count+? WHERE id=?', [views, shares, postId]);
      }
    }
  };
}

module.exports = { createPostStore };
