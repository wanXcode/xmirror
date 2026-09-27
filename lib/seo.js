const crypto = require('node:crypto');
const { parseHTML } = require('linkedom');
const rules = require('../config/seo-rules.json');
const { extractXPostId } = require('./x-post');

function escape(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function documentFor(content) {
  return parseHTML(`<html><body>${String(content || '')}</body></html>`).document;
}
function plainText(content) {
  const doc = documentFor(String(content || "").replace(/<br\s*\/?>/gi, " ").replace(/<(\/?)(p|li|h[1-6]|div)\b/gi, " <$1$2"));
  for (const node of doc.querySelectorAll('script,style,template')) node.remove();
  return doc.body.textContent.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function units(text) {
  const useful = text.replace(/https?:\/\/[^\s]+/gi, '');
  return (useful.match(/[\p{Script=Latin}\d]+(?:['’-][\p{Script=Latin}\d]+)*|[^\p{Script=Latin}\P{L}]/gu) || []).length;
}
function imagesFor(post) {
  let images = post.images;
  if (typeof images === 'string') { try { images = JSON.parse(images); } catch { images = []; } }
  return (Array.isArray(images) ? images : []).filter(image => typeof image === 'string' && /^\/images\/[A-Za-z0-9_.-]+$/.test(image));
}
function metadata(post) {
  const doc = documentFor(post.content);
  const summary = plainText(post.content);
  const heading = doc.querySelector('h1,h2')?.textContent.replace(/\s+/g, ' ').trim();
  const title = heading || summary || `${post.author || 'X'} 的存档`;
  return { title: Array.from(title).slice(0, 100).join(''), description: Array.from(summary).slice(0, 200).join(''), heading };
}
function contentHash(post) {
  // Keep link destinations: identical captions with different references are not exact duplicates.
  const doc = documentFor(post.content);
  const links = [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  const media = [...doc.querySelectorAll('img[src],video[src],source[src]')].map(n => n.getAttribute('src'));
  return crypto.createHash('sha256').update(JSON.stringify([plainText(post.content).normalize('NFKC'), links, media, imagesFor(post), post.video || post.video_source_url || ''])).digest('hex');
}
function validSource(url) {
  try { const u = new URL(url); return ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(u.hostname) && !!extractXPostId(url); } catch { return false; }
}
function evaluate(post, { moderation = 'unknown', duplicate = false, hasMedia = false, autoIndex = true, config = rules } = {}) {
  const reasons = [];
  const text = plainText(post.content);
  const count = units(text);
  const hash = contentHash(post);
  const result = status => ({ status, score, reasons, hash, version: config.version, units: count });
  let score = 0;
  if (post.seo_blocked || moderation === 'reject') {
    reasons.push(post.seo_blocked ? 'admin_block' : 'moderation_reject');
    return result('noindex');
  }
  if (duplicate) { reasons.push('duplicate'); return result('noindex'); }
  if (!validSource(post.url) || !/^[A-Za-z0-9]{6}$/.test(post.short_code || '')) {
    reasons.push('invalid_source_or_short_code'); return result('noindex');
  }
  if (moderation !== 'allow') { reasons.push('moderation_unknown'); return result('review'); }
  // Manual exception can admit useful short posts, but never bypass access/moderation/duplicate restrictions.
  if (post.seo_override === 'noindex') { reasons.push('manual_noindex'); return result('noindex'); }
  if (!text || !count) { reasons.push('empty_text'); return result('noindex'); }
  const complete = post.author && post.author_handle && post.author_handle !== 'unknown' && post.tweet_time && Number.isFinite(Date.parse(post.tweet_time));
  if (!complete) { reasons.push('incomplete_metadata'); return result('review'); }
  if (post.seo_override === 'index') { reasons.push('manual_index'); return result('index'); }
  if (count < config.minUnits) { reasons.push('short_text'); return result('noindex'); }
  if (['queued', 'downloading', 'failed'].includes(post.video_status) && count < config.longTextUnits) {
    reasons.push('essential_media_pending'); return result('review');
  }
  if (count >= config.longTextUnits) { score += 25; reasons.push('substantial_text'); }
  if (metadata(post).heading && units(metadata(post).heading) >= 20) { score += 15; reasons.push('source_heading'); }
  if (hasMedia) { score += 25; reasons.push('preserved_media'); }
  score += 15; reasons.push('complete_metadata');
  if (/<(?:p|li|h[1-6]|br)\b/i.test(post.content || '')) { score += 10; reasons.push('readable_structure'); }
  const qualifies = score >= config.indexScore || count >= config.longTextUnits;
  if (qualifies) {
    if (!autoIndex) { reasons.push('automatic_indexing_paused'); return result('review'); }
    return result('index');
  }
  reasons.push('insufficient_quality_signals');
  return result(score >= config.reviewScore ? 'review' : 'noindex');
}
function robotsFor(post) { return post.seo_status === 'index' && !post.seo_blocked ? 'index, follow' : 'noindex, follow'; }
function sitemap(rows, baseUrl, { includeHome = true } = {}) {
  const urls = rows.filter(row => row.seo_status === 'index' && !row.seo_blocked && /^[A-Za-z0-9]{6}$/.test(row.short_code || ''))
    .map(row => new URL(`/${row.short_code}`, baseUrl).href);
  if (includeHome) urls.unshift(new URL('/', baseUrl).href);
  // Omit lastmod until a reliable material-content timestamp exists.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(urls)].map(url => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>`;
}
module.exports = { escape, plainText, units, imagesFor, metadata, contentHash, evaluate, robotsFor, sitemap, rules };
