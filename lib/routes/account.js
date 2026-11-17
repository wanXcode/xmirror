const { renderDocument } = require('../views/layout');
const { renderMe } = require('../views/pages/me');
const { createTranslator, enabledLanguages, parseCookies } = require('../i18n');
const { pagePath, PAGES } = require('../pages');
const { createRateLimiter } = require('../translation');
const { authorizeUrl, newState, profileFromCode } = require('../google-auth');
const { parseClaimText, KEY_PREFIX, SESSION_DAYS } = require('../accounts');
const { SHORT_CODE_PATTERN, isReservedShortCode, loadReservedShortCodes } = require('../shortcode');
const seo = require('../seo');

const SESSION_COOKIE = 'xput_session';
const OAUTH_COOKIE = 'xput_oauth';
const PAGE_SIZE = 20;

// Only our own account pages are valid sign-in return targets (no open redirect).
function safeNext(value) {
  const allowed = new Set(Object.values(PAGES.me.paths));
  return typeof value === 'string' && allowed.has(value) ? value : PAGES.me.paths.en;
}

function sameOrigin(req, baseUrl) {
  const origin = req.get('origin');
  if (!origin) return true;
  return origin === new URL(baseUrl).origin || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
}

/**
 * Sign-in, the personal archive list and the shortcut key.
 * `findPostsByTweetId(id)` returns posts saved from that tweet (used by "claim").
 * Returns helpers the archive endpoints use to find the caller and record what they saved.
 */
