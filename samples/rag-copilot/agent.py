"""RAG 助手：会话窗口 + 工具调用 + 重试退避 + 结构化输出。"""

import json
import os
import time

from retrieval import build_context, KnowledgeStore
from memory import ConversationWindow
from tools import TOOL_SPECS, execute

MAX_STEPS = 12
CONTEXT_BUDGET_TOKENS = 6000
MODEL = os.environ.get("COPILOT_MODEL", "qwen2.5-32b-instruct")
FALLBACK_MODEL = "qwen2.5-14b-instruct"

SYSTEM_PROMPT = """你是企业知识库助手。
规则：
1. 只依据「参考资料」回答，资料不足时明确说明。
2. 需要实时数据时调用工具。
3. 严格输出 JSON。
"""


def count_tokens(text):
    return max(1, len(text) // 2)


def call_model(messages, model=MODEL, retries=3):
    import requests

    delay = 1.0
    for attempt in range(retries):
        try:
            resp = requests.post(
                os.environ["LLM_BASE_URL"] + "/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['LLM_API_KEY']}"},
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                    "max_tokens": 1200,
                    "tools": TOOL_SPECS,
                },
                timeout=60,
            )
            if resp.status_code in (429, 500, 502, 503):
                raise RuntimeError(f"upstream {resp.status_code}")
            return resp.json()["choices"][0]["message"]
        except RuntimeError:
            if attempt == retries - 1:
                return call_model(messages, FALLBACK_MODEL, 1)
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("model unavailable")


class RagCopilot:
    def __init__(self, store: KnowledgeStore):
        self.store = store
        self.window = ConversationWindow(limit_tokens=CONTEXT_BUDGET_TOKENS)

    def answer(self, question, session_id):
        context, hits = build_context(question, self.store)
        self.window.append(session_id, "user", question)
        usage = {"input_tokens": 0, "output_tokens": 0, "cost": 0.0}
        steps = []

        for step in range(MAX_STEPS):
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "system", "content": context},
                *self.window.as_messages(session_id),
            ]
            msg = call_model(messages)
            usage["input_tokens"] += count_tokens(json.dumps(messages, ensure_ascii=False))
            usage["output_tokens"] += count_tokens(msg.get("content") or "")
            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                payload = json.loads(msg["content"])
                self.window.append(session_id, "assistant", payload["answer"])
                return {"answer": payload["answer"], "steps": steps, "usage": usage, "retrieved": hits}
            for call in tool_calls:
                args = json.loads(call["function"]["arguments"])
                result = execute(call["function"]["name"], args)
                steps.append({"step": step, "tool": call["function"]["name"], "ok": result["ok"]})
                self.window.append(session_id, "tool", json.dumps(result, ensure_ascii=False))

        return {"answer": "达到最大步数，未能完成任务。", "steps": steps, "usage": usage, "stop_reason": "max_steps"}
