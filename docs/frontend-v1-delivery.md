# XPut 前端第一期：交付说明

分支：`feature/frontend-v1`（未创建 PR，未合并 main）。自动化测试 381 项全部通过；浏览器验收脚本 125 项全部通过。

## 1. 交付范围

站点由"推文存档"改造为"X 视频/图片下载器 + 可选永久副本 + Twitter Viewer"。全部页面为服务端渲染，中英文双语，无广告，Viewer 页没有账号搜索、主页浏览或时间线。

| 页面 | 说明 |
|---|---|
| `/`、`/zh/` | 下载器首页：输入框、结果卡、步骤、手机指引、FAQ |
| `/twitter-viewer`、`/zh/twitter-viewer` | Viewer 页：View 生成副本短链 |
| `/{shortCode}` | 保存的帖子结果页（普通版 noindex；精选版可收录） |
| `/ios-shortcut`、`/zh/ios-shortcut` | iPhone 快捷指令介绍页（桌面显示真实二维码） |
| `/privacy`、`/report`（含 `/zh/`） | 隐私政策、举报/删除申请 |
| 404 | 友好的未找到页（保存帖子的短码不存在有单独页面） |
| `/og/{code}.png` | 分享预览图（1200×630） |
| `/sitemap.xml` 等 | sitemap 索引（固定页 + 精选副本）、robots.txt |

## 2. 主要功能

- **解析与下载**：视频多清晰度、GIF（MP4）、图片（原图、多张 ZIP 或手机系统分享存相册）、引用帖媒体；下载经代理并强制保存为附件；超过 150MB 交给浏览器原生下载；下载中进度、已保存、限流倒计时；iPhone / Android 保存指引提示条。
- **结果卡（设计规范 4.2.1）**：桌面 340px 缩略图列、竖屏最高 400px；手机预览 ≤50vh；主按钮"Download HD · 1080p"（最小高度 56px，文字换行不截断）；"其他清晰度"默认展开；手机解析成功后自动滚动，主下载按钮在首屏内。
- **下载面板（5.2.1）**：紧凑列表，72px 缩略图，图片可勾选；桌面弹窗 600px、手机抽屉，最大 80vh，内部滚动；与结果卡复用同一套按钮逻辑。
- **键盘与焦点**：仅键盘显示焦点环（2px #1747C9）；弹窗初始焦点在第一个下载按钮，Tab 在弹窗内循环，Esc/遮罩/关闭回到"下载媒体"。
- **View 与短链**：保存副本过渡、已保存直接跳转；旧短码、旧别名（301）、旧静态地址继续有效；下架副本返回 410。
- **年龄确认**：服务端强制，确认前页面标题、正文、OG 标签、媒体链接都不含内容；确认存会话 cookie。敏感帖仍不允许存档（View 路径代码保留）。
- **收录规则**：可收录 = 上线的 AI 精选页，或已选入原「值得再读」的存档（`seo_status='index'` 且未屏蔽，沿用原有的自动评分和手动选入机制，新存档同样可被选入）；其中标记敏感、被屏蔽、有未处理举报、已下架的一律 noindex 并不进 sitemap；其余页面 `noindex, follow`。**新存档自动收录的额外门槛**（全部满足才收录）：X 返回 `possibly_sensitive` 为 true（含引用帖带标记）的不收录；每天自动新增最多 20 条，超出顺延到次日（`SEO_AUTO_INDEX_DAILY_CAP`，人工选入不受限；`SEO_AUTO_INDEX=false` 可整体改为人工）。「值得再读」存档用普通结果页模板，robots 为 `index, follow`，沿用原有 SEO 标题和摘要，并输出 SocialMediaPosting 结构化数据。
- **「值得再读」列表**（英文 Worth reading；`/browse`、`/zh/browse`）：新版视觉、中英文各自的 URL 和 hreflang，列出上线的 AI 精选页与已选入的存档，支持搜索（搜索结果页 noindex）和分页；页脚有入口，主 sitemap 收录；AI 精选页面包屑"Saved posts"链接到它。
- **精选页**：门槛（互动 ≥50、粉丝 ≥1000、非敏感、未被屏蔽、无未处理举报）+ AI 内容质量检查 + 人工复核 + 每天上限 10 个；命中硬性条件自动下架；管理接口 `/api/admin/featured/*`（暂无后台界面）。
- **SEO**：canonical、hreflang（固定页）、OG/Twitter 标签、JSON-LD（Organization 全站、WebApplication、FAQPage、SocialMediaPosting）、sitemap 索引（主 sitemap + 副本 sitemap）、robots.txt。
- **上游错误处理**：帖子不存在/已删除/私密/被暂停统一为"原帖不可用"（404 + `reason`），不重试、不切换数据源、日志带 `definitive: true`（统计来源成功率时应排除）；真正的故障（超时、5xx、解析失败）仍是 503。

