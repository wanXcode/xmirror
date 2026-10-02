# 本地预览与测试清单（feature/frontend-v1）

## 1. 启动

```bash
git checkout feature/frontend-v1 && npm install
npm test                      # 先跑一遍自动化测试，应全部通过（341 项）
npm start                     # 默认 http://localhost:3000，数据在 ./data
```

- 需要 Node ≥ 20.17（项目在 Node 22 上开发）。不需要 ffmpeg 就能测下载/查看；字幕、翻译相关后端没有界面入口，可忽略。
- 解析帖子要访问外网（fxtwitter / X syndication），本机需要能上外网。
- 本地没有 `NODE_ENV=production`，所以 `/dl` 下载代理默认开启（见 §5）。

### 预览用的样例数据

服务启动一次后（会自动建表），另开终端：

```bash
MODERATION_ADMIN_TOKEN=local-test PORT=3000 node ops/seed-local.js
```

启动服务时也要带同一个 token：`MODERATION_ADMIN_TOKEN=local-test npm start`。脚本会写入：

| 地址 | 状态 |
|---|---|
| `/DEMO01` | 普通保存页（noindex） |
| `/DEMO02` | 敏感帖：未确认年龄时不显示任何内容 |
| `/DEMO03` | 已下架：410 + 参考编号 |
| `/DEMO04` | 精选页（index，带 AI 摘要、JSON-LD） |
| `/OLD001` | 旧别名短码：301 到 `/DEMO05` |
| `/ZZZZZZ` | 不存在的短码：「这个链接不存在」+ 输入框 |

脚本只在本地用，`NODE_ENV=production` 时会拒绝运行。

## 2. 用手机真机访问（同一局域网）

1. 查电脑局域网 IP：macOS `ipconfig getifaddr en0`；Linux `hostname -I`；Windows `ipconfig`（IPv4 地址），例如 `192.168.1.23`。
2. 用这个地址作为站点地址启动（**必须设置**，否则下面第 3 点会出问题）：
   ```bash
   PUBLIC_BASE_URL=http://192.168.1.23:3000 MODERATION_ADMIN_TOKEN=local-test npm start
   ```
   服务已监听 `0.0.0.0`，手机连同一个 Wi-Fi，浏览器打开 `http://192.168.1.23:3000`。打不开时检查电脑防火墙是否放行 3000 端口、路由器是否开了「AP 隔离/访客网络」。
3. 为什么要设 `PUBLIC_BASE_URL`：年龄确认（`/api/age-confirm`）和举报（`/api/reports`）会校验请求来源，来源不是 `PUBLIC_BASE_URL` 或 localhost 会返回 403；它也决定 canonical、OG 图、sitemap 里的地址。
4. **局域网是 http，不是安全上下文**，以下浏览器能力在手机真机上会不可用或降级，这不是 bug：
   - 「粘贴」按钮和剪贴板自动检测（Clipboard API）；手动长按粘贴到输入框仍可用。
   - 系统分享面板（Web Share）、部分浏览器的「复制链接」。
   - 需要完整验证这些时，用 HTTPS 隧道：`cloudflared tunnel --url http://localhost:3000`（或 ngrok），把得到的 `https://xxx` 作为 `PUBLIC_BASE_URL` 重新启动，再用手机打开该地址。隧道地址也能用来测微信/Telegram/X 里的链接预览（OG 图）。
5. 想在手机上看 iPhone 快捷指令页的「获取快捷指令」按钮：用 iPhone 的 Safari 打开 `/ios-shortcut`；桌面浏览器会显示二维码。

## 3. 需要逐项验证的关键流程

建议桌面 Chrome 一遍，iPhone Safari 和 Android Chrome 各一遍。测试帖子请自备：带视频的帖子、多视频/视频+图片的帖子、只有图片的帖子、GIF、纯文字帖。

