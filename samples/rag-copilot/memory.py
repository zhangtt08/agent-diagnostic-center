"""会话窗口管理：按 token 预算裁剪，超出后对更早内容做摘要。"""

import json


class ConversationWindow:
    def __init__(self, limit_tokens=4000, keep_recent=8):
        self.limit_tokens = limit_tokens
        self.keep_recent = keep_recent
        self.sessions = {}

    def append(self, session_id, role, content):
        bucket = self.sessions.setdefault(session_id, [])
        bucket.append({"role": role, "content": content, "tokens": max(1, len(content) // 2)})

    def as_messages(self, session_id):
        bucket = self.sessions.get(session_id, [])
        recent = bucket[-self.keep_recent:]
        older = bucket[: -self.keep_recent]
        messages = []
        if older:
            messages.append({"role": "system", "content": self.summarize(older)})
        total = sum(m["tokens"] for m in recent)
        while total > self.limit_tokens and len(recent) > 2:
            dropped = recent.pop(0)
            total -= dropped["tokens"]
        messages.extend([{"role": m["role"], "content": m["content"]} for m in recent])
        return messages

    def summarize(self, dropped):
        lines = [f"- {m['role']}: {m['content'][:60]}" for m in dropped[-12:]]
        return "早前对话摘要：\n" + "\n".join(lines)

    def persist(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.sessions, f, ensure_ascii=False)

    def load(self, path):
        with open(path, "r", encoding="utf-8") as f:
            self.sessions = json.load(f)
