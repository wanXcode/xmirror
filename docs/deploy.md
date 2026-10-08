# XPut 前端第一期：部署与回滚方案

适用：把 `feature/frontend-v1`（合并到 `main` 之后）部署到正式环境，直接上线，不用临时子域名。
本文只描述步骤，不执行任何部署操作。

## 0. 服务器当前的运行方式（来自仓库配置）

| 项目 | 现状 | 依据 |
|---|---|---|
| 进程管理 | **PM2**，进程名 `xmirror`，PM2 可执行文件 `/usr/local/node/bin/pm2` | `ops/ecosystem.config.cjs`、`ops/DEPLOYMENT.md` |
| 目录布局 | `/opt/xmirror/{current → releases/<时间>-<提交>, releases/, shared/, recovery_snapshots/}`；`shared/` 里放 `.env`、`data/`（SQLite、图片、视频）、`archives/` | `ops/DEPLOYMENT.md` |
| 发布方式 | `ops/deploy.sh`：导出指定提交、`npm ci --omit=dev`、校验 sqlite3、**运行全部测试**、原子切换 `current`、PM2 重启、健康检查，失败自动切回上一版 | `ops/deploy.sh` |
| 运行时环境变量 | PM2 注入 `NODE_ENV=production`、`DATA_DIR`、`ARCHIVES_DIR`、`SQLITE_PATH`；其余来自 `shared/.env`（dotenv） | `ops/ecosystem.config.cjs`、`server.js` |
| 前置 | Cloudflare → nginx → Node（程序信任本机/内网这一跳传来的 `CF-Connecting-IP`） | `lib/client-ip.js`、`ops/DEPLOYMENT.md` |
| Docker | **不用**。仓库里没有 Dockerfile；`render.yaml` 是历史遗留（Render 平台，Node 18），与现网无关 | 仓库 |

> 现网没有 Docker 或其他编排方式的依据。如果服务器实际与上表不符（例如目录不是 `/opt/xmirror`），先以服务器为准，下面命令里的路径相应替换。

下面命令里统一使用：

```bash
export APP_ROOT=/opt/xmirror
export PM2=/usr/local/node/bin/pm2
export SITE=https://xput.app
```

> `ops/DEPLOYMENT.md` 里的例子写的是 `xmirror.app`，现站点域名是 `xput.app`（代码默认 `PUBLIC_BASE_URL=https://xput.app`）。

---

## 1. 数据库与文件格式变更

### 1.1 结论

- **会修改数据库结构，只做"加"，不删、不改已有列。** 新版第一次启动时自动执行（`lib/frontend-schema.js`，每次启动都安全重复执行）。
- **不修改 `data/` 里图片、视频、审核记录等已有文件的格式。**
- **旧版（v1.9.9）代码可以直接读取迁移后的数据库**，回滚不需要恢复数据库（见第 4 节）。
- 迁移本身**没有反向脚本**，但也不需要：新增的列、表旧版不认识也不会用，留着无害。

### 1.2 迁移内容全清单

**`posts` 表新增 7 列**（`ALTER TABLE ... ADD COLUMN`，SQLite 下是瞬时操作，不重写整表）

| 列 | 定义 | 用途 |
|---|---|---|
| `reply_count` | `INTEGER`（空） | 回复数，仅新存档写入 |
| `view_count` | `INTEGER NOT NULL DEFAULT 0` | 浏览计数（内存批量写入） |
| `share_count` | `INTEGER NOT NULL DEFAULT 0` | 分享计数 |
| `author_followers` | `INTEGER`（空） | 作者粉丝数，仅新存档写入 |
| `video_poster` | `TEXT`（空） | 视频封面，仅新存档写入 |
| `sensitive` | `INTEGER NOT NULL DEFAULT 0` | 敏感标记 |
| `legacy_indexed` | `INTEGER NOT NULL DEFAULT 0` | 迁移时对已收录存档的快照标记，**新版不使用**（收录以实时的 `seo_status` 为准，见 6.2），仅保留记录 |

**新增 3 张表**（`CREATE TABLE IF NOT EXISTS`）

| 表 | 用途 |
|---|---|
| `removed_posts` | 下架墓碑：短码 → 参考编号，使被删除的副本返回 410 |
| `post_featured` | 精选页内容与状态（草稿/上线/撤下、复核、上线时间）+ 索引 `idx_post_featured_status` |
| `app_meta` | 键值表，记录一次性迁移标记 |

**一次性数据写入（仅第一次启动）**

- `UPDATE posts SET legacy_indexed=1 WHERE seo_status='index'`，随后在 `app_meta` 写入标记 `legacy_indexed_v1`，之后不再执行。它只写新列，**不改 `seo_status`**。

**已有逻辑不变**：`content_reports`、`post_aliases`、SEO 相关表和迁移照旧。

### 1.3 文件系统上的变化

| 位置 | 变化 | 影响 |
|---|---|---|
| `data/og/` | **新增**，分享图缓存（每张约 30–60KB，按内容哈希命名） | 可随时整个删除，会自动重建；回滚后无人使用 |
| `archives/*.html` | 新版**不再生成**静态 HTML，`/archives/xxx.html` 只做 301 跳到短码（找不到则 404） | 旧文件原样保留，不要删；旧版回滚后会按数据库重新生成页面 |
| `data/images`、`data/videos`、`data/subtitles`、`data/moderation-reviews`、`moderation.log.jsonl` | 无变化 | — |
| `shared/.cache/sqlite3/...` | 无变化（沿用 deploy.sh 的 sqlite3 原生模块缓存） | — |

