"""工具定义与执行：带 JSON Schema 参数校验。"""

import json
import re
import subprocess

TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "query_orders",
            "description": "按客户编号查询订单状态",
            "parameters": {
                "type": "object",
                "properties": {"customer_id": {"type": "string"}, "limit": {"type": "integer"}},
                "required": ["customer_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calc",
            "description": "执行算术表达式",
            "parameters": {"type": "object", "properties": {"expr": {"type": "string"}}, "required": ["expr"]},
        },
    },
]

SCHEMAS = {t["function"]["name"]: t["function"]["parameters"] for t in TOOL_SPECS}


def validate(name, args):
    schema = SCHEMAS.get(name)
    if not schema:
        return [f"unknown tool {name}"]
    issues = []
    for key in schema.get("required", []):
        if key not in args:
            issues.append(f"missing {key}")
    for key, value in args.items():
        prop = schema["properties"].get(key)
        if prop is None:
            issues.append(f"unexpected {key}")
        elif prop["type"] == "integer" and not isinstance(value, int):
            issues.append(f"{key} must be integer")
        elif prop["type"] == "string" and not isinstance(value, str):
            issues.append(f"{key} must be string")
    return issues


def query_orders(customer_id, limit=10):
    return {"orders": [{"id": "SO-1001", "status": "shipped"}][:limit], "customer_id": customer_id}


def calc(expr):
    return {"value": eval_arithmetic(expr)}


def eval_arithmetic(expr):
    """只支持 + - * / 与括号的调度场算法求值，不使用 eval。"""
    tokens = re.findall(r"\d+(?:\.\d+)?|[+\-*/()]", expr)
    precedence = {"+": 1, "-": 1, "*": 2, "/": 2}
    output, ops = [], []
    for token in tokens:
        if re.fullmatch(r"\d+(?:\.\d+)?", token):
            output.append(float(token))
        elif token in precedence:
            while ops and ops[-1] in precedence and precedence[ops[-1]] >= precedence[token]:
                output.append(ops.pop())
            ops.append(token)
        elif token == "(":
            ops.append(token)
        elif token == ")":
            while ops and ops[-1] != "(":
                output.append(ops.pop())
            if not ops:
                raise ValueError("unbalanced parentheses")
            ops.pop()
    while ops:
        top = ops.pop()
        if top in "()":
            raise ValueError("unbalanced parentheses")
        output.append(top)

    stack = []
    for token in output:
        if isinstance(token, float):
            stack.append(token)
            continue
        right, left = stack.pop(), stack.pop()
        stack.append(
            {
                "+": left + right,
                "-": left - right,
                "*": left * right,
                "/": left / right if right else float("nan"),
            }[token]
        )
    return stack[0]


HANDLERS = {"query_orders": query_orders, "calc": calc}


def execute(name, args):
    problems = validate(name, args)
    if problems:
        return {"ok": False, "status": "invalid_arguments", "issues": problems}
    try:
        return {"ok": True, "result": HANDLERS[name](**args)}
    except Exception as err:
        return {"ok": False, "status": "tool_error", "error": str(err)}
