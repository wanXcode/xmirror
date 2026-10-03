const { html } = require('../html');
const illustrations = require('../components/illustrations');
const { renderFinder } = require('../components/finder');
const { pagePath } = require('../../pages');

// Any URL that matches nothing. (A mistyped saved-post code has its own page.)
function renderPageNotFound({ t, lang, downloadBase }) {
  const page = t('pages.notFound');
  return html`<div class="page page--post"><section class="notfound">
  ${illustrations.read(200)}
  <h1 class="notfound__title">${page.h1}</h1>
  <p class="notfound__text">${page.text}</p>
  ${renderFinder({ t, lang, mode: 'home', empty: '', downloadBase, shortcutHref: pagePath('shortcut', lang) })}
  <p class="notfound__links"><a class="text-link" href="${pagePath('home', lang)}">${t('nav.downloader')}</a><a class="text-link" href="${pagePath('viewer', lang)}">${t('nav.viewer')}</a></p>
</section></div>`;
}

module.exports = { renderPageNotFound };
