const { html } = require('../html');
const { enabledLanguages, LANGUAGES, getLanguage } = require('../../i18n');
const { pagePath } = require('../../pages');
const icons = require('./icons');
const { logoMark } = require('./logo');

// Header nav items in the order the design shows them. `shortcut` appears only
// in the mobile drawer and the footer.
const NAV_ITEMS = [
  { key: 'downloader', page: 'home', icon: 'download', header: true },
  { key: 'viewer', page: 'viewer', icon: 'eye', header: true },
  { key: 'shortcut', page: 'shortcut', icon: 'phone', header: false }
];

function languageList({ lang, t, switchHref, idPrefix }) {
  return html`<ul class="lang__list" id="${idPrefix}-list">${LANGUAGES.map(language => {
    const current = language.code === lang;
    if (!language.enabled) {
      return html`<li><span class="lang__item is-disabled" aria-disabled="true"><span class="lang__text"><span class="lang__name">${language.label}</span><span class="lang__sub">${language.english} · ${t('ui.comingSoon')}</span></span></span></li>`;
    }
    return html`<li><a class="lang__item${current ? ' is-current' : ''}" href="${switchHref(language.code)}" hreflang="${language.hreflang}" lang="${language.htmlLang}"${current ? html` aria-current="true"` : ''}><span class="lang__text"><span class="lang__name">${language.label}</span><span class="lang__sub">${language.english}</span></span>${current ? icons.check() : ''}</a></li>`;
  })}</ul>`;
}

/**
 * Site header: logo, nav, language switcher (dropdown on desktop, bottom sheet
 * on phones) and the mobile menu drawer. Every language entry is a real link;
 * nav.js only toggles visibility.
 *
 * current: the nav key to highlight ('downloader' | 'viewer' | 'shortcut' | null)
 * switchHref(code): URL of this same page in another language
 */
function renderHeader({ lang, t, current = null, switchHref }) {
  const active = getLanguage(lang) || enabledLanguages()[0];
  const homeHref = pagePath('home', lang);
  const link = (item, className) => html`<a class="${className}${current === item.key ? ' is-active' : ''}" href="${pagePath(item.page, lang)}"${current === item.key ? html` aria-current="page"` : ''}>`;

  return html`<header class="site-header">
  <div class="site-header__inner">
    <div class="site-header__start">
      <a class="brand" href="${homeHref}" aria-label="XPut">${logoMark(32)}<span class="brand__name">XPut</span></a>
      <nav class="site-nav" aria-label="${t('ui.mainNav')}">${NAV_ITEMS.filter(item => item.header).map(item => html`${link(item, 'nav-link')}${t(`nav.${item.key}`)}</a>`)}</nav>
    </div>
    <div class="site-header__end">
      <div class="lang" data-lang>
        <button class="lang__button" type="button" aria-expanded="false" aria-controls="lang-panel" data-lang-toggle>${icons.globe()}<span class="lang__current">${active.label}</span>${icons.chevronDown()}</button>
        <div class="lang__panel" id="lang-panel" role="group" aria-label="${t('ui.language')}" hidden data-lang-panel>
          <span class="lang__grab" aria-hidden="true"></span>
          <p class="lang__title">${t('ui.language')}</p>
          ${languageList({ lang, t, switchHref, idPrefix: 'lang-panel' })}
        </div>
      </div>
      <button class="menu-button" type="button" aria-label="${t('ui.menu')}" aria-expanded="false" aria-controls="nav-drawer" data-menu-toggle>${icons.menu()}</button>
    </div>
  </div>
</header>
<div class="overlay" hidden data-overlay></div>
<aside class="drawer" id="nav-drawer" aria-label="${t('ui.menu')}" hidden data-drawer>
  <div class="drawer__top">
    <a class="brand" href="${homeHref}" aria-label="XPut">${logoMark(32)}<span class="brand__name">XPut</span></a>
    <button class="drawer__close" type="button" aria-label="${t('ui.closeMenu')}" data-menu-close>${icons.close()}</button>
  </div>
  <nav class="drawer__nav" aria-label="${t('ui.mainNav')}">${NAV_ITEMS.map(item => html`${link(item, 'drawer__link')}${icons[item.icon]()}<span>${t(`nav.${item.key}`)}</span></a>`)}</nav>
  <div class="drawer__lang">
    <p class="lang__title">${t('ui.language')}</p>
    ${languageList({ lang, t, switchHref, idPrefix: 'drawer-lang' })}
  </div>
</aside>`;
}

module.exports = { NAV_ITEMS, renderHeader };
