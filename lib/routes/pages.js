const { renderDocument } = require('../views/layout');
const { createTranslator, enabledLanguages } = require('../i18n');
const { PAGES, pagePath } = require('../pages');
const { renderShell } = require('../views/pages/shell');

// page key -> body renderer. Pages not listed here are not served by this router
// (privacy/report keep their current handlers until their templates exist).
const RENDERERS = {
  home: renderShell,
  viewer: renderShell,
  shortcut: renderShell
};

/**
 * Register fixed, language-prefixed pages. These must be registered before the
 * 6-character short code route so that a fixed path always wins.
 * `skip` lists paths another handler still owns (e.g. the current home page).
 */
function registerPageRoutes(app, { baseUrl, skip = [] }) {
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
          body: render({ t, lang: language.code, page })
        });
        res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(String(document));
      });
    }
  }
}

module.exports = { RENDERERS, registerPageRoutes, pagePath };
