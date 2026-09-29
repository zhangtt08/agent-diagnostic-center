"""最小 ReAct Agent 原型：把 Thought/Action/Observation 循环跑通即可。"""

import json
import re
import os

from tools import TOOLS, run_tool

OPENAI_API_KEY = "sk-a1b2c3d4e5f6g7h8i9j0klmn1234567890"

SYSTEM_PROMPT = """你是一个助手。请按以下格式回复：
Thought: 你的推理
Action: 工具名
Action Input: {"arg": "value"}
或者
Final Answer: 最终回答
"""


class NaiveAgent:
    def __init__(self, model="gpt-4"):
        self.model = model
        self.messages = []
        self.history = []

    def build_prompt(self, question):
        prompt = SYSTEM_PROMPT + "\n".join([f"{m}" for m in self.history])
        return prompt + "\nQuestion: " + question + "\n"

    def parse(self, text):
        action = re.search(r"Action: (\w+)\nAction Input: (.*)", text)
        if action:
            return {"type": "tool", "tool": action.group(1), "input": json.loads(action.group(2))}
        answer = re.search(r"Final Answer: (.*)", text)
        if answer:
            return {"type": "answer", "text": answer.group(1)}
        return {"type": "error", "text": "bad format"}

    def run(self, question):
        self.history.append(f"Question: {question}")
        step = 0
        while True:
            step += 1
            prompt = self.build_prompt(question)
            text = call_llm(prompt)
            parsed = self.parse(text)
            if parsed["type"] == "answer":
                return parsed["text"]
            if parsed["type"] == "error":
                continue
            result = run_tool(parsed["tool"], parsed["input"])
            self.history.append(f"Thought: {text}")
            self.history.append(f"Observation: {result}")
        return None


def call_llm(prompt):
    import requests

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={"model": "gpt-4", "messages": [{"role": "user", "content": prompt}]},
    )
    data = resp.json()
    return data["choices"][0]["message"]["content"]
