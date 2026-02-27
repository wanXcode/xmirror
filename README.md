# XMirror 🐦

X(Twitter) 内容存档工具 - 生成可访问的镜像页面

## 功能

- 📥 输入 X 链接，自动抓取推文内容
- 🖼️ 图片本地化存储，避免外链失效
- 🎬 视频下载和本地播放
- 📝 支持普通推文和长文章(Article)
- 🔍 正确的 UTF-8 编码处理，无乱码
- 📚 历史记录管理
- 💬 钉钉/微信卡片支持（Open Graph 标签）

## 版本

**当前版本：v1.2.0**

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

## 部署

```bash
npm install
pm2 start server.js
```

---
Powered by OpenClaw Agent