### 1.4 旧版能否读取迁移后的数据

可以，原因：

1. 新增列要么允许为空，要么带 `DEFAULT 0`；旧版的 `INSERT` 写明了列名且没有这些列，插入不会失败。
2. 旧版 `SELECT *`、按列名取值，多出的列被忽略。
3. 新增的表旧版不会访问。
4. 旧版短链页面是从数据库实时渲染的（不依赖 `archives/` 里的静态文件），所以新版保存的帖子，旧版也能打开。

**回滚后与新版行为差异（需知悉，不是数据损坏）**

- **「值得再读」的选入机制新旧版本一致**（都以 `seo_status='index'` 且 `seo_blocked=0` 为准），所以老存档和新保存、被自动评分或手动选入的存档，回滚前后的收录状态不变。
- 新版多出来的两类规则回滚后失效：① 上线的 AI 精选页如果自己的 `seo_status` 不是 `index`，旧版会把它当作普通页面（noindex）；② 新版把"敏感、有未处理举报、墓碑"的已选入存档排除出收录，旧版没有这些排除，回滚后这几类页面会按旧规则重新可收录。
- `/browse`：回滚后恢复旧版的中文页面（`/zh/browse` 不存在，返回 404）；新版的 `/browse` 是英文界面。
- 新版下架时写入的 `removed_posts` 墓碑旧版不认：旧版对这些短码返回 404，而不是 410；这是旧版原有的行为。
- 旧版没有的列不再更新（浏览/分享计数停止累加）。

---

## 2. 备份

### 2.1 需要备份什么

| 内容 | 位置 | 必须 | 说明 |
|---|---|---|---|
| SQLite 数据库 | `shared/data/db.sqlite` | **必须** | 用 SQLite 在线备份接口，不要直接 `cp` |
| 图片、视频、字幕、审核记录 | `shared/data/`（`images/ videos/ subtitles/ moderation-reviews/ moderation.log.jsonl`） | **必须** | 文件只增不改，可在线拷贝 |
| 已生成的静态页 | `shared/archives/` | 建议 | 旧版回滚时可用；体积通常不大 |
| 生产配置 | `shared/.env` | **必须** | 含密钥，备份文件权限 600，**不要打印、不要提交** |
| PM2 配置与进程表 | `ecosystem.config.cjs`（在 release 里）、`~/.pm2/dump.pm2` | 建议 | 回滚时用 |
| 当前运行版本 | `readlink $APP_ROOT/current` | **必须记录** | 回滚就靠它 |
| nginx 配置、定时任务 | `/etc/nginx/`、`crontab -l` | 建议 | 本次不改，仅留底 |
| 可以不备份 | `shared/data/og/`（缓存）、`node_modules/`（可重装）、`shared/.cache/` | — | — |

### 2.2 一致性：要不要先停服务

**不需要停服务。**

- 数据库：`sqlite3 ... ".backup"` 走 SQLite 的在线备份接口，得到的是某一时刻的一致快照；写入进行中也安全。**不要在服务运行时直接 `cp db.sqlite`**（可能拷到写到一半的页）。
- 媒体文件：已完成的文件不再被修改。正在下载的视频是临时文件，备份里即使带上不完整的文件也不影响（这些记录在数据库里是"下载中"，重启后会重新入队）。
- 数据库和媒体文件之间不要求绝对同一时刻：先备份数据库、再拷媒体，最坏情况是备份里的数据库比文件"旧一点"，文件多出来的部分是没有记录的孤儿文件，无害。
- 如果你想要绝对一致：在低峰期 `pm2 stop xmirror`，备份，再 `pm2 start`，约 1–2 分钟停机。本方案不要求。

### 2.3 备份命令

```bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
BK=$APP_ROOT/backups/pre-frontend-v1-$TS
sudo mkdir -p "$BK" && sudo chmod 700 "$BK"

# 0) 空间检查：备份需要的空间约等于 data/ 的大小
sudo du -sh $APP_ROOT/shared/data $APP_ROOT/shared/archives
df -h $APP_ROOT

# 1) 记录当前运行版本（回滚用，务必保存）
readlink $APP_ROOT/current | sudo tee "$BK/PREVIOUS_RELEASE.txt"
sudo $PM2 jlist > /dev/null && sudo $PM2 describe xmirror | sudo tee "$BK/pm2-describe.txt" > /dev/null

# 2) 数据库：在线一致性备份（先于媒体文件）
sudo sqlite3 $APP_ROOT/shared/data/db.sqlite ".timeout 5000" ".backup '$BK/db.sqlite'"
sudo sqlite3 "$BK/db.sqlite" "PRAGMA integrity_check;"                      # 期望输出 ok
sudo sqlite3 "$BK/db.sqlite" "SELECT COUNT(*) FROM posts;"                  # 记下数量，部署后对照
# 「值得再读」基线（部署后收录数量应与此一致，扣除敏感/有未处理举报/墓碑后）
sudo sqlite3 "$BK/db.sqlite" "SELECT COUNT(*) FROM posts WHERE seo_status='index' AND seo_blocked=0;" | sudo tee "$BK/baseline-indexed.txt"

# 3) 数据文件和静态页（在线拷贝；不含缓存）
sudo rsync -a --exclude 'db.sqlite*' --exclude 'og/' $APP_ROOT/shared/data/ "$BK/data/"
sudo rsync -a $APP_ROOT/shared/archives/ "$BK/archives/"

# 4) 配置和进程表（含密钥，权限 600）
sudo install -m 600 $APP_ROOT/shared/.env "$BK/env"
sudo cp ~/.pm2/dump.pm2 "$BK/pm2-dump.pm2" 2>/dev/null || true
sudo cp -a /etc/nginx "$BK/nginx" 2>/dev/null || true
crontab -l 2>/dev/null | sudo tee "$BK/crontab.txt" > /dev/null || true

# 5) 校验备份并记录
sudo ls -la "$BK"; sudo du -sh "$BK"
echo "备份目录: $BK"
```

