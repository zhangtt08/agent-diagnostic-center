import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
export const DATA_DIR = process.env.ARL_DATA_DIR ? path.resolve(process.env.ARL_DATA_DIR) : path.join(APP_ROOT, 'data');
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const MARKER_FILE = path.join(DATA_DIR, '.initialized');
const MAX_REPORTS = 120;

/** 区分"从未运行过"与"用户主动清空"，前者才需要补种子数据。 */
export function isInitialized() {
  return fs.existsSync(MARKER_FILE);
}

export function markInitialized() {
  ensureDirs();
  fs.writeFileSync(MARKER_FILE, new Date().toISOString(), 'utf8');
}

function ensureDirs() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function readIndex() {
  ensureDirs();
  if (!fs.existsSync(INDEX_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(entries) {
  ensureDirs();
  const tmp = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tmp, INDEX_FILE);
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function datePart(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

export function nextRunId(createdAt = new Date().toISOString()) {
  const prefix = `diag_${datePart(createdAt)}`;
  const existing = readIndex().filter((r) => String(r.runId).startsWith(prefix));
  let max = 0;
  for (const r of existing) {
    const tail = Number(String(r.runId).slice(prefix.length + 1));
    if (Number.isFinite(tail) && tail > max) max = tail;
  }
  return `${prefix}_${pad(max + 1, 4)}`;
}

export function saveReport(report) {
  ensureDirs();
  const index = readIndex();
  const runId = nextRunId(report.createdAt);
  const stored = { ...report, runId };
  fs.writeFileSync(path.join(REPORT_DIR, `${runId}.json`), JSON.stringify(stored), 'utf8');
  index.push(reportSummary(stored));
  index.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const trimmed = index.slice(0, MAX_REPORTS);
  for (const dropped of index.slice(MAX_REPORTS)) {
    try {
      fs.unlinkSync(path.join(REPORT_DIR, `${dropped.runId}.json`));
    } catch { /* already gone */ }
  }
  writeIndex(trimmed);
  return stored;
}

export function reportSummary(report) {
  const criticals = report.issues.filter((i) => i.severity === 'critical').length;
  const highs = report.issues.filter((i) => i.severity === 'high').length;
  const mediums = report.issues.filter((i) => i.severity === 'medium').length;
  const lows = report.issues.filter((i) => i.severity === 'low').length;
  return {
    runId: report.runId,
    name: report.target.name,
    kind: report.target.kind,
    root: report.target.root,
    createdAt: report.createdAt,
    engineVersion: report.engineVersion,
    overall: report.scores.overall,
    grade: report.scores.grade.key,
    gradeLabel: report.scores.grade.label,
    tone: report.scores.grade.tone,
    coverage: report.coverage.weightedCoverage,
    detected: report.coverage.detectedCount,
    declared: report.coverage.declaredCount,
    strong: report.findings.filter((f) => f.status === 'strong').length,
    issueTotal: report.issues.length,
    critical: criticals,
    high: highs,
    medium: mediums,
    low: lows,
    riskCount: criticals + highs,
    suggestions: report.suggestions.length,
    files: report.metrics.totalFiles,
    codeLines: report.metrics.codeLines,
    durationMs: report.durationMs,
    status: criticals > 0 ? '严重' : highs > 0 ? '警告' : report.scores.overall >= 72 ? '就绪' : '需加固',
    topCategories: report.distribution.slice(0, 3).map((d) => d.label),
    capabilities: report.coverage.detectedIds,
  };
}

export function listSummaries() {
  return readIndex();
}

export function getReport(runId) {
  const safe = sanitizeId(runId);
  if (!safe) return null;
  const file = path.join(REPORT_DIR, `${safe}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function deleteReport(runId) {
  const safe = sanitizeId(runId);
  if (!safe) return false;
  const index = readIndex();
  const next = index.filter((r) => r.runId !== safe);
  if (next.length === index.length) return false;
  writeIndex(next);
  try {
    fs.unlinkSync(path.join(REPORT_DIR, `${safe}.json`));
  } catch { /* ignore */ }
  return true;
}

export function clearReports() {
  const index = readIndex();
  for (const r of index) {
    try {
      fs.unlinkSync(path.join(REPORT_DIR, `${r.runId}.json`));
    } catch { /* ignore */ }
  }
  writeIndex([]);
  return index.length;
}

function sanitizeId(runId) {
  const value = String(runId ?? '');
  return /^[A-Za-z0-9_\-]{4,64}$/.test(value) ? value : null;
}
