const { renderDocument } = require('../views/layout');
const { jsonLd, socialTags } = require('../views/seo-head');
const { renderNotFound, renderPost, renderRemoved } = require('../views/pages/post');
const { buildPostView, excerpt } = require('../post-view');
const { createTranslator, getLanguage, LANGUAGE_COOKIE, negotiateLanguage } = require('../i18n');
const { hasAgeConfirmation } = require('../age-gate');
const { isBot } = require('../view-counter');
const { createRateLimiter } = require('../translation');
const { fill } = require('../text');
const { SHORT_CODE_PATTERN } = require('../shortcode');

const POST_SCRIPTS = ['/js/link.js', '/js/download.js', '/js/zip.js', '/js/result-card.js', '/js/finder.js', '/js/post-page.js'];
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SHARE_DEDUPE_MS = 60 * 60 * 1000;

function pageTitle(t, view) {
  const text = excerpt(view.plainText, 50);
  return text
    ? fill(t('post.titleTemplate'), { author: view.author.name, excerpt: text })
    : `${view.author.name} ${t('post.h1Suffix')} | XPut`;
}

/**
 * /{shortCode}: the saved-post page in its normal (noindex) or featured (indexable) version,
 * plus the removal notice and "this link doesn't exist" states.
 * `featured` (optional) is lib/featured.js's service: pageFor(post) -> featured row or null.
 */
function registerResultRoutes(app, { store, counter, baseUrl, downloadBase = '/dl', featured = null }) {
  const sharedRecently = new Map();

  function send(res, status, document, { vary = true } = {}) {
    res.status(status).set('Cache-Control', 'no-cache, must-revalidate').type('html');
    if (vary) res.set('Vary', 'Cookie, Accept-Language');
    return res.send(String(document));
  }

  function plainPage({ lang, t, code, title, body, robots = 'noindex, follow' }) {
    return renderDocument({
      lang, baseUrl, page: null, path: `/${code}`, title, robots, scripts: POST_SCRIPTS,
      switchHref: language => `/${code}?lang=${language}`, body
    });
  }

  app.get(/^\/([A-Za-z0-9]{6})$/, async (req, res, next) => {
    try {
      const code = req.params[0];

      // Language links on these pages carry ?lang=: remember the choice, then show the clean URL.
      if (typeof req.query.lang === 'string') {
        const language = getLanguage(req.query.lang);
        if (language) res.cookie(LANGUAGE_COOKIE, language.code, { maxAge: YEAR_MS, sameSite: 'lax', path: '/', secure: req.secure });
        return res.redirect(302, `/${code}`);
      }

      const lang = negotiateLanguage(req);
      const t = createTranslator(lang);
      const post = await store.findByCode(code);

      if (!post) {
        const removed = await store.tombstone(code);
        if (removed) {
          return send(res, 410, plainPage({ lang, t, code, title: `${t('post.removedTitle')} | XPut`, body: renderRemoved({ t, lang, reference: removed.reference }) }));
        }
        // Six letters or digits that match nothing: a mistyped saved-post link, not a missing page.
        return send(res, 404, plainPage({ lang, t, code, title: `${t('post.notFoundTitle')} | XPut`, body: renderNotFound({ t, lang, downloadBase }) }));
      }
      if (post.short_code !== code) return res.redirect(301, `/${post.short_code}`);

      const view = buildPostView(post);
      const featuredRow = featured ? await featured.pageFor(post) : null;
      if (!isBot(req.get('user-agent'))) counter.view(post.id);

      // Until the age check is passed, nothing from a sensitive post may appear anywhere in the HTML.
      const locked = view.sensitive && !hasAgeConfirmation(req);
      const title = locked ? `${view.author.name} ${t('post.h1Suffix')} | XPut` : featuredRow ? featuredRow.ai_title : pageTitle(t, view);
      const description = locked ? '' : (featuredRow ? excerpt(featuredRow.summary, 155) : excerpt(view.plainText, 155)) || title;
      const url = `${baseUrl.replace(/\/$/, '')}/${code}`;
      const robots = !locked && featuredRow ? 'index, follow' : 'noindex, follow';

      const featuredPage = featuredRow ? require('../views/pages/featured').buildFeaturedParts({ t, lang, view, row: featuredRow, post, related: await featured.related(post, featuredRow) }) : null;
      const head = [
        socialTags({
          title, description, url, image: locked ? `${baseUrl.replace(/\/$/, '')}/xput-share.png` : `${baseUrl.replace(/\/$/, '')}/og/${code}.png`, type: 'article', lang,
          publishedTime: locked ? null : view.postedAt, imageAlt: `${view.author.name} ${t('post.h1Suffix')}`
        }),
        featuredPage ? jsonLd(featuredPage.structuredData(baseUrl)) : ''
      ];

      const body = renderPost({
        t, lang, view, downloadBase, ageConfirmed: !locked, shareUrl: url, title,
        featuredBody: featuredPage ? { top: featuredPage.top, bottom: featuredPage.bottom } : null
      });
      const document = renderDocument({
        lang, baseUrl, page: null, path: `/${code}`, title: featuredRow ? `${title} | XPut` : title, description, robots, head, scripts: POST_SCRIPTS,
        switchHref: language => `/${code}?lang=${language}`, body
      });
      return send(res, 200, document);
    } catch (error) {
      console.error('短链访问失败:', error.message);
      return next(error);
    }
  });

  // A share/copy of the link counts toward featuring; once per visitor per post per hour.
  const shareLimit = createRateLimiter({ windowMs: 60000, max: 30, code: 'RATE_LIMITED', message: 'Too many requests' });
  app.post('/api/posts/:code/share', shareLimit, async (req, res) => {
    const { code } = req.params;
    if (!SHORT_CODE_PATTERN.test(code)) return res.sendStatus(404);
    const post = await store.findByCode(code);
    if (!post) return res.sendStatus(404);
    const key = `${req.ip}:${post.id}`;
    const now = Date.now();
    if (sharedRecently.size > 10000) for (const [k, at] of sharedRecently) if (now - at > SHARE_DEDUPE_MS) sharedRecently.delete(k);
    if (!(sharedRecently.get(key) > now - SHARE_DEDUPE_MS) && !isBot(req.get('user-agent'))) {
      sharedRecently.set(key, now);
      counter.share(post.id);
    }
    res.sendStatus(204);
  });
}

module.exports = { registerResultRoutes, pageTitle, POST_SCRIPTS };
