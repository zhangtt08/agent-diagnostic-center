# RAG 知识库助手（示例工程）

一个中等成熟度的 Agent 实现，用于演示诊断结果。

- `agent.py`：ReAct 风格循环，`MAX_STEPS` 上限、主/备模型降级、指数退避重试、`response_format=json_object` 结构化输出、token 用量统计。
- `retrieval.py`：Markdown 递归切分（`CHUNK_SIZE` / `CHUNK_OVERLAP`）、embedding 入库 pgvector、余弦相似度召回 `TOP_K`。
- `memory.py`：按 token 预算裁剪会话窗口，超出部分做滚动摘要。
- `tools.py`：工具 JSON Schema 参数校验，非法参数返回 `invalid_arguments`。

## 已知短板

- 召回后没有 cross-encoder 重排，Top-K 直接进提示词。
- 答案没有引用溯源字段，无法验证是否 grounded。
- 没有失败分类与评测集，改动只能靠人工回归。