### 3.1 下载视频（首页 `/`）
- [ ] 粘贴带视频的帖子链接 → 点 Download → 出现结果卡，显示缩略图、时长、多个清晰度和文件大小。
- [ ] 点最高画质 → 出现进度；文件保存成功；iPhone 上出现「已保存到文件，可在 文件 → 分享 → 存储视频」提示条，其中有快捷指令链接。
- [ ] 「其他清晰度」里选 720p/480p 能下载；播放预览能播放。
- [ ] 多视频、视频+图片的帖子：分别显示成独立的区块。
- [ ] GIF 下载得到 MP4。
- [ ] 超过约 150MB 的视频走浏览器原生下载（不显示进度条）。

### 3.2 保存图片
- [ ] 只有图片的帖子：每张图原图尺寸，点开图片是大图查看，可左右切换/关闭。
- [ ] 桌面：多张图可「全部下载为 ZIP」，解压后文件完整。
- [ ] 手机：可一次保存全部图片/单张保存到相册（iOS 受系统分享限制，按页面提示操作）。

### 3.3 View 生成短链（`/twitter-viewer`，或首页的 View）
- [ ] 粘贴帖子 → View post → 出现「正在保存」→ 跳转到 `/{短码}`。
- [ ] 保存页：作者、正文、时间（含保存时间）、回复数、视频/图片、复制链接、分享、在 X 打开、下载媒体抽屉都可用。
- [ ] 同一帖子再次 View：返回同一个短码（「已存在」）。
- [ ] 视频帖：视频仍在保存时页面显示提示，完成后自动更新。
- [ ] 普通保存页源码里有 `noindex, follow`；canonical 指向自身；没有 hreflang。
- [ ] `/DEMO04`（精选页）源码里是 `index, follow`，有 SocialMediaPosting JSON-LD、AI 摘要区块（虚线框、「Not written by the post's author」说明）、相关推荐。
- [ ] 浏览器直接打开 `/og/DEMO01.png`：1200×630 的分享图；敏感帖/不存在的短码返回品牌图。

### 3.4 旧短链能否打开
- [ ] **最重要**：把线上的 `data/`（`db.sqlite` + `images/` + `videos/`）**复制一份**到本地临时目录（`DATA_DIR=/path/to/copy npm start`，不要直接指向生产目录），随机抽查几十个线上已分享过的短码，都能打开且内容完整。
- [ ] 旧别名短码（重复合并产生的）301 到主短码：`/OLD001` → `/DEMO05`。
- [ ] 旧静态地址 `/archives/post_xxx.html` 301 到对应短码；找不到的返回 404。
- [ ] 老存档现在也是 `noindex`（已按你的决定）。
- [ ] `/DEMO03` 返回 410，页面有「这份副本已被移除」和参考编号。

### 3.5 年龄确认
- [ ] `/DEMO02` 首次打开：页面标题通用、没有正文/图片/描述；查看源码和 OG 标签里也没有任何帖子内容。
- [ ] 点确认 → 页面刷新显示内容；关闭浏览器再开（会话 cookie）需要重新确认。
- [ ] 首页/Viewer 解析一个真实敏感帖：出现年龄提示卡；确认前不下发媒体链接（看网络面板里 `/api/resolve` 的返回）。
- [ ] 注意：敏感帖仍然不允许存档（View 会被拒绝），这是预期的。

### 3.6 各种错误/空状态
- [ ] 空输入点 Download；粘贴非 X 链接；粘贴 X 个人主页/搜索页链接（应提示粘贴具体帖子）；
- [ ] 不存在/已删除的帖子 ID（如把真实链接的数字改掉）；私密账号的帖子；
- [ ] 断网（浏览器 DevTools → Network → Offline，或关 Wi-Fi）后点 Download；
- [ ] 频率限制：`FETCH_RATE_LIMIT_PER_MIN=3 npm start`，连续点 4 次，出现「请求过于频繁」及倒计时；
- [ ] 下载中途断网/停止（DevTools throttling）；浏览器拦截下载时的提示；
- [ ] 举报页：空字段、邮箱格式错误、必须勾选确认；提交成功（返回编号）；用 X 帖子链接和 `/DEMO01` 链接都能提交；不存在的链接 → 找不到；一分钟内提交 6 次 → 太频繁。管理员在 `/admin-xput.html` 能看到举报。
- [ ] 随便打开一个不存在的地址（`/no/such/page`、`/zh/xxx`）：友好的 404 页，带输入框；`/api/xxx`、`/images/xxx.jpg` 是纯文本 404。

