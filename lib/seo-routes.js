const fs = require('node:fs');
const path = require('node:path');
const seo = require('./seo');

function registerSeoRoutes(app, { store, publicDir, baseUrl, requireAdmin }) {
  app.use((req, res, next) => {
    if (/^\/(?:api(?:\/|$)|demo(?:\/|$)|admin-moderation\.html$|report(?:\.html)?$|[A-Za-z0-9]{6}\/referer$)/i.test(req.path)) res.set('X-Robots-Tag', 'noindex, follow');
    next();
  });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/archive/\nSitemap: ${baseUrl}/sitemap.xml\n`));
  // No request-time reassessments or external API calls: use stored decisions.
  app.get('/sitemap.xml', async (_req, res) => {
    const count = await store.get("SELECT COUNT(*) AS n FROM posts WHERE seo_status='index' AND seo_blocked=0");
    res.set('Cache-Control', 'no-store').type('application/xml');
    if (count.n <= 49999) return res.send(seo.sitemap(await store.sitemapRows(49999), baseUrl));
    const pages = Math.ceil(count.n / 49999);
    res.send(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: pages }, (_, i) => `<sitemap><loc>${seo.escape(baseUrl)}/sitemaps/${i + 1}.xml</loc></sitemap>`).join('')}</sitemapindex>`);
  });
  app.get('/sitemaps/:page.xml', async (req, res) => {
    if (!/^[1-9]\d{0,4}$/.test(req.params.page)) return res.sendStatus(404);
    const page = Number(req.params.page);
    const rows = await store.sitemapRows(49999, (page - 1) * 49999);
    if (!rows.length && page > 1) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').type('application/xml').send(seo.sitemap(rows, baseUrl, { includeHome: page === 1 }));
  });
  app.get('/help.html', (_req, res) => res.redirect(301, '/help'));
  app.get('/help', (_req, res) => {
    const html = fs.readFileSync(path.join(publicDir, 'help.html'), 'utf8').replaceAll('{{BASE_URL}}', seo.escape(baseUrl));
    res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(html);
  });
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));
  app.get('/', async (_req, res) => {
    const rows = await store.all('SELECT id,short_code,content,author,created_at FROM posts ORDER BY created_at DESC LIMIT 11');
    const firstPage = rows.slice(0,10);
    const bootstrap = JSON.stringify({posts:firstPage.map(post=>({id:post.id,title:seo.metadata(post).title,author:post.author,created_at:post.created_at,short_url:'/'+post.short_code})),has_more:rows.length>10}).replace(/</g,'\\u003c');
    const items = firstPage.map(post => /^[A-Za-z0-9]{6}$/.test(post.short_code || '')
      ? `<article class="history-item"><div class="history-item-copy"><a class="history-item-link" href="/${post.short_code}"><strong>${seo.escape(seo.metadata(post).title)}</strong></a><div class="meta"><span>${seo.escape(post.author)}</span><span>存档于 ${seo.escape(post.created_at)}</span></div></div></article>` : '').join('');
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replace('<div id="historyList"></div>', `<div id="historyList">${items}</div><script type="application/json" id="initialPosts">${bootstrap}</script>`);
    res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(html);
  });
  // Persistent HTML navigation for eligible archives that have left the home page.
  app.get('/browse', async (req, res) => {
    const raw = req.query.page || '1';
    if (!/^[1-9]\d{0,5}$/.test(raw)) return res.sendStatus(404);
    const page = Number(raw);
    const rows = await store.eligible(21, (page - 1) * 20);
    if (!rows.length && page > 1) return res.sendStatus(404);
    const url = `${baseUrl}/browse${page > 1 ? `?page=${page}` : ''}`;
    const links = rows.slice(0, 20).map(post => `<li><a href="/${post.short_code}">${seo.escape(seo.metadata(post).title)}</a><p class="archive-author">${seo.escape(post.author)}</p></li>`).join('');
    res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>值得再读 · 第 ${page} 页 | XPut</title><meta name="description" content="在 XPut 浏览值得再读的 X / Twitter 公开存档，阅读教程、长文和图文资料。"><link rel="canonical" href="${seo.escape(url)}"><meta name="robots" content="${rows.length ? 'index, follow' : 'noindex, follow'}"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/theme.css?v=1.9.1"><link rel="stylesheet" href="/info.css?v=1.9.1"></head><body><main class="info-page"><nav class="info-nav" aria-label="网站导航"><a href="/">← XPut 首页</a><a href="/help">使用帮助</a></nav><header class="info-heading"><h1>值得再读</h1><p>浏览公开存档，发现值得慢慢读的内容。</p></header>${rows.length ? `<ul class="archive-list">${links}</ul>` : '<p class="browse-empty">暂时没有可浏览的存档，稍后再来看看。</p>'}<nav class="browse-pagination" aria-label="存档分页">${page > 1 ? `<a href="/browse?page=${page - 1}">← 上一页</a>` : ''}<span>第 ${page} 页</span>${rows.length > 20 ? `<a href="/browse?page=${page + 1}">下一页 →</a>` : ''}</nav><footer class="info-footer"><a href="/#archiveForm">存档 X 链接 →</a><a href="/report">投诉／删除申请</a></footer></main></body></html>`);
  });
  app.get('/api/admin/seo', requireAdmin, async (req, res) => {
    const status = req.query.status || 'review';
    const page = Number(req.query.page || 1);
    if (!['all','index','review','noindex','unchecked','failed'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 100000) return res.status(400).json({ error: '无效筛选' });
    const where = status === 'all' ? '1=1' : status === 'unchecked' ? 'seo_managed=0' : status === 'failed' ? 'seo_error IS NOT NULL' : 'seo_status=?';
    const args = ['all','unchecked','failed'].includes(status) ? [] : [status];
    const rows = await store.all(`SELECT id,short_code,author,content,seo_status,seo_score,seo_reason,seo_checked_at,seo_rule_version,seo_override,seo_blocked,seo_error,seo_attempts,seo_managed FROM posts WHERE ${where} ORDER BY id DESC LIMIT 21 OFFSET ?`, [...args,(page-1)*20]);
    const summary = await store.all('SELECT seo_status AS status,COUNT(*) AS count FROM posts GROUP BY seo_status');
    const pending = await store.get('SELECT SUM(seo_managed=0) AS unchecked,SUM(seo_error IS NOT NULL) AS failed FROM posts');
    const posts = rows.slice(0,20).map(({content,...post}) => ({ ...post,title:seo.metadata({content,author:post.author}).title }));
    res.set('Cache-Control', 'no-store').json({ posts,summary,pending,page,hasMore:rows.length>20 });
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
