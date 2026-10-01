const { html } = require('../html');
const icons = require('../components/icons');
const { pagePath } = require('../../pages');
const { formatDate } = require('../../format-date');
const { fill } = require('../../text');

function renderPrivacy({ t, lang }) {
  const page = t('pages.privacy');
  const updated = formatDate(page.updatedOn, lang);
  return html`<div class="page page--privacy">
  <div class="legal">
    <nav class="legal__toc" aria-label="${page.toc}"><p class="legal__toc-title">${page.toc}</p>
      <ul>${page.sections.map(section => html`<li><a href="#${section.id}">${section.title}</a></li>`)}</ul></nav>
    <article class="legal__body">
      <h1 class="legal__title">${page.h1}</h1>
      <p class="legal__updated">${fill(page.updated, { date: updated })}</p>
      <aside class="legal__short"><h2>${page.short.title}</h2>
        <ul>${page.short.items.map(item => html`<li>${icons.shield(16)}<span>${item}</span></li>`)}</ul></aside>
      ${page.sections.map(section => html`<section class="legal__section" id="${section.id}"><h2>${section.title}</h2>
        ${section.paragraphs.map(text => html`<p>${text}</p>`)}
        ${section.link ? html`<p><a class="text-link" href="${pagePath(section.link.href, lang)}">${section.link.label}</a></p>` : ''}</section>`)}
    </article>
  </div>
</div>`;
}

module.exports = { renderPrivacy };
