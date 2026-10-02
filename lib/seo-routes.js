const fs = require('node:fs');
const path = require('node:path');
const seo = require('./seo');
const { PAGE_SIZE, copiesSitemap, mainSitemap, robotsTxt, sitemapIndex } = require('./sitemaps');

function registerSeoRoutes(app, { store, postStore, ai, publicDir, baseUrl, requireAdmin }) {
  app.use((req, res, next) => {
    if (/^\/(?:api(?:\/|$)|dl(?:\/|$)|demo(?:\/|$)|admin-xput\.html$|report(?:\.html)?$|[A-Za-z0-9]{6}\/referer$)/i.test(req.path)) res.set('X-Robots-Tag', 'noindex, follow');
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
  app.get('/help.html', (_req, res) => res.redirect(301, '/help'));
  app.get('/help', (_req, res) => {
    const html = fs.readFileSync(path.join(publicDir, 'help.html'), 'utf8').replaceAll('{{BASE_URL}}', seo.escape(baseUrl));
    res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(html);
  });
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));
  // Persistent HTML navigation for eligible archives that have left the home page.
  app.get('/browse', async (req, res) => {
    const raw = req.query.page || '1';
    if (!/^[1-9]\d{0,5}$/.test(raw)) return res.sendStatus(404);
    if (req.query.q !== undefined && typeof req.query.q !== 'string') return res.status(400).send('无效搜索词');
    const query = (req.query.q || '').trim();
    if (Array.from(query).length > 100) return res.status(400).send('搜索词过长');
    const page = Number(raw);
    const rows = await store.eligible(21, (page - 1) * 20, query);
    if (!rows.length && page > 1) return res.sendStatus(404);
    const browseHref = targetPage => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (targetPage > 1) params.set('page', String(targetPage));
      const search = params.toString();
      return `/browse${search ? `?${search}` : ''}`;
    };
    const url = query ? `${baseUrl}/browse` : `${baseUrl}${browseHref(page)}`;
    const pageTitle = query ? `搜索“${query}” | XPut` : `值得再读 · 第 ${page} 页 | XPut`;
    const links = rows.slice(0, 20).map(post => `<li><a href="/${post.short_code}">${seo.escape(seo.metadata(post).title)}</a><p class="archive-author">${seo.escape(post.author)}</p></li>`).join('');
    const resultSummary = query ? `<p class="browse-result-summary">“${seo.escape(query)}”的搜索结果</p>` : '';
    const emptyMessage = query ? `没有找到与“${seo.escape(query)}”相关的公开存档。` : '暂时没有可浏览的存档，稍后再来看看。';
    res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${seo.escape(pageTitle)}</title><meta name="description" content="在 XPut 浏览值得再读的 X / Twitter 公开存档，阅读教程、长文和图文资料。"><link rel="canonical" href="${seo.escape(url)}"><meta name="robots" content="${query || !rows.length ? 'noindex, follow' : 'index, follow'}"><link rel="icon" href="/favicon.svg?v=xput-logo-b-1"><link rel="shortcut icon" href="/favicon.ico?v=xput-logo-b-1"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=xput-logo-b-1"><link rel="manifest" href="/site.webmanifest?v=xput-logo-b-1"><link rel="stylesheet" href="/theme.css?v=1.9.8"><link rel="stylesheet" href="/info.css?v=1.9.8"></head><body><main class="info-page"><nav class="info-nav" aria-label="网站导航"><a href="/">← XPut 首页</a><a href="/help">使用帮助</a></nav><header class="info-heading"><h1>值得再读</h1><p>浏览公开存档，发现值得慢慢读的内容。</p></header><form class="browse-search" action="/browse" method="get" role="search"><label for="browseSearch">搜索公开存档</label><div class="browse-search-row"><input id="browseSearch" type="search" name="q" value="${seo.escape(query)}" maxlength="100" placeholder="搜索标题、正文或作者" autocomplete="off"><button type="submit">搜索</button></div></form>${resultSummary}${rows.length ? `<ul class="archive-list">${links}</ul>` : `<p class="browse-empty">${emptyMessage}</p>`}<nav class="browse-pagination" aria-label="存档分页">${page > 1 ? `<a href="${seo.escape(browseHref(page - 1))}">← 上一页</a>` : ''}<span>第 ${page} 页</span>${rows.length > 20 ? `<a href="${seo.escape(browseHref(page + 1))}">下一页 →</a>` : ''}</nav><footer class="info-footer"><a href="/#archiveForm">存档 X 链接 →</a><a href="/report">投诉／删除申请</a></footer></main></body></html>`);
  });
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
