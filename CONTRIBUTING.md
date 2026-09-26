# XPut 开发流程

## 默认工作流

后续代码改动默认采用：

1. 先建立 GitHub Issue，写清问题、目标和验收标准。
2. 从 `main` 创建独立分支。
3. 在分支完成修改并补充必要测试。
4. 创建 Pull Request，说明改动、风险、验证方式和回滚方式。
5. CI 通过后再 Review。
6. Review 通过后合并到 `main`。
7. 确认代码已同步至 GitHub `main`，记录远端提交 SHA，并确认该提交的 CI 通过。
8. 服务器从 GitHub 拉取该精确提交，在干净的独立 worktree 中使用 `ops/deploy.sh` 发布，保留数据库快照并执行健康检查。

GitHub 是生产代码的发布来源。禁止先部署本地未推送的提交再补推 GitHub；不要用本机复制代码或 Git bundle 绕过 GitHub 发布。GitHub 无法同步时暂停新版本发布，先解决连接问题。

紧急线上故障可以直接创建 hotfix 分支，但仍然通过 PR 合并并补齐回归测试。

## 分支命名

推荐：

- `feat/<topic>` 新功能
- `fix/<topic>` Bug 修复
- `chore/<topic>` 工程、运维和仓库维护
- `docs/<topic>` 文档

## PR 最低要求

每个 PR 至少说明：

- 为什么改
- 改了什么
- 如何验证
- 是否影响数据库、短链或历史归档
- 是否需要生产环境变量变化
- 出现问题如何回滚

涉及以下区域时必须特别检查：

- `server.js` 路由顺序
- SQLite schema / migration
- `archives` / `data` 的持久化路径
- 短链和旧链接兼容
- 内容审核
- 翻译缓存

## 自动检查

Pull Request 和 `main` push 会运行 GitHub Actions：

```bash
npm ci
npm test
node --check server.js
```

CI 通过代表自动回归和语法检查通过，不能替代生产发布后的健康检查。

## 仓库边界

以下内容属于运行数据，不允许提交到 Git：

- `data/`
- `archives/`
- `node_modules/`
- `.env*`
- `server.log`
- SQLite WAL / SHM 文件

生产运行数据统一保存在 `/opt/xmirror/shared/`，代码 release 与运行数据保持分离。
