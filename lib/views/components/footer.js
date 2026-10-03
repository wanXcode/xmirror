const { html } = require('../html');
const { enabledLanguages } = require('../../i18n');
const { pagePath } = require('../../pages');

function renderFooter({ lang, t, switchHref }) {
  const links = [
    [t('nav.downloader'), pagePath('home', lang)],
    [t('nav.viewer'), pagePath('viewer', lang)],
    [t('nav.shortcut'), pagePath('shortcut', lang)],
    [t('footer.browse'), pagePath('browse', lang)],
    ...enabledLanguages().map(language => [language.label, switchHref(language.code), language]),
    [t('footer.privacy'), pagePath('privacy', lang)],
    [t('footer.report'), pagePath('report', lang)]
  ];

  return html`<footer class="site-footer">
  <div class="site-footer__inner">
    <div class="site-footer__about">
      <span class="site-footer__brand">XPut</span>
      <p>${t('footer.tagline')}</p>
      <p class="site-footer__legal">${t('footer.notAffiliated')}</p>
    </div>
    <nav class="site-footer__links" aria-label="XPut">${links.map(([label, href, language]) => html`<a href="${href}"${language ? html` hreflang="${language.hreflang}" lang="${language.htmlLang}"` : ''}>${label}</a>`)}</nav>
  </div>
</footer>`;
}

module.exports = { renderFooter };
