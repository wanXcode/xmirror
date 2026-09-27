# XPut 基础 SEO 方案 v1.0（定稿版）

版本状态：Final。本文是 Phase 1 实现、灰度收录和后续 Search Console 复盘的共同依据。

## 目标与边界

本方案面向 `xput.app` 的基础自然搜索能力，目标是让 Google 能够稳定发现、抓取、理解和选择 XPut 的规范页面，并让搜索结果中的标题、摘要和分享卡片准确反映页面内容。

本阶段不以“让每一条存档都进入 Google”为目标。XPut 的存档内容来自 X 用户提交的第三方内容。Google 明确要求内容对用户有实质价值；单纯转载、批量生成或仅做轻微改写的页面，可能被视为低价值抓取内容或规模化内容。因此，是否允许存档页收录需要和内容审核、版权处理、页面质量一起决定。

业务目标是用高质量存档页承接 X 上的长尾搜索需求。X 的公开帖子是否被 Google 收录不能用 `site:` 查询结果精确代表，Google 不保证展示完整索引数量；因此 XPut 的策略应以“哪些页面给用户增加了稳定访问价值”为收录依据，而不是以复制更多帖子为目标。

## Google 官方依据

核对日期：2026-09-27。依据 Google Search Central：

- [Google 搜索要素](https://developers.google.com/search/docs/essentials?hl=zh-cn)：最低要求是 Googlebot 未被阻止、页面返回 HTTP 200、页面包含可编入索引的内容；满足要求不保证一定收录。
- [SEO 入门指南](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=zh-cn)：使用描述性标题、主要标题、链接文字和图片替代文本；用可抓取链接帮助 Google 发现页面；站点地图是帮助发现内容的手段而非硬性要求。
- [站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=zh-cn)：只放希望出现在搜索结果中的规范绝对 URL；在 `robots.txt` 声明 sitemap；单文件限制为 50,000 个 URL 或 50MB。
- [规范网址](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=zh-cn)：优先使用永久重定向、`rel="canonical"` 和站点地图组合；规范页使用自引用 canonical，并保持站内链接指向规范 URL。
- [垃圾内容政策](https://developers.google.com/search/docs/essentials/spam-policies?hl=zh-cn)：避免无附加价值的转载、规模化低价值页面、关键词堆砌和误导性重定向。
- [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals?hl=zh-cn)：以真实用户数据为准，目标为 LCP ≤ 2.5 秒、INP ≤ 200 毫秒、CLS < 0.1。

Google 还明确说明 `meta keywords` 不参与排名，因此不把关键词标签维护列为重点工作。

这不等于内页不需要关键词策略。对于存档页，应从真实正文中提取页面主题，优先体现在页面标题、可见首要标题、摘要、正文附近的说明文字、图片替代文本和内部链接文字中。不要为了 SEO 人工拼接一组与正文无关的词，也不要把用户原文批量复制到 `meta keywords`。如果产品内部确实需要搜索或筛选字段，可以单独保存结构化主题词，但它不应被当作 Google 排名信号。

## 当前审计结论

### 已具备

- 首页已有独立 `<title>`、`description`、`robots`、绝对 canonical、Open Graph、Twitter Card 和 `WebApplication` JSON-LD。
- 存档页已服务端输出正文、独立标题、摘要、文章类型、发布时间、作者、绝对 canonical 和来源链接，基本符合 Google 对“无需依赖客户端渲染才能理解正文”的要求。
- `/archives/post_*.html` 会 301 到短码；旧域名 `xmirror.app` 会 301 到 `xput.app`，主域迁移方向正确。
- 无效页面线上返回 404，HTTP 到 HTTPS 的首页跳转正常。

### P0 缺口和风险

1. `https://xput.app/sitemap.xml` 当前返回 404。
2. `https://xput.app/robots.txt` 当前只有内容信号说明，没有 `Sitemap: https://xput.app/sitemap.xml` 声明，也没有明确的抓取边界。
3. `/admin-moderation.html` 和 `/demo/` 当前公开返回 200，且没有 `noindex`。它们不属于搜索落地页，应从搜索结果排除；管理页还应增加访问控制或至少禁止公开访问。
4. 生成存档页时，`post.images` 是数据库 JSON 字符串，但 `generateMirrorHtml()` 直接取 `post.images[0]`。线上存档页的 `og:image`/`twitter:image` 因此可能是 `[`，而不是实际图片 URL。
5. 首页“最新公开存档”由 JavaScript 请求 `/api/posts` 后才插入链接。Google 可以执行 JavaScript，但服务端可发现的 HTML 链接更稳定，也更利于抓取预算和无脚本访问。
6. 存档页默认全部 `index, follow`，没有“低质量、被删除、版权争议、空内容、下载失败或仅占位页”的收录状态模型。
7. 多语言目前是客户端切换同一 URL 的文本，未形成独立的 `en`/`zh-CN` URL 变体；暂不应添加不完整的 `hreflang`。

## 推荐目标架构

### 收录范围

首期只承诺收录以下页面：

- `/`：产品首页，保留 `index, follow`。
- 通过质量门槛的短码存档页 `/:shortCode`：有正文、有明确作者和发布时间、有有效媒体或文本、有来源链接、未被审核标记为风险内容。

以下页面默认 `noindex, follow`，并且不进入 sitemap：

- `/admin-moderation.html`、`/demo/**`、任何内部工具页。
- `/api/**`、`/:shortCode/referer`、旧 `/archives/**` URL、无效/删除/空内容/失败占位页。
- 版权投诉、个人敏感信息、恶意内容、重复内容或质量不足的存档页。

`noindex` 页面必须允许 Google 抓取，以便读取 `noindex`；不能用 `robots.txt` 先屏蔽后期待 Google 处理 `noindex`。

### 面向流量的收录分层

建议给每条存档增加可解释的 SEO 状态，而不是统一 `index, follow`：

- **A 类：允许收录**。正文有明确主题和足够信息，页面能提供稳定访问、媒体保留、翻译、清晰时间/作者信息或其他 X 页面不稳定提供的实际价值。
- **B 类：观察或暂不收录**。内容过短、只有图片/表情、重复度高、正文不完整、媒体失败，或无法判断用户搜索价值。页面仍可正常访问，但使用 `noindex, follow`。
- **C 类：禁止收录**。版权投诉、个人敏感信息、恶意/违法内容、审核拒绝、删除内容和内部工具页。按产品规则处理访问、删除和索引状态。

首轮可以选择一批 A 类页面做受控实验，提交 sitemap 后观察 4–8 周的抓取、收录、展示、点击和页面互动，再调整门槛。不要一开始把历史库全部放进 sitemap。

A 类页面需要有 XPut 自己的页面价值：稳定的公开 URL、服务端可读正文、原始来源链接、媒体保留状态、清晰作者和时间信息，以及实际存在的翻译或阅读增强功能。仅把 X 原文换一个域名、自动改写标题或批量添加关键词，不算附加价值。

实现上建议在 `posts` 增加 `seo_status`、`seo_reason` 和 `seo_updated_at` 字段，至少支持 `review`、`index`、`noindex` 三种状态。新存档默认进入 `review`，通过自动规则的页面可进入 `index`；人工只处理边界、争议和手动覆盖。删除、版权投诉、审核拒绝和内容质量下降时要自动降为 `noindex` 或删除。sitemap 只查询 `seo_status='index'`，内页的 robots 元标签也由同一个状态生成，避免 sitemap 与页面标签不一致。

为避免人工审核成为吞吐瓶颈，初始状态可由规则自动分流（正文长度、媒体状态、重复度、审核结果、敏感内容和来源完整性），人工只处理候选 A 类、争议内容和状态变更；规则命中原因应写入 `seo_reason`，便于复盘收录率与流量质量。

### 自动判定流程

现有 `moderator.moderateArchivedContent()` 解决的是“内容是否允许进入系统”，不等于“页面是否适合进入 Google”。SEO 判定应在内容审核通过、存档记录写入后独立运行，并在媒体下载完成、正文修复、翻译生成或收到删除/版权事件时重新运行。

建议把 `posts` 的收录字段扩展为：

```text
seo_status       review | index | noindex
seo_score        integer
seo_reason       json/text
seo_checked_at   datetime
content_hash     text
seo_override     nullable index/noindex
```

第一版可以使用可解释的规则评分，后续再用 Search Console 数据调阈值。示例：

第一版不把大模型作为唯一收录门槛；模型只能在后续辅助提取主题或发现近似重复，最终状态仍由可测试的规则、审核状态和人工覆盖决定。

```text
硬性不合格 -> noindex
  内容审核拒绝、删除或版权投诉
  没有作者、原帖时间或可验证来源
  正文为空、只有 URL/模板文字，或正文少于 40 个有效字符
  视频处于 queued/downloading/failed 且没有足够的文字内容
  content_hash 与已有公开页重复

质量加分
  正文 >= 160 个有效字符                         +25
  有明确标题（>= 20 个有效字符）                 +15
  有本地图片或已完成的视频                       +15
  作者、发布时间、来源链接都完整                 +15
  正文包含可读段落、列表或标题结构               +10
  页面提供稳定媒体保留或已完成的翻译增强         +10

自动状态
  硬性通过且（score >= 70，或正文 >= 160 且元数据完整） -> index
  score 40–69 或存在待确认媒体/重复风险            -> review
  score < 40 或命中硬性规则                        -> noindex
```

“有效字符”应先去除 HTML 标签、URL、重复空白和纯装饰符号，再按中文字符和拉丁词元计数；不能直接按 JavaScript 字符串长度判断。阈值要放在配置中，首批只将自动判定为 `index` 的页面加入 sitemap，`review` 和 `noindex` 页面保持可访问但不进入 sitemap。

伪代码如下：

```js
const moderation = moderate(post);
const quality = evaluateSeoQuality(post, moderation);
await updateSeoState(post.id, quality);

// sitemap.xml
SELECT short_code, seo_updated_at
FROM posts
WHERE seo_status = 'index' AND short_code IS NOT NULL;
```

自动判定必须记录每次命中的规则和分数，管理员可以看到原因并手动提升或降级。手动提升不能绕过内容审核、删除和版权状态；这些事件发生后应自动降级，并从下一次 sitemap 响应中消失。站点地图只是向 Google 推荐 URL，不能保证 Google 最终收录。

页面最终状态按“硬性封禁 > 人工覆盖 > 自动评分”计算：硬性封禁永远是 `noindex`；没有硬性封禁时，使用管理员设置的 `seo_override`；没有覆盖时，使用自动评分结果。评估器需要把这个最终结果写回 `seo_status`，因此 sitemap 和页面 robots 标签都读取同一个最终状态；不能只在展示时临时套用 override。

### URL 与 canonical

- 规范公开 URL 统一为 `https://xput.app/:shortCode`。
- 短码页输出自引用 `<link rel="canonical" href="https://xput.app/:shortCode">`。
- 旧 `/archives/post_*.html` 永久 301 到短码；站内所有链接和 sitemap 只使用短码。
- `/referer` 只负责跳转回 X 原帖，使用 `noindex`，不放入 sitemap。
- 继续保持 HTTP、旧域名到 `https://xput.app/` 的永久跳转，并为 `www.xput.app` 明确选择“配置证书后 301 到主域”或“明确不提供该主机”的策略；不能让 `www` 处于无 DNS、偶尔可访问或返回不同内容的状态。

### 站点地图与 robots

增加服务端动态 `GET /sitemap.xml`：

- 输出首页和当前符合收录条件的短码页。
- 使用绝对 HTTPS URL、XML UTF-8、正确的 `Content-Type`。
- `lastmod` 只使用可验证的正文、结构化数据或媒体重大更新时间；不填虚假频率和优先级。
- 未来超过 50,000 个 URL 时拆分并增加 sitemap index。

将 `public/robots.txt` 或服务端响应改为明确版本，至少包含：

```text
User-agent: *
Disallow: /api/
Sitemap: https://xput.app/sitemap.xml
```

`admin-moderation.html`、`demo/**` 以及低质量存档如果依靠 `noindex` 排除，就不能同时在 robots 中屏蔽；Google 必须能够抓取页面才能看到 `noindex`。如果管理页改为需要登录或返回 401/403，则可以用访问控制保护它，不要把“robots 屏蔽”当作 `noindex` 的替代品。上线后还要确认 Cloudflare 或其他代理没有覆盖应用返回的 robots 内容。

### 页面元数据和结构化数据

首页：

- 保留一个清晰、唯一、面向用户的 `<title>` 和 `description`；删除或降低 `meta keywords` 的维护优先级。
- 增加实际可见的产品说明、使用步骤、支持的 X 链接类型、隐私/版权/删除入口和 FAQ。内容应服务用户，不以关键词堆砌为目标。
- `WebApplication` JSON-LD 保持与页面真实功能、免费价格和品牌信息一致；上线前用 Rich Results Test 验证 JSON 有效性。

短码存档页：

- 标题使用“内容标题/作者 | XPut”，长度和截断应稳定，禁止把未清洗的 HTML 或控制字符带入 head。
- `description` 从正文生成短摘要，去 HTML、去重复空白并限制长度。
- 解析 `post.images` JSON 后，使用第一个经过路径校验的图片生成 `og:image`/`twitter:image`；无图片时省略 image 标签或使用统一品牌图，不能输出 `[`、相对路径或不存在的文件。
- 对媒体 `<img>` 输出与内容相关的 `alt`；装饰性品牌图保持空 alt。
- 可增加 `Article` JSON-LD，字段只使用真实存在的 `headline`、`datePublished`、`author`、`image`、`mainEntityOfPage`；不要为了富摘要虚构评分、互动数或编辑者。
- 来源链接使用可理解的定位文字，并保留 `target="_blank" rel="noopener noreferrer"`。

### 可抓取性与性能

- 将首页首批公开存档链接在服务端 HTML 中渲染，或提供一个服务端渲染的公开存档列表；“加载更多”继续作为增强功能。
- 保证首屏正文、标题、canonical、主要图片不依赖异步 API 才出现。
- 为图片和视频保留尺寸/宽高比，避免布局跳动；图片使用 `loading="lazy"`、`decoding="async"`，首屏主图按实际情况预加载。
- 用 Search Console Core Web Vitals 和 PageSpeed Insights 采集移动端真实/实验数据，按 LCP、INP、CLS 目标治理。

## 两类核心页面的具体优化

### 首页 `/`

首页的任务是解释产品、承接品牌和功能搜索，并把 Google 和用户引导到高质量存档页：

- 将页面的唯一 H1 从单独的 `XPut` 品牌名改为“X 内容存档与分享”一类的产品主张，保留 XPut 作为品牌链接和视觉标识。
- 在首屏静态 HTML 增加一段简短说明，明确“保存 X/Twitter 帖子、图片和视频；无需登录即可阅读和分享；支持翻译”等真实能力。不要写代码里没有实现的承诺。
- 增加“如何使用”“适合保存什么内容”“媒体和翻译如何工作”“删除/版权联系”等可见区块，并用真实问题写 3–5 条 FAQ；这些内容既帮助用户，也为功能型搜索提供上下文。
- 服务端输出一小批 A 类公开存档链接，使用内容标题作为链接文字；客户端无限滚动继续作为增强体验。链接数量应有上限，避免首页变成无尽列表。
- 首页只保留一个清晰的产品主题，不堆叠“存档、备份、保存、镜像”等同义词；`meta keywords` 可删除。
- 将管理页和 demo 从首页可见导航、sitemap 和搜索入口中移除；若仍需保留给内部使用，增加访问控制和 `noindex`。

### 存档内页 `/:shortCode`

内页的任务是承接具体长尾查询，并让用户确认这是一份可靠、可访问的 XPut 存档：

- 增加一个由真实正文生成的页面 H1，内容标题过长时清晰截断；作者、原帖时间和 XPut 标识作为辅助信息，不要只把品牌名当 H1。
- 如果导入正文本身已有 `h1`，应复用或规范化为唯一的页面主标题，避免外层生成一个 H1、正文再保留一个 H1。
- `<title>`、`description`、H1、Open Graph 标题使用同一套清洗后的主题文本，避免 title 只有截断片段或包含 HTML/控制字符。
- 修复图片数组解析后再生成 `og:image`、`twitter:image`；同时为正文图片生成描述性 `alt`，视频保留可读标题或说明。
- 页面 `<html lang>` 应匹配当前默认显示的原文语言；当前始终写成 `zh-CN`，对英文等内容并不准确。客户端切换语言仍不等于独立语言 URL，也暂不添加 hreflang。
- 在正文下方明确展示“原始来源”“保存时间”“媒体状态”“翻译状态”等真实信息，形成 XPut 自己的页面价值。来源链接应尽量直接指向原始 X URL；如果必须使用中转地址，应在页面上明确显示原始来源并确保中转页不进入 sitemap。
- 增加有限的相关存档链接，例如同一作者或明确主题相关的 A 类页面；相关性不足时不要随机推荐，避免生成大量薄弱内部链接。
- 对导入正文中的用户生成外链进行统一清洗；无法信任的外链使用 `rel="ugc nofollow noopener"`，避免把用户提交的垃圾链接当成 XPut 的推荐信号。
- 对短文本、重复内容、删除内容、版权争议和审核失败页使用 `noindex`，不要仅因为 URL 已生成就允许收录。
- 文章结构化数据只填写真实的标题、作者、发布时间、图片和主 URL，不虚构评分、互动量或编辑信息。

这两类页面都应先完成 P0 的可抓取性、canonical、sitemap 和收录状态，再进行文案和内部链接实验。

## 分阶段实施

### Phase 1：可发现、可规范化（P0）

- 修复 `og:image` JSON 解析和路径校验。
- 新增 `robots.txt` 的 sitemap 声明和必要路径规则。
- 新增动态 `sitemap.xml`，只放首页和合格短码规范 URL。
- 为 admin/demo/API/referer/低质量存档落实 `noindex` 或访问限制。
- 增加 `seo_status` 等收录状态字段和状态转换规则，新存档默认不进入 sitemap。
- 将已有存档先回填为 `review`，批量运行一次评估器后再开放 sitemap，禁止迁移时把历史页面全部默认为 `index`。
- 给首页首批存档补充服务端可抓取链接。
- 加入测试：SEO 规则的边界分数、纯文字高质量页面、硬性封禁和人工覆盖的状态转换、sitemap XML/URL 集合、robots 响应、旧 URL 301、短码 canonical、`og:image` 为有效绝对 URL、排除页面含 `noindex`。
- 明确并验证 `www.xput.app` 的 DNS、TLS、301 和 canonical 行为；确认代理层没有覆盖 robots 或 noindex。

### Phase 2：页面理解与分享质量（P1）

- 统一标题和摘要生成器，加入长度、HTML 清洗、控制字符和空值测试。
- 补齐图片 alt、Article JSON-LD、首页 FAQ/使用说明/版权删除入口。
- 统一所有站内链接到短码规范 URL，清理 demo 链接和旧归档链接。
- 在 Search Console 验证站点、提交 sitemap，记录索引覆盖和抓取错误基线。
- 校验现有统计脚本在 `xput.app` 上的域名归因，避免历史使用的 `xmirror.app` site ID 让 SEO 流量无法单独分析。

### Phase 3：质量与增长（P2）

- 基于 Search Console 的查询、点击率、收录率和人工审核数据调整收录门槛。
- 试运行 4–8 周后，只有在没有人工处置、垃圾内容上升或大量“已抓取但未编入索引”的情况下才扩大 A 类范围；如果质量信号恶化，提高阈值、暂停自动 `index` 或将整批页面降为 `noindex`，保留 URL 以便恢复。
- 为“存档、分享、翻译、媒体保留”等 XPut 自有价值制作少量原创说明页；不批量生产只有关键词和转载正文的落地页。
- 建立删除/版权投诉后的 sitemap、canonical、缓存和索引状态联动。
- 持续监控 Core Web Vitals、404/5xx、重定向链和被 Google 选用的 canonical。

## 验收标准

上线前使用以下检查作为基础门槛：

1. `GET /robots.txt` 返回 200、`Content-Type: text/plain`，含唯一正确的 sitemap URL。
2. `GET /sitemap.xml` 返回 200、合法 XML，只包含 HTTPS 短码规范 URL 和首页；每个 URL 访问返回 200。
3. 旧归档 URL 只发生一次 301 并落到短码；短码页 canonical 与 sitemap 完全一致。
4. 首页和短码页在禁用 JavaScript 时仍有标题、正文/摘要和关键导航；首页首批存档链接可在原始 HTML 中发现。
5. admin、demo、referer 和明确低质量页不会进入 sitemap，并返回预期的 `noindex`/访问控制结果；API 按 robots 访问策略处理且不进入 sitemap。
6. 存档页分享卡片的 `og:image` 是可访问的绝对 URL，图片缺失时不会产生错误值。
7. 内页默认语言、页面 H1、导入正文标题和外链属性经过抽样检查，没有错误的语言标记、重复 H1 或未经处理的用户生成垃圾链接。
8. `npm test`、`node --check server.js` 通过；对线上使用 Search Console URL Inspection、Rich Results Test 和 PageSpeed Insights 复核。

## 运营与风险判断

- SEO 不能替代产品价值：Google 明确不保证抓取、收录或排名。首期指标应看“可抓取率、有效页面占比、canonical 正确率、分享预览成功率”，再看点击和排名。
- `site:` 查询只能作为人工抽样，不能作为收录总量或流量预测；索引状态以 Search Console 的覆盖报告、URL 检查和实际搜索表现为准。
- 转载存档的主要风险不是缺少关键词，而是缺乏独特附加价值、版权投诉和低质量页面规模化。收录策略应由质量门槛和审核结果驱动。
- `robots.txt` 只控制抓取，不是规范化工具，也不能代替 `noindex`；canonical、301 和 sitemap 必须指向同一套首选 URL。
- 客户端语言切换暂不做 hreflang。只有具备独立、可抓取、内容完整的语言 URL 后，才添加双向 hreflang。
