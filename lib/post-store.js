// Queries behind the saved-post pages. `db` is { get, all, run } (promise based).
const { SHORT_CODE_PATTERN } = require('./shortcode');

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

    async applyCounts(batch) {
      for (const [postId, { views, shares }] of batch) {
        await db.run('UPDATE posts SET view_count=view_count+?, share_count=share_count+? WHERE id=?', [views, shares, postId]);
      }
    }
  };
}

module.exports = { createPostStore };
