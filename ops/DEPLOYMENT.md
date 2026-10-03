# XPut 部署文档入口

此文件保留用于历史引用，不再维护另一套部署步骤。

- [部署与回滚主流程](../docs/deploy.md)：版本检查、备份、精确 SHA 独立 worktree、`ops/deploy.sh`、验收与回滚。
- [运维手册](../docs/operations.md)：共享服务器隔离、安全、Worker、白名单维护、进程、常用操作。
- [下载代理切换](../docs/download-proxy-rollout.md)。

生产使用 `/usr/bin/node`，不是旧 `/usr/local/node/bin/node`；主域名为 `xput.app`，PM2 进程名仍为 `xmirror`。不要直接修改脏生产工作副本、跳过测试/健康检查或输出生产配置。