function registerAccountRoutes(app, { accounts, store, google, baseUrl, findPostsByTweetId, extractTweetId, normalizeUrl, fetchImpl }) {
  const reserved = loadReservedShortCodes();
  const secureCookie = req => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
  const limit = (max, windowMs = 60000) => createRateLimiter({ windowMs, max, code: 'RATE_LIMITED', message: 'Too many requests, please try again later' });

  async function userFromRequest(req) {
    try { return await accounts.userForSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]); }
    catch (error) { console.error('Session lookup failed:', error.message); return null; }
  }

  // Shortcut key from ?key= or X-XPut-Key. null = none supplied, false = supplied but wrong.
  async function userFromKey(req) {
    const key = String(req.query?.key || req.get('x-xput-key') || '').trim();
    if (!key) return null;
    return (await accounts.userForKey(key)) || false;
  }

  async function recordArchive(userId, code, source) {
    try {
      if (!userId || !SHORT_CODE_PATTERN.test(code || '')) return;
      const post = await store.findByCode(code);
      if (post) await accounts.recordArchive(userId, post.id, source);
    } catch (error) {
      console.error('Recording archive owner failed:', error.message); // never fail the archive itself
    }
  }

  async function requireUser(req, res, next) {
    const user = await userFromRequest(req);
    res.set('Cache-Control', 'no-store');
    if (!user) return res.status(401).json({ success: false, code: 'UNAUTHENTICATED', error: 'Please sign in' });
    if (req.method !== 'GET' && !sameOrigin(req, baseUrl)) return res.sendStatus(403);
    req.user = user;
    return next();
  }

  // ---- Google sign-in
  app.get('/auth/google', limit(30), (req, res) => {
    if (!google.enabled) return res.redirect(302, safeNext(req.query.next));
    const state = newState();
    const next = safeNext(req.query.next);
    res.cookie(OAUTH_COOKIE, Buffer.from(JSON.stringify({ s: state, n: next })).toString('base64url'), { ...secureCookie(req), path: '/auth/google', maxAge: 10 * 60 * 1000 });
    res.set('Cache-Control', 'no-store').redirect(302, authorizeUrl(google, state));
  });

  app.get('/auth/google/callback', limit(30), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cookieValue = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { ...secureCookie(req), path: '/auth/google' });
    let saved = null;
    try { saved = JSON.parse(Buffer.from(cookieValue || '', 'base64url').toString('utf8')); } catch { /* handled below */ }
    const fail = () => res.redirect(302, `${safeNext(saved?.n)}?login=failed`);
    if (!google.enabled || !saved?.s || typeof req.query.state !== 'string' || req.query.state !== saved.s) return fail();
    if (typeof req.query.code !== 'string' || !req.query.code || req.query.error) return fail();
    try {
      const profile = await profileFromCode(google, req.query.code, { fetchImpl });
      const user = await accounts.upsertGoogleUser(profile);
      const session = await accounts.createSession(user.id);
      res.cookie(SESSION_COOKIE, session.token, { ...secureCookie(req), maxAge: SESSION_DAYS * 86400000 });
      return res.redirect(302, safeNext(saved.n));
    } catch (error) {
      console.error('Google sign-in failed:', error.message);
      return fail();
    }
  });

  app.post('/auth/logout', async (req, res) => {
    if (!sameOrigin(req, baseUrl)) return res.sendStatus(403);
    await accounts.endSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]).catch(() => {});
    res.clearCookie(SESSION_COOKIE, secureCookie(req));
    res.set('Cache-Control', 'no-store').json({ success: true });
  });

  // ---- JSON API
  app.get('/api/me', requireUser, async (req, res) => {
    const key = await accounts.keyInfo(req.user.id);
    res.json({ success: true, user: { name: req.user.name, email: req.user.email }, key: key ? { last4: key.last4, created_at: key.created_at } : null, archives: await accounts.count(req.user.id) });
  });

  app.post('/api/me/key', limit(10), requireUser, async (req, res) => {
    res.json({ success: true, key: await accounts.rotateKey(req.user.id) });
  });

  app.get('/api/me/archives', requireUser, async (req, res) => {
    const pageSize = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_SIZE, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const rows = await accounts.list(req.user.id, { limit: pageSize + 1, offset, query: typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '' });
    res.json({
      success: true,
      has_more: rows.length > pageSize,
      archives: rows.slice(0, pageSize).map(row => ({ short_code: row.short_code, url: `/${row.short_code}`, title: seo.metadata(row).title, author: row.author || '', author_handle: row.author_handle || '', saved_at: row.saved_by_me_at, source: row.saved_source }))
    });
  });

  app.delete('/api/me/archives/:code', limit(60), requireUser, async (req, res) => {
    const post = SHORT_CODE_PATTERN.test(req.params.code) ? await store.findByCode(req.params.code) : null;
    const removed = post ? await accounts.removeArchive(req.user.id, post.id) : false;
    res.json({ success: true, removed });
  });

  // Paste old short links or X links; whatever already exists in the library joins "my list".
  app.post('/api/me/archives/claim', limit(10), requireUser, async (req, res) => {
    if (typeof req.body?.text !== 'string') return res.status(400).json({ success: false, code: 'INVALID_REQUEST', error: 'Invalid request' });
    const { codes, tweetIds } = parseClaimText(req.body.text, { extractTweetId, normalizeUrl, isReserved: code => isReservedShortCode(code, reserved) });
    const postIds = new Set();
    let missing = 0;
    for (const code of codes) {
      const post = await store.findByCode(code);
      if (post) postIds.add(post.id); else missing += 1;
    }
    for (const id of tweetIds) {
      const post = (await findPostsByTweetId(id))[0];
      if (post) postIds.add(post.id); else missing += 1;
    }
    let added = 0;
    for (const postId of postIds) {
      const before = await accounts.count(req.user.id);
      await accounts.recordArchive(req.user.id, postId, 'claim');
      if ((await accounts.count(req.user.id)) > before) added += 1;
    }
    res.json({ success: true, found: postIds.size, added, already: postIds.size - added, missing });
  });

  // ---- /me page (one URL per language)
  for (const language of enabledLanguages()) {
    app.get(PAGES.me.paths[language.code], async (req, res, next) => {
      try {
        const t = createTranslator(language.code);
        const copy = t('pages.me');
        const user = await userFromRequest(req);
        const own = pagePath('me', language.code);
        let view = { t, lang: language.code, signedIn: false, googleEnabled: google.enabled, loginFailed: req.query.login === 'failed', loginHref: `/auth/google?next=${encodeURIComponent(own)}` };
        if (user) {
          const rawPage = req.query.page === undefined ? '1' : req.query.page;
          if (typeof rawPage !== 'string' || !/^[1-9]\d{0,5}$/.test(rawPage)) return res.sendStatus(404);
          if (req.query.q !== undefined && typeof req.query.q !== 'string') return res.sendStatus(400);
          const query = (req.query.q || '').trim();
          if (Array.from(query).length > 100) return res.status(400).type('text/plain').send(copy.list.tooLong);
          const page = Number(rawPage);
          const rows = await accounts.list(user.id, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE, query });
          if (!rows.length && page > 1) return res.sendStatus(404);
          const key = await accounts.keyInfo(user.id);
          view = {
            ...view, signedIn: true, user, query, page, hasMore: rows.length > PAGE_SIZE, total: await accounts.count(user.id), keyLast4: key ? key.last4 : null, baseUrl,
            items: rows.slice(0, PAGE_SIZE).map(row => ({ code: row.short_code, title: seo.metadata(row).title, author: row.author || '', handle: row.author_handle || '', date: row.saved_by_me_at }))
          };
        }
        const document = renderDocument({
          lang: language.code, baseUrl, page: 'me', title: copy.title, description: copy.description, robots: 'noindex, nofollow', alternates: false,
          scripts: user ? ['/js/me.js'] : [], body: renderMe(view)
        });
        res.set({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }).type('html').send(String(document));
      } catch (error) { next(error); }
    });
  }

  return { userFromRequest, userFromKey, recordArchive, KEY_PREFIX };
}

module.exports = { registerAccountRoutes, safeNext, SESSION_COOKIE, OAUTH_COOKIE };