## 3. 本轮（设计 v3 评审后）的改动

- 设计画板 v3、`DESIGN-SPEC.md` 交付版（含 4.2.1、5.2.1）入库；字体说明改为"中文系统字体"。
- 结果卡与下载面板按新规范重做；"其他清晰度"改为默认展开（产品决定，画板为收起，仍可收起）。
- Logo B 全面更换：页头、favicon（svg/png/ico）、apple-touch-icon、默认分享图、manifest 颜色。
- 配置项：统计脚本域名/地址、统计服务名、联系邮箱（环境变量优先于 `config/site.json`；设为空字符串即关闭）。
- 中文文案规范化（"在 3 个工作日内"等），并加了防回归测试。

## 4. 性能（手机 Lighthouse，本地生产模式）

LCP 1.4–1.7s，CLS 0，所有页面性能分 99–100。改动要点：拉丁字体自托管并内联 `@font-face`、预加载首屏 4 个字体文件；开启 br/gzip 压缩；CSS/JS 版本号带内容哈希并缓存一年（immutable）；中文使用系统字体（Noto Sans SC 网络字体每页约 700KB，已弃用；分享图仍用它渲染）。

## 5. 新增依赖与许可证

`satori`、`@resvg/resvg-js`（分享图）、`qrcode`（二维码）、`compression`（压缩）、`@fontsource/{ibm-plex-sans,space-grotesk,noto-sans-sc}`（字体，SIL OFL 1.1；许可证文本在 `licenses/` 与 `/fonts/LICENSE.txt`）。

## 6. 上线前需要手动完成

1. 设置环境变量 `ANALYTICS_NAME`（隐私页统计服务名）和 `CONTACT_EMAIL`（隐私页、举报页联系邮箱）；隐私政策"最后更新"日期按正式上线日填写（现为 2026-10-03，上线日期变动时同步修改）。
2. 部署 `workers/download-proxy`（Cloudflare Worker），核对 `wrangler.toml` 的路由、zone、限流绑定写法；生产环境本地 `/dl` 默认关闭，下载全部走 Worker。
3. 真机验证（需 HTTPS 隧道或线上环境）：iPhone Safari / Android Chrome 的下载、图片系统分享、快捷指令；旧存档用线上数据副本抽查。
4. 上线后在 Search Console 提交 `https://xput.app/sitemap.xml`。

## 7. 已知取舍（需知悉）

- 手机页头不固定（画板里页头始终可见，但固定页头会改变手机菜单/语言面板层级，按默认方案未做）。
- 敏感帖不存档；举报接口新增了"可用 X 帖子链接查找副本"（原有行为不变）；翻译/字幕后端代码无界面入口，保留未删。
- 精选页 AI 内容目前通过管理接口录入，无后台界面。
- 已删除 `safari-pinned-tab.svg` 及对应 `<link rel="mask-icon">`。

## 8. 上线运维（待办已处理）

- 下载代理容灾：`DOWNLOAD_VIA=worker|node`，应急只需改环境变量重启，见 `docs/download-proxy-rollout.md`（含上线顺序）。
- 缓存头：见 `docs/caching.md`（结果页 `private, no-store`，`/api/*` 一律 `no-store`）。
- 管理接口：未带或错误 token 返回 401，服务器未配置 token 返回 503；`robots.txt` 屏蔽 `/api/`、`/dl`、`/node-dl`。
- 翻译/字幕后端路由：生产默认关闭（`FEATURE_TRANSLATION=true` 开启），代码保留。

## 9. 文档与工具

`docs/local-testing.md`（本地启动、手机真机、测试清单、配置优先级）、`docs/frontend-open-questions.md`（决策与待确认记录）、`docs/test-report-20261002.md`（验收报告）、`ops/seed-local.js`（样例数据）、`ops/e2e-results.js`（结果卡/下载面板浏览器验收，截图在 `docs/screenshots/v3/`）。
