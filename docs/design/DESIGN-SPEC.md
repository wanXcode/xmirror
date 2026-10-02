# XPut 设计修改说明 v2

> 依据：关键词数据与新版产品规划（本文覆盖此前文档与画布中冲突的部分），以及上一轮交互评审意见。
> 视觉风格不变：沿用「温度品牌风格」（奶油底 #FBF7F0、白卡片、主色 #1747C9 只用于可点击元素、暖橙 #FF8A4C 只做装饰；标题 Space Grotesk，正文 IBM Plex Sans；中文使用系统字体（PingFang SC、Microsoft YaHei、Noto Sans CJK SC），拉丁文字使用自托管的 Space Grotesk / IBM Plex Sans；OG 图仍用 Noto Sans SC 渲染）。

---

## 0. 变更摘要

| 类别 | 变更 |
| --- | --- |
| 页面 | 取消 /image-downloader、/gif-downloader、/video-downloader 独立页；第一期只有首页、Viewer 页、结果页，各含中英文 |
| 优先级 | Viewer 页提升到与首页同等，需完整桌面/手机及全部状态 |
| 导航 | 简化为 Video Downloader、Twitter Viewer、语言切换 |
| 结果页 | 路径从 /p/[id] 改为沿用现有短码 /{shortCode}（如 /h0b9Ls）；默认全部 noindex, follow；只有通过高门槛并经抽检的结果页才切换为精选版（AI 标题与补充内容）并开放收录，按日限量放量 |
| 结果卡 | 按媒体类型区分交互：视频 / 图片 / GIF / 混合媒体 / 引用帖 / 纯文字 |
| 手机保存 | 下载后给出 iPhone / Android 的保存指引；图片改用系统分享面板，不用 ZIP |
| View 流程 | 新增「正在保存副本」过渡、「已保存过」快捷路径、结果页内下载抽屉 |
| 多语言 | 语言切换做成可扩展列表；所有按钮和标题承受 +30% 文本长度；为 pt-BR 预留 |
| SEO | Title / Meta / H1 / H2 / FAQ 文案直接落到页面上；技术要求写进交付说明 |

---

## 1. 第一期页面清单与画布对应

| 路径 | 页面 | 桌面 | 手机 | 画布处理 |
| --- | --- | --- | --- | --- |
| / | 首页（英文） | ✓ | ✓ | 改：W_Home_D / W_Home_M |
| /twitter-viewer | Viewer 页（英文） | ✓ | ✓ | 改：W_Viewer_D / W_Viewer_M |
| /zh/ | 首页（中文） | ✓ | ✓ | 改：W_HomeZH_D / W_HomeZH_M（重写文案，不直译） |
| /zh/twitter-viewer | Viewer 页（中文） | ✓ | ✓ | 新增 |
| /{shortCode} | 推文查看结果页（普通版，noindex） | ✓ | ✓ | W_Copy_D / W_Copy_M / W_CopyZH_M |
| /{shortCode} | 推文查看结果页（精选可收录版） | ✓ | ✓ | W_Featured_D/M、W_FeaturedZH_D/M |
| /ios-shortcut | iPhone 快捷指令介绍页（英文） | ✓ | ✓ | 新增：W_Shortcut_D / W_Shortcut_M |
| /zh/ios-shortcut | iPhone 快捷指令介绍页（中文） | ✓ | ✓ | 新增：W_ShortcutZH_D / W_ShortcutZH_M |
| — | 首页状态汇总 | ✓ | ✓ | 改：W_States_D / W_States_M |
| — | Viewer 状态汇总 | ✓ | ✓ | 新增 |
| — | 结果卡组件库（各媒体类型） | ✓ | ✓ | 新增 |
| — | 下载后反馈与手机保存指引 | — | ✓ | 新增 |

**从画布移除**（第二期或取消）：W_Video_D/M、W_Image_D/M、W_GIF_D/M、W_Guide_D/M。
说明：举报页、隐私页、404 属于基础页，开发可直接用通用模板；如需设计稿可在第一期末补手机版。

**设计顺序**：Viewer 手机版 → 首页与 Viewer 的各种状态 → 推文查看结果页 → 中文版。

---

## 2. 全局组件

### 2.1 顶栏

