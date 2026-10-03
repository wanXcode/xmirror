# feature/frontend-v1 本地验收报告（2026-10-02）

## 结论与环境

按下表的独立验收点计：**通过 48 / 失败 6 / 未测 6**。未发现阻断上线级问题；4 项影响体验，2 项细节问题。测试数据和附加工具写入 `/tmp`，依赖安装写入忽略的 `node_modules/`；仓库代码未修改。验收期间未提交或推送代码。

- 分支：`feature/frontend-v1`，提交 `1756661`；`git pull` 返回 Already up to date。
- 工作区切换前已有未跟踪的 `docs/ui-audit-and-directions.md`、`public/redesign/`、`public/redesign-v2/`，因此**不满足“工作区干净”**；这些内容未被本次测试改动。
- Node `v26.8.0-alpha.0.0.0`、npm `11.19.0`，npm 提示该 Node 版本不在其支持范围；本地 Chrome + Playwright Core，桌面 1440px、模拟 iPhone UA 的 390px 手机视口。
- `npm install` 成功。`npm test` 在允许本机监听后 **343/343 通过，失败 0**。第一次沙箱内运行因 `listen EPERM 127.0.0.1` 失败，属于执行环境限制，不计为产品失败。完整日志：`/tmp/xput-test-20261002.log`。
- 初次沙箱内 DNS 无法解析 npm 和 fxtwitter；获准在沙箱外执行后外网可达，真实推文用例已实际运行，**没有因无网络而标为未测的用例**。
- 样例使用 `ops/seed-local.js` 写入临时 `DATA_DIR`；另在该临时库中为 `DEMO02` 添加标记媒体 URL，以使敏感媒体泄漏检查有实际测试数据。现有 `data/` 未触碰。

| 范围 | 通过 | 失败 | 未测 | 核验摘要 |
|---|---:|---:|---:|---|
| A 页面与 SEO | 10 | 0 | 0 | 固定页、404 的状态和源 HTML；Title、description、H1/H2、canonical、hreflang、JSON-LD、FAQ/步骤、无账号搜索/广告。`/zh` 规范化为 301 `/zh/`。 |
| B 样例结果页 | 8 | 0 | 1 | `DEMO01/02/03/04`、`OLD001`、未知短码和保留路径通过；含媒体的敏感样例在确认前 HTML/OG 均无标记 URL，确认后正文与媒体出现。 |
| C sitemap/robots | 2 | 0 | 0 | robots 指向 sitemap index；副本 sitemap 有 `DEMO04`，无普通、敏感、下架、旧别名与新普通副本。 |
| D 核心流程 | 10 | 0 | 2 | 真实推文媒体结构；GIF MP4 实际保存；下载中按钮禁用、Saved 状态；代理 `attachment`、域名限制；View 过渡/短码复用；媒体抽屉。 |
| E 错误与边界 | 5 | 1 | 2 | 空/乱码/主页链接、三种域名和 `?s=`、第 4 次 429、前端倒计时、离线 Try again；全 9 ID 错误态见下。 |
| F 多语言与排版 | 4 | 1 | 1 | 固定页真实语言链接、结果页 cookie 与原文不翻译、390px 无横向滚动和截字、长按钮上下排列；举报页中文空格见下。 |
| G Lighthouse 手机模式 | 6 | 3 | 0 | 三页 SEO 各 100、CLS 各 0；三页 LCP 均超过 2.5 秒目标。 |
| H 配置 | 3 | 1 | 0 | 显式空统计变量关闭脚本；显式设置后 `data-domain=xput.app`；邮箱有/无切换；未设置统计变量时仍加载脚本。 |
| **合计** | **48** | **6** | **6** | 统计单位为本表独立验收点，非 npm 单测数量。 |

### 核心流程证据