把数据库备份和 `.env` 下载到本地电脑（在**本地电脑**上执行；`<服务器>` 为 SSH 主机名，`<备份目录>` 为上面输出的 `$BK`）。`.env` 含密钥，下载后只放在本机加密磁盘上，不要提交、不要上传到聊天或工单：
```bash
mkdir -p ~/xput-backup && chmod 700 ~/xput-backup
# 备份目录属于 root，先在服务器上改成登录用户可读，再下载（或用 ssh + sudo cat 管道，二选一）
ssh <服务器> 'sudo chown -R $USER "<备份目录>"'
scp <服务器>:<备份目录>/db.sqlite <服务器>:<备份目录>/env <服务器>:<备份目录>/PREVIOUS_RELEASE.txt ~/xput-backup/
chmod 600 ~/xput-backup/env
# 校验：本地与服务器上的校验和一致
shasum -a 256 ~/xput-backup/db.sqlite; ssh <服务器> 'sha256sum "<备份目录>/db.sqlite"'
```

> `ops/deploy.sh` 在部署时还会自动再做一份数据库快照到 `$APP_ROOT/recovery_snapshots/<release>/db.sqlite`。上面的备份是它之外的完整备份，不要省略。
> 备份目录与数据在同一块磁盘上只能防误操作；如有条件，把 `$BK` 再同步到另一台机器或对象存储。

---

## 3. 部署步骤

### 3.1 部署前确认（约 5 分钟）

1. **Cloudflare Worker 已按第 5 节部署并用真实链接验证通过。**（否则新版页面里的下载会失效，因为生产环境下 Node 不再提供 `/dl`。）
2. 第 2 节备份已完成，`$BK` 路径已记下。
3. 服务器环境：
   ```bash
   node -v                      # 需要 >= 20.17（package.json engines）
   df -h $APP_ROOT              # 新依赖含字体包（约 100MB+），release 需要几百 MB 空闲
   ldd --version | head -1      # 分享图使用 @resvg/resvg-js 原生二进制，较老的 glibc 可能无法加载（见下）
   which sqlite3 curl           # deploy.sh 需要
   ```
   - **分享图依赖**：`@resvg/resvg-js` 是预编译二进制。如果 glibc 太老，加载会失败；失败时 `/og/*.png` 自动退回品牌默认图并在日志里出现 `OG image failed`，**不会影响其他功能**。部署后按 3.4 检查，必要时作为已知遗留问题之后处理，不阻断上线。
   - `deploy.sh` 会 `npm ci --omit=dev --ignore-scripts`，resvg 的二进制来自可选依赖，不依赖安装脚本。
4. 代码来源：必须是 GitHub `main` 上已通过 CI 的合并提交。生产机上用 `git fetch`，不从本地脏工作区部署（见 `ops/DEPLOYMENT.md` "固定发布顺序"）。
5. **一次性审核现有「值得再读」（上线前必做，约 15 分钟）**：新站会把现有 `seo_status='index'` 的存档继续放进 sitemap 和「值得再读」列表，先人工过一遍，把不想公开推荐的屏蔽掉。
   ```bash
   cd $APP_ROOT/current
   # 只读导出（对第 2 节的备份库或线上库都可以；旧库结构也能跑）。列：id、短码、作者、正文前 100 字、是否有媒体(1/0)
   node ops/audit-indexable.js "$BK/db.sqlite" > /tmp/indexable.tsv      # 末尾会在 stderr 打印总数，应与 baseline-indexed.txt 一致
   column -t -s$'\t' /tmp/indexable.tsv | less -S                        # 或下载后用表格软件打开
   ```
   不想用脚本时，等价的纯 SQL（正文含 HTML 标签，仅供粗看）：
   ```bash
   sudo sqlite3 -header -separator $'\t' "$BK/db.sqlite" "SELECT id, short_code, author||' (@'||author_handle||')' AS author, substr(replace(replace(content,char(10),' '),char(9),' '),1,100) AS text_first_100, (COALESCE(images,'[]')<>'[]' OR (video_status='completed' AND video IS NOT NULL)) AS has_media FROM posts WHERE seo_status='index' AND seo_blocked=0 AND short_code IS NOT NULL ORDER BY id;"
   ```
   **屏蔽某一条**（`<ID>` 用上面导出的 id；屏蔽后立即变为 noindex，并从 sitemap 和列表消失；这是现网旧版就有的接口，**部署前后都能用**）：
   ```bash
   curl -s -X POST "$SITE/api/admin/seo/<ID>" -H "x-admin-token: $MODERATION_ADMIN_TOKEN" -H 'content-type: application/json' -d '{"blocked":true}'
   # 反悔：-d '{"blocked":false}'（之后按规则重新评估）
   ```
   不想走接口时（服务停着或接口不可用）：`sudo sqlite3 $APP_ROOT/shared/data/db.sqlite "UPDATE posts SET seo_blocked=1, seo_status='noindex' WHERE id=<ID>;"`。
   审核完把被屏蔽的 id 记进部署记录，上线后在 6.6 核对：copies sitemap 的数量 = 导出总数 − 屏蔽数（再减去后来新增的排除项）。这是一次性审核；之后新存档按下面 3.2 的自动收录门槛处理。
