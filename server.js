import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDirectory, analyzeUploaded, ENGINE_VERSION } from './src/engine/index.js';
import { saveReport, listSummaries, getReport, deleteReport, clearReports, reportSummary } from './src/store.js';
import { listSamples, SAMPLE_ROOT } from './src/samples.js';
import { ensureSeedData } from './src/seed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, 'web');
const ASSET_VER = String(Date.now());
const MAX_BODY = 24 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { 'content-length': buf.length, 'cache-control': 'no-store', ...headers });
  res.end(buf);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'content-type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体超过 24MB 上限'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function diagnoseDirectory(dirPath, name) {
  const resolved = path.resolve(String(dirPath));
  if (!fs.existsSync(resolved)) {
    throw Object.assign(new Error(`路径不存在：${resolved}`), { status: 400 });
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw Object.assign(new Error('请选择一个文件夹（或单个源码文件所在的目录）'), { status: 400 });
  }
  const report = analyzeDirectory(resolved, { name: name || undefined });
  if (report.metrics.totalFiles === 0) {
    throw Object.assign(new Error('该目录下没有找到可分析的文件'), { status: 400 });
  }
  return saveReport(report);
}

function buildKpis(summaries) {
  const chronological = [...summaries].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const latest = chronological[chronological.length - 1];
  const prev = chronological[chronological.length - 2];
  const series = {
    overall: chronological.map((r) => r.overall),
    coverage: chronological.map((r) => r.coverage),
    detected: chronological.map((r) => r.detected),
    riskCount: chronological.map((r) => r.riskCount),
    suggestions: chronological.map((r) => r.suggestions),
    runIds: chronological.map((r) => r.runId),
    createdAt: chronological.map((r) => r.createdAt),
  };
  if (!latest) return { cards: [], series: null, latest: null };
  const delta = (key, invert = false) => {
    if (!prev) return null;
    const diff = round(latest[key] - prev[key], 1);
    return { value: diff, good: diff === 0 ? null : invert ? diff < 0 : diff > 0 };
  };
  const cards = [
    { key: 'overall', label: '综合诊断评分', value: `${latest.overall}`, unit: '分', hint: latest.gradeLabel, icon: 'gauge', tone: 'green', series: series.overall, delta: delta('overall') },
    { key: 'coverage', label: '能力覆盖度', value: `${latest.coverage}`, unit: '%', hint: '按权重计算', icon: 'layers', tone: 'blue', series: series.coverage, delta: delta('coverage') },
    { key: 'detected', label: '识别专业功能', value: `${latest.detected}`, unit: '项', hint: `共 ${latest.strong} 项强证据`, icon: 'spark', tone: 'violet', series: series.detected, delta: delta('detected') },
    { key: 'riskCount', label: '高危问题数', value: `${latest.riskCount}`, unit: '个', hint: `严重 ${latest.critical} · 高 ${latest.high}`, icon: 'alert', tone: 'amber', series: series.riskCount, delta: delta('riskCount', true) },
    { key: 'suggestions', label: '优化建议', value: `${latest.suggestions}`, unit: '条', hint: '含证据与改法', icon: 'book', tone: 'cyan', series: series.suggestions, delta: delta('suggestions', true) },
  ];
  return { cards, series, latest };
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    try {
      const method = req.method === 'HEAD' ? 'GET' : req.method;

      if (method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { ok: true, engine: ENGINE_VERSION, samples: listSamples().length, sampleRoot: SAMPLE_ROOT, records: listSummaries().length, time: new Date().toISOString() });
      }

      if (method === 'GET' && pathname === '/api/bootstrap') {
        ensureSeedData();
        const summaries = listSummaries();
        const focusId = url.searchParams.get('run') || summaries[0]?.runId || null;
        const focus = focusId ? getReport(focusId) : null;
        return json(res, 200, {
          kpis: buildKpis(summaries),
          history: summaries,
          focus: focus ? stripHeavy(focus) : null,
          focusId,
          samples: listSamples(),
          engine: ENGINE_VERSION,
        });
      }

      if (method === 'GET' && pathname === '/api/reports') {
        return json(res, 200, { items: listSummaries() });
      }

      if (method === 'GET' && pathname === '/api/report') {
        const id = url.searchParams.get('runId');
        const report = id ? getReport(id) : null;
        if (!report) return json(res, 404, { error: '未找到该诊断记录' });
        return json(res, 200, { report: stripHeavy(report), summary: reportSummary(report) });
      }

      if (method === 'GET' && pathname === '/api/report-full') {
        const id = url.searchParams.get('runId');
        const report = id ? getReport(id) : null;
        if (!report) return json(res, 404, { error: '未找到该诊断记录' });
        return json(res, 200, { report });
      }

      if (method === 'DELETE' && pathname === '/api/report') {
        const id = url.searchParams.get('runId');
        const ok = id ? deleteReport(id) : false;
        return json(res, ok ? 200 : 404, { ok, history: listSummaries() });
      }

      if (method === 'POST' && pathname === '/api/clear') {
        const removed = clearReports();
        return json(res, 200, { ok: true, removed, history: [] });
      }

      if (method === 'POST' && pathname === '/api/diagnose/path') {
        const body = await readBody(req);
        const report = diagnoseDirectory(body.path, body.name);
        return json(res, 200, { report: stripHeavy(report), summary: reportSummary(report), history: listSummaries(), kpis: buildKpis(listSummaries()) });
      }

      if (method === 'POST' && pathname === '/api/diagnose/upload') {
        const body = await readBody(req);
        const files = Array.isArray(body.files) ? body.files : [];
        if (files.length === 0) return json(res, 400, { error: '没有收到任何文件' });
        const report = analyzeUploaded(files, { name: body.name || '上传的 Agent 工程' });
        if (report.metrics.totalFiles === 0) return json(res, 400, { error: '上传的文件无法解析' });
        const saved = saveReport(report);
        return json(res, 200, { report: stripHeavy(saved), summary: reportSummary(saved), history: listSummaries(), kpis: buildKpis(listSummaries()) });
      }

      if (method === 'POST' && pathname === '/api/diagnose/sample') {
        const body = await readBody(req);
        const sample = listSamples().find((s) => s.key === body.key);
        if (!sample) return json(res, 404, { error: '未找到该示例工程' });
        const report = saveReport(analyzeDirectory(sample.dir, { name: sample.name }));
        return json(res, 200, { report: stripHeavy(report), summary: reportSummary(report), history: listSummaries(), kpis: buildKpis(listSummaries()) });
      }

      return json(res, 404, { error: '接口不存在' });
    } catch (err) {
      return json(res, err.status ?? 500, { error: err.message || '服务器内部错误' });
    }
  }

  if (method_static(req, res, pathname)) return undefined;
  return send(res, 404, notFoundPage(), { 'content-type': 'text/html; charset=utf-8' });
}

