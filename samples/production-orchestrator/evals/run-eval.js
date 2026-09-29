/** 评测：Golden Dataset + 确定性评分器 + LLM Judge + 回归门禁。 */
import { Orchestrator, RUN_BUDGET } from '../src/loop.js';
import golden from './golden.json' with { type: 'json' };

const GATE = { minPassRate: 0.9, maxP95Ms: 20_000, maxCostUsd: 0.5, allowRegressions: 0 };

export async function runEval({ provider, baseline }) {
  const agent = new Orchestrator({ provider, planner: null, critic: null, eventBus: null });
  const results = [];
  for (const testCase of golden.cases) {
    const started = Date.now();
    const out = await agent.run({ query: testCase.input, runId: `eval_${testCase.id}`, sessionId: testCase.id, tenantId: 'eval', userId: 'eval' });
    results.push({
      id: testCase.id,
      passed: evaluate(testCase, out),
      ms: Date.now() - started,
      cost: out.cost ?? 0,
      failureType: out.failureCode ?? null,
      expectedTools: testCase.expectedTools,
      actualTools: (out.trace ?? []).filter((s) => s.kind === 'tool_call').map((s) => s.name),
    });
  }
  const passRate = results.filter((r) => r.passed).length / results.length;
  const p95 = percentile(results.map((r) => r.ms), 0.95);
  const regressions = baseline ? results.filter((r, i) => baseline[i]?.passed && !r.passed) : [];
  const gate = {
    verdict: passRate >= GATE.minPassRate && p95 <= GATE.maxP95Ms && regressions.length === 0 ? 'PASS' : 'FAIL',
    passRate,
    p95,
    regressions: regressions.length,
    budget: RUN_BUDGET,
  };
  return { results, gate };
}

function evaluate(testCase, out) {
  if (!out.answer) return false;
  const missing = (testCase.mustContain ?? []).filter((kw) => !out.answer.includes(kw));
  if (missing.length) return false;
  const forbidden = (testCase.mustNotContain ?? []).filter((kw) => out.answer.includes(kw));
  if (forbidden.length) return false;
  const usedTools = (out.trace ?? []).filter((s) => s.kind === 'tool_call' && s.status === 'ok').map((s) => s.name);
  return (testCase.expectedTools ?? []).every((tool) => usedTools.includes(tool));
}

function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
}
