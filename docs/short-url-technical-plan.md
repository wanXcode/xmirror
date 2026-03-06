# xmirror 短链接改造技术方案（V1）

## 1. 目标
在不影响现有归档/翻译/删除能力的前提下，实现：
1. 内容页短链接主路径：`/{shortCode}`（6位，`[A-Za-z0-9]`）
2. 短链接访问时服务端直出内容页（地址栏不变，无302）
3. 历史长链接 `/archives/post_xxx.html` 统一 301 到对应短链接
4. 首页与 API 默认展示短链接

---

## 2. 架构与数据改造

### 2.1 数据库改造（SQLite）
表：`posts`
- 新增字段：`short_code TEXT`
- 新增唯一索引：`idx_posts_short_code`

迁移策略：
1. 启动时执行 `PRAGMA table_info(posts)` 检查字段；不存在则 `ALTER TABLE`。
2. 建立唯一索引：`CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_short_code ON posts(short_code)`。
3. 扫描 `short_code IS NULL OR ''` 的历史记录，逐条补齐 6 位短码。

短码生成策略：
- 固定长度 6
- 字符集：`A-Z a-z 0-9`
- 生成后查重；冲突则重试（最多 N 次，建议 20）
- 若连续失败，返回错误并中止启动（防止脏状态上线）

---

## 3. 路由与渲染改造

### 3.1 新增短链主路由（核心）
路由：`GET /:shortCode([A-Za-z0-9]{6})`

处理逻辑：
1. `SELECT * FROM posts WHERE short_code=?`
2. 命中：`res.status(200).send(generateMirrorHtml(post))`
3. 未命中：`next()`（避免吞掉其他路由）

> 关键：这里是**直出 HTML**，不是 `redirect('/archives/...')`。

### 3.2 旧长链兼容路由（301）
替换当前静态 `app.use('/archives', express.static(...))` 的主访问行为：
- 新增：`GET /archives/:fileName`（匹配 `post_*.html`）
- 根据 `html_file` 查到记录后，`301 -> /{short_code}`
- 若没有映射记录，再尝试静态文件兜底（防止个别历史异常）

建议落地方式：
- 保留 `/archives` 静态目录仅作兜底资源读取
- 在其前面放置精准路由处理 `post_*.html` 的301

### 3.3 路由顺序（非常关键）
建议顺序：
1. `/api/*`
2. `/images` `/videos` 等静态资源
3. `/archives/:fileName(post_*.html)` 301 兼容
4. `/:shortCode([A-Za-z0-9]{6})` 短链直出
5. `/` 首页
6. 其他静态兜底

---

## 4. API 与前端改造

### 4.1 POST /api/archive
- 入库时生成 `short_code`
- 返回：
```json
{
  "success": true,
  "id": 123,
  "url": "/Ab3xYz",
  "short_code": "Ab3xYz"
}
```
- 不再返回 `/archives/post_xxx.html`

### 4.2 GET /api/posts
每条记录追加：
- `short_url: "/{short_code}"`

### 4.3 首页展示
- 所有“查看/复制/分享”入口统一使用 `short_url`
- 不再暴露新长链

### 4.4 Canonical
- 内容页 `<link rel="canonical">` 指向 `https://xmirror.app/{short_code}`

---

## 5. 历史数据重建策略

上线时执行一次批处理：
1. 给历史 `posts` 补齐 `short_code`
2. 遍历 `posts`，用最新模板重生成归档页（可选）
3. 首页列表读取 DB 时直接走 `short_url` 字段，不依赖旧HTML内链接

说明：
- 即使不重生成 `archives/*.html`，只要首页改为短链接、长链有301，也能满足业务目标。
- 建议仍做一次重建，保证历史页面内 canonical 与分享路径一致。

---

## 6. 发布与迁移步骤（生产）

1. **备份**
   - 备份 `data/db.sqlite`
   - 备份 `archives/`
2. **发布代码**
3. **服务启动时自动迁移**（字段/索引/补码）
4. **执行一次历史重建脚本**（可独立命令）
5. **冒烟验证**
   - 新归档返回短链
   - 短链200直出
   - 旧长链301到短链
   - 首页链接全部短链
6. **观察日志**（24h）

---

## 7. 回滚方案

触发条件：
- 大面积 404
- 路由冲突导致首页/API异常

回滚动作：
1. 回滚代码版本
2. 保留 `short_code` 字段（向后兼容，不需要回退DB）
3. 关闭 `/archives/* -> short` 的301逻辑，恢复旧长链直接访问
4. 如有必要恢复发布前 `db.sqlite` 备份

---

## 8. 测试用例（最小集）

1. **短码唯一性**
   - 连续创建100条，`short_code` 不重复
2. **短链直出**
   - `GET /Ab3xYz` 返回200，且无Location头
3. **旧链301**
   - `GET /archives/post_*.html` 返回301，Location=`/{short_code}`
4. **删除行为**
   - 删除后短链404，旧链也404（或进入兜底策略）
5. **首页展示**
   - 列表只出现短链

---

## 9. 实施拆分（建议）

### Phase 1（后端能力）
- DB迁移 + 短码生成
- `archive/posts` API输出短链
- 短链直出 + 长链301

### Phase 2（展示层）
- 首页链接全面切短
- canonical统一短链
- 历史内容批量重建

### Phase 3（稳定性）
- 日志与异常监控
- 冲突与404告警

---

## 10. 结论
该方案能完整满足你的要求：
- 新链短、可传播
- 短链打开即内容页本体
- 历史长链不断链（301迁移）
- 首页统一短链展示

技术风险可控，支持平滑上线与快速回滚。