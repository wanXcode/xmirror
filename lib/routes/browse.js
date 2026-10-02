const { renderDocument } = require('../views/layout');
const { renderBrowse } = require('../views/pages/browse');
const { createTranslator, enabledLanguages } = require('../i18n');
const { pagePath, PAGES } = require('../pages');
const seo = require('../seo');

const PAGE_SIZE = 20;

/**
 * /browse and /zh/browse: the public "Saved posts" list. Indexable when it shows posts and no search term;
 * search results are noindex. Each language has its own URL (hreflang pair on the first page).
 */
function registerBrowseRoutes(app, { store, baseUrl }) {
  for (const language of enabledLanguages()) {
    const path = PAGES.browse.paths[language.code];
    app.get(path, async (req, res, next) => {
      try {
        const rawPage = req.query.page === undefined ? '1' : req.query.page;
        if (typeof rawPage !== 'string' || !/^[1-9]\d{0,5}$/.test(rawPage)) return res.sendStatus(404);
        if (req.query.q !== undefined && typeof req.query.q !== 'string') return res.sendStatus(400);
        const t = createTranslator(language.code);
        const query = (req.query.q || '').trim();
        if (Array.from(query).length > 100) return res.status(400).type('text/plain').send(t('pages.browse.tooLong'));
        const page = Number(rawPage);
        const rows = await store.listSaved({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE, query });
        if (!rows.length && page > 1) return res.sendStatus(404);
        const items = rows.slice(0, PAGE_SIZE).map(row => ({
          code: row.short_code,
          title: row.featured_title || seo.metadata(row).title,
          author: row.author || '',
          handle: row.author_handle || '',
          date: row.tweet_time || row.created_at
        }));
        const copy = t('pages.browse');
        const ownPath = pagePath('browse', language.code) + (page > 1 ? `?page=${page}` : '');
        const search = page > 1 ? `?page=${page}` : '';
        const document = renderDocument({
          lang: language.code, baseUrl, page: 'browse', path: query ? pagePath('browse', language.code) : ownPath,
          title: page > 1 ? `${copy.title.replace(/ \| XPut$/, '')} (${t('pages.browse.pageN').replace('{n}', page)}) | XPut` : copy.title,
          description: copy.description,
          robots: query || !items.length ? 'noindex, follow' : 'index, follow',
          alternates: page === 1 && !query,
          switchHref: code => pagePath('browse', code) + (query ? `?q=${encodeURIComponent(query)}` : search),
          body: renderBrowse({ t, lang: language.code, items, query, page, hasMore: rows.length > PAGE_SIZE })
        });
        res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(String(document));
      } catch (error) { next(error); }
    });
  }
}

module.exports = { registerBrowseRoutes };