- 桌面：Logo ｜ Video Downloader · Twitter Viewer ｜ 语言切换。当前页导航项用暖橙浅底高亮。
- 手机：Logo ｜ 语言切换 ｜ 菜单按钮（菜单内为两个导航项）。
- 首页导航项文字为 "Video Downloader"，链接到 /（不再有独立视频页）。

### 2.2 语言切换（可扩展）

- 触发按钮显示当前语言名称（English / 中文），点击展开下拉列表；手机为底部抽屉。
- 列表项用各语言的自称：English、中文、Português (Brasil)（第二期出现）。
- 每项都是真实的 `<a href>`，指向对应语言的同一页面；结果页（无语言前缀）切换语言时写入偏好 cookie 并刷新。
- 列表按 6 种语言的高度设计，超出后可滚动。

### 2.3 文本长度弹性（为 pt-BR 预留）

- 所有按钮不设固定宽度，用最小宽度 + 内边距；文本超长时换行而不是截断。
- 手机端 Download / View 两按钮在文本超长时自动改为上下排列（各占整行）。
- H1 在手机上允许三行；桌面 H1 最大宽度 900px。
- 设计稿中为首页与 Viewer 各加一个「+30% 长度」压力测试画板（用加长的占位英文）。

### 2.4 页脚

链接：Video Downloader、Twitter Viewer、iPhone Shortcut、语言版本（English / 中文）、Privacy、Report content；声明 "Not affiliated with X Corp."。

### 2.5 广告位

- 第一期不放广告，所有画板已移除广告位。
- 以后接入时的原则不变：固定尺寸占位防止 CLS；不放在首屏、输入框与按钮之间、结果卡内部和敏感内容页面；广告样式不得像按钮；每页最多 2 个。
---

## 3. 输入组件

- 组成：输入框 + Paste 按钮 + 主操作。
  - 首页：Download（主，实心）+ View（次，描边）。
  - Viewer 页：只有 View post（主）。
- Paste 读取剪贴板；读取失败时提示 "Long-press the box to paste"。
- 页面加载时如果剪贴板权限已授予且内容是 X 链接，不自动提交，只在输入框下方显示一行「检测到链接，点击填入」。
- 接受的链接：x.com、twitter.com、mobile.twitter.com、带查询参数的分享链接；非帖子链接（如个人主页）提示 "Paste a link to a single post".

---

## 4. 结果卡（核心改动）

### 4.1 通用结构

1. 头部：作者头像、名称、@handle、正文首行、媒体数量与类型。
2. 媒体块（每个媒体一个块，按推文顺序）。
3. 底部：View & save a copy（文字链）、Open on X。

### 4.2 各媒体类型

| | 视频 | 图片 | GIF |
| --- | --- | --- | --- |
| 预览 | 缩略图加播放按钮，点击在卡内静音播放 | 网格（1–4 张），点击全屏查看 | 自动循环播放（静音） |
| 主操作 | 一个大按钮：Download HD · 1080p · [大小] | 手机：Save all to Photos（系统分享面板）；桌面：Download all (ZIP) | Download GIF (MP4) |
| 次要操作 | 「Other qualities ▾」折叠，展开后列出其余清晰度 | 网格角标勾选部分图片；全屏查看中保存单张 | 说明文字：X 上的 GIF 以 MP4 存储，可在 WhatsApp / Telegram 中作为动图发送 |
| 信息 | 时长、分辨率、文件大小 | 张数、原图尺寸 | 时长、文件大小 |

### 4.3 混合媒体与特殊情况

- 一条推文含视频 + 图片：分块显示，每块用各自交互；顶部显示 "2 videos · 2 photos"。
- 引用帖里有媒体：单独一块，标题 "From the quoted post"。
- 纯文字推文：显示全文与「此帖没有可下载的媒体」，主操作变为 View & save a copy，次要为 Copy text、Open on X。

### 4.4 下载反馈（新增）

- 按钮状态：默认 → Downloading…（进度） → Saved ✓（3 秒后恢复）；下载中禁止重复点击。
- 下载完成后底部弹出提示条（手机），按设备区分：
  - iPhone："Saved to Files. Open Files → Share → Save Video to add it to Photos." 附 "Get the one-tap Shortcut" 链接。
  - Android："Saved to Downloads. You'll also find it in your Gallery."
  - 图片走分享面板时，不显示此提示。