### 3.7 中英文切换
- [ ] 每个页面（首页、Viewer、快捷指令、隐私、举报、404、保存页）右上角（手机是语言按钮/底部抽屉）切换，URL 在 `/xxx` 与 `/zh/xxx` 之间对应变化；
- [ ] 页脚的 English / 中文 链接同样有效；
- [ ] 保存页和 404 的语言按 cookie `xput_lang` / 浏览器语言；`/DEMO01?lang=zh` 会设置 cookie 并 302；
- [ ] 中文页面里没有残留英文占位符（如 `[time]`、`{date}`）；隐私政策里的统计服务名、联系邮箱在配置后正确显示（见 §6）；
- [ ] 手机上：菜单抽屉、语言抽屉、遮罩、返回键行为；长中文文案不撑破布局。

### 3.8 其他
- [ ] `/sitemap.xml`（索引）→ `/sitemap-main.xml`（固定页，含 hreflang）、`/sitemap-copies-1.xml`（只有精选且仍可收录的页面）；`/robots.txt`。
- [ ] 查看页面源码确认服务端渲染（不开 JS 也能看到正文、FAQ、步骤）。
- [ ] 手机真机上看首屏速度、有无布局跳动；也可跑 Lighthouse（Chrome DevTools → Lighthouse → Mobile）。跑分请用生产模式：`NODE_ENV=production npm start`，并确认响应带 `Content-Encoding: br/gzip`、`/css`、`/js` 带 `?v=` 且 `Cache-Control: ...immutable`、字体来自 `/fonts/`（不再请求 Google Fonts）。

## 4. 精选页流程（管理接口，无后台界面）

```bash
T='x-admin-token: local-test'; J='content-type: application/json'
curl -H "$T" localhost:3000/api/admin/featured                 # 候选列表和各项门槛
curl -X POST -H "$T" -H "$J" localhost:3000/api/admin/featured/POST_ID -d '{"ai_title":"…","topic":"…","summary":"…","context":"…","key_points":["…","…","…"]}'
curl -X POST -H "$T" -H "$J" localhost:3000/api/admin/featured/POST_ID/review -d '{"reviewed":true}'
curl -X POST -H "$T" localhost:3000/api/admin/featured/POST_ID/publish
curl -X POST -H "$T" localhost:3000/api/admin/featured/POST_ID/withdraw
```

阈值：互动（浏览+分享）≥ 50、粉丝 ≥ 1000、每天最多 10 个（`config/featured.json`）。验证：没复核不能发布；编辑已上线内容后回到草稿；出现未处理举报/被屏蔽/敏感时页面自动下架并变回 noindex。粉丝数拿不到时用 `POST …/followers {"followers": 5000}` 手动设置。

## 5. 本地无法完整测试的部分与替代方式

