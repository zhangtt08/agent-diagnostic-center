# 生产级编排 Agent（示例工程）

作为"合格 Agent"的对照参考实现。

| 机制 | 位置 | 说明 |
| --- | --- | --- |
| 三重预算 | `src/loop.js` `RUN_BUDGET` | 步数 16 / 墙钟 120s / 成本 $0.5，任一超限即带 `stopReason` 收敛 |
| 上下文压缩 | `Orchestrator.compact` | 按 token 预算裁剪并占位标记 |
| 混合检索 + 重排 | `src/retrieval.js` | BM25 与向量并集 → cross-encoder 精排 → 阈值 0.35 过滤 |
| 长期记忆隔离 | `src/memory.js` | 所有读写以 `tenant:user` 作为 scope |
| 护栏 | `src/guardrails.js` | 注入模式拦截、PII 脱敏、外连域名白名单、输出 schema 校验 |
| 工具执行 | `src/tools.js` | zod `safeParse` 前置校验、AbortController 超时、`destructive` 标记 |
| 人工审批 | `loop.js` `requestApproval` | 破坏性工具先 dry-run 请求批准，未批准直接返回 `awaiting_human_approval` |
| 模型路由 | `pickModel` | 首轮用轻量模型，高复杂度升级，异常降级到环境变量指定备胎 |
| Trace | `src/trace.js` | 按 seq 记录 model_call / tool_call / decision / output / error，落库前脱敏 |
| 评测与门禁 | `evals/run-eval.js` | Golden Dataset + 确定性评分 + P95 + 回归计数 → PASS/FAIL |

## 仍可改进

- `stream: true` 已开启但 TTFT 未单独埋点。
- 成本单价硬编码在 `PRICE`，应接入配置中心。
