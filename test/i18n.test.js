const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LANGUAGES, createTranslator, enabledLanguages, getLanguage, languageFromAcceptHeader, negotiateLanguage, parseCookies
} = require('../lib/i18n');
const en = require('../lib/content/en');
const zh = require('../lib/content/zh');
const { PAGES, pagePath, fixedSlugs } = require('../lib/pages');

const keys = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) =>
  value && typeof value === 'object' && !Array.isArray(value) ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]);

test('every enabled language has exactly the English keys, and a path for every fixed page', () => {
  assert.deepEqual(keys(zh).sort(), keys(en).sort());
  for (const language of enabledLanguages()) {
    for (const [page, entry] of Object.entries(PAGES)) assert.ok(entry.paths[language.code], `${page} has no ${language.code} path`);
  }
});

test('pt-BR is reserved but disabled until its content is complete', () => {
  assert.equal(getLanguage('pt-BR'), null);
  assert.equal(LANGUAGES.find(language => language.code === 'pt-BR').enabled, false);
  assert.equal(createTranslator('pt-BR')('nav.viewer'), en.nav.viewer); // falls back to English
  assert.throws(() => createTranslator('en')('nav.nope'), /Missing translation key/);
});

test('page paths per language, with English as the fallback', () => {
  assert.equal(pagePath('home', 'zh'), '/zh/');
  assert.equal(pagePath('viewer', 'en'), '/twitter-viewer');
  assert.equal(pagePath('shortcut', 'zh'), '/zh/ios-shortcut');
  assert.equal(pagePath('viewer', 'pt-BR'), '/twitter-viewer');
  assert.throws(() => pagePath('nope', 'en'));
  assert.ok(fixedSlugs().includes('zh') && fixedSlugs().includes('twitter-viewer'));
});

test('Accept-Language picks the best enabled language by q-value', () => {
  assert.equal(languageFromAcceptHeader('zh-CN,zh;q=0.9,en;q=0.8'), 'zh');
  assert.equal(languageFromAcceptHeader('en-US,en;q=0.9,zh;q=0.8'), 'en');
  assert.equal(languageFromAcceptHeader('zh-TW'), 'zh');
  assert.equal(languageFromAcceptHeader('fr;q=0.9, zh;q=0.5'), 'zh');
  assert.equal(languageFromAcceptHeader('pt-BR,pt;q=0.9'), null); // disabled for now
  assert.equal(languageFromAcceptHeader('zh;q=0, en'), 'en');
  assert.equal(languageFromAcceptHeader('*'), null);
  assert.equal(languageFromAcceptHeader(''), null);
});

test('result-page language: saved cookie wins over the browser, then browser, then English', () => {
  const req = (cookie, accept) => ({ headers: { cookie, 'accept-language': accept } });
  assert.equal(negotiateLanguage(req('xput_lang=en', 'zh-CN')), 'en');
  assert.equal(negotiateLanguage(req('a=1; xput_lang=zh', 'en')), 'zh');
  assert.equal(negotiateLanguage(req(undefined, 'zh-CN')), 'zh');
  assert.equal(negotiateLanguage(req('xput_lang=pt-BR', undefined)), 'en'); // disabled language ignored
  assert.equal(negotiateLanguage(req('xput_lang=%E0%A4%A', undefined)), 'en'); // malformed cookie
  assert.equal(negotiateLanguage({ headers: {} }), 'en');
});

test('cookie parsing keeps the first value and tolerates junk', () => {
  assert.deepEqual(parseCookies('a=1; b=2; a=3; broken; c=%20x'), { a: '1', b: '2', c: ' x' });
  assert.deepEqual(parseCookies(undefined), {});
});