function stripHeavy(report) {
  return {
    ...report,
    dictionary: undefined,
    categories: undefined,
    findings: (report.findings ?? []).map((f) => ({
      ...f,
      evidence: f.evidence.slice(0, 5),
      docEvidence: f.docEvidence.slice(0, 2),
    })),
  };
}

function method_static(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.endsWith('/')) rel += 'index.html';
  const target = path.join(WEB_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(WEB_DIR)) return false;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  const ext = path.extname(target).toLowerCase();
  let body = fs.readFileSync(target);
  if (ext === '.html') body = Buffer.from(body.toString('utf8').split('__ASSET_VER__').join(ASSET_VER));
  send(res, 200, body, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  return true;
}

function notFoundPage() {
  return '<!doctype html><meta charset="utf-8"><title>404</title><body style="font:14px system-ui;padding:40px">页面不存在。<a href="/">返回诊断中心</a>';
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      try {
        json(res, 500, { error: err.message || '未知错误' });
      } catch { /* socket already closed */ }
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { findFreePort } = await import('./src/net.js');
  const preferred = Number(process.env.PORT || 4173);
  const port = process.env.PORT ? preferred : await findFreePort(preferred);
  const server = createServer();
  server.on('error', (err) => {
    console.error('[诊断中心] 启动失败：', err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const seed = ensureSeedData();
    console.log(`Agent 诊断中心已启动： http://127.0.0.1:${port}/  (engine ${ENGINE_VERSION})`);
    if (seed.seeded) console.log(`首次启动：已分析 ${seed.seeded} 个内置示例工程生成基线数据。`);
  });
}
