const seo = require('./seo');
const { PAGE_SIZE, copiesSitemap, mainSitemap, robotsTxt, sitemapIndex } = require('./sitemaps');

function registerSeoRoutes(app, { store, postStore, ai, publicDir, baseUrl, requireAdmin }) {
  app.use((req, res, next) => {
    if (/^\/(?:api(?:\/|$)|(?:node-)?dl(?:\/|$)|demo(?:\/|$)|admin-xput\.html$|report(?:\.html)?$|[A-Za-z0-9]{6}\/referer$)/i.test(req.path)) res.set('X-Robots-Tag', 'noindex, follow');
    next();
  });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(robotsTxt(baseUrl)));
  // Index of the fixed-page sitemap and one or more saved-copy sitemaps. Stored decisions only: no
  // request-time reassessment or external calls.
  app.get('/sitemap.xml', async (_req, res) => {
    const pages = Math.max(1, Math.ceil((await postStore.indexableCount()) / PAGE_SIZE));
    const root = baseUrl.replace(/\/$/, '');
    res.set('Cache-Control', 'no-cache').type('application/xml')
      .send(sitemapIndex([`${root}/sitemap-main.xml`, ...Array.from({ length: pages }, (_, i) => `${root}/sitemap-copies-${i + 1}.xml`)]));
  });
  app.get('/sitemap-main.xml', (_req, res) => res.set('Cache-Control', 'no-cache').type('application/xml').send(mainSitemap(baseUrl)));
  app.get('/sitemap-copies-:page.xml', async (req, res) => {
    if (!/^[1-9]\d{0,4}$/.test(req.params.page)) return res.sendStatus(404);
    const page = Number(req.params.page);
    const rows = await postStore.indexableCopies(PAGE_SIZE, (page - 1) * PAGE_SIZE);
    if (!rows.length && page > 1) return res.sendStatus(404);
    res.set('Cache-Control', 'no-cache').type('application/xml').send(copiesSitemap(rows, baseUrl));
  });
  // The old help page now lives in the home page FAQ. A path-based target (not cookie-based) keeps the 301 cacheable.
  for (const [paths, target] of [[['/help', '/help.html'], '/#faq'], [['/zh/help', '/zh/help.html'], '/zh/#faq']]) app.get(paths, (_req, res) => res.redirect(301, target));
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));
  app.get('/api/admin/seo', requireAdmin, async (req, res) => {
    const status = req.query.status || 'review';
    const page = Number(req.query.page || 1);
    if (!['all','index','review','noindex','unchecked','failed'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 100000) return res.status(400).json({ error: '无效筛选' });
    const where = status === 'all' ? '1=1' : status === 'unchecked' ? 'seo_managed=0' : status === 'failed' ? 'seo_error IS NOT NULL' : 'seo_status=?';
    const args = ['all','unchecked','failed'].includes(status) ? [] : [status];
    const rows = await store.all(`SELECT * FROM posts WHERE ${where} ORDER BY id DESC LIMIT 21 OFFSET ?`, [...args,(page-1)*20]);
    const summary = await store.all('SELECT seo_status AS status,COUNT(*) AS count FROM posts GROUP BY seo_status');
    const pending = await store.get('SELECT SUM(seo_managed=0) AS unchecked,SUM(seo_error IS NOT NULL) AS failed FROM posts');
    const posts = await Promise.all(rows.slice(0,20).map(async post => ({ id:post.id,short_code:post.short_code,author:post.author,
      seo_status:post.seo_status,seo_score:post.seo_score,seo_reason:post.seo_reason,seo_error:post.seo_error,
      seo_blocked:post.seo_blocked,seo_override:post.seo_override,
      seo_moderation:post.seo_moderation,seo_rule_version:post.seo_rule_version,seo_quality_version:post.seo_quality_version,
      title:seo.metadata(post).title,titleSource:seo.metadata(post).source,titleJob:await ai?.jobFor(post.id) })));
    res.set('Cache-Control', 'no-store').json({ posts,summary,pending,page,hasMore:rows.length>20,ai:await ai?.summary() });
  });
  app.post('/api/admin/seo/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { override = null, blocked } = req.body || {};
    if (!Number.isSafeInteger(id) || id <= 0 || ![null, 'index', 'noindex'].includes(override) || (blocked !== undefined && typeof blocked !== 'boolean') || (blocked === false && override === 'index')) return res.status(400).json({ error: '无效参数' });
    const result = await store.override(id, override, blocked);
    if (!result) return res.status(404).json({ error: '存档不存在' });
    res.set('Cache-Control', 'no-store').json(result);
  });
}
module.exports = { registerSeoRoutes };
