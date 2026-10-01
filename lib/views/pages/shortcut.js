const { html, raw } = require('../html');
const icons = require('../components/icons');
const { banner, faq, hero, steps } = require('../components/sections');
const { pagePath } = require('../../pages');
const { qrSvg } = require('../../qr');

// iPhone Shortcut page: phones get the button, desktops get a QR code for the same iCloud link.
function renderShortcut({ t, lang, shortcutUrl }) {
  const page = t('pages.shortcut');
  const get = page.get;
  return html`<div class="page page--shortcut">
  <div class="tool">${hero(page)}</div>
  <section class="get" aria-label="${get.button}">
    <div class="get__phone only-narrow">
      <a class="btn btn--primary get__button" href="${shortcutUrl}" rel="noopener">${icons.download(18)}<span class="btn__label">${get.button}</span></a>
      <p class="get__note">${get.note}</p>
    </div>
    <div class="get__desktop only-wide-block" data-copy-root data-copied="${get.copied}">
      ${raw(qrSvg(shortcutUrl, { label: get.qrLabel, size: 160 }))}
      <div class="get__copy">
        <h2 class="get__title">${get.qrTitle}</h2>
        <p class="get__text">${get.qrText}</p>
        <div class="get__actions">
          <a class="btn btn--plain btn--small" href="${shortcutUrl}" rel="noopener">${icons.external(18)}<span>${get.open}</span></a>
          <button class="btn btn--plain btn--small" type="button" data-copy="${shortcutUrl}">${icons.link(18)}<span>${get.copy}</span></button>
        </div>
        <p class="get__status" role="status" aria-live="polite" data-copy-status></p>
      </div>
    </div>
  </section>
  ${steps({ ...page.steps, icons: [icons.download, icons.share, icons.image] })}
  ${banner({ ...page.banner, href: pagePath('home', lang), icon: icons.download })}
  ${faq(page.faq)}
</div>`;
}

module.exports = { renderShortcut };
