const { html } = require('../html');
const { pagePath } = require('../../pages');
const { formatDate } = require('../../format-date');
const { fill } = require('../../text');

// "Worth reading": the public list of indexable saved copies (AI featured pages and archives picked by the SEO mechanism).
function renderBrowse({ t, lang, items, query, page, hasMore }) {
  const copy = t('pages.browse');
  const base = pagePath('browse', lang);
  const href = target => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (target > 1) params.set('page', String(target));
    const search = params.toString();
    return `${base}${search ? `?${search}` : ''}`;
  };
  const list = items.length
    ? html`<ul class="saved-list">${items.map(item => html`<li class="saved-item"><a class="saved-item__link" href="/${item.code}"><strong class="saved-item__title">${item.title}</strong><span class="saved-item__meta">${item.author}${item.handle ? ` · @${item.handle}` : ''}${item.date ? ` · ${formatDate(item.date, lang)}` : ''}</span></a></li>`)}</ul>`
    : html`<p class="saved-empty">${query ? fill(copy.emptySearch, { q: query }) : copy.emptyAll}</p>`;
  const pager = (page > 1 || hasMore)
    ? html`<nav class="pager" aria-label="${copy.pagination}">${page > 1 ? html`<a class="btn btn--plain btn--small" href="${href(page - 1)}" rel="prev">${copy.prev}</a>` : html`<span></span>`}<span class="pager__page">${fill(copy.pageN, { n: page })}</span>${hasMore ? html`<a class="btn btn--plain btn--small" href="${href(page + 1)}" rel="next">${copy.next}</a>` : html`<span></span>`}</nav>`
    : '';
  return html`<div class="page page--browse">
  <header class="browse__head">
    <h1 class="browse__title">${copy.h1}</h1>
    <p class="browse__subtitle">${copy.subtitle}</p>
    <form class="browse__search" action="${base}" method="get" role="search">
      <label class="visually-hidden" for="browse-q">${copy.searchLabel}</label>
      <input class="field__input" id="browse-q" type="search" name="q" value="${query}" maxlength="100" placeholder="${copy.placeholder}" autocomplete="off">
      <button class="btn btn--primary" type="submit"><span class="btn__label">${copy.search}</span></button>
    </form>
    ${query ? html`<p class="browse__summary">${fill(copy.resultsFor, { q: query })} · <a class="text-link" href="${base}">${copy.clear}</a></p>` : ''}
  </header>
  ${list}
  ${pager}
</div>`;
}

module.exports = { renderBrowse };