6. **必须**升级版本号再部署：`package.json`、`package-lock.json`、`VERSION.md` 的版本号一致且高于线上版本，并在 `CHANGELOG.md` 顶部追加了本版本说明。合并前确认：`node -p "require('./package.json').version"` 输出的就是本次要发布的 `<版本号>`。部署后 CSS/JS 的版本号前缀、日志和回滚校验都靠它区分新旧版；版本号没升就不要部署。

### 3.2 设置新的环境变量

写到 `$APP_ROOT/shared/.env`（**不要打印该文件**；用追加方式，避免覆盖）：

```bash
# 先确认已有的关键变量存在（只看是否存在，不输出内容）
sudo grep -c '^MODERATION_ADMIN_TOKEN=' $APP_ROOT/shared/.env     # 期望 1；管理接口鉴权用它

# 追加新变量（把占位符换成真实值）
sudo tee -a $APP_ROOT/shared/.env >/dev/null <<'EOF'
# --- XPut 前端第一期 ---
CONTACT_EMAIL=<联系邮箱，显示在隐私页和举报页>
ANALYTICS_NAME=<统计服务名称，写入隐私政策>
EOF
```

| 变量 | 是否必须 | 说明 |
|---|---|---|
| `CONTACT_EMAIL` | 必须 | 隐私页、举报页显示；为空则不显示 |
| `ANALYTICS_NAME` | 必须 | 隐私政策里的统计服务名；为空则用通用描述 |
| `MODERATION_ADMIN_TOKEN` | 已有 | 管理接口鉴权，未带/错误返回 401，未配置返回 503 |
| `PUBLIC_BASE_URL` | 建议确认 | 应为 `https://xput.app`（canonical、分享图、sitemap、来源校验） |
| `DOWNLOAD_VIA` | **不要设置** | 生产默认 `worker`（页面用 `/dl`）。仅应急时设为 `node`（见 `docs/download-proxy-rollout.md`） |
| `FEATURE_TRANSLATION` | **不要设置** | 默认开启（v2.1.0 起）：上线后帖子页即出现「翻译帖子」，需确认 `SILICONFLOW_API_KEY` 已配置；紧急关闭设为 `false` 并重启 |
| `FEATURE_SUBTITLES` | **不要设置** | 生产默认关闭字幕路由。**v2.1.0 起字幕与翻译开关分开：如果现网靠 `FEATURE_TRANSLATION=true` 在用字幕，升级后字幕会停用**，这是预期行为（字幕功能后期单独开发） |
| `ANALYTICS_DOMAIN` / `ANALYTICS_SRC` | 可不设 | 不设则读 `config/site.json`（域名 `xput.app`）；设为空字符串表示关闭统计 |
| `SEO_AUTO_INDEX` | 可选 | 默认开启：新存档按评分自动收录。设为 `false` 则全部改为人工选入 |
| `SEO_AUTO_INDEX_DAILY_CAP` | 可选 | 自动收录的每日新增上限，默认 `20`（按 UTC 日计，超出的顺延到次日；人工选入不受限）。默认值也在 `config/seo-auto-index.json` |
| `SEO_AUTO_INDEX_BLOCK_SENSITIVE` | 可选 | 默认 `true`：X 标记 `possibly_sensitive`（含引用帖带标记）的帖子不自动收录；存档入口本身也拒绝这类帖子 |
| `SHORTCUT_URL`、`VIEW_COUNTER_FLUSH_MS`、`FETCH_RATE_LIMIT_PER_MIN`、`DOWNLOAD_RATE_LIMIT_PER_MIN` | 可选 | 默认值即可 |

隐私政策页面的"最后更新"日期已设为 `2026-10-03`（`lib/content/*.js` 的 `pages.privacy.updatedOn`）；如果上线日期推迟，请在合并前同步修改。

### 3.3 部署

在生产机上（`ops/DEPLOYMENT.md` 的固定流程；`<SHA>` 为 `origin/main` 上已验证的合并提交完整 SHA）：

```bash
cd <服务器上的仓库工作副本，例如 /opt/xmirror-src>
release_commit='<SHA>'
git fetch origin main
git merge-base --is-ancestor "$release_commit" origin/main      # 必须成功
release_source="/tmp/xmirror-release-$release_commit"
git worktree add --detach "$release_source" "$release_commit"

sudo XMIRROR_SOURCE_DIR="$release_source" XMIRROR_APP_ROOT=$APP_ROOT \
  XMIRROR_PM2_BIN=$PM2 bash "$release_source/ops/deploy.sh"
```

脚本会依次完成：数据库快照 → 导出代码 → `npm ci` → 校验 sqlite3 → **运行全部测试**（约 20 秒；会在本机随机端口起临时服务，需要能监听本机端口）→ 原子切换 `current` → PM2 重启 → 健康检查（`/healthz`，要求 `service=xmirror`）→ `pm2 save`。任何一步失败会自动切回上一个版本，`current` 不会指向半成品。整个过程通常 2–5 分钟，其中真正的服务中断只有 PM2 重启的几秒钟。

> 新版**第一次启动**时完成数据库迁移（1.2 节），日志里没有迁移输出，成功与否看 3.4 的结构检查。

### 3.4 启动后立即验证（约 3 分钟）

