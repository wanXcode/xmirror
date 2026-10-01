const { renderDocument } = require('../views/layout');
const { createTranslator, enabledLanguages, negotiateLanguage } = require('../i18n');
const { PAGES, pagePath } = require('../pages');
const { renderShell } = require('../views/pages/shell');
const { renderHome } = require('../views/pages/home');
const { renderViewer } = require('../views/pages/viewer');
const { renderShortcut } = require('../views/pages/shortcut');
const { renderReport } = require('../views/pages/report');
const { renderPrivacy } = require('../views/pages/privacy');
const { renderPageNotFound } = require('../views/pages/not-found');


// page key -> body renderer. Pages not listed here are not served by this router
// (privacy/report keep their current handlers until their templates exist).
// Page scripts, in load order (finder.js needs link.js first).
const FINDER_SCRIPTS = ['/js/link.js', '/js/download.js', '/js/zip.js', '/js/result-card.js', '/js/finder.js'];
const SCRIPTS = { home: FINDER_SCRIPTS, viewer: FINDER_SCRIPTS, shortcut: ['/js/copy-link.js'], report: ['/js/report.js'] };
// The request form is not a page to land on from search.
const ROBOTS = { report: 'noindex, follow' };

const RENDERERS = {
  home: renderHome,
  viewer: renderViewer,
  shortcut: renderShortcut,
  report: renderReport,
  privacy: renderPrivacy
};

/**
 * Register fixed, language-prefixed pages. These must be registered before the
 * 6-character short code route so that a fixed path always wins.
 * `skip` lists paths another handler still owns (e.g. the current home page).
 */
function registerPageRoutes(app, { baseUrl, skip = [], downloadBase = '/dl', shortcutUrl = '' }) {
  // "/zh" -> "/zh/" so every language home has one canonical URL.
  for (const language of enabledLanguages().filter(item => item.prefix)) {
    // Express matches "/zh/" with this route too, so only redirect the bare form.
    app.get(language.prefix, (req, res, next) => (req.path === language.prefix ? res.redirect(301, `${language.prefix}/`) : next()));
  }

  for (const [page, entry] of Object.entries(PAGES)) {
    const render = RENDERERS[page];
    if (!render) continue;
    for (const language of enabledLanguages()) {
      const path = entry.paths[language.code];
      if (!path || skip.includes(path)) continue;
      app.get(path, (_req, res) => {
        const t = createTranslator(language.code);
        const document = renderDocument({
          lang: language.code,
          baseUrl,
          page,
          title: t(`pages.${page}.title`),
          description: t(`pages.${page}.description`),
          scripts: SCRIPTS[page] || [],
          robots: ROBOTS[page],
          body: render({ t, lang: language.code, page, downloadBase, shortcutUrl })
        });
        res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(String(document));
      });
    }
  }
}

/**
 * Last route: anything that matched nothing. API and asset paths get a plain 404; pages get the
 * friendly "Page not found" in the language of the URL prefix, the language cookie or the browser.
 */
function registerNotFound(app, { baseUrl, downloadBase = '/dl' }) {
  app.use((req, res) => {
    const wantsPage = (req.method === 'GET' || req.method === 'HEAD') && !/^\/(api|dl|og|images|videos|subtitles|js|css)\//.test(req.path) && !/\.[A-Za-z0-9]{2,5}$/.test(req.path);
    if (!wantsPage) return res.status(404).type('text/plain').send('Not found');
    const prefixed = enabledLanguages().find(language => language.prefix && (req.path === language.prefix || req.path.startsWith(`${language.prefix}/`)));
    const code = prefixed ? prefixed.code : negotiateLanguage(req);
    const t = createTranslator(code);
    const document = renderDocument({
      lang: code, baseUrl, page: null, path: prefixed ? `${prefixed.prefix}/` : '/', title: t('pages.notFound.title'), robots: 'noindex, follow',
      scripts: FINDER_SCRIPTS, body: renderPageNotFound({ t, lang: code, downloadBase }), switchHref: language => (language === 'zh' ? '/zh/' : '/')
    });
    res.set({ 'Cache-Control': 'no-store', Vary: 'Cookie, Accept-Language' }).status(404).type('html').send(String(document));
  });
}

module.exports = { RENDERERS, registerNotFound, registerPageRoutes, pagePath };
