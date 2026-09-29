# 最小 ReAct Agent（示例工程）

只做了一件事：把 `Thought / Action / Observation` 循环跑通。

- `agent.py`：`while True` 主循环，正则解析模型输出，历史无限累积。
- `tools.py`：`read_file` / `write_file` / `run_python` 直接执行，无参数校验、无超时、无审批。

## 为什么它得分低

1. 循环没有最大步数与时间预算，模型反复失败时会永久空转。
2. API Key 以字面量写在源码里。
3. `run_python` 把模型生成的代码交给 `subprocess` 执行，没有任何沙箱或资源限制。
4. `run_tool` 用 `except Exception: pass` 吞掉全部异常，失败会伪装成"成功但结果为空"。
5. 提示词内联在代码里，无法版本化与回归。
