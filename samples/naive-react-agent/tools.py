"""工具集合：直接执行，不做参数校验，也不做超时控制。"""

import os
import subprocess
import requests


def search_web(query):
    r = requests.get("https://api.search.example/q", params={"q": query})
    return r.text


def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return "ok"


def run_python(code):
    proc = subprocess.run(["python", "-c", code], capture_output=True, text=True)
    return proc.stdout + proc.stderr


TOOLS = {
    "search_web": search_web,
    "read_file": read_file,
    "write_file": write_file,
    "run_python": run_python,
}


def run_tool(name, args):
    fn = TOOLS.get(name)
    if fn is None:
        return f"unknown tool {name}"
    try:
        return fn(**args)
    except Exception:
        pass


def get_env(key):
    return os.environ.get(key)