- 首次下载成功后，在结果卡底部轻提示 "Want this link to last? View & save a copy"，不弹窗。

### 4.5 开发须知（写入交付说明）

- 所有下载必须经代理并设置 `Content-Disposition: attachment`，否则浏览器会在新标签页播放视频，违背「无跳转」承诺。
- 代理的实现要求（控制带宽成本，延续「下载器只返回直链、不转存」的思路）：
  - 流式转发，不落盘、不缓存文件。
  - 优先部署在边缘层（如 Cloudflare Workers），不要放在源站 Node 进程上。
  - 只允许代理 `*.twimg.com` 的地址，其他域名一律拒绝，防止被当作开放代理滥用。
  - 按 IP 限流（与解析接口的限流策略一致），超限时前端显示倒计时状态。
- 手机端图片保存使用 Web Share API Level 2（files），不支持时回退为逐张下载。

---

## 5. View 流程与结果页 /{shortCode}

### 5.1 流程

1. 点击 View → 按钮变为 "Saving a copy…"，同时在结果区显示保存过渡（1–2 秒，带进度动画）。
2. 若此帖之前已有人保存：直接显示 "Saved on [date]"，立即跳转。
3. 跳转到 /{shortCode}。

### 5.2 结果页结构

1. 顶栏（同全站）。
2. 副本说明（不做原帖状态定期检查）：元信息中固定写 "Saved by XPut on [date]"，阅读卡下方一行中性说明 "This is a saved copy. The original post may have changed or been removed."
3. 阅读卡：作者、全文、媒体（视频可播放，图片可全屏）、发布日期、回复数量。
4. 操作：
   - Share link（主）：手机调起系统分享面板；桌面复制并显示 "Link copied ✓"。
   - Download media：在页面内打开下载抽屉（手机为底部抽屉，桌面为弹出层），内容复用第 4 节结果卡，不跳转。
   - Open on X。
5. 回流区块："Save or view another post" + 紧凑输入组件。
6. 内链：Video Downloader、Twitter Viewer。
7. 页脚。

### 5.3 结果页状态

- 敏感内容：先显示年龄确认，确认前不加载媒体、不显示广告。
- 副本已应要求移除：显示说明与 "Back to XPut"。
- 短码不存在：显示 "This link doesn't exist" + 输入组件（不是通用 404）。

### 5.4 语言

- URL 不加语言前缀；界面语言（按钮、标签、提示文字）优先读用户上次选择（cookie），其次浏览器语言，默认英文。
- 精选版的例外：AI 标题和补充内容（Summary / Context / Key points）固定使用一种语言，按推文原文的语言决定，不随 cookie 或浏览器语言变化，保证搜索引擎和所有访客看到同一份内容。界面按钮文字仍可跟随用户偏好。
- 如果以后需要同一条推文的中英文两个精选版，必须使用两个不同的 URL（并互设 hreflang），不能在同一 URL 上切换。
- 推文正文保持原文，不翻译。

---

## 6. 状态清单（首页与 Viewer 各一套）

| 状态 | 首页 | Viewer | 表现 |
| --- | --- | --- | --- |
| 初始 | 插画空状态（下载） | 插画空状态（阅读） | 虚线框 + 插画 + 一句说明 |
| 加载中 | ✓ | ✓ | 主按钮转圈 "Fetching…"，骨架卡 |
| 链接无效 | ✓ | ✓ | 输入框红框 + 下方红字说明，不弹窗 |
| 非单条帖子链接 | ✓ | ✓ | "Paste a link to a single post, not a profile." |
| 原帖不可用 | ✓ | ✓ | 提供 "Check for a saved copy" |
| 服务繁忙 | ✓ | ✓ | Try again |
| 请求过多 | ✓ | ✓ | 倒计时按钮 |
| 敏感内容 | ✓ | ✓ | 年龄确认（服务端强制） |
| 纯文字帖 | ✓ | — | View 成为主操作 |
| 保存副本中 | ✓ | ✓ | "Saving a copy…" 过渡 |
| 下载完成提示 | ✓（手机） | — | 见 4.4 |

---

## 7. 页面规格与 SEO 文案

### 7.1 首页 /

