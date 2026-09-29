import { DIMENSIONS } from './capabilities.js';

const PENALTY = { critical: 26, high: 15, medium: 8, low: 4 };

function credit(finding) {
  if (finding.status === 'strong') return 1;
  if (finding.status === 'present') return 0.62;
  if (finding.status === 'declared') return 0.18;
  return 0;
}

export function computeScores(findings, issues) {
  const dimensions = Object.values(DIMENSIONS).map((dim) => {
    const caps = findings.filter((f) => f.dimension === dim.key);
    const totalWeight = caps.reduce((sum, c) => sum + c.weight, 0) || 1;
    const earnedWeight = caps.reduce((sum, c) => sum + c.weight * credit(c), 0);
    const coverage = earnedWeight / totalWeight;
    const dimIssues = issues.filter((i) => i.dimension === dim.key);
    const penalty = dimIssues.reduce((sum, i) => sum + (PENALTY[i.severity] ?? 4), 0);
    const base = coverage * 100;
    const score = clamp(Math.round(base - penalty), 0, 100);
    return {
      key: dim.key,
      label: dim.label,
      weight: dim.weight,
      coverage: Math.round(coverage * 1000) / 10,
      penalty,
      score,
      base: Math.round(base * 10) / 10,
      issues: dimIssues.map((i) => i.id),
      detected: caps.filter((c) => c.status !== 'absent').map((c) => c.id),
      missing: caps.filter((c) => c.status === 'absent').map((c) => c.id),
    };
  });

  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
  const grade = gradeFor(overall);
  const riskLoad = issues.reduce((sum, i) => sum + (PENALTY[i.severity] ?? 4), 0);

  return {
    overall,
    grade,
    gradeLabel: grade.label,
    riskLoad,
    dimensions,
    summary: summaryFor(overall, grade, findings, issues),
  };
}

export function coverageStats(findings) {
  const detected = findings.filter((f) => f.status === 'strong' || f.status === 'present');
  const declared = findings.filter((f) => f.status === 'declared');
  const totalWeight = findings.reduce((s, f) => s + f.weight, 0) || 1;
  const earned = findings.reduce((s, f) => s + f.weight * credit(f), 0);
  return {
    detectedCount: detected.length,
    declaredCount: declared.length,
    absentCount: findings.length - detected.length - declared.length,
    totalCount: findings.length,
    weightedCoverage: Math.round((earned / totalWeight) * 1000) / 10,
    detectedIds: detected.map((f) => f.id),
  };
}

function gradeFor(score) {
  if (score >= 85) return { key: 'S', label: 'S · 生产就绪', tone: 'green' };
  if (score >= 72) return { key: 'A', label: 'A · 接近就绪', tone: 'green' };
  if (score >= 58) return { key: 'B', label: 'B · 可用需加固', tone: 'amber' };
  if (score >= 40) return { key: 'C', label: 'C · 原型阶段', tone: 'amber' };
  return { key: 'D', label: 'D · 概念验证', tone: 'red' };
}

function summaryFor(score, grade, findings, issues) {
  const strong = findings.filter((f) => f.status === 'strong').length;
  const criticals = issues.filter((i) => i.severity === 'critical').length;
  if (criticals > 0) {
    return `识别到 ${strong} 项成熟能力，但存在 ${criticals} 个严重级缺陷，${grade.label}。建议先消除严重与高级问题再考虑扩功能。`;
  }
  if (score >= 72) {
    return `识别到 ${strong} 项成熟能力，工程护栏基本齐备，整体达到 ${grade.label}。剩余问题集中在体验与成本优化。`;
  }
  if (score >= 50) {
    return `能力骨架已具备（${strong} 项强证据），但缺少足够的护栏与可观测支撑，当前为 ${grade.label}。`;
  }
  return `仅识别到 ${strong} 项强证据能力，Agent 关键机制（循环预算、记忆管理、评测）尚未成型，当前为 ${grade.label}。`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
