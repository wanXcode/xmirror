const { enabledLanguages } = require('./i18n');
const { PAGES, pagePath } = require('./pages');

// Pages that are not meant to be found through search stay out of the sitemap.
const NOINDEX_PAGES = new Set(['report']);
const PAGE_SIZE = 49999;
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
const absolute = (baseUrl, path) => new URL(path, baseUrl).href;

/** Fixed pages, each language listed with hreflang alternates (en, zh-Hans, x-default = English). */
function mainSitemap(baseUrl) {
  const languages = enabledLanguages();
  const entries = [];
  for (const page of Object.keys(PAGES)) {
    if (NOINDEX_PAGES.has(page)) continue;
    const links = [...languages.map(language => ({ hreflang: language.hreflang, href: absolute(baseUrl, pagePath(page, language.code)) })),
      { hreflang: 'x-default', href: absolute(baseUrl, pagePath(page, 'en')) }];
    for (const language of languages) {
      entries.push(`<url><loc>${escape(absolute(baseUrl, pagePath(page, language.code)))}</loc>${links.map(link => `<xhtml:link rel="alternate" hreflang="${link.hreflang}" href="${escape(link.href)}"/>`).join('')}</url>`);
    }
  }
  return `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>`;
}

/** Saved copies that are open to indexing: featured pages and legacy-indexed archives. */
function copiesSitemap(rows, baseUrl) {
  const urls = rows.map(row => {
    const lastmod = row.lastmod ? new Date(/[zZ]|[+-]\d\d:?\d\d$|T/.test(row.lastmod) ? row.lastmod : `${String(row.lastmod).replace(' ', 'T')}Z`) : null;
    return `<url><loc>${escape(absolute(baseUrl, `/${row.short_code}`))}</loc>${lastmod && !Number.isNaN(lastmod.getTime()) ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  });
  return `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
}

function sitemapIndex(locations) {
  return `${XML}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations.map(loc => `<sitemap><loc>${escape(loc)}</loc></sitemap>`).join('')}</sitemapindex>`;
}

function robotsTxt(baseUrl) {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /dl/', `Sitemap: ${baseUrl.replace(/\/$/, '')}/sitemap.xml`, ''].join('\n');
}

module.exports = { PAGE_SIZE, copiesSitemap, mainSitemap, robotsTxt, sitemapIndex };
