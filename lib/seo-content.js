const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const { imageSize } = require('image-size');
const seo = require('./seo');
const { normalizeXTimestamp } = require('./x-post');
const dimensions = new Map();

function localImageSize(src, dataDir) {
  if (!/^\/images\/[A-Za-z0-9_.-]+$/.test(src || '')) return null;
  try {
    const file = path.join(dataDir, src);
    const stat = fs.statSync(file);
    const key = `${file}:${stat.mtimeMs}:${stat.size}`;
    if (dimensions.has(key)) return dimensions.get(key);
    const fd = fs.openSync(file, 'r');
    let result;
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, 512 * 1024));
      fs.readSync(fd, buffer, 0, buffer.length, 0);
      const size = imageSize(buffer);
      result = size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : null;
    } finally { fs.closeSync(fd); }
    if (dimensions.size >= 512) dimensions.clear();
    dimensions.set(key, result);
    return result;
  } catch { return null; }
}

// Rendering only: stored source and translation block identity remain unchanged.
function prepareContent(post, dataDir) {
  const doc = parseHTML(`<html><body>${post.content || ''}</body></html>`).document;
  for (const el of doc.querySelectorAll('script,style,iframe,object,embed,form,base,meta,link')) el.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
  }
  const meta = seo.metadata(post);
  const firstHeading = doc.querySelector('h1,h2');
  const heading = firstHeading && seo.plainText(firstHeading.innerHTML) === meta.title ? firstHeading : null;
  for (const el of [...doc.querySelectorAll('h1,h2')]) {
    const tag = el === heading ? 'h1' : 'h2';
    if (el.localName !== tag) {
      const replacement = doc.createElement(tag);
      for (const a of [...el.attributes]) replacement.setAttribute(a.name, a.value);
      while (el.firstChild) replacement.appendChild(el.firstChild);
      el.replaceWith(replacement);
    }
  }
  const title = seo.metadata(post).title;
  for (const [i, img] of [...doc.querySelectorAll('img')].entries()) {
    const src = img.getAttribute('src') || '';
    if (!/^(?:\/images\/|https?:\/\/)/i.test(src)) { img.removeAttribute('src'); }
    if (!img.getAttribute('alt')) img.setAttribute('alt', `${post.author || '作者'}的帖子配图 ${i + 1}：${title}`);
    img.setAttribute('decoding', 'async');
    img.setAttribute('loading', i === 0 ? 'eager' : 'lazy');
    if (i === 0) img.setAttribute('fetchpriority', 'high');
    const size = localImageSize(src, dataDir);
    if (size) { img.setAttribute('width', size.width); img.setAttribute('height', size.height); }
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(href)) { a.removeAttribute('href'); continue; }
    a.setAttribute('rel', 'ugc nofollow noopener noreferrer');
    a.setAttribute('target', '_blank');
  }
  return { html: doc.body.innerHTML, headingHtml: heading ? '' : `<h1 class="archive-title">${seo.escape(title)}</h1>` };
}

function structuredData(post, baseUrl, language, image) {
  const meta = seo.metadata(post);
  const data = {
    '@context': 'https://schema.org', '@type': 'SocialMediaPosting',
    '@id': `${baseUrl}/${post.short_code}#post`, url: `${baseUrl}/${post.short_code}`,
    mainEntityOfPage: `${baseUrl}/${post.short_code}`, headline: meta.title,
    description: meta.description, inLanguage: language,
    author: { '@type': 'Person', name: post.author || post.author_handle || 'X 用户' },
    isBasedOn: post.url
  };
  if (/^[A-Za-z0-9_]{1,15}$/.test(post.author_handle || '')) data.author.url = `https://x.com/${post.author_handle}`;
  const published = normalizeXTimestamp(post.tweet_time, null);
  if (published) data.datePublished = published;
  if (image) data.image = image;
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
module.exports = { prepareContent, structuredData, localImageSize };
