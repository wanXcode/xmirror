# XPut download proxy (Cloudflare Worker)

Browsers open a video in a new tab unless the response says `Content-Disposition: attachment`.
X's CDN does not send that header, so every download goes through this proxy:

```
GET https://xput.app/dl?u=<https://video.twimg.com/...mp4>&n=<file name>
```

- Streams the file from X to the visitor. Nothing is written to disk or cached.
- Only `https://*.twimg.com` is allowed (no ports, no credentials). Redirects from X are refused.
- Upstream must answer with `video/*` or `image/*`; anything else is a 502.
- Visitor cookies and headers are never forwarded (only a valid `Range`).
- Full downloads are rate limited per visitor IP (`CF-Connecting-IP`).

The rules live in `core.mjs` and are shared with the local Node version (`lib/download-proxy.js`),
so the tests in `test/download-proxy.test.js` cover both.

## Deploy

1. `cd workers/download-proxy`
2. Edit `wrangler.toml`: set the route pattern and `zone_name` to your domain.
3. `npx wrangler deploy` (log in once with `npx wrangler login`).
4. In the site's environment leave `DOWNLOAD_VIA` unset or `worker` and `DOWNLOAD_PROXY_BASE` unset (default `/dl`),
   so `/dl` is served only by the Worker. If the Worker ever fails, set `DOWNLOAD_VIA=node` and restart the site:
   the pages then use the Node proxy on `/node-dl`, which this route does not match (see `docs/download-proxy-rollout.md`).

Because the route is on the same hostname as the site, the page calls `/dl` without CORS.

## Rate limiting

`wrangler.toml` declares a Workers Rate Limiting binding (`RATE_LIMITER`, 60 downloads per minute per IP).
If your account or Wrangler version does not accept that block, delete it (the Worker then skips the check)
and add a Cloudflare WAF rate limiting rule instead:

- Expression: `http.request.uri.path eq "/dl" and http.request.method eq "GET"`
- Characteristic: IP, 60 requests per 1 minute, action: Block (or Managed Challenge)

The page shows a countdown from the `Retry-After` header when it gets a 429.

## Local development

No Worker needed: `node server.js` serves the same `/dl` from `lib/download-proxy.js`
(on by default unless `NODE_ENV=production`). To try the Worker itself: `npx wrangler dev`,
then point the page at it with `DOWNLOAD_PROXY_BASE=http://127.0.0.1:8787/dl`.

## Cost note

Bandwidth for the proxied files is billed to the Worker/Cloudflare plan, not to the origin server.
Workers have request-count and CPU-time limits, but streaming a body does not consume CPU time per byte.