- **Title**：Twitter Video Downloader – Download X Videos in HD | XPut
- **Meta description**：Download videos, GIFs and images from X (Twitter) in HD. Free, no sign-up, no pop-ups. Paste a link and save MP4 to your phone or computer.
- **H1**：X (Twitter) Video Downloader（唯一 H1）
- **副标题**：Download X videos in HD as MP4 — plus images and GIFs. Paste a post link and save it to your phone or computer.
- **徽章**：Free · No pop-ups · No sign-up
- **区块与 H2**（正文 600–1000 词，全部在 HTML 中可见）：
  1. 输入组件 + 结果区（初始为插画空状态）
  2. H2 How to download X (Twitter) videos — 三步卡片
  3. H2 Download Twitter videos on iPhone and Android — 两栏（桌面）/ 两块（手机），各含 3 步与说明；iPhone 栏附快捷指令链接
  4. Viewer 内链横幅："Just want to read a post? Try our Twitter Viewer"
  5. H2 Why use XPut — 四点：Every quality in HD / MP4；Videos, images and GIFs；No pop-ups or redirects；Links that last after deletion
  6. H2 Frequently asked questions — 7 条，用 `<details>`，所有答案（每条 2–4 句）已写在画板中，开发直接放入 HTML 源码：
     - How do I download a Twitter video in HD?
     - Can I convert a Twitter video to MP4?
     - Does it work with x.com links?
     - How do I save a Twitter GIF?
     - How do I download Twitter videos on iPhone?
     - Can I download images from a tweet?
     - Is XPut free and safe to use?
  7. 页脚

### 7.2 Viewer 页 /twitter-viewer

- **Title**：Twitter Viewer – View X Posts Without an Account | XPut
- **Meta description**：View any public X (Twitter) post anonymously, no login or account needed. Links keep working even if the original post is deleted.
- **H1**：Twitter Viewer
- **副标题**：View any public X post anonymously, without an account. Paste a link to read it — your link keeps working even if the post is deleted.
- **徽章**：No login · Anonymous · Saved copies
- **区块与 H2**：
  1. 输入组件（只有 View post）+ 结果区（初始插画空状态）
  2. H2 How to view tweets without an account — 三步
  3. H2 View X posts anonymously — 说明：无需登录，不留下浏览记录，作者看不到谁查看了帖子
  4. H2 Links that last — 差异化卖点；自然覆盖 save tweet、see deleted tweets（如实说明：只能看到在删除前已被保存过的帖子）
  5. 下载器内链横幅："Want to save the video? Download it here"
  6. H2 Frequently asked questions：
     - Can I view Twitter without logging in?
     - Is this Twitter viewer anonymous?
     - What happens if the post is deleted?
     - Can I see deleted tweets?
     - Can I see someone's whole profile?（如实回答：只支持单条推文链接）
     - Can I see replies?（只显示回复数量，可在 X 上打开）
  7. 页脚
- **边界**：页面上不得出现账号搜索框、主页浏览、时间线等功能或暗示（包括插画）。

### 7.3 中文首页 /zh/

- **Title**：推特视频下载器 – X（Twitter）高清视频在线下载 | XPut
- **H1**：推特视频下载
- **副标题**：粘贴 X（推特）帖子链接，免费在线下载高清 MP4 视频，也支持图片和 GIF。无需登录，无弹窗。
- **H2**：如何下载推特视频 ／ 在 iPhone 和安卓手机上保存推特视频 ／ 为什么选择 XPut ／ 常见问题
- FAQ 示例：推特视频怎么下载？／ 支持 x.com 链接吗？／ 怎么保存到 iPhone 相册？／ 能下载推特上的图片和 GIF 吗？／ 需要登录推特账号吗？
- 中文排版：正文 16px，行高 1.75；中英文之间留空格；标点用全角。

### 7.4 中文 Viewer /zh/twitter-viewer

- **Title**：推特在线查看器 – 无需登录查看 X 推文 | XPut
- **H1**：推特查看器
- **副标题**：免登录查看任何公开的 X（推特）帖子，匿名浏览；原帖删除后，链接依然有效。
- **H2**：如何免登录查看推文 ／ 匿名查看 X 帖子 ／ 链接长期有效 ／ 常见问题

### 7.5 iPhone 快捷指令页 /ios-shortcut

