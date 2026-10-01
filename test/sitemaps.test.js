const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { copiesSitemap, mainSitemap, robotsTxt, sitemapIndex } = require('../lib/sitemaps');
const { faqPage, organization, pageHead, webApplication } = require('../lib/views/page-seo');
const { createTranslator } = require('../lib/i18n');

const BASE = 'https://xput.app';
const locs = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

test('main sitemap: fixed pages in both languages with hreflang alternates; the report page is left out', () => {
  const xml = mainSitemap(BASE);
  assert.deepEqual(locs(xml), [
    'https://xput.app/', 'https://xput.app/zh/', 'https://xput.app/twitter-viewer', 'https://xput.app/zh/twitter-viewer',
    'https://xput.app/ios-shortcut', 'https://xput.app/zh/ios-shortcut', 'https://xput.app/privacy', 'https://xput.app/zh/privacy'
  ]);
  assert.ok(!xml.includes('/report'));
  assert.ok(xml.includes('hreflang="x-default" href="https://xput.app/"'));
  assert.ok(xml.includes('hreflang="zh-Hans" href="https://xput.app/zh/twitter-viewer"'));
  assert.equal((xml.match(/<xhtml:link/g) || []).length, 8 * 3);
});

test('copies sitemap: one url per copy with a date, escaped, never the home page', () => {
  const xml = copiesSitemap([{ short_code: 'Ab1234', lastmod: '2026-10-01T09:30:00.000Z' }, { short_code: 'Cd5678', lastmod: '2026-09-30 10:00:00' }, { short_code: 'Ef9012', lastmod: null }], BASE);
  assert.deepEqual(locs(xml), ['https://xput.app/Ab1234', 'https://xput.app/Cd5678', 'https://xput.app/Ef9012']);
  assert.ok(xml.includes('<lastmod>2026-10-01</lastmod>') && xml.includes('<lastmod>2026-09-30</lastmod>'));
  assert.equal((xml.match(/<lastmod>/g) || []).length, 2);
  assert.deepEqual(locs(copiesSitemap([], BASE)), []);
});

test('sitemap index and robots.txt', () => {
  assert.deepEqual(locs(sitemapIndex(['https://xput.app/a.xml?x=1&y=2'])), ['https://xput.app/a.xml?x=1&amp;y=2']);
  const robots = robotsTxt('https://xput.app/');
  assert.ok(robots.includes('Sitemap: https://xput.app/sitemap.xml'));
  assert.ok(robots.includes('Disallow: /api/') && robots.includes('Disallow: /dl/'));
  assert.ok(!/Disallow: \/(og|images|videos|css|js)/.test(robots), 'assets and share images stay crawlable');
});

test('structured data: Organization, WebApplication (free), FAQPage built from the visible FAQ', () => {
  assert.equal(organization(BASE).url, 'https://xput.app/');
  const t = createTranslator('en');
  const app = webApplication({ t, lang: 'en', page: 'home', baseUrl: BASE });
  assert.equal(app.applicationCategory, 'MultimediaApplication');
  assert.equal(app.offers.price, '0');
  assert.equal(app.url, 'https://xput.app/');
  assert.equal(webApplication({ t: createTranslator('zh'), lang: 'zh', page: 'viewer', baseUrl: BASE }).url, 'https://xput.app/zh/twitter-viewer');
  const items = t('pages.home.faq.items');
  const faq = faqPage(items);
  assert.equal(faq.mainEntity.length, items.length);
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, items[0].a);
});

test('pageHead: OG + Twitter tags and the right JSON-LD per page', () => {
  const parse = (page, lang = 'en') => {
    const { document } = parseHTML(`<html><head>${pageHead({ t: createTranslator(lang), lang, page, baseUrl: BASE })}</head></html>`);
    const types = [...document.querySelectorAll('script[type="application/ld+json"]')].map(n => JSON.parse(n.textContent)['@type']);
    return { document, types };
  };
  const home = parse('home');
  assert.deepEqual(home.types, ['WebApplication', 'FAQPage']);
  assert.equal(home.document.querySelector('meta[property="og:image"]').getAttribute('content'), 'https://xput.app/xput-share.png');
  assert.equal(home.document.querySelector('meta[property="og:url"]').getAttribute('content'), 'https://xput.app/');
  assert.equal(home.document.querySelector('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
  assert.deepEqual(parse('shortcut').types, ['FAQPage']);
  assert.deepEqual(parse('privacy').types, []);
  assert.equal(parse('home', 'zh').document.querySelector('meta[property="og:locale"]').getAttribute('content'), 'zh_CN');
});
