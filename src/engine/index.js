import path from 'node:path';
import { loadProjectFiles, toFileRecord, isGeneratedArtifact } from './scanner.js';
import { prepareSources, computeMetrics } from './metrics.js';
import { detectCapabilities, buildContext, capabilityDictionary } from './detector.js';
import { evaluateRisks } from './risks.js';
import { computeScores, coverageStats } from './scoring.js';
import { buildSuggestions, buildStrengths } from './suggestions.js';
import { buildPipeline } from './pipeline.js';
import { CATEGORIES } from './capabilities.js';

export const ENGINE_VERSION = '1.0.0';

const ISSUE_STAGE = {
  loop_without_budget: 'reasoner',
  unbounded_context: 'reasoner',
  tool_without_timeout: 'tools',
  tool_without_schema: 'tools',
  hardcoded_secret: 'intake',
  exec_without_sandbox: 'tools',
  destructive_without_approval: 'tools',
  injection_surface: 'retriever',
  no_retry: 'reasoner',
  no_observability: 'reasoner',
  no_eval: 'answer',
  rag_without_citation: 'retriever',
  no_fallback_model: 'reasoner',
  no_cost_control: 'reasoner',
  swallowed_errors: 'tools',
  giant_files: null,
  no_tests: null,
  memory_without_isolation: 'intake',
  prompt_inline: 'planner',
  no_structured_output: 'tools',
  deep_nesting: null,
  no_streaming: 'answer',
  no_failure_taxonomy: null,
  vector_without_rerank: 'retriever',
};

export function analyzeDirectory(root, options = {}) {
  const resolved = path.resolve(root);
  const { files: rawFiles, skipped } = loadProjectFiles(resolved, options);
  return analyzeFiles(rawFiles, {
    target: {
      kind: 'directory',
      root: resolved,
      name: options.name || path.basename(resolved),
      skipped,
    },
  });
}

export function analyzeUploaded(entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const usable = list.filter((e) => typeof e?.path === 'string' && typeof e?.content === 'string');
  const generated = usable.filter((e) => isGeneratedArtifact(e.path.replace(/\\/g, '/').split('/').pop()));
  const raw = usable
    .filter((e) => !generated.includes(e))
    .map((e) => toFileRecord(e.path.replace(/^\/+/, ''), e.content));
  return analyzeFiles(raw, {
    target: {
      kind: 'upload',
      root: options.root ?? '(上传内容)',
      name: options.name ?? '上传的 Agent 工程',
      skipped: { ignored: 0, binary: list.length - usable.length, tooLarge: generated.length },
    },
  });
}

export function analyzeFiles(rawFiles, options = {}) {
  const started = Date.now();
  const sources = prepareSources(rawFiles);
  const metrics = computeMetrics(sources);
  const findings = detectCapabilities(sources);
  const ctx = buildContext(findings, sources, metrics);
  const issues = evaluateRisks(ctx);
  const scores = computeScores(findings, issues);
  const suggestions = buildSuggestions({ findings, issues, scores, metrics });
  const strengths = buildStrengths(findings);
  const coverage = coverageStats(findings);

  const blockersByStage = new Map();
  for (const issue of issues) {
    const stage = ISSUE_STAGE[issue.id];
    if (!stage) continue;
    const list = blockersByStage.get(stage) ?? [];
    list.push({ id: issue.id, title: issue.title, severity: issue.severity, severityLabel: issue.severityLabel, color: issue.color });
    blockersByStage.set(stage, list);
  }
  ctx.issuesForStage = (stage) => blockersByStage.get(stage) ?? [];

  const pipeline = buildPipeline(findings, ctx);
  const distribution = buildDistribution(issues);
  const fileIndex = buildFileIndex(sources, findings);

  return {
    engineVersion: ENGINE_VERSION,
    durationMs: Date.now() - started,
    createdAt: new Date().toISOString(),
    target: {
      kind: options.target?.kind ?? 'unknown',
      name: options.target?.name ?? '未命名工程',
      root: options.target?.root ?? '',
      skipped: options.target?.skipped ?? { ignored: 0, binary: 0, tooLarge: 0 },
    },
    metrics,
    scores,
    coverage,
    distribution,
    pipeline,
    strengths,
    suggestions,
    issues,
    findings,
    fileIndex,
    dictionary: capabilityDictionary(),
    categories: Object.values(CATEGORIES),
  };
}

function buildDistribution(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.category;
    const label = CATEGORIES[key]?.label ?? (key === 'engineering' ? '工程质量' : '其他问题');
    const entry = groups.get(label) ?? { label, count: 0, color: CATEGORIES[key]?.color ?? '#94a3b8', ids: [] };
    entry.count += 1;
    entry.ids.push(issue.id);
    groups.set(label, entry);
  }
  const total = issues.length || 1;
  return [...groups.values()]
    .map((g) => ({ ...g, percent: Math.round((g.count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

function buildFileIndex(sources, findings) {
  const map = new Map();
  for (const f of sources) {
    if (f.family === 'doc') continue;
    map.set(f.path, { path: f.path, language: f.language, lines: f.lineCount, capabilities: [] });
  }
  for (const finding of findings) {
    for (const ev of finding.evidence) {
      const entry = map.get(ev.path);
      if (!entry) continue;
      if (!entry.capabilities.includes(finding.id)) entry.capabilities.push(finding.id);
    }
  }
  return [...map.values()]
    .filter((e) => e.capabilities.length > 0)
    .sort((a, b) => b.capabilities.length - a.capabilities.length || b.lines - a.lines)
    .slice(0, 60);
}
