# 下载代理：上线顺序与应急切换

下载经代理转发并带 `Content-Disposition: attachment`，否则浏览器会在新标签页播放视频。超过 150MB 的文件也走代理，只是前端不把它读进内存而是交给浏览器原生下载（地址仍是 `/dl?u=…`，不会直接打开 twimg 原始地址；有测试守护）。

## 开关

| 变量 | 行为 |
|---|---|
| `DOWNLOAD_VIA=worker`（生产默认） | 页面使用 `/dl`，由 Cloudflare Worker 处理；Node 不提供代理 |
| `DOWNLOAD_VIA=node` | 页面改用 `/node-dl`，由 Node 的 `lib/download-proxy.js` 处理（规则与 Worker 相同：只允许 https `*.twimg.com`、不跟随重定向、不转发访客头、`attachment`、按 IP 限流 `DOWNLOAD_RATE_LIMIT_PER_MIN`） |
| 其他取值 | 启动即报错退出，避免悄悄选错模式 |
| `DOWNLOAD_PROXY_BASE` | 直接指定页面使用的下载地址（如本地 `wrangler dev`） |

应急路径用 `/node-dl` 而不是 `/dl`：Worker 路由 `xput.app/dl*` 匹配不到它，所以**只改环境变量并重启 Node 就生效，不需要改 Cloudflare**。启动日志会打印当前模式（`下载代理: node（页面使用 /node-dl）`）。

## 上线顺序

1. 部署 Worker：`cd workers/download-proxy && npx wrangler deploy`（先核对 `wrangler.toml` 的路由、zone、`RATE_LIMITER` 绑定）。
2. **用真实链接验证 Worker**（此时线上仍是旧版前端）：
   - `curl -sI "https://xput.app/dl?u=<真实的 video.twimg.com mp4 地址>&n=test.mp4"` → `200`/`206`，含 `content-disposition: attachment`、`content-length`、`cache-control: private, no-store`；
   - 非 twimg 地址（如 `u=https://example.com/a.mp4`）→ `400`；
   - 连续请求超过限额 → `429` 且带 `Retry-After`；
   - 浏览器里打开该链接应直接下载，不在新标签页播放。
3. 确认第 2 步全部通过后，再发布新版前端（`DOWNLOAD_VIA` 在生产默认即 worker，无需设置）。
4. 发布后用手机真机各下载一次视频和图片。

## 应急（Worker 故障）

1. 在生产环境加 `DOWNLOAD_VIA=node`，重启 Node。
2. 确认：页面源码里的 `downloadBase` 为 `/node-dl`；下载一个视频成功。
3. 注意：此时带宽走源站 Node，只作应急；Worker 恢复后删除该变量（或改回 `worker`）并重启。
