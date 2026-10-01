const site = require('../../config/site.json');
const { version: APP_VERSION } = require('../../package.json');
const { html, raw } = require('./html');
const { createTranslator, enabledLanguages, getLanguage } = require('../i18n');
const { pagePath } = require('../pages');
const { renderFooter } = require('./components/footer');
const { renderHeader } = require('./components/header');
const { jsonLd } = require('./seo-head');
const { organization } = require('./page-seo');

function absolute(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Wrap page content in the shared document shell.
 *
 * page:      key from lib/pages.js for fixed pages (enables hreflang + nav highlight); null for others
 * path:      this page's own path (canonical); defaults to the fixed page path
 * switchHref(code): where the language links point; defaults to the same fixed page in `code`
 * head:      extra, already-escaped <head> content (structured data, OG tags)
 * scripts:   extra page scripts (paths), loaded deferred after nav.js, in order
 */
function renderDocument({
  lang,
  baseUrl,
  page = null,
  path,
  title,
  description = '',
  robots = 'index, follow',
  current = null,
  switchHref,
  alternates = true,
  head = '',
  scripts = [],
  body
}) {
  const language = getLanguage(lang);
  if (!language) throw new Error(`Unsupported language: ${lang}`);
  const t = createTranslator(lang);
  const ownPath = path || (page ? pagePath(page, lang) : '/');
  const toLang = switchHref || (page ? code => pagePath(page, code) : () => ownPath);
  const canonical = absolute(baseUrl, ownPath);
  const hreflangs = page && alternates
    ? [...enabledLanguages().map(item => ({ code: item.hreflang, href: absolute(baseUrl, pagePath(page, item.code)) })),
      { code: 'x-default', href: absolute(baseUrl, pagePath(page, 'en')) }]
    : [];
  const navCurrent = current ?? (page ? require('../pages').PAGES[page].nav : null);

  return html`<!doctype html>
<html lang="${language.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description ? html`<meta name="description" content="${description}">` : ''}
<meta name="robots" content="${robots}">
<link rel="canonical" href="${canonical}">
${hreflangs.map(item => html`<link rel="alternate" hreflang="${item.code}" href="${item.href}">`)}
<meta name="google-site-verification" content="${site.googleSiteVerification}">
<meta name="theme-color" content="#FBF7F0">
<link rel="icon" href="/favicon.ico?v=${site.iconVersion}" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon.svg?v=${site.iconVersion}" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${site.iconVersion}">
<link rel="manifest" href="/site.webmanifest?v=${site.iconVersion}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${site.fonts}">
<link rel="stylesheet" href="/css/xput.css?v=${APP_VERSION}">
${typeof head === 'string' ? raw(head) : head}
${jsonLd(organization(baseUrl))}
<script defer data-domain="${site.analytics.domain}" src="${site.analytics.src}"></script>
</head>
<body>
<a class="skip-link" href="#main">${t('ui.skipToContent')}</a>
${renderHeader({ lang, t, current: navCurrent, switchHref: toLang })}
<main id="main" class="site-main">${body}</main>
${renderFooter({ lang, t, switchHref: toLang })}
<script src="/js/nav.js?v=${APP_VERSION}" defer></script>
${scripts.map(src => html`<script src="${src}?v=${APP_VERSION}" defer></script>`)}
</body>
</html>`;
}

module.exports = { renderDocument };