真实公开帖子测试样例：多清晰度视频 [SpaceX](https://x.com/SpaceX/status/1897790210219311202)（4 个 MP4 variants）；4 张原图 [Victoria Memorial Hall](https://x.com/victoriamemkol/status/2037565576613405064)（均为 `name=orig`）；GIF [Moonveil](https://x.com/Moonveil_Studio/status/1933469479822111000)（MP4）；视频加图片 [NASA JPL](https://x.com/NASAJPL/status/1950583566947213444)；带媒体引用帖 [GeovaniBeltrn](https://x.com/GeovaniBeltrn/status/1975644380200378663)；纯文字 [NASA](https://x.com/NASA/status/2041213300403249494)。桌面和手机结果卡均显示对应区块；4 图灯箱下一张与多清晰度展开正常。

GIF 下载在两种视口均触发浏览器 download 事件并保存 156625 字节 MP4；记录到 `is-busy` 且按钮禁用，随后 `is-saved`。代理对合法 `twimg.com` 的 HEAD 返回 `Content-Disposition: attachment`，对 `example.com`、伪装子域名和 HTTP URL 返回 400。View 出现 “Saving a copy…” 并进入 `/2vFXWD`；重复保存返回同一短码，结果页抽屉打开后 URL 未变。

原始断言和截图：`/tmp/xput-qa-http-results.json`、`/tmp/xput-qa-ui-results.json`、`/tmp/xput-qa-flow-results.json`、`/tmp/xput-qa-api-extra-results.json`、`/tmp/xput-qa-media-ui-results.json`、`/tmp/xput-sensitive-check-results.json`；`/tmp/xput-desktop-media-drawer.png`、`/tmp/xput-mobile-media-drawer.png`、`/tmp/xput-mobile-rate-limited.png`。HTTP 脚本最初 3 个红项经人工复核，其中未知短码为 HTML 实体转义、`/zh` 为正常规范化，均为断言误报；统计脚本项为真实差异。

## 失败项（按严重程度）

### 阻断上线

无。

### 影响体验

1. **F-01 首页手机 LCP 超目标。** 复现：在本地临时服务对 `/` 运行 Lighthouse 手机模式。预期：设计说明 §8 的 LCP `<2.5s`。实际：**4.3s**，复测 **5.6s**；CLS 0、SEO 100。证据：`/tmp/xput-lh-home.json`、`/tmp/xput-lh-home-repeat.json`；相关目标 `docs/design/DESIGN-SPEC.md` §8。此为本机模拟限速结果，仍需上线环境复核。
2. **F-02 Viewer 手机 LCP 超目标。** 复现：同法测 `/twitter-viewer`。预期 `<2.5s`；实际 **5.4s**，CLS 0、SEO 100。证据：`/tmp/xput-lh-viewer.json`；相关目标 `docs/design/DESIGN-SPEC.md` §8。
3. **F-03 中文首页手机 LCP 超目标。** 复现：同法测 `/zh/`。预期 `<2.5s`；实际 **5.6s**，CLS 0、SEO 100。证据：`/tmp/xput-lh-zh.json`；相关目标 `docs/design/DESIGN-SPEC.md` §8。
4. **F-04 某些不存在的帖子被呈现为“服务繁忙”。** 复现：`POST /api/resolve`，JSON `{"url":"https://x.com/SpaceX/status/9999999999999999999"}`；重复两次。预期：设计状态表中的“原帖不可用”，可检查已保存副本。实际：503 `SERVICE_UNAVAILABLE`；按已通过的前端 5xx 映射单测，此响应会显示忙碌/Try again，而不是不可用状态。同样不存在的邻近 ID `1897790210219311203` 返回 404 `SOURCE_UNAVAILABLE`。当时 fxtwitter 回 404、syndication 回 400，聚合逻辑将其归为服务故障；属于上游响应组合相关的边界问题。证据：`/tmp/xput-qa-live-results.json`、`/tmp/xput-qa-final-http-results.json`；相关文件 `lib/fetchers/errors.js:22`、`lib/fetchers/index.js:111`。

### 细节

5. **F-05 未设置统计环境变量时仍加载统计脚本。** 复现：不设置 `ANALYTICS_DOMAIN`、`ANALYTICS_SRC` 启动服务，查看 `/` 源 HTML。预期：按本次验收要求，不加载统计脚本。实际：存在 `<script data-domain="xput.app" src="https://a.zhxs.me/js/script.js">`；配置文件提供了默认值。显式置空任一变量可关闭，显式设置两者时 `data-domain=xput.app` 正常。证据：`/tmp/xput-qa-http-results.json`、`/tmp/xput-qa-config-rate-results.json`；相关文件 `config/site.json:4`、`lib/site.js:10`、`lib/views/layout.js:74`。此处也与 `docs/local-testing.md` §6 所述的“环境变量优先于配置文件”有关，应明确最终配置契约。
6. **F-06 中文举报页数字前缺空格。** 复现：访问 `/zh/report`，查看首段和审核步骤。预期：与站内“在 3 个工作日内”等中文文案的数字间距一致。实际两处显示“通常在3 个工作日内”。证据：页面源 HTML、`lib/content/zh.js:360` 和 `lib/content/zh.js:383`；其余抽查的中文固定页未发现同类普通正文问题（日期格式未计入）。

## 未测项与原因

1. **B：线上历史存档批量兼容性。** 未提供线上 `data/` 的安全副本；按要求没有触碰现有 `data/`。本地仅核对 `OLD001 → DEMO05` 和种子数据。
2. **D：超过约 150MB 视频的浏览器原生下载回退。** 未找到适合且可稳定访问的公开大文件样例；常规 MP4 下载和代理响应头已验证。
3. **D：Cloudflare Worker 的线上路由、zone、WAF/限流绑定。** 本地只测试 Node `/dl` 代理及 Worker 单测；没有线上 Cloudflare 配置与流量入口。
4. **E：从真实公网来源伪造 `CF-Connecting-IP` 的端到端请求。** 本机没有可控公网对端；本地内网来源的第 4 次 429 已验证，`npm test` 中的公开对端不信任单测通过。
5. **E：真实私密账号帖子。** 无合适且获准的私密账号链接；公开不存在帖子、上游错误组合、离线状态已测试。
6. **F：真机系统能力。** 390px iPhone UA 仅是浏览器模拟，不能验证 Safari/Android 的系统分享、相册、文件管理与快捷指令权限。

### 仅需真人用手机验证

- iPhone Safari：下载后在“文件”中找到 MP4，再保存到“照片”；图片 Web Share；快捷指令安装和首次运行权限。
- Android Chrome：下载进入系统“下载内容”/相册、图片分享面板与文件保存。
- 手机浏览器的系统剪贴板/分享权限、前后台切换及真实触控手势。局域网 HTTP 下部分能力不可用，需 HTTPS 隧道复核。

## 附注

`npm install` 提示 2 个 moderate 依赖告警；本轮未执行依赖安全审计，不将其计为上述验收失败。`/tmp` 下的测试产物和数据目录可在验收后清理，未包含在本报告的提交中。
