# XPut 运维手册

核验日期：2026-10-03。本文不含生产配置值或连接凭据；连接信息由管理员另行保管，配置见服务器 `/opt/xmirror/shared/.env`。

## 架构与隔离边界

- 站点请求：Cloudflare → nginx → PM2 管理的 Node。
- 下载请求：Cloudflare Worker `xput-download-proxy` 接管 `xput.app/dl*`，流式转发媒体，不由源站保存下载器文件。
- View 正常保存副本会在源站保存媒体。不要把下载器与存档的磁盘行为混为一谈。
- 同机有其他站点。只操作 XPut vhost、专属脚本和 `xmirror` 进程；不要全局封锁 80/443、重启所有 PM2 应用或覆盖 Docker 防火墙规则。

## 目录与运行时

| 路径或项目 | 用途 |
|---|---|
| `/opt/xmirror/current` | 指向当前 release |
| `/opt/xmirror/releases/` | 精确 Git SHA 的代码版本 |
| `/opt/xmirror/shared/.env` | 生产配置；不打印、不提交 |
| `/opt/xmirror/shared/data/` | 数据库、媒体、审核、分享图缓存 |
| `/opt/xmirror/shared/archives/` | 保留的旧静态页，不删除 |
| `/opt/xmirror/backups/` | 发布前与安全配置备份 |
| `/opt/xmirror/recovery_snapshots/` | deploy.sh 的一致性数据库快照 |
| PM2 `xmirror` | 只重启此进程 |
| `/usr/bin/node` | 生产 Node 运行时；不要用旧 `/usr/local/node/bin/node` |
| `/usr/local/node/bin/pm2` | PM2 可执行文件；命令前确保 PATH 优先 `/usr/bin` |

```bash
export PATH=/usr/bin:/bin:/usr/local/node/bin:$PATH
PM2=/usr/local/node/bin/pm2
$PM2 status xmirror
$PM2 logs xmirror --lines 100 --nostream
readlink /opt/xmirror/current
curl -fsS https://xput.app/healthz
```

Node 没有热更新。修改配置后需要重启，但 `.env` 修改不会自动替换 PM2 已缓存的同名环境项，必须核对覆盖来源。

## 安全配置与续期

| 配置 | 实际位置与规则 |
|---|---|
| XPut vhost | `/etc/nginx/sites-enabled/xput.app`（可能为软链接） |
| Cloudflare 来源白名单 | `/etc/nginx/conf.d/xput-cf-origin.conf`，实际 TCP peer，不相信客户端伪造请求头 |
| Node 私有端口 | `/etc/iptables/rules.v4`、`/etc/iptables/rules.v6`：非回环接口不能访问 3001 |
| SSL | Cloudflare Full (strict)，源站使用有效证书 |
| ACME | HTTP `/.well-known/acme-challenge/<token>` 仅静态 webroot 例外，不能代理业务；续期 dry-run 已通过 |
| WAF | 仅 `xput.app/api/resolve`，每 IP、每节点 10 秒 10 次，超限阻断 10 秒 |

白名单不是对全服务器 80/443 的防火墙限制：其他站点保持现状。旧域名只跳转，不代理 XPut 业务。loopback 为管理和健康检查保留。防火墙静态文件不含 Docker 动态 NAT/FORWARD 链，不得用完整 `iptables-save` 覆盖它们。尚未为此重启服务器验证持久化；下次计划重启后检查。

### Cloudflare 网段自动更新

- 脚本：`/usr/local/sbin/xput-update-cloudflare-ips.py`
- 定时任务：`/etc/cron.d/xput-cloudflare-ips`，服务器本地时间每月 1 日 04:17；不是整台服务器的 crontab 替换。
- 来源：`https://www.cloudflare.com/ips-v4` 与 `https://www.cloudflare.com/ips-v6`。
- 日志：`/var/log/xput-cloudflare-ips.log`；cron 标准输出：`/var/log/xput-cloudflare-ips-cron.log`。
- 备份：`/opt/xmirror/backups/cloudflare-ips/`。
- 使用文件锁避免并发。下载失败、空内容、非法/非公网 CIDR 均不写配置；无变化不 reload。
- 只重写 XPut geo 块，保留 loopback、ACME map 和其他站点配置。有变更先备份、原子替换、`nginx -t` 后 reload；失败恢复旧配置并记录日志。
- 首次手动运行：22 个官方网段一致，`UNCHANGED`，未 reload。实际变更及失败恢复分支尚未在生产注入故障演练。

```bash
sudo /usr/bin/python3 /usr/local/sbin/xput-update-cloudflare-ips.py
sudo tail -50 /var/log/xput-cloudflare-ips.log
sudo nginx -t
sudo certbot renew --cert-name xput.app --dry-run --no-random-sleep-on-renew
```

## 环境变量：用途、默认来源与当前设置状态

