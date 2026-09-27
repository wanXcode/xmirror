const fs = require('node:fs');
const path = require('node:path');
const seo = require('./seo');

function registerSeoRoutes(app, { store, publicDir, baseUrl, requireAdmin }) {
  app.use((req, res, next) => {
    if (/^\/(?:api(?:\/|$)|demo(?:\/|$)|admin-moderation\.html$)/i.test(req.path)) res.set('X-Robots-Tag', 'noindex, follow');
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
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));
  app.get('/', async (_req, res) => {
    const rows = await store.all('SELECT id,short_code,content,author,created_at FROM posts ORDER BY created_at DESC LIMIT 10');
    const items = rows.map(post => /^[A-Za-z0-9]{6}$/.test(post.short_code || '')
      ? `<article class="history-item"><div class="history-item-copy"><a class="history-item-link" href="/${post.short_code}"><strong>${seo.escape(seo.metadata(post).title)}</strong></a><div class="meta"><span>${seo.escape(post.author)}</span><span>存档于 ${seo.escape(post.created_at)}</span></div></div></article>` : '').join('');
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replace('<div id="historyList"></div>', `<div id="historyList">${items}</div>`);
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
    const links = rows.slice(0, 20).map(post => `<li><a href="/${post.short_code}">${seo.escape(seo.metadata(post).title)}</a> · ${seo.escape(post.author)}</li>`).join('');
    res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公开存档 · 第 ${page} 页 | XPut</title><link rel="canonical" href="${seo.escape(url)}"><meta name="robots" content="${rows.length ? 'index, follow' : 'noindex, follow'}"><link rel="stylesheet" href="/theme.css"><style>main{max-width:800px;margin:3rem auto;padding:1rem;line-height:1.8}li{margin:1rem 0;overflow-wrap:anywhere}nav{display:flex;gap:2rem}</style></head><body><main><a href="/">← XPut</a><h1>公开存档</h1><ul>${links}</ul><nav>${page > 1 ? `<a href="/browse?page=${page - 1}">上一页</a>` : ''}${rows.length > 20 ? `<a href="/browse?page=${page + 1}">下一页</a>` : ''}</nav></main></body></html>`);
  });
  app.get('/api/admin/seo', requireAdmin, async (req, res) => {
    const status = req.query.status || 'review';
    if (!['index', 'review', 'noindex'].includes(status)) return res.status(400).json({ error: '无效状态' });
    const rows = await store.all('SELECT id,short_code,author,seo_status,seo_score,seo_reason,seo_checked_at,seo_rule_version,seo_override,seo_blocked FROM posts WHERE seo_status=? ORDER BY id DESC LIMIT 100', [status]);
    res.set('Cache-Control', 'no-store').json({ posts: rows });
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
