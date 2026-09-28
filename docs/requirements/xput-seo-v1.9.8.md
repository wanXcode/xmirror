# XPut v1.9.8：SEO 质量与自动标题

对应 Issue #64。承接 [最终方案](xput-seo-quality-iteration-v1.md)。这是开发小版本，部署、历史迁移和 Search Console 验证分别记录。

## 已实现的行为

- SEO 只读解析与内容入口相同的人工审核记录；人工决定先使旧推荐结果失效，再同步重评。正文、目标链接和规则版本变化后旧决定失效，本地图片路径变化不使相同文本的决定失效。
- 数据库源内容变更触发器立即撤下旧推荐状态，等待重评。生成标题单独存储，不影响原文长度、标题加分、去重、短码或原文翻译缓存。
- 新存档默认规则 v3；旧数据保留 v2，只有显式分批迁移才切换。v3 检测高比例重复词句，普通长文仍可自动通过；特殊格式可疑时待检查。
- 自动标题优先已有原文标题，否则采用通用文本模型；失败使用原文完整句。普通小节不自动当全文标题。长文超输入上限直接本地兜底，不进行无限分段调用。
- 标题、摘要、主题词、依据及版本单独保存；公开页面、首页、列表、分享与结构化数据读取相同结果。结果与原文不匹配时自动失效。
- 独立 SQLite 作业／预算文件持久化；调用前原子预留，超时、未知计费及低用量响应也保留全额预留，宁可少调用，不把未知费用视为零。报价过期停止调用。
- 最多两次请求（含质量重写），并发 1，每日最多 40 次、每月最多 1200 次；用户正在翻译时不启动标题任务。额度用尽、接口停用或余额问题自动兜底。
- 统一后台显示内容审核、推荐原因、标题来源及预算预留；不新增标题人工编辑或审批流程。

## 发布配置

未启用 AI 或缺少有效价格时，网站仍有完整的本地标题和 SEO 能力，不会发请求。沿用现有 `SILICONFLOW_API_KEY` 与 `SILICONFLOW_BASE_URL`，无需新密钥。

2026-09-28 查验：[服务商价格页](https://www.siliconflow.cn/pricing)将 `Qwen/Qwen2.5-7B-Instruct` 标为免费（输入价格 0，展示价格 0，Free 标识）；现有账号 `/models` 包含该模型，六次合成样本请求均 200，共 1758 tokens。中文、英文可用，存在不满足约束而兜底的结果，不代表已完成全部真实存档质量验证。

为避免免费模型价格变化带来过低的预留，首版按**高于当前标价的保守计费上限**预留；不是声称模型当前收取这个费用。若服务商改价超过配置上限，必须暂停并重核配置，应用不能代替服务商账单或控制翻译等其他调用的开销。

```dotenv
SEO_AI_ENABLED=true
SEO_AI_MODEL=Qwen/Qwen2.5-7B-Instruct
SEO_AI_INPUT_CNY_PER_MILLION=1
SEO_AI_OUTPUT_CNY_PER_MILLION=4
SEO_AI_PRICE_VALID_UNTIL=2026-10-28T00:00:00Z
SEO_AI_DAILY_CNY=1
SEO_AI_MONTHLY_CNY=20
SEO_QUALITY_VERSION=3
```

价格有效期到期前复核服务商报价后更新。以 UTC 划分日期／月份。输入最大 8192 tokens，采用 UTF-8 字节上界加消息框架余量保守估算；实际 token 超上界会暂停。输出最大 512 tokens。一次预留 0.01024 元，最多两次即 0.02048 元；每日 40 次限制进一步把当前配置的每日最大预留压至 0.4096 元。上限是标题任务按配置价格计算的限制，不是整个 AI 账号的总支出限制。

价格、模型、开关等环境配置改变后需重启生效。`SEO_AI_ENABLED=false` 停止生成但保留已保存标题；`SEO_AI_RENDER=false` 立即切回本地标题。新存档可用 `SEO_QUALITY_VERSION=2` 临时恢复旧筛选；旧数据的目标版本仍按记录管理。

## 迁移与历史首批

先按既有流程备份 SQLite 和 `moderation-reviews/`，保留新增的 `seo-ai.sqlite`（含 WAL 文件，使用 SQLite 备份方法）。历史页面默认不进入 AI 队列。

```sh
# 只读预览，比较旧状态与 v3；无外部调用
DATA_DIR=/path/to/data node ops/evaluate-seo.js --quality-version=3 --limit=100

# 抽查差异后分批应用；输出 rolloutId，每条保留独立快照
DATA_DIR=/path/to/data node ops/evaluate-seo.js --quality-version=3 --limit=100 --apply

# 使用 lastId 继续后续批次
DATA_DIR=/path/to/data node ops/evaluate-seo.js --quality-version=3 --limit=100 --after-id=100

# 已确认的历史候选最多 20 个 ID：先预览，再启用并入队
DATA_DIR=/path/to/data node ops/seo-ai.js --ids=1,2,3
DATA_DIR=/path/to/data node ops/seo-ai.js --ids=1,2,3 --apply

# 只恢复没有后续变更的某次迁移；重新核对当前审核，不恢复旧审核决定
DATA_DIR=/path/to/data node ops/evaluate-seo.js --apply --rollback=1
```

`--limit` 是扫描条数，不是保证推荐条数。首批 ID 要以当时数据库为准。回退遇到内容、投诉封禁、人工决定、日常重评等后续变化时拒绝直接恢复，保留新状态，再显式按需要重评。不要整库覆盖新数据。

鉴权/余额失败会持久暂停 AI；修复配置后可执行 `node ops/seo-ai.js --resume --apply` 清除暂停，不清理费用记录。调用中进程退出的任务保留预算并自动落入 fallback，避免重启隐式重放。

## 验收边界

需要完整单元／HTTP 测试、数据库状态变化及预算并发测试，检查唯一 H1、标题跨页面一致、原文媒体与翻译保留、公开搜索分页及原有首页布局。隐藏目录下 Express `sendFile` 会出现与业务无关的静态 404，使用相同源码的普通临时目录作 HTTP 验证。

上线前还要按合并提交与生产运行时做公开检查。本版本不创建 Search Console 账号、不自动改 DNS、不保证收录；账号验证、实际索引与自然搜索转化仍需对应访问权限。标题生成和校验降低误写概率，不证明所有模型输出的语义完全正确。
