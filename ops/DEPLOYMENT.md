# XPut 部署文档入口

此文件保留用于历史引用，不再维护另一套部署步骤。

- [部署与回滚主流程](../docs/deploy.md)：版本检查、备份、精确 SHA 独立 worktree、`ops/deploy.sh`、验收与回滚。
- [运维手册](../docs/operations.md)：共享服务器隔离、安全、Worker、白名单维护、进程、常用操作。
- [下载代理切换](../docs/download-proxy-rollout.md)。

生产使用 `/usr/bin/node`，不是旧 `/usr/local/node/bin/node`；主域名为 `xput.app`，PM2 进程名仍为 `xmirror`。不要直接修改脏生产工作副本、跳过测试/健康检查或输出生产配置。

## Private source moderation ledger

`shared/data/moderation-blocked-sources.json` is an optional JSON array of numeric
post/article IDs stored as strings. It is runtime data, never committed to Git.
Write it atomically with mode 0600 after backing up the previous file. Missing
means empty; malformed or unreadable data fails closed. Both archive and resolve
prechecks consult it when moderation is enabled, before contacting the source or
downloading media. URL and author aliases cannot bypass a blocked ID. This ledger
does not take down existing copies: use the admin removal endpoint separately,
with a private recovery backup, and verify media and poster URLs are also gone.

Rule version changes invalidate content-bound manual review fingerprints. Preserve
confirmed removals in the source ledger independently of the rule version. Rolling
back to a release without ledger support removes this pre-fetch protection; keep
the content-bound rejection and verify takedowns after any rollback.
