# XMirror 单机部署说明

生产目录采用“代码版本可替换、运行数据永久共享”的布局：

```text
/opt/xmirror/
├── current -> releases/20260908T...-<commit>
├── releases/                 # 只读代码版本，默认保留最近 5 个
├── shared/
│   ├── .env                  # 密钥和生产配置
│   ├── data/                 # SQLite、图片、视频
│   └── archives/             # 已生成的 HTML
└── recovery_snapshots/       # 每次发布前的数据库恢复副本
```

`data/`、`archives/`、`.env` 不属于发布包，脚本不会用 Git 内容覆盖它们。每个 release 中的同名路径只是指向 `shared/` 的软链接，以兼容现有程序使用相对路径的地方。

## 首次切换

确认 `/opt/xmirror` 是实际生产目录，并先检查磁盘空间。旧布局第一次迁移使用随仓库提供的脚本；它会停止 xmirror、为 SQLite 建立一致性快照，在同一磁盘内把运行数据移动到 `shared/`，再在旧路径建立兼容软链接。失败时会自动移回原位置并重启旧服务，不会复制整套媒体文件占用双倍空间。

```bash
sudo XMIRROR_APP_ROOT=/opt/xmirror \
  XMIRROR_PM2_BIN=/usr/local/node/bin/pm2 \
  bash ops/migrate-legacy-layout.sh
```

迁移成功并验证旧服务正常后，再执行下方发布命令。

生产环境变量建议放在 `/opt/xmirror/shared/.env`，至少复核 `PORT`、翻译服务密钥和审核管理令牌。不要提交该文件。

生产主机还需安装 Node.js/npm、PM2、curl、SQLite CLI，以及 `gcc`、`g++`、
`make`、`python3`。通常 `npm ci` 会安装与主机兼容的 sqlite3 预编译 binding；
发布脚本会在切换版本前执行一次内存数据库 CRUD。若预编译 binding 无法加载，
脚本会使用上述编译工具自动执行 `npm rebuild sqlite3 --build-from-source` 并再次
验证；重编译或复验失败时发布立即中止，`current` 不会被修改。

启用视频字幕还需要服务器安装 `ffmpeg` 和 `ffprobe`。XMirror 会把视频音频切成小片，调用配置的语音转写服务，再按用户选择的语言生成 WebVTT 字幕；字幕生成不会阻塞视频播放。Debian/Ubuntu 可执行 `apt-get install ffmpeg`。

## 发布

### 固定发布顺序

每次生产发布严格按以下顺序执行，不直接向受保护的 `main` 推送，也不从本地脏工作区部署：

1. 在本地确认 `git status`、版本号、测试和语法检查均通过。
2. 提交变更，创建 `release/vX.Y.Z` 分支并推送到 GitHub。
3. 创建 PR 到 `main`，等待所有 CI 通过后合并。
4. 读取合并后的 `origin/main` 完整 SHA，确认它属于 `origin/main`。
5. SSH 登录生产机，在服务器执行 `git fetch origin main`，从该完整 SHA 创建 `/tmp/xmirror-release-<SHA>` 独立 worktree。
6. 在该 worktree 中执行 `XMIRROR_SOURCE_DIR=... XMIRROR_APP_ROOT=/opt/xmirror XMIRROR_PM2_BIN=/usr/local/node/bin/pm2 bash ops/deploy.sh`。
7. 部署脚本成功后验证 `/healthz`、首页版本号、静态资源版本、PM2 `xmirror` 为 online，再验证本次改动的关键接口或页面行为。
8. 发布失败时保留旧 `current`，先看部署脚本的自动回滚结果，再检查 PM2 与健康端点。

发布前需要记住：`git push` 本身不会部署；生产机必须使用 GitHub `main` 的合并提交；不得打印 `/opt/xmirror/shared/.env`、API Key 或其他密钥。

先将代码同步至 GitHub `main`，确认目标提交的 CI 通过，并记录完整提交 SHA。
生产代码必须从 GitHub 拉取，不能先部署本地未推送的提交后补推，也不能通过复制代码或 Git bundle 绕过 GitHub。

