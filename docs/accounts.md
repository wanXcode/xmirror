# 个人中心与 Google 登录

登录后，在 `/me`（中文 `/zh/me`）查看自己保存过的帖子。页面不收录（`noindex`），不进 sitemap。

## 工作方式

- 存档仍按推文 URL 全站去重；“谁存了什么”记在 `user_archives(user_id, post_id, source, created_at)`。
- 登录：Google OAuth 授权码流程，只请求 `openid email profile`。库里存 Google 用户 ID、邮箱、名称（表 `users`）。
- 会话：随机令牌放在 HttpOnly Cookie `xput_session`（30 天），库里只存 SHA-256（表 `user_sessions`）。
- 快捷指令密钥：登录后在 `/me` 生成，格式 `xk_…`，只显示一次，库里只存哈希（表 `user_keys`）。重置即让旧密钥失效。
  - `GET /api/archive/quick?...&key=<密钥>`，或请求头 `X-XPut-Key`。
  - 密钥错误返回 401 `INVALID_KEY`（不会静默丢记录）；不带密钥的请求行为不变。
- 网页上登录状态下保存的存档也会记入个人列表。
- 认领历史存档：`/me` 里粘贴旧短链或 X 链接，库里已有的会加入列表（`POST /api/me/archives/claim`）。没有任何记录的旧存档无法自动归属。
- “从我的列表移除”只删除归属，不删除存档本身。合并重复帖（`ops/dedupe-posts.js`）和管理员删除帖子时，归属会一并迁移/清理。

## 部署所需配置

| 变量 | 说明 |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 客户端 ID（Web 应用） |
| `GOOGLE_CLIENT_SECRET` | 对应的 Secret，只放服务器 `.env`，不要提交 |
| `GOOGLE_REDIRECT_URI` | 可选；默认 `${PUBLIC_BASE_URL}/auth/google/callback`，必须与 Google 控制台里登记的完全一致 |

未配置 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 时，`/me` 显示“登录暂不可用”，其余功能不受影响。

Google Cloud 设置：创建项目 → OAuth 同意屏幕（外部，范围仅 `openid`/`email`/`profile`，发布为正式版）→ 创建 OAuth 客户端（Web 应用），
授权来源 `https://xput.app`，重定向 URI `https://xput.app/auth/google/callback`。

## 数据库变更

启动时自动 `CREATE TABLE IF NOT EXISTS` 新增 `users`、`user_sessions`、`user_keys`、`user_archives`；不改动已有表。回滚代码可保留这些表。

## 接口

| 接口 | 说明 |
|---|---|
| `GET /auth/google?next=/zh/me` | 跳转 Google 登录（`next` 只允许 `/me`、`/zh/me`） |
| `GET /auth/google/callback` | Google 回调，校验 state 后建立会话 |
| `POST /auth/logout` | 退出登录 |
| `GET /api/me` | 当前用户、密钥后四位、存档数 |
| `POST /api/me/key` | 生成/重置密钥（明文只返回一次） |
| `GET /api/me/archives?limit&offset&q` | 我的存档列表 |
| `DELETE /api/me/archives/:code` | 从我的列表移除 |
| `POST /api/me/archives/claim` | `{ "text": "…链接…" }` 批量认领 |
