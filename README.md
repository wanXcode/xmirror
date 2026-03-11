# XMirror 🐦

X(Twitter) / 微信公众号内容存档工具 - 生成可访问的镜像页面

## 功能

- 📥 输入 X 链接或微信公众号文章链接，自动抓取内容
- 🖼️ 图片本地化存储，避免外链失效
- 🎬 视频下载和本地播放（X）
- 📝 支持普通推文、长文章(Article) 与微信公众号正文
- 🔍 正确的 UTF-8 编码处理，无乱码
- 📚 历史记录管理
- 💬 钉钉/微信卡片支持（Open Graph 标签）

## 版本

**当前版本：v1.6.0**

### v1.6.0 更新内容
- 🟢 新增微信公众号文章归档支持（`mp.weixin.qq.com`）
- 🖼️ 支持公众号文章图片本地化与分享卡片首图
- ♻️ 前后端输入提示与接口文案同步扩展为 X / 微信双来源

### v1.5.0 更新内容
- 🍎 新增 iOS 快捷指令友好接口：`GET /api/archive/quick`
- 🔗 支持一键把 X 链接转成 xmirror 短链（可返回重定向 / JSON / 纯文本）
- ♻️ 抽离归档核心逻辑，`/api/archive` 与快捷入口共用同一流程

### v1.4.0 更新内容
- 🌐 新增内页翻译能力（SiliconFlow / OpenAI 兼容）
- 💾 新增译文落库缓存（`translations` 表），重复访问秒开
- 🔁 交互优化为单按钮切换（首次翻译、后续原文/译文一键切换）
- ♻️ 老存档页面可批量重渲染，统一升级到新内页模板
- 🛠️ 支持 systemd 持久化启动（可通过环境变量配置翻译能力）

### v1.3.0 更新内容
- 🖼️ 首页全新 Glassmorphism 设计（渐变背景 + 浮动光球 + 毛玻璃卡片）
- 🎨 内页 Twitter 原生风格设计
- 🌙 深色/浅色自动切换（根据时区）+ 手动切换按钮
- 🔍 完整 SEO 优化（Meta、Open Graph、Twitter Card、JSON-LD）
- 📐 响应式优化（手机端链接自动换行等）

### v1.2.0 更新内容
- 国际化支持（i18n），自动检测浏览器语言（中文/英文）
- 语言切换按钮，支持手动切换中英文
- SEO 优化：添加 meta 标签、Open Graph、Twitter Card、结构化数据
- 分离 CSS 和 JS 文件，提高代码可维护性

### v1.1.0 更新内容
- 添加钉钉/微信卡片 meta 标签支持
- 实现视频下载和本地播放
- 优化页面 Open Graph 标签

## 技术栈

- Node.js + Express
- SQLite
- 前端原生 HTML/CSS/JS
- Python3 + curl_cffi + BeautifulSoup + html2text（用于微信公众号正文提取）

## API 快速说明

### 1) 原有接口（POST）

`POST /api/archive`

请求体：

```json
{"url":"https://x.com/..."}
```

或：

```json
{"url":"https://mp.weixin.qq.com/s/..."}
```

### 2) iOS 快捷指令推荐接口（GET）

`GET /api/archive/quick?url=<X链接或公众号文章链接>&format=<redirect|json|text>`

- `format=redirect`（默认）：直接 302 到镜像短链页面
- `format=json`：返回 JSON（包含 `absolute_url`）
- `format=text`：直接返回纯文本短链，适合快捷指令复制到剪贴板

示例：

```bash
curl "https://xmirror.app/api/archive/quick?url=https%3A%2F%2Fx.com%2Fxxx%2Fstatus%2F123&format=text"
```

## iOS 快捷指令配置（最简）

1. 动作：获取剪贴板（得到 X 链接）
2. 动作：URL 编码（对链接编码）
3. 动作：文本（拼接）
   - `https://xmirror.app/api/archive/quick?url=<编码后的链接>&format=text`
4. 动作：获取 URL 内容（GET）
5. 动作：复制到剪贴板（内容即 xmirror 存档短链）
6. 可选：显示通知（“已生成并复制 xmirror 链接”）

## 部署

### 方式一：直接启动

```bash
npm install
pip3 install curl_cffi beautifulsoup4 lxml html2text
node server.js
```

### 方式二：systemd 持久化启动（推荐）

1) 创建环境变量文件 `/etc/xmirror/xmirror.env`
2) 配置 `xmirror.service` 指向 `server.js`
3) 执行：

```bash
systemctl daemon-reload
systemctl enable xmirror.service
systemctl restart xmirror.service
```

---
Crafted with 🌸 by Flora
