const { html } = require('../html');
const icons = require('../components/icons');
const illustrations = require('../components/illustrations');
const { renderFinder } = require('../components/finder');
const { banner, faq, featureGrid, hero, prose, steps } = require('../components/sections');
const { pagePath } = require('../../pages');

// No account search, profile browsing or timeline anywhere on this page (spec 7.2).
function renderViewer({ t, lang, downloadBase }) {
  const page = t('pages.viewer');

  const empty = html`<div class="empty">
    ${illustrations.read(200)}
    <p class="empty__title">${page.empty.title}</p>
    <p class="empty__text">${page.empty.text}</p>
  </div>`;

  return html`<div class="page page--tool">
  <div class="tool">
    ${hero(page)}
    ${renderFinder({ t, lang, mode: 'viewer', empty, downloadBase, shortcutHref: pagePath('shortcut', lang) })}
  </div>
  ${steps(page.steps)}
  ${featureGrid({ id: 'anonymous-h2', h2: page.anonymous.h2, items: page.anonymous.items, notes: page.anonymous.notes, icon: [icons.shield, icons.eye, icons.share, icons.info] })}
  <section class="section" aria-labelledby="lasting-h2">
    <h2 id="lasting-h2" class="section__title">${page.lasting.h2}</h2>
    ${prose(page.lasting.paragraphs)}
  </section>
  ${banner({ ...page.banner, href: pagePath('home', lang), icon: icons.download })}
  ${faq(page.faq)}
</div>`;
}

module.exports = { renderViewer };