- **目标词**：twitter video downloader iphone、save twitter video iphone
- **Title**：Download Twitter Videos on iPhone – One-Tap Shortcut | XPut
- **Meta description**：Save X (Twitter) videos and photos to your iPhone in one tap with the free XPut Shortcut. No app, no account, no copy and paste.
- **H1**：Save X videos on iPhone in one tap
- **主按钮**：Get the Shortcut → https://www.icloud.com/shortcuts/e2c41e2726044bc38dc57c8fbd45c734
- 手机：直接显示主按钮；桌面：显示二维码（指向同一 iCloud 链接，由开发生成真实二维码）+ 打开 / 复制链接
- **H2**：How the iPhone Shortcut works（三步 + 首次运行权限说明）／ Frequently asked questions
- 引导到下载器的横幅："Use XPut in Safari instead"
- 入口：首页 iPhone 区块、空状态、iPhone 下载完成提示条，均链接到本页（不再直接跳 iCloud）
- 中文版 /zh/ios-shortcut：Title「iPhone 一键保存推特视频 – XPut 快捷指令」，H1「在 iPhone 上一键保存 X 视频」

### 7.6 精选可收录结果页 /{shortCode}（与普通结果页并存）

- 适用于通过精选门槛的结果页；index, follow，进入副本 sitemap，canonical 指向自身。
- **精选门槛**（全部满足才进入候选）：
  - 访问或分享达到一定次数（阈值由后台配置）；
  - 作者是有一定关注度的公开账号（阈值由后台配置）；
  - 非敏感、未被举报、未被申请移除；
  - AI 补充内容通过质量检查（不空泛、不重复原文、无事实性错误标记）。
- **放量方式**：初期候选页须人工抽检后再开放收录；每天新增收录数量设上限（后台可调），根据 Search Console 的收录与质量反馈逐步放开。
- **语言**：AI 标题与补充内容的语言跟随推文原文语言，固定不变（见 5.4）。画板 W_FeaturedZH_D/M 表示「中文推文」的精选页，不是同一条推文的中文翻译版。
- **H1**：AI 生成的 SEO 标题，概括推文主题，如 "[Person/Event] says [key point] – [Date]"；上方面包屑 XPut › Saved posts › [Topic]。
- **推文卡片**：标注 "Original post on X"，作者与 handle 在卡片内；正文、媒体、发布/保存时间、回复数、Copy link / Download media / Open on X、保存副本说明，与普通版一致。
- **XPut 补充内容区块**（虚线边框 + 浅底，与原推文卡片明显区分）：顶部标签 "Summary and context by XPut" 及 "Not written by the post's author · AI-assisted, [date]"；H2 Summary（2–3 句）、H2 Context、H2 Key points（3–5 条）；底部 "Spot a mistake? Report it"。
- **相关推文**：H2 "More from [author] and [topic]"，4 张卡片（标题、handle、日期、缩略图），链接到其他精选结果页。
- 下方保留再次输入框与工具页入口。
- 中文版同结构，标签为「摘要与背景由 XPut 提供」「非原作者撰写 · AI 辅助生成」。

### 7.7 普通结果页 /{shortCode}

- **Title**：{作者} on X: "{正文前 50 字}" | XPut
- **Meta description**：正文前 155 字。
- **OG / Twitter Card**：标题、描述、首图（有视频时用视频封面；纯文字帖用品牌默认图，含作者名与正文摘要）。
- **robots**：普通版一律 noindex, follow。只有通过 7.6 精选门槛并经抽检的页面才切换为精选版并开放收录；作者或权利人申请移除时立即撤回收录与副本。
- H1 为「[作者名] on X」（视觉上与作者行一致）；正文用 `<article>`。
- OG 图模板见画板 W_OG：纯文字帖为品牌底图 + 作者 + 正文前 120 字；有媒体时右侧放封面图。

---

## 8. 技术与 SEO 交付说明（给开发）

