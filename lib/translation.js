const crypto = require('crypto');
const { parseHTML } = require('linkedom');
const { TranslationProviderError } = require('./siliconflow');

const SUPPORTED_LANGUAGES = Object.freeze({
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  es: 'Español'
});

class TranslationFormatError extends Error {
  constructor(message = '翻译结果格式异常') {
    super(message);
    this.name = 'TranslationFormatError';
    this.code = 'TRANSLATION_FORMAT';
  }
}

function normalizeTargetLanguage(value) {
  return Object.hasOwn(SUPPORTED_LANGUAGES, value) ? value : null;
}

function detectContentLanguage(content = '') {
  const text = cleanHtmlText(content);
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(text)) return 'ko';
  const zhCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (!zhCount) return 'en';
  if (!latinCount) return 'zh';
  return zhCount / (zhCount + latinCount) >= 0.2 ? 'zh' : 'en';
}

function decodeEntities(text = '') {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}

function cleanHtmlText(html = '') {
  return decodeEntities(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

// Build translation segments and mark their exact place in the source HTML.
// The client clones this structure and replaces only marked text, so media,
// links, lists and quote chrome remain in the same order in the translation.
function prepareTranslatableContent(content = '') {
  const { document } = parseHTML(`<div data-translation-root>${String(content)}</div>`);
  const root = document.querySelector('[data-translation-root]');
  const blocks = [];
  const mediaTags = new Set(['IMG', 'VIDEO', 'SOURCE', 'PICTURE']);
  const containerTags = new Set(['DIV', 'SECTION', 'ARTICLE', 'UL', 'OL']);

  const mark = (element, type) => {
    const text = cleanHtmlText(element.innerHTML);
    if (!text) return;
    const index = blocks.length;
    element.setAttribute('data-translation-index', String(index));
    blocks.push({ type, text });
  };

  const markInlineRun = (parent, nodes, type = 'p') => {
    if (!nodes.length) return;
    const source = nodes.map(node => node.outerHTML || node.textContent || '').join('');
    const text = cleanHtmlText(source);
    if (!text) return;
    const marker = document.createElement('span');
    parent.insertBefore(marker, nodes[0]);
    nodes.forEach(node => marker.appendChild(node));
    mark(marker, type);
  };

  const visit = (container, inheritedType = 'p') => {
    let inline = [];
    const flush = () => { markInlineRun(container, inline, inheritedType); inline = []; };
    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType !== 1) { inline.push(node); continue; }
      const tag = node.tagName;
      if (tag === 'BR') { flush(); continue; }
      if (mediaTags.has(tag)) { flush(); continue; }
      if (tag === 'BLOCKQUOTE') {
        flush();
        const paragraphs = Array.from(node.children).filter(child => child.tagName === 'P');
        const body = node.classList.contains('quoted-post') && paragraphs.length > 1 ? paragraphs.slice(1) : paragraphs;
        if (body.length) body.forEach(paragraph => mark(paragraph, 'blockquote'));
        else mark(node, 'blockquote');
        continue;
      }
      if (/^H[1-6]$/.test(tag) || tag === 'P' || tag === 'LI') {
        flush();
        const type = tag === 'LI' ? 'li' : tag.toLowerCase();
        if (node.querySelector('img,video,picture')) visit(node, type);
        else mark(node, type);
        continue;
      }
      if (containerTags.has(tag)) { flush(); visit(node, inheritedType); continue; }
      inline.push(node);
    }
    flush();
  };

  visit(root);
  return { blocks, html: root.innerHTML };
}

// Return semantic blocks so translation jobs and the marked page use exactly
// the same indexes.
function extractTranslatableBlocks(content = '') {
  return prepareTranslatableContent(content).blocks;
}

function sourceHash(parts) {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function translateInBatches(parts, translateBatch, { batchSize = 30 } = {}) {
  async function translateStable(batch) {
    try {
      const result = await translateBatch(batch);
      if (!Array.isArray(result?.translations) || result.translations.length !== batch.length) {
        throw new TranslationFormatError();
      }
      return result;
    } catch (error) {
      const isFormatError = error instanceof TranslationFormatError || error?.code === 'TRANSLATION_FORMAT';
      if (!isFormatError || batch.length === 1) throw error;
      const midpoint = Math.ceil(batch.length / 2);
      const left = await translateStable(batch.slice(0, midpoint));
      const right = await translateStable(batch.slice(midpoint));
      return {
        sourceLang: left.sourceLang !== 'auto' ? left.sourceLang : right.sourceLang,
        translations: [...left.translations, ...right.translations]
      };
    }
  }

  const translations = [];
  let sourceLang = 'auto';
  for (let offset = 0; offset < parts.length; offset += batchSize) {
    const result = await translateStable(parts.slice(offset, offset + batchSize));
    if (sourceLang === 'auto' && result.sourceLang) sourceLang = result.sourceLang;
    translations.push(...result.translations);
  }
  return { sourceLang, translations };
}

function createRateLimiter({ windowMs = 60000, max = 10, message = '翻译请求过于频繁，请稍后再试', code } = {}) {
  const clients = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const recent = (clients.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - recent[0])) / 1000)));
      return res.status(429).json({ success: false, ...(code ? { code } : {}), error: message });
    }
    recent.push(now);
    clients.set(key, recent);
    if (clients.size > 10000) {
      for (const [client, timestamps] of clients) if (now - timestamps.at(-1) >= windowMs) clients.delete(client);
    }
    next();
  };
}

function translationErrorResponse(error) {
  if (error instanceof TranslationProviderError) {
    if (error.providerCode === 'TIMEOUT') return { status: 504, message: '翻译请求超时，请重试' };
    if (error.providerCode === 'NETWORK' || error.providerStatus >= 500) return { status: 503, message: '翻译服务暂时不可用，请稍后重试' };
    return { status: 502, message: '翻译服务返回异常，请稍后重试' };
  }
  return { status: 500, message: error?.message || '翻译失败' };
}

module.exports = {
  SUPPORTED_LANGUAGES, TranslationFormatError, normalizeTargetLanguage, detectContentLanguage, prepareTranslatableContent, extractTranslatableBlocks,
  sourceHash, translateInBatches, createRateLimiter, translationErrorResponse
};
