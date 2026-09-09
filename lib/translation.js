const crypto = require('crypto');
const { TranslationProviderError } = require('./siliconflow');

const SUPPORTED_LANGUAGES = Object.freeze({
  'zh-CN': '简体中文',
  en: 'English'
});

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

// Return semantic blocks so clients can preserve headings, lists and quotes.
function extractTranslatableBlocks(content = '') {
  const source = String(content).replace(/<img[^>]*>/gi, '').replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '');
  const blocks = [];
  const blockPattern = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  let cursor = 0;
  const appendPlain = html => {
    const text = cleanHtmlText(html);
    if (text) text.split(/\n+/).map(value => value.trim()).filter(Boolean)
      .forEach(value => blocks.push({ type: 'p', text: value }));
  };
  while ((match = blockPattern.exec(source))) {
    appendPlain(source.slice(cursor, match.index));
    const text = cleanHtmlText(match[2]);
    if (text) blocks.push({ type: match[1].toLowerCase(), text });
    cursor = blockPattern.lastIndex;
  }
  appendPlain(source.slice(cursor));
  return blocks;
}

function sourceHash(parts) {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function translateInBatches(parts, translateBatch, { batchSize = 30 } = {}) {
  const translations = [];
  let sourceLang = 'auto';
  for (let offset = 0; offset < parts.length; offset += batchSize) {
    const result = await translateBatch(parts.slice(offset, offset + batchSize));
    if (!Array.isArray(result?.translations) || result.translations.length !== Math.min(batchSize, parts.length - offset)) {
      throw new Error('翻译结果格式异常');
    }
    if (sourceLang === 'auto' && result.sourceLang) sourceLang = result.sourceLang;
    translations.push(...result.translations);
  }
  return { sourceLang, translations };
}

function createRateLimiter({ windowMs = 60000, max = 10 } = {}) {
  const clients = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const recent = (clients.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - recent[0])) / 1000)));
      return res.status(429).json({ success: false, error: '翻译请求过于频繁，请稍后再试' });
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
  SUPPORTED_LANGUAGES, normalizeTargetLanguage, detectContentLanguage, extractTranslatableBlocks,
  sourceHash, translateInBatches, createRateLimiter, translationErrorResponse
};
