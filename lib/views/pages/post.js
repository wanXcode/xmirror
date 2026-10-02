const { html, jsonForScript, raw } = require('../html');
const icons = require('../components/icons');
const illustrations = require('../components/illustrations');
const { renderFinder } = require('../components/finder');
const { formatDate } = require('../../format-date');
const { localDownloads } = require('../../post-view');
const { fill } = require('../../text');
const { pagePath } = require('../../pages');

const AUTHOR_FALLBACK = '';

function avatar(view) {
  return view.author.avatar
    ? html`<img class="card__avatar" src="${view.author.avatar}" alt="" width="36" height="36" loading="lazy" referrerpolicy="no-referrer">`
    : html`<span class="card__avatar card__avatar--blank"></span>`;
}

function videoBlock(video, label, t) {
  if (video.state === 'ready') {
    return html`<div class="post__media"><div class="preview preview--post"><video class="preview__video preview__video--static" ${video.isGif ? html`autoplay loop muted playsinline` : html`controls playsinline preload="metadata"`}${video.poster ? html` poster="${video.poster}"` : ''} aria-label="${label}"><source src="${video.src}" type="video/mp4"></video></div></div>`;
  }
  if (video.state === 'pending') return html`<p class="note note--pending" role="status" data-video-pending>${icons.clock(16)}<span>${t('post.videoPending')}</span></p>`;
  if (video.state === 'failed') return html`<p class="note">${icons.info(16)}<span>${t('post.videoFailed')}</span></p>`;
  return '';
}

function mediaBlocks(view, t) {
  const gallery = view.images.length ? html`<div class="post__media"><div class="photos photos--${Math.min(view.images.length, 4)}">${view.images.map((image, index) => html`<div class="photo"><button class="photo__open" type="button" data-lightbox="${index}" aria-label="${fill(t('result.openPhoto'), { n: index + 1 })}"><img src="${image.src}" alt="${fill(t('post.photoOf'), { n: index + 1 })}" loading="${index === 0 && !view.video.src ? 'eager' : 'lazy'}" decoding="async"></button></div>`)}</div></div>` : '';
  return html`${videoBlock(view.video, view.author.name, t)}${view.extraVideos.map(video => videoBlock({ ...video, poster: null }, view.author.name, t))}${gallery}`;
}

