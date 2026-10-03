const { DEFAULT_LANGUAGE, getLanguage } = require('./i18n');

// Fixed pages and their URL per language. `nav` marks the header item to highlight.
const PAGES = Object.freeze({
  home: { nav: 'downloader', paths: { en: '/', zh: '/zh/' } },
  viewer: { nav: 'viewer', paths: { en: '/twitter-viewer', zh: '/zh/twitter-viewer' } },
  shortcut: { nav: 'shortcut', paths: { en: '/ios-shortcut', zh: '/zh/ios-shortcut' } },
  browse: { nav: null, paths: { en: '/browse', zh: '/zh/browse' } },
  privacy: { nav: null, paths: { en: '/privacy', zh: '/zh/privacy' } },
  report: { nav: null, paths: { en: '/report', zh: '/zh/report' } }
});

function pagePath(page, lang) {
  const entry = PAGES[page];
  if (!entry) throw new Error(`Unknown page: ${page}`);
  return entry.paths[getLanguage(lang)?.code] || entry.paths[DEFAULT_LANGUAGE];
}

// First path segment of every fixed page, e.g. "zh", "twitter-viewer", "report".
function fixedSlugs() {
  const slugs = new Set();
  for (const { paths } of Object.values(PAGES)) {
    for (const path of Object.values(paths)) {
      const slug = path.split('/').filter(Boolean)[0];
      if (slug) slugs.add(slug.toLowerCase());
    }
  }
  return [...slugs];
}

module.exports = { PAGES, fixedSlugs, pagePath };