```bash
# 进程与日志
sudo $PM2 status xmirror                                   # online，重启次数不应持续增加
sudo $PM2 logs xmirror --lines 60 --nostream               # 应看到 "下载代理: worker（页面使用 /dl）"，没有报错堆栈
readlink $APP_ROOT/current                                 # 指向新 release

# 健康
curl -fsS $SITE/healthz                                    # {"status":"ok","service":"xmirror"}

# 数据库迁移成功（应看到 7 个新列、3 张新表）
sudo sqlite3 $APP_ROOT/shared/data/db.sqlite "PRAGMA table_info(posts);" | grep -E 'reply_count|view_count|share_count|author_followers|video_poster|sensitive|legacy_indexed'
sudo sqlite3 $APP_ROOT/shared/data/db.sqlite ".tables" | tr -s ' ' '\n' | grep -E '^(removed_posts|post_featured|app_meta)$'
sudo sqlite3 $APP_ROOT/shared/data/db.sqlite "SELECT COUNT(*) FROM posts;"     # 与备份时的数量一致或更多

# 新版确实在运行（页头有新 logo 的图标版本号，且 HTML 引用带内容哈希的样式）
curl -s $SITE/ | grep -o 'favicon.svg?v=[^"]*' | head -1           # xput-logo-b-1
curl -s $SITE/ | grep -o '/css/xput.css?v=[^"]*' | head -1         # 必须形如 <版本号>-1a2b3c4d，前缀要与 package.json 中的 version 一致（不一致说明跑的不是新版）
```

通过后继续第 6 节的上线检查清单。任何一项不通过且 10 分钟内无法修复 → 回滚（第 4 节）。

---

## 4. 回滚方案（目标：10 分钟内完成）

### 4.1 决策

| 现象 | 做法 |
|---|---|
| 新版页面/功能异常，数据库正常 | **A. 只回滚代码**（默认；约 2–3 分钟） |
| 数据库损坏或迁移导致无法启动 | **B. 回滚代码 + 恢复数据库**（约 5 分钟，**会丢失备份之后新增的数据**） |
| 上一个 release 目录已被清理 | **C. 从旧提交重新部署**（约 5–8 分钟） |

因为旧版可以直接读取新版数据库（1.4 节），**绝大多数情况选 A**，不需要动数据库。

### 4.2 A. 只回滚代码（约 2–3 分钟）

`PREV` 是备份时记下的旧 release 路径（`$BK/PREVIOUS_RELEASE.txt`，也可用 `ls -t $APP_ROOT/releases | head` 查看；`deploy.sh` 默认保留最近 5 个）。

```bash
PREV=$(sudo cat $BK/PREVIOUS_RELEASE.txt)          # 例如 /opt/xmirror/releases/20260929T...-f6b2fdf...
[ -d "$PREV" ] && echo "旧版本存在: $PREV"

sudo ln -s "$PREV" $APP_ROOT/.current-rollback
sudo mv -Tf $APP_ROOT/.current-rollback $APP_ROOT/current          # 原子切换
sudo $PM2 delete xmirror
sudo XMIRROR_APP_ROOT=$APP_ROOT $PM2 start $APP_ROOT/current/ops/ecosystem.config.cjs --update-env
sudo $PM2 save

curl -fsS $SITE/healthz                                            # service = xmirror
curl -s $SITE/ | grep -o '/css/xput.css?v=[^"]*' | head -1     # 回滚后前缀应变回上一版本号（不再是 <版本号>）；v1.9.9 的页面没有该样式，改用 grep -c 'Version v1.9.9' 期望 1
```

数据（`shared/`）原样保留；`.env` 里新增的变量旧版不读取，可以留着。

### 4.3 B. 恢复数据库（仅在必要时，约 +2 分钟）

选择备份中的快照：优先 `$BK/db.sqlite`（部署前的完整备份）；也可用 `$APP_ROOT/recovery_snapshots/<release>/db.sqlite`。

```bash
sudo $PM2 stop xmirror                                          # 先停服务，不要在运行中覆盖 SQLite
sudo cp -a $APP_ROOT/shared/data/db.sqlite $APP_ROOT/shared/data/db.sqlite.failed-$(date -u +%H%M)   # 留证
sudo rm -f $APP_ROOT/shared/data/db.sqlite-wal $APP_ROOT/shared/data/db.sqlite-shm
sudo cp -a "$BK/db.sqlite" $APP_ROOT/shared/data/db.sqlite
sudo sqlite3 $APP_ROOT/shared/data/db.sqlite "PRAGMA integrity_check;"          # ok
# 然后执行 4.2 的"切换代码并启动"
```

代价：备份之后新增的数据会丢失——部署窗口内新保存的帖子、举报、浏览计数。图片/视频文件不受影响（只是出现没有记录的孤儿文件）。

### 4.4 C. 上一个 release 已不在

```bash
cd <仓库工作副本>
git worktree add --detach /tmp/xmirror-rollback <旧提交 SHA>      # 部署前记录的上一版本提交（回滚后 css 版本号前缀应为上一版本号）；release 目录名末尾也含它
sudo XMIRROR_SOURCE_DIR=/tmp/xmirror-rollback XMIRROR_APP_ROOT=$APP_ROOT XMIRROR_PM2_BIN=$PM2 \
  bash /tmp/xmirror-rollback/ops/deploy.sh
```

这条路径要重新 `npm ci` 和跑测试，比 A 慢。因此**部署前请确认上一个 release 目录存在**（`ls $APP_ROOT/releases`），并且不要在同一天连续部署超过 5 次（会被清理）。

### 4.5 时间预算

