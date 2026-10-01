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

module.exports = { jsonLd, raw, socialTags };
