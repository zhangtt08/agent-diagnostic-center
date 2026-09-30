# Agent Diagnostic Center

[English](README.md) | [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)
![Node](https://img.shields.io/badge/Node.js%20%E2%89%A520-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Static Analysis](https://img.shields.io/badge/analysis-static%20%7C%20offline-blueviolet)

> **Point it at your agent project and it tells you — with `file:line` evidence — which professional agent capabilities you actually have, how you score, and what to fix next.**
>
> **把它指向你的 Agent 工程：自动识别你真正实现了哪些专业能力，给出量化评分和带证据的优化建议。**

## The problem it solves

Anyone can wire up an LLM loop; few know whether their agent is built *right*. Is the loop bounded? Are tool calls schema-validated and timeout-protected? Is memory isolated per user/session? Are there hardcoded secrets? Agent Diagnostic Center answers these questions by statically scanning your source code — it never imports, executes, or uploads anything — and returns a capability inventory, an 8-dimension score with an S–D grade, and concrete fixes with `file:line` evidence.

Zero dependencies: Node.js built-in modules only. No `npm install`, no Electron, no network access.

## ✨ Features

- **32 capability detections across 9 categories** — Loop, Memory, RAG, Tool Calling, Planner, Reflection, MCP, Guardrails and more, spanning orchestration & control, memory & context, knowledge & retrieval, tools & integration, reasoning & planning, reliability, safety & guardrails, observability, and delivery & UX. Each detection reports status (strong evidence / detected / docs-only mention / not found), confidence, matched patterns, and `file:line` code evidence.
- **Honest confidence model** — "strong evidence" requires ≥ 2 distinct patterns across multiple files; a capability mentioned only in comments or README is downgraded to "docs-only", never passed off as implemented.
- **24 risk checks with actionable fixes** — e.g. agent loop without a max-iteration cap (critical), tool calls without timeout protection (critical), code execution without sandboxing (critical), hardcoded secrets (critical), session history with no truncation policy, unvalidated tool arguments, non-isolated long-term memory, RAG answers without traceable citations, no eval set. Each finding includes what was found / why it matters / how to fix / sample code / evidence location.
- **8-dimension weighted scoring** — architecture completeness (20%), reasoning & planning (14%), reliability (14%), memory & context (13%), tool orchestration (13%), knowledge augmentation (10%), safety & guardrails (8%), observability (5%). Composite score maps to S / A / B / C / D grades; the "estimated +N points" on each suggestion is back-solved from the same formula, not a made-up number.
- **Analysis hygiene that avoids AI-guessing** — comments and docs are stripped before pattern matching (line-number geometry preserved); lockfiles and build artifacts (`package-lock.json`, `*.min.js`, `*.d.ts`, `node_modules/`, `dist/`, …) are excluded so they can't fabricate capabilities; "missing-X" checks only fire with sufficient evidence; a failing rule never takes down the whole run.
- **Fully static & private** — your code is never imported, executed, or installed-against; analysis runs in a local process listening on `127.0.0.1` only; source never leaves the machine; history capped at 120 reports, clearable from the UI.
- **Zero-dependency dashboard** — vanilla HTML/CSS/JS with hand-drawn SVG charts (trend lines, donut chart, pipeline view). No chart library, no CDN, no web fonts — fully offline.
- **Never an empty shell** — 3 built-in sample projects at different maturity levels are analyzed on first launch: an 87-line naive ReAct agent (18 pts, D), a 267-line RAG copilot (47 pts, C), and a 395-line production orchestrator (61 pts, B). Verified on a real 118-file / 16k-line project: 74 pts (A), 28 capabilities, in 362 ms. The quality-rank correlation is locked in by `tests/engine.test.js`.

## 🚀 Quick Start

Requires Node.js ≥ 20 (verified on v24). One-click launch is Windows; `node server.js` runs anywhere.

```bash
git clone https://github.com/zhangtt08/agent-diagnostic-center.git
cd agent-diagnostic-center
node server.js
# open the printed http://127.0.0.1:<port> in your browser
```

On Windows, the friendlier path:

1. Double-click **`start-agent-diagnostic.bat`** — starts the local server and opens the UI in a dedicated Edge app window (no address bar, feels like a native app).
2. Optional: double-click **`install-desktop-shortcut.bat`** — creates a desktop shortcut with the custom icon (`assets/icon.ico`).

Other commands:

```bash
node desktop.js            # server + app window (auto-picks a free port)
node server.js             # server only, open the browser yourself
npm test                   # run the automated engine + API test suite
node tools/make-icon.mjs   # regenerate icons
```

Three ways to run a diagnosis: **analyze a local directory** (enter an absolute path — fastest), **upload files or a whole folder** (drag & drop, code stays local), or **use the built-in samples**.

## 🏗️ Architecture / How it works

Pure static analysis: strip comments (preserving line numbers) → traverse the project and filter out noise/build artifacts → match capability patterns with multi-file confidence scoring → run risk checks → compute weighted dimension scores → generate suggestions with `file:line` evidence and back-solved score gains.

```
server.js              HTTP server + REST API + static assets
desktop.js             desktop launcher (free-port pick + Edge app window)
src/engine/
  languages.js         language detection, comment stripping (line-number preserving)
  scanner.js           directory traversal, noise & build-artifact filtering
  metrics.js           size / nesting / branch density / error-handling density
  capabilities.js      32-capability rule library (with plain-language explanations)
  detector.js          pattern matching + confidence judgment
  risks.js             24 risk checks
  scoring.js           dimension & composite scores
  suggestions.js       suggestion generation + score-gain estimation
  pipeline.js          static reconstruction of the agent execution chain
src/store.js           report persistence (atomic writes + rotation)
src/seed.js            first-launch baseline seeding
web/                   frontend (vanilla JS + hand-drawn SVG charts)
samples/               3 built-in sample projects
tests/                 automated tests (engine + API)
tools/                 icon generation, shortcut installer, seed commands
```

**Known limits, stated honestly**: static analysis tells you *whether* a practice exists, not whether it is *correct* (e.g. it detects an eval set, not its quality); heavily obfuscated or unusually named code may be missed; files over 1 MB are skipped. The dashboard cards show code-level metrics (composite score, capability coverage, critical findings), not runtime metrics — those can't be observed from source, and inventing them would be fake data.

## 📄 License

[MIT](LICENSE) © 2026 zhangtt08