| 功能 | 为什么本地测不全 | 本地替代 |
|---|---|---|
| Cloudflare Worker 下载代理（`xput.app/dl/*`） | 路由、zone、限流绑定只存在于 Cloudflare 账号里 | 本地 Node 的 `/dl` 代理逻辑一致（只允许 https `*.twimg.com`、不跟随重定向、`Content-Disposition: attachment`、不转发访客头），前端流程可完整测；Worker 核心逻辑由 `test/download-proxy.test.js` 覆盖。想跑 Worker 本体：`cd workers/download-proxy && npx wrangler dev`，再用 `DOWNLOAD_PROXY_BASE=http://<IP>:8787/dl` 启动站点（限流绑定 `RATE_LIMITER` 在本地模拟器里不一定生效）。上线后需在 Cloudflare 上手动核对 `wrangler.toml` 的路由/zone/限流写法。 |
| 真实 IP 限流（按访客 IP） | 本地所有请求来自同一 IP，且线上 IP 来自 Cloudflare 的 `CF-Connecting-IP` | 调低阈值测逻辑：`FETCH_RATE_LIMIT_PER_MIN=3`、`DOWNLOAD_RATE_LIMIT_PER_MIN=3`。模拟不同访客：`curl -H 'CF-Connecting-IP: 1.2.3.4' …` 与 `5.6.7.8`（只有来自内网/本机的连接才信任这个头，所以本地可以模拟，公网直连不会被伪造）。Cloudflare 层面的限流/WAF 本地无法验证。 |
| HTTPS 才有的浏览器能力（剪贴板、Web Share） | 局域网是 http | 用 cloudflared/ngrok 隧道（见 §2.4）。 |
| 链接预览（微信/X/Telegram 的卡片） | 需要公网可访问的 URL | 同样用隧道；用隧道地址在聊天里发一个保存页链接。 |
| 搜索引擎收录、sitemap 提交、Search Console | 只有线上域名能验证 | 本地检查 sitemap/robots/robots meta/JSON-LD 的内容；上线后在 Search Console 提交 `https://xput.app/sitemap.xml`。 |
| 统计脚本 | 需要外部服务与线上域名 | 本地可用 `ANALYTICS_SRC=`（空）关闭；不设变量时按 `config/site.json` 加载（域名 `xput.app`，见 §6）。 |
| 线上真实数据的数量/性能 | 本地数据少 | 复制一份线上 `data/` 做 §3.4 的抽查。 |

## 6. 可配置项（环境变量，优先于 `config/site.json`）

**优先级规则：** 环境变量 > `config/site.json` > 代码默认值。变量**未设置**时读取 `config/site.json`（其中统计脚本的 `data-domain` 为 `xput.app`，脚本地址为 `https://a.zhxs.me/js/script.js`，所以本地不设变量也会加载统计脚本）；变量**设为空字符串**表示关闭（`ANALYTICS_SRC=` 或 `ANALYTICS_DOMAIN=` 任一为空就不加载）。`ANALYTICS_NAME`、`CONTACT_EMAIL`、`SHORTCUT_URL` 同理。


| 变量 | 作用 |
|---|---|
| `PUBLIC_BASE_URL` | 站点对外地址（canonical、OG、sitemap、来源校验） |
| `ANALYTICS_DOMAIN` / `ANALYTICS_SRC` | 统计脚本的 `data-domain` 与脚本地址；任一为空则不加载 |
| `ANALYTICS_NAME` | 隐私政策里写的统计服务名（为空则用通用描述） |
| `CONTACT_EMAIL` | 隐私页和举报页显示的联系邮箱（为空则不显示） |
| `SHORTCUT_URL` | iPhone 快捷指令的 iCloud 链接 |
| `FETCH_RATE_LIMIT_PER_MIN` / `DOWNLOAD_RATE_LIMIT_PER_MIN` | 解析/下载限流 |
| `DOWNLOAD_PROXY_BASE`、`ENABLE_LOCAL_DOWNLOAD_PROXY` | 下载代理地址、是否启用本地代理 |
| `MODERATION_ADMIN_TOKEN` | 管理接口口令（不要提交到代码或日志） |
| `VIEW_COUNTER_FLUSH_MS` | 浏览/分享计数写库间隔 |

## 7. 浏览器自动验收（结果卡与下载面板）

`ops/e2e-results.js` 用 Playwright 在 1366×768、1440×900、390×844 三个视口解析一条横屏、一条竖屏视频，断言主下载按钮完整位于首屏、预览尺寸上限（桌面 340px 列 / 竖屏最高 400px，手机 ≤50vh）、按钮 min-height 56px 与文案、「其他清晰度」间距 4px、正文最多 2 行；并测试下载面板（单视频、混合媒体、图片帖）的键盘打开、初始焦点、Tab 循环、Esc/遮罩/关闭按钮后焦点回到「下载媒体」、焦点环样式、+30% 长文本不截断。它不属于 `npm test`（需要浏览器）：

```bash
npm install --no-save playwright-core
CHROME_PATH=/path/to/chrome node ops/e2e-results.js            # 截图写入 docs/screenshots/v3/
```
