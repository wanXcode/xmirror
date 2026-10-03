const { html } = require('../html');
const icons = require('../components/icons');
const illustrations = require('../components/illustrations');
const { renderFinder } = require('../components/finder');
const { banner, faq, featureGrid, hero, platformGuide, steps } = require('../components/sections');
const { pagePath } = require('../../pages');

function renderHome({ t, lang, downloadBase }) {
  const page = t('pages.home');
  const shortcutHref = pagePath('shortcut', lang);

  const empty = html`<div class="empty">
    ${illustrations.download(200)}
    <p class="empty__title">${page.empty.title}</p>
    <p class="empty__text">${page.empty.text}</p>
    <a class="text-link" href="${shortcutHref}"><span class="only-wide">${page.empty.shortcutDesktop}</span><span class="only-narrow">${page.empty.shortcutMobile}</span></a>
  </div>`;

  return html`<div class="page page--tool">
  <div class="tool">
    ${hero(page)}
    ${renderFinder({ t, lang, mode: 'home', empty, downloadBase, shortcutHref: pagePath('shortcut', lang) })}
  </div>
  ${steps(page.steps)}
  ${platformGuide({ ...page.phones, shortcutHref })}
  ${banner({ ...page.banner, href: pagePath('viewer', lang), icon: icons.eye })}
  ${featureGrid({ id: 'why-h2', h2: page.why.h2, items: page.why.items, notes: page.why.notes, icon: [icons.layers, icons.image, icons.shield, icons.clock] })}
  ${faq(page.faq)}
</div>`;
}

module.exports = { renderHome };
