/**
 * 生产级 Agent 编排循环：步数/时间/成本三重预算 + 逐步 trace + 失败归因。
 */
import { validateToolArgs, TOOL_REGISTRY } from './tools.js';
import { checkPromptInjection, redactSecrets, assertAllowedHost } from './guardrails.js';
import { recallMemories, persistMemories } from './memory.js';
import { retrieve } from './retrieval.js';
import { TraceCollector } from './trace.js';

export const RUN_BUDGET = {
  maxIterations: 16,
  maxWallClockMs: 120_000,
  maxCostUsd: 0.5,
  contextWindowTokens: 128_000,
};

const PRICE = { inputPer1k: 0.0025, outputPer1k: 0.01 };

export class Orchestrator {
  constructor({ provider, planner, critic, eventBus }) {
    this.provider = provider;
    this.planner = planner;
    this.critic = critic;
    this.eventBus = eventBus;
  }

  async run(request) {
    const trace = new TraceCollector({ runId: request.runId, sessionId: request.sessionId });
    const startedAt = Date.now();
    let cost = 0;
    let stopReason = 'completed';

    const injection = checkPromptInjection(request.query);
    if (injection.blocked) {
      trace.record({ kind: 'error', code: 'prompt_injection_detected', detail: injection.reason });
      return { answer: null, stopReason: 'blocked_by_guardrail', trace: trace.steps, cost };
    }

    const plan = await this.planner.decompose(request.query, { maxSubtasks: 8 });
    trace.record({ kind: 'decision', detail: { plan: plan.subtasks, estimatedSteps: plan.estimatedSteps } });

    const memories = await recallMemories({ scope: `${request.tenantId}:${request.userId}`, query: request.query, topK: 5 });
    const messages = [{ role: 'system', content: await this.loadPrompt('orchestrator.v4') }];

    for (let iteration = 0; iteration < RUN_BUDGET.maxIterations; iteration += 1) {
      if (Date.now() - startedAt > RUN_BUDGET.maxWallClockMs) {
        stopReason = 'timeout_budget';
        break;
      }
      if (cost > RUN_BUDGET.maxCostUsd) {
        stopReason = 'cost_budget';
        break;
      }

      const context = this.compact(messages, RUN_BUDGET.contextWindowTokens);
      const retrieval = await retrieve({ query: request.query, topK: 12 }).then((docs) => rerank(request.query, docs, 5));
      const reply = await this.provider.complete({
        model: this.pickModel(iteration, plan),
        messages: [...context, ...memoryBlock(memories), ...retrievalBlock(retrieval)],
        tools: TOOL_REGISTRY.schemas(),
        response_format: { type: 'json_schema', strict: true },
        stream: true,
      });

      cost += (reply.usage.inputTokens / 1000) * PRICE.inputPer1k + (reply.usage.outputTokens / 1000) * PRICE.outputPer1k;
      trace.record({ kind: 'model_call', iteration, tokens: reply.usage, ms: reply.latencyMs, model: reply.model });

      if (!reply.toolCalls?.length) {
        const verdict = await this.critic.review({ query: request.query, answer: reply.text, evidence: retrieval });
        if (!verdict.approved && iteration < RUN_BUDGET.maxIterations - 1) {
          messages.push({ role: 'user', content: `评审未通过：${verdict.reason}，请修正。` });
          continue;
        }
        await persistMemories({ scope: `${request.tenantId}:${request.userId}`, facts: verdict.facts });
        trace.record({ kind: 'output', text: redactSecrets(reply.text), citations: verdict.citations });
        return { answer: reply.text, citations: verdict.citations, stopReason, trace: trace.steps, cost, usage: reply.usage };
      }

      for (const call of reply.toolCalls) {
        const parsed = validateToolArgs(call.name, call.arguments);
        if (!parsed.ok) {
          trace.record({ kind: 'tool_call', name: call.name, status: 'invalid_arguments', issues: parsed.issues });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: parsed.issues }) });
          continue;
        }
        if (call.name === 'http_fetch' && !assertAllowedHost(parsed.value.url)) {
          trace.record({ kind: 'tool_call', name: call.name, status: 'permission_denied' });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'host_not_allowed' }) });
          continue;
        }
        if (TOOL_REGISTRY.isDestructive(call.name)) {
          const approval = await this.eventBus.requestApproval({ tool: call.name, args: parsed.value, timeoutMs: 30_000 });
          if (!approval.approved) {
            trace.record({ kind: 'tool_call', name: call.name, status: 'awaiting_approval', outcome: approval.outcome });
            return { answer: null, stopReason: 'awaiting_human_approval', trace: trace.steps, cost };
          }
        }
        const result = await TOOL_REGISTRY.invoke(call.name, parsed.value, { timeoutMs: 15_000, signal: trace.signal });
        trace.record({ kind: 'tool_call', name: call.name, status: result.status, ms: result.ms, errorCode: result.errorCode });
        messages.push({ role: 'tool', tool_call_id: call.id, content: redactSecrets(result.text).slice(0, 8_000) });
      }
    }

    return { answer: null, stopReason, trace: trace.steps, cost, failureCode: classifyFailure(trace.steps) };
  }

  compact(messages, budgetTokens) {
    const kept = [...messages];
    let tokens = estimateTokens(kept);
    while (tokens > budgetTokens && kept.length > 2) {
      const dropped = kept.splice(1, 1)[0];
      tokens -= estimateTokens([dropped]);
      kept.splice(1, 0, { role: 'system', content: '[早前对话已压缩]' });
    }
    return kept;
  }

  pickModel(iteration, plan) {
    if (iteration === 0) return 'gpt-4o-mini';
    if (plan.complexity === 'high') return 'gpt-4o';
    return process.env.AGENT_FALLBACK_MODEL ?? 'gpt-4o-mini';
  }

  async loadPrompt(key) {
    return (await import(`./prompts/${key}.js`)).default;
  }
}

function memoryBlock(memories) {
  if (!memories.length) return [];
  return [{ role: 'system', content: `<untrusted memories>\n${memories.map((m) => `- ${m.text}`).join('\n')}\n</untrusted>` }];
}

function retrievalBlock(docs) {
  if (!docs.length) return [];
  return [{ role: 'system', content: `<untrusted documents>\n${docs.map((d) => `[${d.chunkId}] ${d.text}`).join('\n')}\n</untrusted>` }];
}

function estimateTokens(messages) {
  return messages.reduce((sum, m) => sum + Math.ceil(String(m.content ?? '').length / 3.5), 0);
}

function rerank(query, docs, topN) {
  return docs.sort((a, b) => b.crossScore - a.crossScore).slice(0, topN);
}

function classifyFailure(steps) {
  if (steps.some((s) => s.status === 'invalid_arguments')) return 'tool_argument_error';
  if (steps.some((s) => s.status === 'timeout')) return 'tool_timeout';
  if (steps.some((s) => s.code === 'prompt_injection_detected')) return 'safety_block';
  return 'loop_exhausted';
}