| 步骤 | 时间 |
|---|---|
| 判断需要回滚、找到 `PREV` | 1 分钟 |
| 4.2 切换代码并重启 | 1–2 分钟 |
| （仅 B）停服、恢复数据库、校验 | +2 分钟 |
| 验证首页、短链、`/healthz` | 2 分钟 |
| **合计** | A ≈ 5 分钟；B ≈ 7–8 分钟 |

### 4.6 回滚后的收尾

- Cloudflare：Worker 与路由可以保留（旧版页面不使用 `/dl`）。如果上线时新增了缓存规则或 WAF 规则，一并撤销。
- 把失败现象、日志（`pm2 logs xmirror --lines 200 --nostream`，注意不要包含 `.env`）保存下来，再决定修复后重新发布。
- 数据库里新增的列和表保留即可。

---

## 5. 与 Cloudflare Worker 的部署顺序

**原则：先 Worker，验证通过后，再发布新版 Node。** 生产环境下新版 Node **不再提供 `/dl`**（由 Worker 接管），所以顺序反了下载会全部失败。反过来，先部署 Worker 是安全的：此时旧版 Node 没有 `/dl` 路由，Worker 路由（`xput.app/dl*`）不会与它冲突，旧版页面也不使用它。

1. **部署 Worker**（在 `workers/download-proxy/`）：先核对 `wrangler.toml` 的路由、`zone_name`、`RATE_LIMITER` 绑定写法，然后 `npx wrangler deploy`。
2. **用真实链接验证 Worker**（此时线上仍是旧版前端）：
   ```bash
   U='<一个真实的 https://video.twimg.com/....mp4 地址>'
   curl -sI "$SITE/dl?u=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$U")&n=test.mp4"
   #  期望: 200 或 206；content-disposition: attachment; filename="test.mp4"；content-length；cache-control: private, no-store
   curl -sI "$SITE/dl?u=https%3A%2F%2Fexample.com%2Fa.mp4"          # 期望 400（非 twimg 地址被拒绝）
   for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code} " "$SITE/dl?u=<同上>&n=t.mp4" -H 'Range: bytes=0-1'; done   # 超限后出现 429（带 Retry-After）
   ```
   再在浏览器里打开该下载链接：应直接下载文件，**不在新标签页播放**。
3. 验证全部通过 → 进入第 2、3 节（备份、部署 Node）。**Worker 验证不通过则不要部署新版前端。**
4. 部署后用真机再下载一次视频和图片（第 6 节）。
5. 确认 Cloudflare 缓存设置符合 `docs/caching.md`：不要对 HTML 开 "Cache Everything"；`/{短码}`、`/api/*`、`/dl*` 绕过缓存。

**如果 Worker 临时无法上线**（权限、额度等），备选：在 `shared/.env` 加 `DOWNLOAD_VIA=node` 后再部署新版 Node，页面改用 Node 端的 `/node-dl`（带宽走源站，只作过渡）。Worker 就绪后删除该变量并重启（`sudo $PM2 restart xmirror --update-env`）。

**Worker 自身回滚**：`npx wrangler rollback`，或在 Cloudflare 控制台暂时关闭路由；同时在 `.env` 加 `DOWNLOAD_VIA=node` 并重启 Node，页面立即改用 Node 代理，不需要改代码。

---

## 6. 上线后立即执行的检查清单

按顺序执行；每项都写了怎么验证。准备工具：一台桌面浏览器、一部 iPhone、一部 Android（真机检查见 6.5）。

### 6.1 首页与 Viewer

| 项目 | 验证方法 | 通过标准 |
|---|---|---|
| 首页 | 浏览器打开 `$SITE/`、`$SITE/zh/`；`curl -s $SITE/ \| grep -c '<h1'` | 页面正常，唯一 H1；页头是新 logo；标签页图标是蓝底白 X 橙托盘（旧图标需强制刷新）；`curl -sI $SITE/zh` 返回 301 到 `/zh/` |
| Viewer | 打开 `$SITE/twitter-viewer`、`$SITE/zh/twitter-viewer` | 只有 "View post"，没有账号搜索/主页浏览/时间线 |
| 「值得再读」列表 | 打开 `$SITE/browse`、`$SITE/zh/browse`；`curl -s $SITE/browse \| grep -o 'name="robots" content="[^"]*"'` | 新版页头页脚和配色；列表有内容；`index, follow`；有 hreflang 一对；页脚有"Saved posts / 已保存的帖子"入口；带 `?q=` 的搜索页是 `noindex, follow`；翻页链接可用 |
| 其他固定页 | `/ios-shortcut`（桌面显示二维码）、`/privacy`、`/report`（含 `/zh/`），随便打开一个不存在地址 | 都正常；隐私页显示联系邮箱和统计服务名；404 页友好且带输入框 |
| 语言切换 | 每页切换中英文 | URL 在 `/xxx` 与 `/zh/xxx` 间切换 |
| 响应头 | `curl -sI $SITE/ \| grep -i -E 'content-encoding\|cache-control'` | `content-encoding: br` 或 gzip；`cache-control: no-cache, must-revalidate` |
| 样式/字体 | `curl -s $SITE/ \| grep -o 'fonts.googleapis' \| wc -l` | 0（不再请求 Google Fonts）；浏览器 Network 里字体来自 `/fonts/` |

### 6.2 旧短链

先从数据库取几个真实的旧短码，覆盖不同类型：

