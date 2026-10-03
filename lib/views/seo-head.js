const { html, raw, jsonForScript } = require('./html');

const LOCALES = { en: 'en_US', zh: 'zh_CN', 'pt-BR': 'pt_BR' };

/** Open Graph + Twitter Card tags (already escaped; pass as `head` to renderDocument). */
function socialTags({ title, description, url, image, type = 'website', lang = 'en', publishedTime = null, imageAlt = '' }) {
  return html`<meta property="og:site_name" content="XPut">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${title}">
${description ? html`<meta property="og:description" content="${description}">` : ''}
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${LOCALES[lang] || 'en_US'}">
${image ? html`<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${imageAlt ? html`<meta property="og:image:alt" content="${imageAlt}">` : ''}` : ''}
${publishedTime ? html`<meta property="article:published_time" content="${publishedTime}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
${description ? html`<meta name="twitter:description" content="${description}">` : ''}
${image ? html`<meta name="twitter:image" content="${image}">` : ''}`;
}

function jsonLd(data) {
  return html`<script type="application/ld+json">${jsonForScript(data)}</script>`;
}

/** schema.org SocialMediaPosting for a saved copy: a reposted social post that points back at the original. */
function socialMediaPosting({ baseUrl, view, headline, description, inLanguage = 'en', topic = '', modifiedAt = null }) {
  const root = baseUrl.replace(/\/$/, '');
  const url = `${root}/${view.code}`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    '@id': `${url}#post`,
    headline,
    url,
    mainEntityOfPage: url,
    inLanguage,
    description,
    articleBody: view.plainText,
    author: { '@type': 'Person', name: view.author.name, alternateName: `@${view.author.handle}`, url: `https://x.com/${view.author.handle}` },
    sharedContent: { '@type': 'WebPage', url: view.url },
    isBasedOn: view.url,
    publisher: { '@type': 'Organization', name: 'XPut', url: root }
  };
  if (view.postedAt) data.datePublished = view.postedAt;
  if (modifiedAt) data.dateModified = new Date(`${String(modifiedAt).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(modifiedAt)) ? '' : 'Z'}`).toISOString();
  if (view.replies !== null) data.commentCount = view.replies;
  if (topic) data.about = { '@type': 'Thing', name: topic };
  return data;
}

module.exports = { jsonLd, raw, socialMediaPosting, socialTags };
