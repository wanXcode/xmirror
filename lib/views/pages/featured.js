const { socialMediaPosting } = require('../seo-head');
const { html } = require('../html');
const icons = require('../components/icons');
const { createTranslator } = require('../../i18n');
const { formatDate } = require('../../format-date');
const { fill } = require('../../text');
const { pagePath } = require('../../pages');
const { isLocalMedia } = require('../../post-view');

// Featured pages (docs/design W_Featured*): the saved post plus an XPut summary, context and key points.
// The AI-written parts and their headings use the post's own language, fixed per page, so search
// engines and every visitor see the same words; only buttons and the site chrome follow the visitor.

function relatedCard(item, contentT, contentLang) {
  let thumb = '';
  try {
    const first = JSON.parse(item.images || '[]').find(isLocalMedia) || (isLocalMedia(item.video_poster) ? item.video_poster : null);
    thumb = first ? html`<img src="${first}" alt="" loading="lazy">` : '';
  } catch { /* no thumbnail */ }
  return html`<li><a class="related__card" href="/${item.short_code}"><span class="related__thumb">${thumb}</span><span class="related__body"><strong>${item.ai_title}</strong><span>@${item.author_handle} · ${formatDate(item.tweet_time || item.created_at, contentLang)}</span></span></a></li>`;
}

function buildFeaturedParts({ t, lang, view, row, post, related }) {
  const contentLang = row.lang || 'en';
  const c = createTranslator(contentLang);
  const savedDate = formatDate(view.savedAt, contentLang);
  const updated = formatDate(row.ai_generated_at, contentLang);
  const topic = row.topic || '';
  const moreHeading = topic ? fill(c('featured.moreFrom'), { author: view.author.name, topic }) : fill(c('featured.moreFromAuthor'), { author: view.author.name });

  const top = html`<nav class="breadcrumb" aria-label="${c('featured.breadcrumbLabel')}"><a href="${pagePath('home', lang)}">XPut</a><span aria-hidden="true">›</span><a href="${pagePath('browse', lang)}">${c('featured.breadcrumbSaved')}</a>${topic ? html`<span aria-hidden="true">›</span><span>${topic}</span>` : ''}</nav>
<header class="featured__head">
  <h1 class="featured__title">${row.ai_title}</h1>
  <p class="featured__saved">${fill(c('featured.savedFrom'), { date: savedDate })}</p>
  <p class="featured__label">${icons.external(16)}<span>${c('featured.originalLabel')}</span></p>
</header>`;

  const bottom = html`<section class="xput-notes" lang="${contentLang === 'zh' ? 'zh-Hans' : contentLang}" aria-label="${c('featured.tag')}">
  <div class="xput-notes__top"><span class="xput-notes__tag">${icons.info(16)}<span>${c('featured.tag')}</span></span><span class="xput-notes__disclaimer">${fill(c('featured.disclaimer'), { date: updated })}</span></div>
  <h2>${c('featured.summary')}</h2>
  <p>${row.summary}</p>
  <h2>${c('featured.context')}</h2>
  <p>${row.context}</p>
  <h2>${c('featured.keyPoints')}</h2>
  <ul>${row.key_points.map(point => html`<li>${point}</li>`)}</ul>
  <p class="xput-notes__report">${c('featured.spot')} <a href="/report?post=${view.code}">${c('featured.reportIt')}</a></p>
</section>
${related.length ? html`<section class="related" aria-labelledby="related-h2"><h2 id="related-h2" class="section__title section__title--small">${moreHeading}</h2><ul class="related__list">${related.map(item => relatedCard(item, c, contentLang))}</ul></section>` : ''}`;

  const structuredData = baseUrl => socialMediaPosting({
    baseUrl, view, headline: row.ai_title, description: row.summary, topic,
    inLanguage: contentLang === 'zh' ? 'zh-Hans' : contentLang, modifiedAt: row.updated_at
  });

  return { top, bottom, structuredData };
}

module.exports = { buildFeaturedParts };