```bash
sudo sqlite3 $APP_ROOT/shared/data/db.sqlite \
  "SELECT short_code FROM posts ORDER BY id LIMIT 3;
   SELECT short_code FROM posts ORDER BY id DESC LIMIT 3;
   SELECT short_code FROM posts WHERE video IS NOT NULL AND video<>'' LIMIT 2;
   SELECT short_code FROM posts WHERE images IS NOT NULL AND images NOT IN ('','[]') LIMIT 2;
   SELECT alias_code FROM post_aliases LIMIT 2;
   -- 已选入「值得再读」的存档（应保持可收录），各取几个
   SELECT short_code FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id LIMIT 3;
   SELECT short_code FROM posts WHERE seo_status='index' AND seo_blocked=0 ORDER BY id DESC LIMIT 3;
   -- 未选入的存档（应为 noindex）
   SELECT short_code FROM posts WHERE seo_status<>'index' LIMIT 3;"
```

对每个短码：

```bash
for c in <上面查到的短码...>; do printf "%s " $c; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $SITE/$c; done
```

| 检查 | 通过标准 |
|---|---|
| 普通旧短码 | `200`；浏览器里正文、图片、视频能正常显示/播放，发布日期和保存日期正确 |
| 别名短码（`post_aliases`） | `301` 到主短码 |
| 旧静态地址 `/archives/post_xxx.html`（取一个 `html_file`） | `301` 到对应短码 |
| 不存在的 6 位短码（如 `ZZZZZZ`） | `404`，页面是 "This link doesn't exist" + 输入框 |
| 被下架的副本（若有） | 本次迁移前被删除的行不在库里，显示 404；以后通过管理接口下架的显示 410 |
| **已选入「值得再读」的存档**（上面第 5 组） | `curl -s $SITE/<短码> \| grep -o 'name="robots" content="[^"]*"'` → **`index, follow`**；`curl -s $SITE/<短码> \| grep -c '"@type":"SocialMediaPosting"'` → `1`；`<title>` 沿用原有 SEO 标题；用普通结果页模板（没有 AI 摘要区块） |
| 未选入的存档（第 6 组）、被屏蔽/敏感/有未处理举报的存档 | 同上命令 → `noindex, follow`，无 SocialMediaPosting |
| 结果页不被 CF 缓存 | `curl -sI $SITE/<旧短码> \| grep -i -E 'cache-control\|cf-cache-status'` → `private, no-store`，`cf-cache-status: DYNAMIC` |

### 6.3 下载

| 检查 | 方法 | 通过标准 |
|---|---|---|
| 解析 | 在首页粘贴一条带视频的真实推文，点 Download | 出现结果卡，缩略图、清晰度、文件大小；"Other qualities" 默认展开 |
| 视频下载 | 点主按钮 | 进度 → "Saved ✓"；文件正常播放；**没有打开新标签页** |
| 代理响应头 | 浏览器 Network 看 `/dl?...` | `content-disposition: attachment`；域名是 `xput.app`（不是直连 twimg） |
| 图片 | 粘贴图片帖 | 桌面 ZIP 可解压；手机走系统分享面板（真机检查） |
| GIF | 粘贴 GIF 帖 | 得到 MP4 |
| 大文件 | 找一个 >150MB 视频（如有） | 交给浏览器原生下载，仍走 `/dl`，响应带 `attachment` |
| 限流 | 连续快速点击解析 21 次以上 | 出现 "请求过于频繁" 倒计时（`FETCH_RATE_LIMIT_PER_MIN` 默认 20） |
| 错误状态 | 粘贴不存在的帖子 ID | 显示 "原帖不可用"（不是 503 "服务繁忙"） |

### 6.4 View（保存副本）

| 检查 | 方法 | 通过标准 |
|---|---|---|
| 新建副本 | 在 Viewer 页粘贴一条**未保存过**的公开推文，点 View post | 出现 "Saving a copy…"，跳转到 `/XXXXXX`；页面正常 |
| 数据库 | `sudo sqlite3 .../db.sqlite "SELECT id,short_code,view_count,sensitive,html_file FROM posts ORDER BY id DESC LIMIT 1;"` | 有新行；`sensitive=0` |
| 重复保存 | 对同一条推文再 View | 返回同一个短码（显示 "已保存过" 后跳转） |
| 结果页功能 | 复制/分享链接、"Download media" 弹窗、"Open on X" | 弹窗内按钮可下载；Tab 焦点在弹窗内循环，Esc 关闭后回到按钮 |
| 浏览计数 | 刷新几次后等 30 秒再查 `view_count` | 数值增加（批量写入，约 30 秒） |
| 收录状态 | 该页 robots | 刚保存时是 `noindex, follow`（尚未评分）；SEO 评分任务（每分钟轮询）达标后会自动变为 `index, follow`，与旧版一致；这是预期行为 |
| 分享图 | `curl -s -o /tmp/og.png -w "%{http_code} %{content_type} %{size_download}\n" $SITE/og/<新短码>.png` | `200 image/png`，约 30–60KB；`file /tmp/og.png` 显示 1200 x 630。若很小且等于 `xput-share.png`，查看日志是否有 `OG image failed` |

### 6.5 年龄确认

线上没有已存档的敏感帖（敏感内容不允许存档），所以分两部分验证：