只记录是否设置，不记录 `.env` 的任何值。默认数字及公开模式属于代码默认，不是生产秘密；默认地址、邮箱、模型名称等以代码文件为准，不在此复制。

| 变量 | 用途与代码默认 | 当前是否设置 |
|---|---|---|
| `NODE_ENV` | 运行模式；PM2 指定生产 | PM2 设置 |
| `DATA_DIR` / `ARCHIVES_DIR` / `SQLITE_PATH` | 默认项目目录；PM2 指向 shared | PM2 设置 |
| `PORT` | 监听端口，默认 3000 | 设置 |
| `PUBLIC_BASE_URL` | canonical、来源校验、分享链接；默认见 `lib/public-url.js` | 设置 |
| `MODERATION_ADMIN_TOKEN` | 管理接口鉴权，默认无 | 设置 |
| `CONTACT_EMAIL` | 隐私/举报联系方式，默认站点配置 | 设置 |
| `ANALYTICS_NAME` | 隐私页统计名称，未设置时通用描述 | 未设置 |
| `ANALYTICS_DOMAIN` / `ANALYTICS_SRC` | 默认 `config/site.json`；任一空值关闭统计 | 未设置 |
| `SHORTCUT_URL` | 默认站点配置中的快捷指令 | 未设置 |
| `DOWNLOAD_VIA` | 生产默认 Worker；应急模式详见下文 | 未设置 |
| `DOWNLOAD_PROXY_BASE` / `ENABLE_LOCAL_DOWNLOAD_PROXY` | 代理地址覆盖/旧开关，默认无 | 未设置 |
| `FEATURE_TRANSLATION` | 生产默认关闭，控制翻译和字幕；设为 `true` 后帖子页出现「翻译帖子」（v2.1.0 起），并同时启用字幕路由。需已配置 `SILICONFLOW_API_KEY` | 未设置 |
| `SEO_AUTO_INDEX` | 默认启用自动收录 | 未设置 |
| `SEO_AUTO_INDEX_DAILY_CAP` | 默认每日 20，UTC 日 | 未设置 |
| `SEO_AUTO_INDEX_BLOCK_SENSITIVE` | 默认阻止敏感帖自动收录 | 未设置 |
| `SEO_QUALITY_VERSION` / `SEO_AI_RENDER` | 质量版本默认 3；有效生成标题默认渲染 | 未设置 |
| `SEO_AI_ENABLED` / `SEO_AI_MODEL` | AI 标题开关默认关；模型默认见 `lib/seo-ai.js` | 设置，值未列出 |
| `SEO_AI_DAILY_CNY` / `SEO_AI_MONTHLY_CNY` / `SEO_AI_INPUT_CNY_PER_MILLION` / `SEO_AI_OUTPUT_CNY_PER_MILLION` / `SEO_AI_PRICE_VALID_UNTIL` / `SEO_AI_UNLIMITED_UNTIL` | 历史 SEO 预算字段；当前免费模型策略不据此授权付费调用 | 保留设置；不要推断当前值或用途仍有效 |
| `SILICONFLOW_API_KEY` | 提供方凭据，默认无 | 设置 |
| `OPENAI_API_KEY` | 兼容回退凭据，默认无 | 未设置 |
| `SILICONFLOW_BASE_URL` / `SILICONFLOW_MODEL` / `SILICONFLOW_FALLBACK_MODELS` / `TRANSLATE_PROVIDER` | 默认见 `server.js`；翻译关闭时不是前端入口 | 未设置 |
| `SILICONFLOW_TRANSCRIPTION_MODEL` | 转写模型默认见 `server.js` | 未设置 |
| `SUBTITLE_SEGMENT_SECONDS` / `SUBTITLE_TRANSCRIPTION_CONCURRENCY` / `SUBTITLE_CONCURRENCY` | 默认 12 / 3 / 2 | 未设置 |
| `TRANSLATION_CONCURRENCY` / `TRANSLATE_RATE_WINDOW_MS` / `TRANSLATE_RATE_MAX` | 默认 2 / 60000 / 10 | 未设置 |
| `FETCH_RATE_LIMIT_PER_MIN` / `DOWNLOAD_RATE_LIMIT_PER_MIN` | 默认 20 / 60；后者用于 Node 应急代理 | 未设置 |
| `VIDEO_DOWNLOAD_CONCURRENCY` / `VIEW_COUNTER_FLUSH_MS` | 默认 1 / 30000 | 未设置 |
| `TRUST_PROXY` | 默认本机及私有代理网段，见 `lib/client-ip.js` | 未设置 |
| `XPUT_SKIP_DOTENV` | 测试隔离；生产不设置 | 未设置 |
| `XMIRROR_APP_ROOT` / `XMIRROR_SOURCE_DIR` / `XMIRROR_PM2_BIN` | 发布命令覆盖项，默认见脚本 | 发布时临时设置，不写 `.env` |

## 管理存档与精选页

