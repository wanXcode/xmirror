const { html } = require('./html');
const { jsonLd, socialTags } = require('./seo-head');
const { pagePath } = require('../pages');

const absolute = (baseUrl, path) => new URL(path, baseUrl).href;
const SHARE_IMAGE = '/xput-share.png';

function organization(baseUrl) {
  return { '@context': 'https://schema.org', '@type': 'Organization', name: 'XPut', url: absolute(baseUrl, '/'), logo: absolute(baseUrl, '/favicon-512x512.png') };
}

function webApplication({ t, lang, page, baseUrl }) {
  const copy = t(`pages.${page}`);
  return {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: page === 'home' ? 'XPut Video Downloader' : 'XPut Twitter Viewer',
    url: absolute(baseUrl, pagePath(page, lang)),
    description: copy.description || copy.subtitle,
    applicationCategory: 'MultimediaApplication', operatingSystem: 'Any', inLanguage: lang === 'zh' ? 'zh-Hans' : lang,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
  };
}

function faqPage(items) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(item => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })) };
}

/** <head> additions for a fixed page: Open Graph / Twitter tags and structured data. */
function pageHead({ t, lang, page, baseUrl }) {
  const copy = t(`pages.${page}`);
  const description = copy.description || copy.subtitle || '';
  const data = [];
  if (page === 'home' || page === 'viewer') data.push(webApplication({ t, lang, page, baseUrl }));
  if (copy.faq?.items?.length) data.push(faqPage(copy.faq.items));
  return html`${socialTags({ title: copy.title, description, url: absolute(baseUrl, pagePath(page, lang)), image: absolute(baseUrl, SHARE_IMAGE), lang, imageAlt: 'XPut' })}
${data.map(item => jsonLd(item))}`;
}

module.exports = { faqPage, organization, pageHead, webApplication };