1. **解析阶段**：在首页粘贴一条真实的敏感推文（`possibly_sensitive`）→ 应显示年龄确认卡，**确认前** `/api/resolve` 返回里不含媒体链接（浏览器 Network 查看）；点确认后才出现结果卡。确认后浏览器应带有会话 cookie `xput_age`（HttpOnly；关闭浏览器后失效）。
2. **结果页阶段**（可选，需要写生产库，做完立即删除）：
   ```bash
   sudo sqlite3 $APP_ROOT/shared/data/db.sqlite \
     "INSERT INTO posts(url,short_code,author,author_handle,content,images,video_status,sensitive,html_file) VALUES('https://x.com/i/status/1','ZZTEST','测试','test','敏感测试正文SECRET','[]','none',1,'x.html');"
   curl -s $SITE/ZZTEST | grep -c 'SECRET'          # 必须是 0：确认前不含正文
   # 浏览器打开 $SITE/ZZTEST，点确认，应显示正文
   sudo sqlite3 $APP_ROOT/shared/data/db.sqlite "DELETE FROM posts WHERE short_code='ZZTEST';"
   ```
   自动化测试已覆盖这条逻辑；若不想写生产库，可只做第 1 部分。

### 6.6 sitemap 与 robots

```bash
curl -s $SITE/robots.txt
#  期望包含: Allow: /   Disallow: /api/   Disallow: /dl   Disallow: /node-dl   Sitemap: https://xput.app/sitemap.xml

curl -s $SITE/sitemap.xml
#  期望: <sitemapindex>，包含 /sitemap-main.xml 和 /sitemap-copies-1.xml

curl -s $SITE/sitemap-main.xml | grep -c '<url>'          # 10（首页、Viewer、快捷指令、值得再读 /browse、隐私，各中英文）；不含 /report
curl -s $SITE/sitemap-main.xml | grep -c 'hreflang'       # 30（每个 URL 3 个）
curl -s $SITE/sitemap-copies-1.xml | grep -c '<url>'      # = 「值得再读」数量 + 上线的 AI 精选页（刚上线时没有）；对照基线，见下
sudo sqlite3 $APP_ROOT/shared/data/db.sqlite "SELECT COUNT(*) FROM posts p WHERE p.seo_status='index' AND p.seo_blocked=0 AND COALESCE(p.sensitive,0)=0 AND p.short_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM content_reports r WHERE r.post_id=p.id AND r.status='open') AND NOT EXISTS (SELECT 1 FROM removed_posts x WHERE x.short_code=p.short_code);"
#  上面两个数字应相等（上线初期没有 AI 精选页）；与 baseline-indexed.txt 相比只会因排除项变少，不会大幅下降
curl -s $SITE/sitemap-copies-1.xml | grep -c "$(sudo sqlite3 $APP_ROOT/shared/data/db.sqlite "SELECT short_code FROM posts WHERE seo_status='index' AND seo_blocked=0 LIMIT 1;")"   # 1：抽查一个已选入的存档在 sitemap 里
curl -s $SITE/sitemap-copies-2.xml -o /dev/null -w '%{http_code}\n'   # 404
```

之后在 Google Search Console 提交 `https://xput.app/sitemap.xml`，并把旧的 `/sitemap.xml`（原先直接列出文章）替换掉。

### 6.7 其他必查项

| 项目 | 方法 | 通过标准 |
|---|---|---|
| 管理接口鉴权 | `curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/admin/featured` | `401`（带正确 `x-admin-token` 才返回 200） |
| API 不被缓存 | `curl -sI -X POST $SITE/api/resolve -H 'content-type: application/json' -d '{}' \| grep -i cache-control` | `no-store` |
| 翻译/字幕默认关闭 | `curl -s $SITE/api/translate/1` | `404`，`code: FEATURE_DISABLED` |
| 下载代理未走 Node | `curl -s -o /dev/null -w '%{http_code}' "$SITE/node-dl?u=x"` | `404`（`DOWNLOAD_VIA` 未设置时 Node 不提供） |
| 日志 | `sudo $PM2 logs xmirror --lines 200 --nostream` | 无未捕获异常、无反复出现的 `OG image failed`、`featured admin failed` |
| 资源占用 | `sudo $PM2 monit` 或 `ps -o rss,cpu -p $(sudo $PM2 pid xmirror)` | 内存稳定，重启次数不增长 |
| 统计 | 浏览器 Network 看统计脚本 | 域名为 `xput.app`（`ANALYTICS_*` 为空则不加载） |

### 6.8 真机

按 `docs/local-testing.md` 第 3 节，重点：

- iPhone Safari：下载视频 → 文件 App → 存到相册提示条；图片走系统分享面板；快捷指令页按钮。
- Android Chrome：下载进入"下载内容"，相册可见；图片分享面板。
- 手机上解析成功后自动滚动，主下载按钮在首屏；下载弹窗为底部抽屉。

### 6.9 上线后 24 小时

- 每隔几小时看一次 `pm2 logs`、Search Console 的覆盖率/抓取错误（新增的 noindex 页面不应出现在索引里）。
- 关注 429/5xx 比例（统计来源成功率时排除日志里带 `"definitive": true` 的记录）。
- 如发现问题，按第 4 节决策表回滚。

---

## 7. 一页速查

```text
部署前:  Worker 已部署并验证 → 备份(第2节) → .env 加 CONTACT_EMAIL / ANALYTICS_NAME → 记录 PREVIOUS_RELEASE
部署:    git worktree <SHA> → sudo XMIRROR_SOURCE_DIR=... bash ops/deploy.sh   (内含数据库快照、测试、健康检查、失败自动回退)
验证:    /healthz、迁移列与表、首页/旧短链/下载/View/sitemap/robots (第6节)
回滚:    ln -s $PREV → mv -Tf current → pm2 delete && pm2 start ecosystem   (代码回滚；数据库无需恢复)
应急:    下载异常 → .env 加 DOWNLOAD_VIA=node 并 pm2 restart --update-env
```
