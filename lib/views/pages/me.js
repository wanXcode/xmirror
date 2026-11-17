const { html } = require('../html');
const { pagePath } = require('../../pages');
const { formatDate } = require('../../format-date');
const { fill } = require('../../text');

function renderLogin({ t, googleEnabled, loginFailed, loginHref }) {
  const copy = t('pages.me');
  return html`<section class="me-card" aria-labelledby="me-login">
    <h2 class="me-card__title" id="me-login">${copy.login.h2}</h2>
    <p class="me-card__text">${copy.login.text}</p>
    ${loginFailed ? html`<p class="me-note me-note--error" role="alert">${copy.login.failed}</p>` : ''}
    ${googleEnabled
    ? html`<p><a class="btn btn--primary" href="${loginHref}"><span class="btn__label">${copy.login.button}</span></a></p>`
    : html`<p class="me-note">${copy.login.unavailable}</p>`}
    <p class="me-card__hint">${copy.login.privacy}</p>
  </section>`;
}

function renderMe(view) {
  const { t, lang } = view;
  const copy = t('pages.me');
  const header = html`<header class="browse__head">
    <h1 class="browse__title">${copy.h1}</h1>
    <p class="browse__subtitle">${copy.subtitle}</p>
  </header>`;
  if (!view.signedIn) return html`<div class="page page--browse page--me">${header}${renderLogin(view)}</div>`;

  const { query, page, hasMore, items, total, keyLast4, user, baseUrl } = view;
  const base = pagePath('me', lang);
  const href = target => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (target > 1) params.set('page', String(target));
    const search = params.toString();
    return `${base}${search ? `?${search}` : ''}`;
  };
  const list = items.length
    ? html`<ul class="saved-list">${items.map(item => html`<li class="saved-item me-item">
        <a class="saved-item__link" href="/${item.code}"><strong class="saved-item__title">${item.title}</strong><span class="saved-item__meta">${item.author}${item.handle ? ` · @${item.handle}` : ''}${item.date ? ` · ${fill(copy.list.savedOn, { date: formatDate(item.date, lang) })}` : ''}</span></a>
        <button class="btn btn--plain btn--small me-item__remove" type="button" data-me-remove="${item.code}">${copy.list.remove}</button>
      </li>`)}</ul>`
    : html`<p class="saved-empty">${query ? fill(copy.list.emptySearch, { q: query }) : copy.list.emptyAll}</p>`;
  const pager = (page > 1 || hasMore)
    ? html`<nav class="pager" aria-label="${copy.list.pagination}">${page > 1 ? html`<a class="btn btn--plain btn--small" href="${href(page - 1)}" rel="prev">${copy.list.prev}</a>` : html`<span></span>`}<span class="pager__page">${fill(copy.list.pageN, { n: page })}</span>${hasMore ? html`<a class="btn btn--plain btn--small" href="${href(page + 1)}" rel="next">${copy.list.next}</a>` : html`<span></span>`}</nav>`
    : '';

  return html`<div class="page page--browse page--me" data-me data-quick-base="${String(baseUrl).replace(/\/$/, '')}"
    data-copied="${copy.key.copied}" data-key-failed="${copy.key.failed}" data-claim-failed="${copy.claim.failed}"
    data-claim-result="${copy.claim.result}" data-list-failed="${copy.list.failed}" data-url-label="${copy.key.urlLabel}">
  ${header}
  <section class="me-card" aria-label="${user.name || ''}">
    <p class="me-card__text">${fill(copy.account.signedInAs, { name: user.name || user.email || '' })}${user.email && user.name ? ` · ${user.email}` : ''}</p>
    <p><button class="btn btn--plain btn--small" type="button" data-me-logout>${copy.account.logout}</button></p>
  </section>

  <section class="me-card" aria-labelledby="me-key">
    <h2 class="me-card__title" id="me-key">${copy.key.h2}</h2>
    <p class="me-card__text">${copy.key.text}</p>
    <p class="me-card__hint">${keyLast4 ? fill(copy.key.current, { last4: keyLast4 }) : copy.key.none}</p>
    ${keyLast4 ? html`<p class="me-card__hint">${copy.key.rotateNote}</p>` : ''}
    <p><button class="btn btn--primary btn--small" type="button" data-me-key><span class="btn__label">${keyLast4 ? copy.key.rotate : copy.key.generate}</span></button></p>
    <div class="me-secret" data-me-secret hidden>
      <p class="me-card__hint">${copy.key.shownTitle}</p>
      <div class="me-secret__row"><code class="me-secret__code" data-me-key-value></code><button class="btn btn--plain btn--small" type="button" data-me-copy="key">${copy.key.copy}</button></div>
      <p class="me-card__hint">${copy.key.urlLabel}</p>
      <div class="me-secret__row"><code class="me-secret__code" data-me-url-value></code><button class="btn btn--plain btn--small" type="button" data-me-copy="url">${copy.key.copy}</button></div>
    </div>
    <p class="me-note me-note--error" role="alert" data-me-key-error hidden></p>
  </section>

  <section class="me-card" aria-labelledby="me-claim">
    <h2 class="me-card__title" id="me-claim">${copy.claim.h2}</h2>
    <p class="me-card__text">${copy.claim.text}</p>
    <textarea class="field__input field__input--area" data-me-claim-text rows="4" maxlength="20000" placeholder="${copy.claim.placeholder}" aria-labelledby="me-claim"></textarea>
    <p><button class="btn btn--primary btn--small" type="button" data-me-claim><span class="btn__label">${copy.claim.button}</span></button></p>
    <p class="me-note" role="status" data-me-claim-status hidden></p>
  </section>

  <section aria-labelledby="me-list">
    <h2 class="me-card__title" id="me-list">${copy.list.h2} <span class="me-count">${fill(copy.list.count, { n: total })}</span></h2>
    <form class="browse__search" action="${base}" method="get" role="search">
      <label class="visually-hidden" for="me-q">${copy.list.searchLabel}</label>
      <input class="field__input" id="me-q" type="search" name="q" value="${query}" maxlength="100" placeholder="${copy.list.placeholder}" autocomplete="off">
      <button class="btn btn--primary" type="submit"><span class="btn__label">${copy.list.search}</span></button>
    </form>
    ${query ? html`<p class="browse__summary"><a class="text-link" href="${base}">${copy.list.clear}</a></p>` : ''}
    <p class="me-note me-note--error" role="alert" data-me-list-error hidden></p>
    ${list}
    ${pager}
  </section>
</div>`;
}

module.exports = { renderMe };
