# 缓存头一览（配置 Cloudflare 时使用）

下表是服务器实际发出的 `Cache-Control`，由 `test/result-page.test.js`（"cache headers by type of response"）和 `test/basic-pages.test.js` 守护。

## 原则

- **Cloudflare 默认不缓存 HTML**，保持这个默认：**不要**对站点开 "Cache Everything" 或把 HTML 加入缓存规则。
- 结果页 `/{shortCode}` 的内容取决于访客（界面语言 cookie `xput_lang`、年龄确认 cookie `xput_age`、浏览计数），而 **Cloudflare 缓存不会按 `Vary: Cookie / Accept-Language` 区分**，一旦被缓存，所有访客会看到同一种语言，甚至看到别人确认过年龄后的敏感内容。所以结果页发 `private, no-store`（`Vary: Cookie, Accept-Language` 仅作补充）。
- 静态资源按源站头缓存即可（带版本的文件一年 immutable）。

## 各类响应

| 类别 | 路径 | Cache-Control | 备注 |
|---|---|---|---|
| 固定页（HTML） | `/`、`/zh/`、`/twitter-viewer`、`/zh/twitter-viewer`、`/ios-shortcut`、`/zh/ios-shortcut`、`/privacy`、`/report`（含 `/zh/`） | `no-cache, must-revalidate` | 语言由 URL 决定，带 ETag，可 304 复验；CF 不会缓存 HTML，除非你加规则 |
| 「已保存的帖子」列表（HTML） | `/browse`、`/zh/browse`（含 `?page=`、`?q=`） | `no-cache, must-revalidate` | 语言由 URL 决定、不依赖 cookie；内容随新存档变化，所以每次复验；搜索结果页是 `noindex` |
| 结果页（HTML） | `/{shortCode}`（普通、精选、敏感、已下架 410、短码不存在 404） | `private, no-store` | 另有 `Vary: Cookie, Accept-Language`；**必须绕过 CF 缓存** |
| 404 页（HTML） | 其他未匹配地址 | `private, no-store` | 同上 |
| API | `/api/*`（含 `/api/admin/*`、`/api/resolve`、`/api/media-info`…） | `no-store` | 服务器对 `/api` 统一兜底，处理函数只能更严 |
| 版本化 CSS/JS | `/css/xput.css?v=…`、`/js/*.js?v=…`（页面里引用的就是这种） | `public, max-age=31536000, immutable` | 版本号 = 包版本 + 文件内容哈希，改文件即换 URL |
| 无版本的 CSS/JS 与图标 | `/css/xput.css`、`/favicon.ico`、`/favicon.svg`、`/apple-touch-icon.png`、`/xput-share.png`、`/site.webmanifest` | `public, max-age=0, must-revalidate` | 每次复验（ETag），图标地址带 `?v=` 换新 |
| 字体 | `/fonts/{ibm-plex-sans,space-grotesk}/*.woff2`、`/fonts/LICENSE.txt` | woff2：`public, max-age=31536000, immutable` | 文件名固定，一年 |
| 用户媒体 | `/images/*`、`/videos/*` | 静态文件默认：`public, max-age=0`（带 ETag） | 可在 CF 上按需缓存；不含个人信息 |
| 分享图 | `/og/{code}.png` | `public, max-age=86400`；品牌兜底图（敏感帖、不存在、渲染失败）`public, max-age=300`、限流兜底 `public, max-age=60`；另有 `X-Robots-Tag: noindex` | 同一帖子内容变化时文件名哈希变化 |
| sitemap | `/sitemap.xml`、`/sitemap-main.xml`、`/sitemap-copies-N.xml` | `no-cache` | |
| robots.txt | `/robots.txt` | （无，Express 默认） | `Disallow: /api/`、`/dl`、`/node-dl`，并声明 sitemap |
| 下载代理 | `/dl?…`（Worker）、`/node-dl?…`（Node 应急） | `private, no-store`（成功下载）；错误 `no-store` | 带 `Content-Disposition: attachment` |
| 压缩 | HTML/CSS/JS/JSON/SVG | `Content-Encoding: br` 或 `gzip`，`Vary: Accept-Encoding` | `/dl`、`/node-dl` 不压缩 |

## Cloudflare 建议配置

1. **Caching → Cache Rules**：不要新增 "Cache Everything"。若已有，必须排除：`/{6 位短码}`、`/api/*`、`/dl*`、`/node-dl*`、`/og/*`（可缓存，但不是必须）。
2. 保持 "Respect origin Cache-Control"（Browser Cache TTL 选 "Respect Existing Headers"）。
3. `/dl*` 只给 Worker；`/api/*` 与 `/dl*` 的限流用 Worker 绑定或 WAF 规则（见 `workers/download-proxy/README.md`）。
4. 开启 Brotli 没问题；源站已自己压缩，二者不冲突。
5. 验证：`curl -sI https://xput.app/<任一短码>` 应看到 `cache-control: private, no-store`，并且 `cf-cache-status` 为 `DYNAMIC`（不是 `HIT`）。