由管理员安全加载令牌到当前会话。不要输出令牌或把真实值写进命令历史、截图及文档；下面只用变量占位。取消屏蔽会重新评估，并非保证收录。

```bash
SITE=https://xput.app
curl -fsS -X POST "$SITE/api/admin/seo/<ID>" \
  -H "x-admin-token: $MODERATION_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"blocked":true}'
# 取消屏蔽
curl -fsS -X POST "$SITE/api/admin/seo/<ID>" \
  -H "x-admin-token: $MODERATION_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"blocked":false}'
cd /opt/xmirror/current
/usr/bin/node ops/audit-indexable.js /opt/xmirror/shared/data/db.sqlite > /tmp/indexable.tsv
```

精选接口均需鉴权；编辑内容后须再次复核，再发布。详细门槛见 `config/featured.json`。

```bash
curl -fsS "$SITE/api/admin/featured" -H "x-admin-token: $MODERATION_ADMIN_TOKEN"
curl -fsS "$SITE/api/admin/featured/<ID>" -H "x-admin-token: $MODERATION_ADMIN_TOKEN"
curl -fsS -X POST "$SITE/api/admin/featured/<ID>" \
  -H "x-admin-token: $MODERATION_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"ai_title":"<TITLE>","topic":"<TOPIC>","summary":"<SUMMARY>","context":"<CONTEXT>","key_points":["<POINT>"]}'
curl -fsS -X POST "$SITE/api/admin/featured/<ID>/review" \
  -H "x-admin-token: $MODERATION_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"reviewed":true}'
curl -fsS -X POST "$SITE/api/admin/featured/<ID>/publish" -H "x-admin-token: $MODERATION_ADMIN_TOKEN"
curl -fsS -X POST "$SITE/api/admin/featured/<ID>/withdraw" -H "x-admin-token: $MODERATION_ADMIN_TOKEN"
```

## 下载应急、Worker 与发布

仅在 Worker 异常时，在生产配置里**幂等地**设置应急模式，不反复追加重复行；恢复时删除该项。先安全备份配置，令牌不复制到源站。

```bash
# 用服务器管理员编辑器维护 .env，不打印内容。
sudoedit /opt/xmirror/shared/.env
# 应急：DOWNLOAD_VIA=node；恢复：移除 DOWNLOAD_VIA 行，使用代码默认 Worker。
PATH=/usr/bin:/bin:/usr/local/node/bin:$PATH /usr/local/node/bin/pm2 restart xmirror --update-env
/usr/local/node/bin/pm2 save
curl -fsS https://xput.app/healthz
# 核对页面 JSON 中 downloadBase：应急 /node-dl，正常 /dl。
```

本机使用有效的 Cloudflare 授权，不提交凭据。部署和回滚前核对路由及绑定：

```bash
cd workers/download-proxy
npx wrangler deploy
# 真实媒体 URL 由操作者提供；引号内是变量，不嵌入凭据。
curl -sSI --get --data-urlencode "u=$MEDIA_URL" --data-urlencode 'n=test.mp4' https://xput.app/dl
curl -sSI 'https://xput.app/dl?u=https%3A%2F%2Fexample.com%2Fa.mp4'
# 成功要求 200/206、attachment、private,no-store；非法目标 400。
# 同一来源/节点的小 Range 请求验证 429 与 Retry-After；不是精确全局计数器。
npx wrangler rollback
```

回滚 Worker 后确认旧版本正常，否则使用 Node 应急模式。正式 Node 发布必须 CI 通过、精确 SHA、独立 worktree、`ops/deploy.sh` 全测试和健康检查；代码回滚入口见 [部署与回滚方案](deploy.md)。旧 `ops/DEPLOYMENT.md` 只作为链接入口。

## 测试、磁盘及例行检查

```bash
cd <CLEAN_CHECKOUT>
npm ci && npm test
node --require ./test/support/no-dotenv.js --test test/media-download.test.js
```

不要省略单文件测试的预加载；不要把测试数据写入生产库。磁盘媒体持续增长，2026-10-03 本次核验约剩 18 GB，不应继续引用早期“只剩 3 GB”估计，也不保证以后仍有此空间。

- 日常：健康、PM2 重启次数、新增视频下载错误、OG/管理接口错误、解析 429/5xx、磁盘余量；未找到原帖的正常失败与服务错误分开统计。
- 每周：Search Console 抓取/收录、值得再读审核、sitemap 与数据库可收录数量、备份可恢复性、证书有效期；抽查 Worker 下载头和源站直连拒绝。
- 每月：核对 IP 更新 cron 日志；失败须处理，不能仅依赖“已安装定时任务”。
- 下次计划重启：验证 nginx 白名单、IPv4/IPv6 3001 阻断、其他站点和 Docker 网络均恢复。不要为此临时重启共享服务器。
- 真机项目见 [本地与真机测试清单](local-testing.md)；日志和静态检查不等同于真实设备保存到相册。
