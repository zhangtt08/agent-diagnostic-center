import { CAPABILITIES } from './capabilities.js';

const PRIORITY = {
  high: { key: 'high', label: '高优先级', tone: 'red', order: 0 },
  medium: { key: 'medium', label: '中优先级', tone: 'amber', order: 1 },
  low: { key: 'low', label: '低优先级', tone: 'blue', order: 2 },
};

const SEVERITY_TO_PRIORITY = { critical: 'high', high: 'high', medium: 'medium', low: 'low' };

export function buildSuggestions({ findings, issues, scores, metrics }) {
  const out = [];
  const byId = new Map(findings.map((f) => [f.id, f]));

  for (const issue of issues) {
    const gain = estimateIssueGain(issue, scores);
    out.push({
      id: `fix_${issue.id}`,
      kind: 'fix',
      title: issue.title,
      priority: PRIORITY[SEVERITY_TO_PRIORITY[issue.severity]].key,
      priorityLabel: PRIORITY[SEVERITY_TO_PRIORITY[issue.severity]].label,
      tone: PRIORITY[SEVERITY_TO_PRIORITY[issue.severity]].tone,
      category: issue.category,
      dimension: issue.dimension,
      rationale: issue.problem,
      impact: issue.impact,
      action: issue.fix,
      snippet: issue.snippet,
      expectedGain: gain,
      evidence: issue.evidence,
      refs: [`risk:${issue.id}`],
    });
  }

  for (const cap of CAPABILITIES) {
    const finding = byId.get(cap.id);
    if (!finding || finding.status !== 'absent') continue;
    const gain = Math.round(cap.weight * (cap.weight >= 8 ? 1.9 : 1.35) * 10) / 10;
    if (gain < 1.2) continue;
    out.push({
      id: `add_${cap.id}`,
      kind: 'capability',
      title: `补齐能力：${cap.label}`,
      priority: cap.weight >= 9 ? 'medium' : cap.weight >= 6 ? 'medium' : 'low',
      priorityLabel: PRIORITY[cap.weight >= 6 ? 'medium' : 'low'].label,
      tone: PRIORITY[cap.weight >= 6 ? 'medium' : 'low'].tone,
      category: cap.category,
      dimension: cap.dimension,
      rationale: `代码中未发现「${cap.en}」的任何实现证据。`,
      impact: cap.headline,
      action: cap.detail,
      snippet: '',
      expectedGain: gain,
      evidence: [],
      refs: [`capability:${cap.id}`],
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.expectedGain - a.expectedGain);
  return out.map((s, i) => ({ ...s, rank: i + 1 }));
}

export function buildStrengths(findings) {
  return findings
    .filter((f) => f.status === 'strong')
    .sort((a, b) => b.confidence - a.confidence || b.weight - a.weight)
    .map((f) => ({
      id: f.id,
      label: f.label,
      en: f.en,
      category: f.category,
      categoryLabel: f.categoryLabel,
      confidence: f.confidence,
      hits: f.hits,
      files: f.files.length,
      headline: f.headline,
      evidence: f.evidence.slice(0, 3),
    }));
}

function estimateIssueGain(issue, scores) {
  const dim = scores.dimensions.find((d) => d.key === issue.dimension);
  if (!dim) return 3;
  const penalty = { critical: 26, high: 15, medium: 8, low: 4 }[issue.severity] ?? 4;
  const recoverable = Math.min(penalty, dim.penalty);
  const dimGain = Math.min(recoverable, 100 - dim.score);
  return Math.round(dimGain * dim.weight * 100) / 100;
}
