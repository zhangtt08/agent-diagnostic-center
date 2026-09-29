export const SEVERITY = {
  critical: { key: 'critical', label: '严重', weight: 26, color: '#dc2626' },
  high: { key: 'high', label: '高', weight: 14, color: '#f97316' },
  medium: { key: 'medium', label: '中', weight: 7, color: '#eab308' },
  low: { key: 'low', label: '低', weight: 3, color: '#3b82f6' },
};

const re = (s, f = 'i') => new RegExp(s, f);

export const RISK_CHECKS = [
  {
    id: 'loop_without_budget',
    title: 'Agent 循环缺少最大迭代上限',
    severity: 'critical',
    category: 'reliability',
    dimension: 'reliability',
    problem: '检测到循环执行结构，但没有找到 max_iterations / max_steps / max_turns 之类的硬上限。',
    impact: '模型一旦陷入"调用—失败—再调用"的自证循环，会无限消耗 token 并让请求永久挂起，是最常见的线上事故来源。',
    fix: '在循环外设置固定步数上限（建议 8–15），超限后强制收敛并返回结构化失败原因；同时叠加墙钟时间预算。',
    snippet: 'for (let step = 0; step < MAX_STEPS; step += 1) { ... }  // 超限后 break 并记录 stop_reason',
    when: (c) => c.has('agent_loop') && !c.hit(re('max[_ ]?(?:iterations|steps|turns|loops|rounds|depth)|maxIterations|maxSteps|maxTurns|MAX_(?:STEPS|ITERATIONS|TURNS)|step\\s*<\\s*\\d')),
    evidence: (c) => c.evidenceOf('agent_loop', 3),
  },
  {
    id: 'unbounded_context',
    title: '会话历史无截断或压缩策略',
    severity: 'high',
    category: 'memory',
    dimension: 'memory',
    problem: '检测到对话历史累积，但没有窗口裁剪、摘要压缩或 token 计数。',
    impact: '上下文会随轮次线性膨胀，最终超出窗口报错，或在长任务后期因"中间信息遗忘"导致质量断崖式下降。',
    fix: '按 token 预算保留最近 N 轮 + 对更早内容做滚动摘要；超出预算时优先丢弃工具原始输出而非用户意图。',
    snippet: 'const kept = trimToTokenBudget(messages, CONTEXT_BUDGET, { keep: ["system", "last_user"] })',
    when: (c) => c.has('short_term_memory') && !c.hit(re('trim|truncat|compact|summariz|window|maxTokens|max_tokens|contextWindow|context_window|tokenBudget|token_budget')),
    evidence: (c) => c.evidenceOf('short_term_memory', 3),
  },
  {
    id: 'tool_without_timeout',
    title: '工具调用没有超时保护',
    severity: 'critical',
    category: 'reliability',
    dimension: 'reliability',
    problem: '存在工具执行路径，但代码中未见 timeout / AbortController / deadline。',
    impact: '单个外部依赖卡死会拖垮整条 Agent 链路，用户看到的是永久转圈，而不是可解释的失败。',
    fix: '为每次工具执行加超时与取消信号，超时后写入 tool_error 证据并让循环决定是否换策略。',
    snippet: 'await withTimeout(executor.run(args), { ms: TOOL_TIMEOUT, signal })',
    when: (c) => c.has('tool_calling') && !c.hit(re('timeout|AbortController|AbortSignal|deadline|withTimeout|asyncio\\.wait_for|setTimeout\\s*\\(', )),
    evidence: (c) => c.evidenceOf('tool_calling', 3),
  },
  {
    id: 'tool_without_schema',
    title: '工具参数未做 Schema 校验',
    severity: 'high',
    category: 'safety',
    dimension: 'safety',
    problem: '检测到工具调用，但未发现参数结构校验（JSON Schema / zod / pydantic）。',
    impact: '模型会编造字段名和类型，未校验的参数直接进入文件、数据库或网络操作，可能造成本地数据破坏或越权。',
    fix: '执行前先做 schema 校验，不合法直接返回 invalid_arguments 给模型自我修正，绝不带着脏参数执行副作用。',
    snippet: 'const parsed = tool.inputSchema.safeParse(args); if (!parsed.success) return { status: "invalid_arguments", issues: parsed.error }',
    when: (c) => c.has('tool_calling') && !c.hit(re('safeParse|jsonschema|JsonSchema|json_schema|inputSchema|input_schema|pydantic|BaseModel|validate\\s*\\(|z\\.object|ajv')),
    evidence: (c) => c.evidenceOf('tool_calling', 3),
  },
  {
    id: 'hardcoded_secret',
    title: '疑似硬编码密钥',
    severity: 'critical',
    category: 'safety',
    dimension: 'safety',
    problem: '源码中出现看起来像明文 API Key / Token 的字面量。',
    impact: '一旦仓库被共享或提交到远端，密钥即刻泄露；模型还可能把密钥原样输出到日志与回复中。',
    fix: '改为从环境变量或密钥管理读取，仓库中只保留 .env.example 占位；对已泄露密钥执行轮换。',
    snippet: 'const key = process.env.OPENAI_API_KEY ?? missing("OPENAI_API_KEY")',
    when: (c) => c.regex(re('(sk-[A-Za-z0-9\\-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|api[_-]?key\\s*[:=]\\s*[\'"][A-Za-z0-9_\\-]{20,}[\'"])')).some((h) => looksReal(h.match) && !isFixture(h.path)),
    evidence: () => [],
    evidenceFrom: (c) => findSecretHits(c.sources),
  },
  {
    id: 'exec_without_sandbox',
    title: '代码执行缺少隔离限制',
    severity: 'critical',
    category: 'safety',
    dimension: 'safety',
    problem: '检测到动态执行 / 子进程调用，但未发现沙箱、资源上限或网络隔离。',
    impact: '模型生成的代码拥有与服务进程同等权限，一条 rm -rf 或反向外连即可造成实质损害。',
    fix: '在容器或受限解释器中执行，禁用网络、只读挂载、限制 CPU/内存/时长，并把危险命令列入黑名单。',
    snippet: 'docker run --rm --network=none --memory=256m --cpus=0.5 --pids-limit=64 -v "$dir:/w:ro" python:3.12-slim',
    when: (c) => c.has('code_execution') && c.evidenceOf('code_execution', 40).some((e) => !isFixture(e.path)) && !c.hit(re('sandbox|docker|container|rlimit|memory_limit|cpu_limit|network_disabled|jail|seccomp|vm2|pyodide|firejail|--network=none|allowed|whitelist|allow_list')),
    evidence: (c) => c.evidenceOf('code_execution', 3),
  },
  {
    id: 'destructive_without_approval',
    title: '高风险动作缺少人工确认',
    severity: 'high',
    category: 'safety',
    dimension: 'safety',
    problem: 'Agent 具备文件写入 / 代码执行 / 网络访问能力，但没有 human-in-the-loop 审批。',
    impact: '错误决策会直接落到真实系统上，且事后难以回滚；这是自动化项目最难获得采纳的一点。',
    fix: '对写操作引入 dry-run + 确认门禁，列出将要变更的路径清单让用户批准后再执行。',
    snippet: 'if (tool.destructive && !ctx.approved) return { status: "awaiting_approval", diff: plan.changes }',
    when: (c) => (c.has('filesystem_access') || c.has('code_execution') || c.has('web_access')) && !c.has('human_in_loop'),
    evidence: (c) => [...c.evidenceOf('filesystem_access', 2), ...c.evidenceOf('code_execution', 1)],
  },
  {
    id: 'injection_surface',
    title: '外部内容注入面缺少护栏',
    severity: 'high',
    category: 'safety',
    dimension: 'safety',
    problem: 'Agent 会读取网页/文件/检索结果等外部内容并送入模型，但未见输入输出护栏。',
    impact: '外部内容中一句"忽略以上指令"即可劫持 Agent，把工具能力用于攻击者目标（间接提示注入）。',
    fix: '外部内容用明确分隔符包裹并声明为不可信数据；对检索/抓取文本做注入模式扫描；限制工具白名单。',
    snippet: 'const ctx = `<untrusted source="${src.id}">${sanitize(doc.text)}</untrusted>`  // 提示中声明其非指令',
    when: (c) => (c.has('web_access') || c.has('rag') || c.has('filesystem_access')) && !c.has('guardrails'),
    evidence: (c) => [...c.evidenceOf('web_access', 2), ...c.evidenceOf('rag', 2)],
  },
  {
    id: 'no_retry',
    title: '模型调用没有重试与退避',
    severity: 'medium',
    category: 'reliability',
    dimension: 'reliability',
    problem: '存在模型调用，但未见 retry / backoff 逻辑。',
    impact: '限流与瞬时网络抖动会直接变成用户可见失败，成功率被基础设施噪声拖累。',
    fix: '只对 429/5xx/超时做指数退避重试（2–3 次 + 抖动），业务性错误不重试以免放大问题。',
    snippet: 'await retry(() => llm.create(...), { retries: 3, backoff: "exponential", jitter: true, retryOn: [429, 500, 502, 503] })',
    when: (c) => c.has('model_routing') || (c.has('agent_loop') && !c.has('retry_resilience')),
    guard: (c) => !c.has('retry_resilience'),
    evidence: (c) => c.evidenceOf('agent_loop', 2),
  },
  {
    id: 'no_observability',
    title: '缺少链路追踪，失败无法定位',
    severity: 'medium',
    category: 'observability',
    dimension: 'observability',
    problem: '检测到 Agent 循环，但没有 step 级 trace / 耗时 / token 记录。',
    impact: '线上出错时只能靠复现猜测是哪一步、哪个工具、哪段上下文导致，优化无从下手。',
    fix: '为每次运行分配 run_id，按 seq 记录 model_call / tool_call / retrieval / output 六类 step 并落库。',
    snippet: 'trace.push({ seq, kind: "tool_call", name, args, ms, tokens, status })',
    when: (c) => c.has('agent_loop') && !c.has('observability'),
    evidence: (c) => c.evidenceOf('agent_loop', 2),
  },
  {
    id: 'no_eval',
    title: '没有评测集，改动无法验证',
    severity: 'medium',
    category: 'observability',
    dimension: 'observability',
    problem: '代码规模已不小，但未发现 dataset / expected output / 评分器。',
    impact: '每次 Prompt 或模型变更都是"凭感觉"，回归只能在用户侧被发现。',
    fix: '沉淀 30–100 条带期望输出的 Golden Dataset，改一次跑一次，把通过率作为合入门禁。',
    snippet: 'const report = await runEval({ dataset: golden, agent, evaluators: [exactMatch, toolUsage, schemaValid] })',
    when: (c) => !c.has('evaluation') && c.metrics.codeLines > 400,
    evidence: () => [],
  },
  {
    id: 'rag_without_citation',
    title: 'RAG 结果未做可溯源引用',
    severity: 'medium',
    category: 'knowledge',
    dimension: 'knowledge',
    problem: '检测到检索增强，但未见 evidence / citation / source 回溯字段。',
    impact: '无法验证答案是否真的来自检索内容，幻觉与正确回答在输出上长得一模一样。',
    fix: '召回片段带 doc_id + 片段编号注入提示，要求答案逐句标注引用，并做 groundedness 校验。',
    snippet: 'answer.citations = usedChunks.map(c => ({ docId: c.docId, chunkId: c.id, score: c.score }))',
    when: (c) => c.has('rag') && !c.hit(re('citation|cite|source_id|sourceId|doc_id|docId|chunk_id|grounded|attribution|reference_id')),
    evidence: (c) => c.evidenceOf('rag', 3),
  },
  {
    id: 'no_fallback_model',
    title: '未配置降级模型链',
    severity: 'low',
    category: 'reliability',
    dimension: 'reliability',
    problem: '只使用单一模型且无 fallback。',
    impact: '上游模型限流或下线时整条链路不可用。',
    fix: '为主模型配置同能力等级的备用模型，按错误类型自动切换并记录切换事件。',
    snippet: 'const chain = [primary, fallback]; for (const m of chain) { try { return await call(m) } catch (e) { if (!retryable(e)) throw e } }',
    when: (c) => !c.has('model_routing') && c.has('agent_loop'),
    evidence: () => [],
  },
  {
    id: 'no_cost_control',
    title: '未统计 token 用量与成本',
    severity: 'low',
    category: 'reliability',
    dimension: 'reliability',
    problem: '有模型调用但未见 usage / cost 统计。',
    impact: '无法定位成本热点，也无法对单次任务设预算上限。',
    fix: '在每次调用记录 input/output token 与单价，聚合到 run 级成本并设预算告警。',
    snippet: 'usage.input += resp.usage.input_tokens; cost += resp.usage.input_tokens * PRICE_IN',
    when: (c) => !c.has('cost_control') && (c.has('agent_loop') || c.has('tool_calling')),
    evidence: () => [],
  },
  {
    id: 'swallowed_errors',
    title: '存在被吞掉的异常',
    severity: 'high',
    category: 'engineering',
    dimension: 'reliability',
    problem: '代码中出现空的 catch 块或 catch 后仅打印。',
    impact: '失败被静默转成"成功但结果不对"，是最难排查的一类 bug。',
    fix: 'catch 必须分类处理：可重试的进重试队列，不可恢复的写入 trace 并向上传播结构化错误。',
    snippet: 'catch (err) { trace.push({ kind: "error", message: err.message }); throw new ToolError(tool, { cause: err }) }',
    when: (c) => findSwallowHits(c.sources).length > 0,
    evidence: () => [],
    evidenceFrom: (c) => findSwallowHits(c.sources),
  },
  {
    id: 'giant_files',
    title: '存在超大源文件',
    severity: 'low',
    category: 'engineering',
    dimension: 'reliability',
    problem: '有源文件超过 800 行。',
    impact: '单文件承载过多职责，改动影响面难以推理，也拖慢模型阅读上下文的速度。',
    fix: '按能力边界拆分（循环 / 工具 / 记忆 / 检索各自独立模块），保留薄壳入口。',
    snippet: 'agent/loop.js  agent/tools.js  agent/memory.js  agent/retrieval.js',
    when: (c) => giantFiles(c.sources).length > 0,
    evidence: (c) => giantFiles(c.sources).slice(0, 3).map((f) => ({ path: f.path, line: 1, snippet: `${f.lineCount} 行`, pattern: '文件规模', match: 'oversized file' })),
  },
  {
    id: 'no_tests',
    title: '缺少自动化测试',
    severity: 'medium',
    category: 'engineering',
    dimension: 'reliability',
    problem: '未发现测试文件或测试框架引用。',
    impact: 'Agent 行为高度非确定，没有回归网时任何重构都可能悄悄破坏既有能力。',
    fix: '先用 MockProvider 把循环/工具/解析逻辑做成确定性单测，再补端到端评测集。',
    snippet: 'test("loop stops at max steps", async () => { expect((await agent.run(q, { provider: mock })).stopReason).toBe("max_steps") })',
    when: (c) => c.metrics.testFiles === 0 && c.metrics.codeLines > 300,
    evidence: () => [],
  },
  {
    id: 'memory_without_isolation',
    title: '长期记忆未按用户/会话隔离',
    severity: 'high',
    category: 'safety',
    dimension: 'safety',
    problem: '存在持久化记忆，但未见 session/user/tenant 作用域参数。',
    impact: 'A 用户的事实会被召回进 B 用户的提示词，属于数据泄露级缺陷。',
    fix: '所有记忆读写强制带 scope key（tenant + user + conversation），检索时按 scope 过滤。',
    snippet: 'memory.upsert({ scope: `${tenantId}:${userId}`, facts })  // 检索同样按 scope 过滤',
    when: (c) => c.has('long_term_memory') && !c.has('session_isolation'),
    evidence: (c) => c.evidenceOf('long_term_memory', 3),
  },
  {
    id: 'prompt_inline',
    title: '提示词硬编码在业务代码中',
    severity: 'low',
    category: 'engineering',
    dimension: 'reasoning',
    problem: '未见外置提示词文件或模板机制，长提示疑似内联在代码里。',
    impact: '无法版本化、无法 diff、无法做 A/B 与回归，调优成本随文件数量线性上升。',
    fix: '把提示词移到 prompts/ 目录并带版本号，运行时按 key 加载，同时在评测中记录 prompt hash。',
    snippet: 'const prompt = prompts.load("planner", { version: 3 })  // prompts/planner.v3.md',
    when: (c) => !c.has('prompt_management') && c.has('agent_loop'),
    evidence: () => [],
  },
  {
    id: 'no_structured_output',
    title: '未约束模型输出结构',
    severity: 'medium',
    category: 'engineering',
    dimension: 'architecture',
    problem: '存在工具编排，但未见 response_format / schema 约束。',
    impact: '下游靠正则从自由文本里抢救字段，模型换个说法就解析失败。',
    fix: '声明 JSON Schema 并开启 json mode，解析失败时把错误回喂给模型要求重生成。',
    snippet: 'response_format: { type: "json_schema", json_schema: { schema: PlanSchema, strict: true } }',
    when: (c) => c.has('tool_calling') && !c.has('structured_output'),
    evidence: (c) => c.evidenceOf('tool_calling', 2),
  },
  {
    id: 'deep_nesting',
    title: '控制流嵌套过深',
    severity: 'low',
    category: 'engineering',
    dimension: 'reliability',
    problem: '存在超过 6 层的代码块嵌套。',
    impact: '分支组合爆炸使错误路径难以穷举，评审与测试覆盖成本急剧上升。',
    fix: '用早返回和提取函数把嵌套压平，把循环体的每个阶段抽成独立步骤函数。',
    snippet: 'if (!valid) return fail("invalid");  // 先处理异常路径，主流程保持最外层',
    when: (c) => c.metrics.maxNesting > 6,
    evidence: () => [],
  },
  {
    id: 'no_streaming',
    title: '服务化接口未使用流式输出',
    severity: 'low',
    category: 'delivery',
    dimension: 'architecture',
    problem: '有 HTTP/CLI 入口但未见流式实现。',
    impact: '长回答场景下用户需等待完整生成结束才看到第一个字，感知延迟放大数倍。',
    fix: '改为 SSE 逐 token 推送，并在首块输出时记录 TTFT 指标。',
    snippet: 'res.setHeader("content-type", "text/event-stream"); for await (const d of llm.stream()) res.write(`data: ${json(d)}\\n\\n`)',
    when: (c) => c.has('api_surface') && !c.has('streaming'),
    evidence: () => [],
  },
  {
    id: 'no_failure_taxonomy',
    title: '失败未分类，无法统计改进',
    severity: 'medium',
    category: 'observability',
    dimension: 'observability',
    problem: '有错误处理但没有失败类型枚举与归因。',
    impact: '只知道"失败了"，不知道是检索错、工具错还是格式错，优化只能靠猜。',
    fix: '定义 8–15 类失败码，按证据强度自动归因并统计分布，优先攻占比最高的类别。',
    snippet: 'type FailureCode = "retrieval_miss" | "tool_error" | "invalid_format" | "hallucination" | "loop_exhausted"',
    when: (c) => !c.has('failure_taxonomy') && (c.has('rag') || c.has('tool_calling')),
    evidence: () => [],
  },
  {
    id: 'vector_without_rerank',
    title: '向量召回未做重排',
    severity: 'low',
    category: 'knowledge',
    dimension: 'knowledge',
    problem: '使用向量检索但没有 rerank / cross-encoder 阶段。',
    impact: 'Top-K 里混入语义相近但无关的片段，会直接污染提示词并诱发幻觉。',
    fix: '召回 top-20 后用 cross-encoder 精排取 top-5，并按分数阈值丢弃低相关片段。',
    snippet: 'const docs = (await vs.query({ limit: 20 })).pipe(rerank(query, { topN: 5, minScore: 0.35 }))',
    when: (c) => c.has('vector_store') && !c.hit(re('rerank|cross.?encoder|mmr|max_marginal|re.?rank')),
    evidence: (c) => c.evidenceOf('vector_store', 2),
  },
];

