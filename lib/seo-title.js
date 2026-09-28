const crypto = require('node:crypto');
const { parseHTML } = require('linkedom');
const { detectContentLanguage } = require('./translation');

function text(content) {
  const { document } = parseHTML(`<html><body>${String(content || '').replace(/<br\s*\/?>/gi, ' ').replace(/<(\/?)(p|div|li|h[1-6])\b/gi, ' <$1$2')}</body></html>`);
  for (const n of document.querySelectorAll('script,style,template')) n.remove();
  return document.body.textContent.replace(/\s+/g, ' ').trim();
}
function fingerprint(post) {
  const { document } = parseHTML(`<html><body>${post.content || ''}</body></html>`);
  const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  return crypto.createHash('sha256').update(JSON.stringify([text(post.content), links, post.url || '', post.author_handle || ''])).digest('hex');
}
function clip(value, max) {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  const prefix = chars.slice(0, max - 1).join('');
  const sentences = prefix.match(/^.*[。！？.!?；;]/u);
  if (sentences && sentences[0].length >= max / 3) return sentences[0].trim();
  const safe = prefix.replace(/[A-Za-z0-9]+$/, '').trim();
  return (safe || prefix).replace(/[，,、:：\s]+$/, '') + '…';
}
function sourceMetadata(post) {
  const { document } = parseHTML(`<html><body>${post.content || ''}</body></html>`);
  const heading = text(document.querySelector('h1,h2')?.innerHTML || '');
  // A subsection is not automatically the title of the whole document.
  const first = document.body.firstElementChild;
  const sourceTitle = first && first.matches('h1,h2') ? text(first.innerHTML) : '';
  const goodHeading = sourceTitle.length >= 4 && Array.from(sourceTitle).length <= 70 &&
    !/https?:\/\/|^@|^(前言|引言|目录|正文|总结|introduction|summary)$/i.test(sourceTitle);
  const summary = text(post.content);
  const sentences = summary.split(/(?<=[。！？.!?])\s*/u).filter(s => s.length >= 8 && !/^https?:\/\/|^@/.test(s));
  const useful = sentences.find(s => !/^(我昨天|最近我|大家好|hello everyone|today i tried)/i.test(s));
  return { title: clip(goodHeading ? sourceTitle : useful || summary || `${post.author || 'X'} 的存档`, 70),
    description: clip(summary, 200), heading, source: goodHeading ? 'original' : 'extracted', needsAI: !goodHeading };
}
function metadata(post) {
  const base = sourceMetadata(post);
  if (process.env.SEO_AI_RENDER !== 'false' && post.seo_title && post.seo_title_hash === fingerprint(post)) {
    return { ...base, title: post.seo_title, description: post.seo_description || base.description, source: 'ai' };
  }
  return base;
}

// Conservative validation. Evidence matching limits invention; it does not
// prove semantics. Suspicious content falls back to extraction automatically.
function validateGenerated(value, input) {
  const contains = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());
  const strings = [value?.title, value?.description];
  if (strings.some(s => typeof s !== 'string' || !s.trim() || /[<>\u0000-\u001f]/u.test(s))) return null;
  if (Array.from(value.title).length > 70 || Array.from(value.description).length > 200) return null;
  if (!Array.isArray(value.keywords) || value.keywords.length < 1 || value.keywords.length > 3 ||
      value.keywords.some(k => typeof k !== 'string' || k.length < 2 || k.length > 30 || !contains(input,k))) return null;
  let keywords = value.keywords;
  if (!keywords.some(k => contains(value.title,k))) {
    const primary = (value.title.match(/[A-Za-z][A-Za-z0-9.+#-]+|[\p{Script=Han}]{2,8}/gu)||[]).find(k=>contains(input,k));
    if (!primary) return null;
    keywords = [primary,...keywords].slice(0,3);
  }
  if (!Array.isArray(value.evidence) || !value.evidence.length || value.evidence.some(e => typeof e !== 'string' || e.length < 8 || !input.includes(e))) return null;
  const output = strings.join(' ');
  if (/最新|最全|震惊|必看|100%|guaranteed|ultimate|best ever/i.test(output)) return null;
  for (const n of output.match(/\d+(?:[.,]\d+)*(?:%|年)?/g) || []) if (!input.includes(n)) return null;
  // Check proper names / technical identifiers, not harmless grammatical words.
  for (const name of output.match(/\b(?:[A-Z][A-Za-z0-9+#-]{2,}|[A-Za-z][A-Za-z0-9_-]*[.#][A-Za-z0-9_.-]+)\b/g) || []) {
    if (!input.toLowerCase().includes(name.toLowerCase())) return null;
  }
  for (const k of keywords) if (value.title.toLowerCase().split(k.toLowerCase()).length > 3) return null;
  // Risky negation/attribution needs a verbatim title, not an inferred claim.
  if (/(?:不支持|不能|无法|并非|尚未|未证实|据称|猜测|可能|不一定|\bnot\b|\bnever\b|\bmight\b|\brumou?r)/i.test(input) &&
      (!input.includes(value.title) || !input.includes(value.description))) return null;
  if (detectContentLanguage(input) !== detectContentLanguage(value.title)) return null;
  return { title: value.title.trim(), description: value.description.trim(), keywords, evidence: value.evidence };
}
module.exports = { text, fingerprint, clip, sourceMetadata, metadata, validateGenerated };