服务器现有工作副本可能包含运行数据或其他修改，禁止在脏工作副本中直接 checkout/pull。
以下命令在服务器仓库中获取 GitHub 提交并创建独立工作目录（将占位符替换为已验证的完整 SHA）：

```bash
release_commit='<GitHub main 上已验证的完整提交 SHA>'
git fetch origin main
git merge-base --is-ancestor "$release_commit" origin/main
release_source="/tmp/xmirror-release-$release_commit"
git worktree add --detach "$release_source" "$release_commit"
sudo XMIRROR_SOURCE_DIR="$release_source" XMIRROR_APP_ROOT=/opt/xmirror \
  XMIRROR_PM2_BIN=/usr/local/node/bin/pm2 bash "$release_source/ops/deploy.sh"
```

上述检查和发布命令必须逐步成功后才继续；GitHub 拉取失败或目标提交不在 `origin/main` 时停止发布。
发布后核对运行版本与目标 SHA，并验证公网健康、短链和本次改动的用户行为。

未显式设置 `XMIRROR_HEALTH_URL` 时，脚本会从
`/opt/xmirror/shared/.env` 的数字型 `PORT` 推导检查地址；未配置 `PORT` 时与应用
一样回退到 `3000`。解析过程不会执行或 `source` 生产 `.env`，并会拒绝动态
表达式、重复赋值和越界端口。若需要覆盖完整地址，可在命令中增加例如
`XMIRROR_HEALTH_URL=http://127.0.0.1:8080/healthz`。

首次迁移验证的是尚未包含新版健康端点的旧服务，因此默认检查同端口根路径，
只要求 HTTP 成功。正式发布默认检查 `http://127.0.0.1:<PORT>/healthz`，不仅
要求 HTTP 成功，还会校验响应中的 `service` 为 `xmirror`，避免把同机其他 Web
服务误判为本次发布成功。显式提供 `XMIRROR_HEALTH_URL` 时两个脚本都会原样使用
该地址，但迁移仍只执行基础 HTTP 检查，发布仍要求 XMirror 服务身份。

脚本会依次：

1. 验证路径、Git revision、Node/npm/PM2；
2. 首次部署时保守迁移旧运行数据；
3. 使用 SQLite 在线备份接口创建一致的数据库恢复副本；
4. 从当前 Git commit 导出代码，并从新 release 中移除历史版本曾跟踪的运行数据；
5. 安装锁定依赖，验证 sqlite3 原生 binding（必要时从源码重编译），再运行测试和语法检查；
6. 原子切换 `current`，通过 PM2 重启并执行带服务身份校验的本机 HTTP 健康检查；
7. 若重启失败，自动把 `current` 切回上一版本；
8. 仅清理过旧的代码 release，不清理共享数据或恢复快照。

部署后检查：

```bash
pm2 status xmirror
pm2 logs xmirror --lines 50 --nostream
curl -fsS https://xmirror.app/ | grep -o 'Version v[0-9.]*' | head -1
```

## 回滚

选择一个已验证的旧 release，原子修改软链接并重载 PM2：

```bash
sudo ln -s /opt/xmirror/releases/<release> /opt/xmirror/.current-rollback
sudo mv -Tf /opt/xmirror/.current-rollback /opt/xmirror/current
sudo /usr/local/node/bin/pm2 delete xmirror
sudo XMIRROR_APP_ROOT=/opt/xmirror /usr/local/node/bin/pm2 \
  start /opt/xmirror/current/ops/ecosystem.config.cjs --update-env
```

代码回滚不会改变数据库。如需恢复数据库，应先停止服务，并由运维明确选择 `recovery_snapshots/` 中的副本；不要在运行中的 SQLite 上直接覆盖。

## Git 历史运行数据

`.gitignore` 只能阻止新增文件，不能自动取消已经被 Git 跟踪的历史数据库、图片和存档。应在独立提交中执行并审阅：

```bash
git rm -r --cached data archives
git status --short
```

这只从 Git 索引移除文件，不删除工作区内容。提交前仍需确认生产副本和恢复路径，历史 Git 对象中的敏感数据也不会因此消失。