1. **路由优先级**：先匹配固定页面（/twitter-viewer、/zh/、/zh/twitter-viewer、/privacy、/report 等），再匹配 6 位短码。
2. **短码保留字**：生成时排除保留字，至少包括 zh、pt、en、ios-shortcut、api、about、privacy、terms、report、help、blog、static、images、videos、assets，以及所有现有和计划中的页面路径；保留字列表放在配置中，新增页面时同步扩充。已分享的旧短码必须继续有效。
3. **canonical**：每页指向自身。
4. **hreflang**：首页与 Viewer 的中英文互相标注 en、zh-Hans、x-default（指向英文）；为 pt-BR 预留。结果页不设 hreflang。
5. **结构化数据**：
   - 首页与 Viewer 用 WebApplication（applicationCategory: MultimediaApplication，offers.price: 0）；全站 Organization。
   - 精选结果页用 SocialMediaPosting：author（名称、handle、X 主页链接）、datePublished（原帖发布时间）、url / sharedContent 指向原帖链接，表明这是对一条社交媒体帖子的转载与补充。
   - FAQ 区块用 FAQPage。注意预期：Google 自 2023 年起基本只为政府和医疗类网站展示 FAQ 富媒体结果，这里的作用主要是帮助搜索引擎理解页面内容，不要期待搜索结果中出现折叠问答。
6. **sitemap 与 robots.txt**：
   - 主站 sitemap：首页、Viewer、快捷指令页，中英文版本各自列出（含 hreflang 标注），以及隐私、举报页。
   - 副本 sitemap：只列入已开放收录的精选结果页，随收录状态增删。
   - 两份 sitemap 通过 sitemap index 汇总，并在 robots.txt 中声明。
7. **语言切换**：真实 `<a>` 链接到对应语言 URL，不用 JS 切换同一 URL 的内容。
8. **正文渲染**：FAQ、步骤等直接在 HTML 中，`<details>` 折叠可以，内容必须在源码里。
9. **图片**：描述性 alt；示例图 WebP + 懒加载；插画用内联 SVG。
10. **性能**：首屏只加载必要 CSS/JS；字体 font-display: swap；目标 LCP < 2.5s、CLS < 0.1，以手机为准；以后接入广告时，广告脚本不在首屏加载。
11. **下载**：见 4.5（代理下载、Web Share）。
12. **年龄确认**：服务端强制，未确认不下发媒体 URL；确认状态存会话 cookie。

---

## 9. 画布交付清单（本轮）

| 顺序 | 画板 | 说明 |
| --- | --- | --- |
| 1 | Viewer – Mobile | 按 7.2 重做 |
| 2 | Viewer – Desktop | 按 7.2 重做 |
| 3 | Home – Mobile / Desktop | 去掉独立工具页链接，按 7.1 补 iPhone/Android 区块与 FAQ |
| 4 | 结果卡组件库（手机 + 桌面） | 视频、图片、GIF、混合媒体、引用帖、纯文字、全屏查看图片 |
| 5 | 首页状态（手机 + 桌面） | 第 6 节全部状态 |
| 6 | Viewer 状态（手机 + 桌面） | 第 6 节全部状态 |
| 7 | 下载反馈（手机） | 按钮状态、iPhone/Android 提示条、分享面板示意 |
| 8 | 结果页（手机 + 桌面） | 原帖仍在、原帖已删、下载抽屉、敏感内容、已移除、短码不存在 |
| 9 | 中文首页、中文 Viewer（手机 + 桌面） | 按 7.3、7.4，重点检查中文排版 |
| 10 | +30% 文本压力测试（手机） | 首页、Viewer 各一 |
| 11 | 举报、隐私、404（手机 + 桌面） | 基础页 |
| 12 | iPhone 快捷指令页（中英文，手机 + 桌面） | 按 7.5 |
| 13 | 导航展开状态 | 手机菜单抽屉、语言底部抽屉；桌面语言下拉 |
| 14 | 分享预览图（OG）模板 | 1200×630，纯文字 / 含媒体两种 |
| 15 | 结果页中文界面（手机） | 检查中文排版 |
| 16 | 精选可收录结果页（中英文，手机 + 桌面） | 按 7.6 |

---

## 10. 已确认决策

1. GIF 第一期只提供 MP4 下载，不做服务端转 .gif。
2. 结果页不做原帖状态定期检查。
3. 举报、隐私、404 第一期出设计稿（桌面 + 手机）。
4. iPhone 快捷指令已在现网可用（iCloud 链接）；新增独立介绍页 /ios-shortcut 与 /zh/ios-shortcut，站内入口统一指向介绍页。
5. 第一期不做 /video-downloader 独立页，避免与首页争抢同一组关键词；第二期按数据再评估。