function metaLine(view, lang, t) {
  const saved = formatDate(view.savedAt, lang);
  const posted = formatDate(view.postedAt, lang);
  const left = posted ? fill(t('post.postedAndSaved'), { posted, saved }) : fill(t('post.savedOnly'), { saved });
  const replies = view.replies === null ? '' : fill(view.replies === 1 ? t('post.replyOne') : t('post.replyMany'), { n: view.replies.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') });
  return html`<div class="post__meta"><span>${left}</span>${replies ? html`<span>${replies}</span>` : ''}</div>`;
}

function actions(view, t) {
  return html`<div class="post__actions">
  <button class="btn btn--primary btn--small" type="button" data-share>
    <span class="only-wide">${icons.link(18)}<span>${t('post.copyLink')}</span></span><span class="only-narrow">${icons.share(18)}<span>${t('post.shareLink')}</span></span>
  </button>
  ${view.hasMedia ? html`<button class="btn btn--plain btn--small" type="button" data-open-drawer aria-haspopup="dialog">${icons.download(18)}<span>${t('post.downloadMedia')}</span></button>` : ''}
  <a class="btn btn--plain btn--small" href="${view.url}" target="_blank" rel="noopener noreferrer"><span>${t('post.openOnX')}</span>${icons.external(16)}</a>
</div>
<p class="post__note">${t('post.savedNote')}</p>`;
}

/** The reading card: author, full text, media, dates, actions. `featured` makes the name a plain line (the page H1 is the AI title). */
function postCard({ t, lang, view, featured = false }) {
  const name = html`<span class="post__name">${view.author.name || AUTHOR_FALLBACK}</span> <span class="post__suffix">${t('post.h1Suffix')}</span>`;
  return html`<article class="post" data-post>
  <header class="post__head">${avatar(view)}<div class="post__who">${featured ? html`<p class="post__title">${name}</p>` : html`<h1 class="post__title">${name}</h1>`}<p class="post__handle">@${view.author.handle}</p></div></header>
  <div class="post__text">${raw(view.textHtml)}</div>
  ${mediaBlocks(view, t)}
  ${metaLine(view, lang, t)}
  ${actions(view, t)}
</article>`;
}

function sensitiveCard({ t, lang, view }) {
  return html`<article class="post post--locked" data-post>
  <header class="post__head">${avatar(view)}<div class="post__who"><h1 class="post__title"><span class="post__name">${view.author.name}</span> <span class="post__suffix">${t('post.h1Suffix')}</span></h1><p class="post__handle">@${view.author.handle}</p></div></header>
  <div class="sensitive__cover">${icons.eyeOff(30)}<p class="sensitive__title">${t('input.sensitive.title')}</p><p class="sensitive__text">${t('input.sensitive.textView')}</p></div>
  <div class="sensitive__actions"><button class="btn btn--primary" type="button" data-age-confirm>${t('input.sensitive.confirm')}</button><a class="btn btn--outline" href="${pagePath('home', lang)}">${t('input.sensitive.back')}</a></div>
</article>`;
}

function drawer(t) {
  return html`<div class="sheet-overlay" hidden data-sheet-overlay></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden tabindex="-1" data-sheet>
  <div class="sheet__head"><h2 id="sheet-title">${t('post.drawerTitle')}<span class="sheet__count" data-sheet-count></span></h2><button class="drawer__close" type="button" aria-label="${t('post.close')}" data-sheet-close>${icons.close(20)}</button></div>
  <div class="sheet__body" data-sheet-body></div>
  <p class="sheet__foot">${t('post.drawerFoot')}</p>
</div>`;
}

function quickLinks(t, lang) {
  return html`<nav class="quick-links" aria-label="${t('ui.mainNav')}"><a class="btn btn--plain btn--small" href="${pagePath('home', lang)}">${icons.download(18)}<span>${t('nav.downloader')}</span></a><a class="btn btn--plain btn--small" href="${pagePath('viewer', lang)}">${icons.eye(18)}<span>${t('nav.viewer')}</span></a></nav>`;
}

function anotherPost({ t, lang, downloadBase }) {
  return html`<section class="another" aria-labelledby="another-h2">
  <h2 id="another-h2" class="section__title section__title--small">${t('post.another')}</h2>
  ${renderFinder({ t, lang, mode: 'home', empty: '', downloadBase, shortcutHref: pagePath('shortcut', lang) })}
  ${quickLinks(t, lang)}
</section>`;
}

// Client data for post-page.js. Local files are the fallback when the original cannot be fetched.
function postConfig({ t, lang, view, downloadBase, shareUrl, title, locked = false, extra = {} }) {
  const config = {
    id: view.id, code: view.code, url: view.url, shareUrl, title, lang, downloadBase,
    shortcutHref: pagePath('shortcut', lang),
    videoPending: view.video.state === 'pending' || view.extraVideos.some(v => v.state === 'pending'),
    // Nothing about the media is sent until the age check has been passed.
    photos: locked ? [] : view.images.map(image => ({ orig_url: image.src, url: image.src })),
    local: locked ? { videos: [], gifs: [], images: [] } : localDownloads(view),
    result: t('result'),
    text: Object.fromEntries(['drawerLoading', 'drawerLocalNote', 'drawerItems', 'linkCopied', 'linkCopiedToast'].map(key => [key, t(`post.${key}`)])),
    endpoints: { resolve: '/api/resolve', share: `/api/posts/${view.code}/share`, ageConfirm: '/api/age-confirm', mediaInfo: '/api/media-info', videoStatus: `/api/posts/${view.id}/video-status` },
    ...extra
  };
  return html`<script type="application/json" data-post-config>${jsonForScript(config)}</script>`;
}

function renderPost({ t, lang, view, downloadBase, ageConfirmed, shareUrl, title, featuredBody = null }) {
  if (view.sensitive && !ageConfirmed) {
    return html`<div class="page page--post">${sensitiveCard({ t, lang, view })}${postConfig({ t, lang, view, downloadBase, shareUrl, title, locked: true })}</div>`;
  }
  return html`<div class="page page--post${featuredBody ? ' page--featured' : ''}">
  ${featuredBody ? featuredBody.top : ''}
  ${postCard({ t, lang, view, featured: Boolean(featuredBody) })}
  ${featuredBody ? featuredBody.bottom : ''}
  ${anotherPost({ t, lang, downloadBase })}
  ${drawer(t)}
  <div class="pill-toast" role="status" hidden data-toast>${icons.link(16)}<span>${t('post.linkCopiedToast')}</span></div>
  ${postConfig({ t, lang, view, downloadBase, shareUrl, title })}
</div>`;
}

function renderRemoved({ t, lang, reference }) {
  return html`<div class="page page--post"><div class="status-card status-card--error status-card--wide" role="status">
  <span class="status-card__icon">${icons.info(20)}</span>
  <div class="status-card__body"><h1 class="status-card__title">${t('post.removedTitle')}</h1>
  <p class="status-card__text">${t('post.removedText')}${reference ? ` ${fill(t('post.removedRef'), { ref: reference })}` : ''}</p>
  <div class="status-card__actions"><a class="btn btn--plain btn--small" href="${pagePath('home', lang)}">${t('post.backToXPut')}</a></div></div>
</div></div>`;
}

function renderNotFound({ t, lang, downloadBase }) {
  return html`<div class="page page--post"><section class="notfound">
  ${illustrations.read(200)}
  <h1 class="notfound__title">${t('post.notFoundTitle')}</h1>
  <p class="notfound__text">${t('post.notFoundText')}</p>
  ${renderFinder({ t, lang, mode: 'home', empty: '', downloadBase, shortcutHref: pagePath('shortcut', lang) })}
</section></div>`;
}

module.exports = { drawer, anotherPost, postCard, postConfig, renderNotFound, renderPost, renderRemoved };
