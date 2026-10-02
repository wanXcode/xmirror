# Frontend v1: items awaiting confirmation

Defaults were implemented for everything below; each can be changed later.

## Copy
- zh `meta description` for fixed pages is just the subtitle.
- zh state and result copy are drafted by the developer (not in the artboards).
- Strings not in any artboard were added by the developer: empty-input message, "no saved copy" text, rejected card, single-photo labels, OG footer in zh ("已保存的副本").
- Breadcrumb "Saved posts" on featured pages is plain text (no page to link to).

## Behaviour
- Sensitive-post View path is implemented but unreachable: the archive still rejects sensitive posts.
- Media sizes come from a HEAD request (`/api/media-info`); previews play from the X CDN; files over ~150MB use the browser's native download.
- Quote-post media, replies and followers were added to the fetch layer additively. Replies and poster images exist only for newly archived posts.
- Follower count is not available from the syndication fallback, so such posts cannot satisfy the follower gate until set by an admin (`POST /api/admin/featured/:id/followers`).
- Tombstones (410) are written only via the admin delete API.
- Legacy-indexed archives keep `index`; every new archive is `noindex`.
- View/share counters are batched in memory and flushed periodically.
- Local `/dl` proxy is off when `NODE_ENV=production`; the Cloudflare Worker serves `xput.app/dl/*`.
- Translation/subtitle backend code is orphaned (no UI), left in place.

## Featured pages
- Thresholds are my defaults: 20 interactions (views + shares), 1000 followers, 10 pages per day (`config/featured.json`).
- AI content is entered through the admin API and needs human review before publishing; editing a live page returns it to draft.
- Report link on result pages is `/report?post=CODE`.

## OG images
- New dependencies: `satori`, `@resvg/resvg-js`, and `@fontsource/{ibm-plex-sans,space-grotesk,noto-sans-sc}` (fonts are loaded lazily; Noto Sans SC slices only when the text contains CJK).
- Only PNG/JPEG/GIF thumbnails are embedded (WebP local images fall back to a placeholder tile).
- Scripts other than Latin and CJK (Arabic, Thai, ...) are not covered and would render as boxes.
- Images are cached under `DATA_DIR/og`; sensitive posts, unknown codes and render failures get `/xput-share.png`.

## Cloudflare / deployment
- Worker route, zone and rate-limit binding syntax in `workers/download-proxy/wrangler.toml` need checking against the real account.

## Shortcut, report, privacy, 404 (stage 5)
- Shortcut QR points to the iCloud link from the design spec (`config/site.json` `shortcutUrl`, overridable with `SHORTCUT_URL`). The QR is generated server-side (`qrcode` dependency).
- The artboards leave 4 of 5 shortcut FAQ answers empty; I wrote them (en + zh).
- Report page: "[time]" is set to "3 business days"; the form's email is required; "Reason" is sent as a `[code] label — details` prefix because `/api/reports` is unchanged (kinds: copyright / other). `/api/reports` now also accepts an X post link (looked up by canonical URL), a small additive change.
- Privacy page: all paragraphs were drafted by me from actual behaviour (cookies `xput_lang`, `xput_age`; server logs; the "privacy-friendly analytics" wording must be confirmed against the analytics provider). "Last updated" is 2026-10-01. No contact email is given; contact is via the report page. Supply one if wanted.
- zh report/privacy/404 copy is drafted (no zh artboards).
- Generic 404 page reuses the saved-post "not found" layout (W_404) with Video Downloader / Twitter Viewer links; API and asset paths still get plain-text 404s.
- Old `public/report.html` / `report.js` were replaced by the server-rendered page.

## SEO and performance (stage 6)
- `/sitemap.xml` is now a sitemap index: `/sitemap-main.xml` (fixed pages en + zh with hreflang) and `/sitemap-copies-N.xml` (live featured pages + legacy-indexed archives). The old `/sitemaps/N.xml` paths are gone. The report page is left out of the sitemap because it is noindex (the spec listed it).
- robots.txt: `Disallow: /api/` and `/dl/`; `/og/` and media stay crawlable (OG images carry `X-Robots-Tag: noindex`).
- Organization JSON-LD is on every page; WebApplication on home/viewer; FAQPage on home, viewer and shortcut. SocialMediaPosting is on featured pages.
- WebP: there are no raster sample images on the site (illustrations are inline SVG, user media is stored as received), so no conversion was needed; converting saved photos would require a new image dependency.
- Lighthouse (mobile, simulated throttling, local sandbox, Google Fonts unreachable so web fonts fall back; real numbers on production may differ slightly):

| Page | Perf | A11y | Best practices | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| / | 96 | 100 | 96 | 100 | 2.1 s | 0 |
| /zh/ | 98 | 100 | 96 | 100 | 2.1 s | 0 |
| /twitter-viewer | 97 | 100 | 96 | 100 | 2.1 s | 0 |
| /ios-shortcut | 99 | 100 | 96 | 100 | 1.8 s | 0 |
| /privacy | 99 | 100 | 96 | 100 | 1.7 s | 0 |
| /report | 99 | 100 | 96 | 66* | 1.7 s | 0 |
| saved post (normal) | 97 | 100 | 96 | 66* | 2.3 s | 0 |
| featured post | 100 | 100 | 96 | 100 | 1.5 s | 0 |

\* SEO 66 is the deliberate `noindex` ("blocked from indexing"). Best-practices 96 is the console error from the blocked Google Fonts request in the sandbox. The 404 page cannot be audited (Lighthouse rejects non-200 pages).

## Performance follow-up (after local acceptance, 2026-10-02)
- Mobile LCP was 4.3–5.6 s on the acceptance machine against 2.1–2.5 s in my sandbox. Causes: the render-blocking Google Fonts stylesheet (two third-party origins; blocked in my sandbox, so my earlier numbers did not include it), and no gzip/brotli plus `max-age=0` on CSS/JS from Node. Fixed: fonts are self-hosted and the Latin `@font-face` rules inlined, `compression` (br/gzip) added, CSS/JS URLs carry a content hash and are `immutable`.
- **Design change to confirm:** Noto Sans SC is no longer loaded as a web font. As unicode-range slices it was ~700 KB per Chinese page and took zh LCP to 6.8 s; Chinese text now uses the visitor's system CJK font (PingFang SC, Microsoft YaHei, Noto Sans CJK SC). Latin text keeps IBM Plex Sans and Space Grotesk. (OG images still render with Noto Sans SC on the server.)

## Font licenses
Space Grotesk, IBM Plex Sans (served from `/fonts/`) and Noto Sans SC (OG images only) are SIL OFL 1.1. The license texts are in `licenses/OFL-*.txt`, and `public/fonts/LICENSE.txt` (public at `/fonts/LICENSE.txt`) ships the notices for the two served families. The font files themselves come from the `@fontsource` npm packages at runtime; they are not copied into the repo.

## Source success-rate statistics
When computing per-source success rates from the `[fetch]` log lines, leave out entries with `"definitive": true`. They are the post's own state (`reason`: `not_found`, `deleted`, `private`, `suspended`), not a source fault, so they count neither as a failure nor as a success. Only `timeout`, `network`, `upstream` (5xx/unexpected status), `rate_limit` and `incomplete` (parse failure) entries are source failures.
