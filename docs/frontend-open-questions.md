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