function giantFiles(sources) {
  return sources.filter((f) => f.family === 'code' && f.lineCount > 800).sort((a, b) => b.lineCount - a.lineCount);
}

const SECRET_RE = /(sk-[A-Za-z0-9\-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"])/gi;

const PLACEHOLDER_RE = /(test|dummy|example|sample|fake|mock|placeholder|changeme|your[_-]|xxx|<|\.\.\.|todo|fixture|seed|redacted|none|null)/i;

function looksReal(value) {
  const body = String(value).replace(/.*[:=]\s*['"]/, '').replace(/['"]$/, '');
  const letters = body.replace(/[^A-Za-z]/g, '');
  if (PLACEHOLDER_RE.test(body)) return false;
  if (letters.length < 16) return false;
  const distinct = new Set(letters.toLowerCase().split('')).size;
  return distinct >= 8;
}

function isFixture(filePath) {
  return /(^|\/)(tests?|__tests__|fixtures?|examples?|docs?|mocks?)(\/|$)/i.test(filePath)
    || /\.(test|spec)\.[jt]sx?$/i.test(filePath)
    || /(^|\/)seed[\w.-]*\.(ts|js|py)$/i.test(filePath);
}

function findSecretHits(sources) {
  const out = [];
  for (const file of sources) {
    if (file.family === 'doc') continue;
    if (isFixture(file.path)) continue;
    const text = file.content;
    let m;
    SECRET_RE.lastIndex = 0;
    while ((m = SECRET_RE.exec(text)) !== null) {
      if (!looksReal(m[0])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ path: file.path, line, snippet: mask(m[0]), match: 'secret literal', pattern: '密钥扫描' });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function mask(value) {
  if (value.length <= 12) return `${value.slice(0, 3)}****`;
  return `${value.slice(0, 6)}…${value.slice(-3)}`.replace(/[A-Za-z0-9]{6,}/g, '****');
}

const SWALLOW_RE = /(catch\s*\([^)]*\)\s*\{\s*\}|except\s*:\s*pass|catch\s*\{\s*\}|except\s+Exception\s*:\s*pass)/g;

function findSwallowHits(sources) {
  const out = [];
  for (const file of sources) {
    if (file.family === 'doc') continue;
    const text = file.content;
    let m;
    SWALLOW_RE.lastIndex = 0;
    while ((m = SWALLOW_RE.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ path: file.path, line, snippet: m[0].replace(/\s+/g, ' ').slice(0, 80), match: m[0].slice(0, 40), pattern: '空异常处理' });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

export function evaluateRisks(ctx) {
  const issues = [];
  for (const check of RISK_CHECKS) {
    try {
      if (check.guard && !check.guard(ctx)) continue;
      if (!check.when(ctx)) continue;
      const evidence = (check.evidenceFrom ?? check.evidence)?.(ctx) ?? [];
      issues.push({
        id: check.id,
        title: check.title,
        severity: check.severity,
        severityLabel: SEVERITY[check.severity].label,
        color: SEVERITY[check.severity].color,
        category: check.category,
        dimension: check.dimension,
        problem: check.problem,
        impact: check.impact,
        fix: check.fix,
        snippet: check.snippet,
        evidence,
      });
    } catch {
      // A rule that throws must never break the whole diagnosis; record it as an unknown issue.
      issues.push({
        id: check.id,
        title: `${check.title}（规则执行异常）`,
        severity: 'low',
        severityLabel: SEVERITY.low.label,
        color: SEVERITY.low.color,
        category: 'engineering',
        dimension: 'reliability',
        problem: '该检查项在本次分析中抛出异常，已跳过。',
        impact: '诊断结论可能不完整。',
        fix: '反馈该规则以便修正。',
        snippet: '',
        evidence: [],
      });
    }
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title));
  return issues;
}
