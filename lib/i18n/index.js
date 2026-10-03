const en = require('../content/en');
const zh = require('../content/zh');
const ptBR = require('../content/pt-BR');

// Adding a language: add an entry here (enabled: true), add its content module,
// and give every page in lib/pages.js a path for it. Nothing else is language-specific.
const LANGUAGES = Object.freeze([
  { code: 'en', label: 'English', english: 'English', htmlLang: 'en', hreflang: 'en', prefix: '', enabled: true, content: en },
  { code: 'zh', label: '中文', english: 'Chinese', htmlLang: 'zh-Hans', hreflang: 'zh-Hans', prefix: '/zh', enabled: true, content: zh },
  { code: 'pt-BR', label: 'Português (Brasil)', english: 'Portuguese', htmlLang: 'pt-BR', hreflang: 'pt-BR', prefix: '/pt', enabled: false, content: ptBR }
]);

const DEFAULT_LANGUAGE = 'en';
const LANGUAGE_COOKIE = 'xput_lang';

const enabledLanguages = () => LANGUAGES.filter(language => language.enabled);
const getLanguage = code => LANGUAGES.find(language => language.code === code && language.enabled) || null;

function lookup(content, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), content);
}

// t('footer.privacy') -> string/array/object for `lang`, falling back to English.
function createTranslator(code) {
  const language = LANGUAGES.find(item => item.code === code) || LANGUAGES[0];
  return function t(key) {
    const value = lookup(language.content, key);
    if (value !== undefined) return value;
    const fallback = lookup(en, key);
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing translation key: ${key}`);
  };
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) {
      try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* ignore malformed */ }
    }
  }
  return cookies;
}

// "zh-CN,zh;q=0.9,en;q=0.8" -> first enabled language by preference.
function languageFromAcceptHeader(header = '') {
  const ranges = String(header).split(',').map(item => {
    const [tag, ...params] = item.trim().split(';');
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
  }).filter(range => range.tag && range.tag !== '*' && range.q > 0).sort((a, b) => b.q - a.q);

  for (const { tag } of ranges) {
    const exact = enabledLanguages().find(language => language.code.toLowerCase() === tag);
    if (exact) return exact.code;
    const primary = tag.split('-')[0];
    const match = enabledLanguages().find(language => language.code.toLowerCase().split('-')[0] === primary);
    if (match) return match.code;
  }
  return null;
}

// For URLs without a language prefix (result pages): saved preference first,
// then the browser's language, then English.
function negotiateLanguage(req) {
  const saved = parseCookies(req.headers?.cookie)[LANGUAGE_COOKIE];
  if (getLanguage(saved)) return saved;
  return languageFromAcceptHeader(req.headers?.['accept-language']) || DEFAULT_LANGUAGE;
}

module.exports = {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_COOKIE,
  createTranslator,
  enabledLanguages,
  getLanguage,
  languageFromAcceptHeader,
  negotiateLanguage,
  parseCookies
};
