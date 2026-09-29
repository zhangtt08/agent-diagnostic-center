import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-data-'));
process.env.ARL_DATA_DIR = dataDir;

const { createServer } = await import('../server.js');
const { ensureSeedData } = await import('../src/seed.js');

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function get(pathname) {
  const res = await fetch(base + pathname);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

async function post(pathname, payload) {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('首次启动自动补齐示例基线数据', () => {
  const result = ensureSeedData();
  assert.ok(result.total >= 3, `应有至少 3 条种子记录，实际 ${result.total}`);
  assert.deepEqual(result.failures ?? [], []);
  const again = ensureSeedData();
  assert.equal(again.seeded, 0, '已有数据时不应重复写入');
});

test('GET /api/bootstrap 返回 5 张真实指标卡与趋势序列', async () => {
  const { status, body } = await get('/api/bootstrap');
  assert.equal(status, 200);
  assert.equal(body.kpis.cards.length, 5);
  const labels = body.kpis.cards.map((c) => c.label);
  assert.deepEqual(labels, ['综合诊断评分', '能力覆盖度', '识别专业功能', '高危问题数', '优化建议']);
  for (const card of body.kpis.cards) {
    assert.ok(card.value && card.value !== 'NaN', '卡片必须有真实数值');
    assert.ok(Array.isArray(card.series) && card.series.length >= 3, '迷你趋势图需要历史序列');
    assert.ok(card.series.every((v) => Number.isFinite(v)));
  }
  assert.ok(body.focus, '应返回焦点报告');
  assert.ok(body.focus.findings.length >= 30);
  assert.ok(body.focus.pipeline.length === 6);
  assert.ok(body.history.length >= 3);
});

test('GET / 返回完整前端外壳', async () => {
  const { status, body, headers } = await get('/');
  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /text\/html/);
  assert.ok(body.includes('Agent 诊断中心'));
  assert.ok(body.includes('/js/app.js'));
  assert.ok(body.includes('开始诊断'));
});

test('静态资源可访问且类型正确', async () => {
  for (const [file, pattern] of [['/css/app.css', /\.kpis/], ['/js/app.js', /renderPipeline/], ['/js/charts.js', /lineChart/], ['/js/icons.js', /ICONS/], ['/assets/icon.svg', /svg/], ['/manifest.webmanifest', null]]) {
    const { status, body, headers } = await get(file);
    assert.equal(status, 200, `${file} 应可访问`);
    assert.match(String(headers.get('content-type')), /text\/|image\/|application\/|manifest\+json/);
    if (pattern) assert.ok(pattern.test(String(body)), `${file} 内容异常`);
    else assert.equal(body.display, 'standalone', 'manifest 必须声明 standalone 才能作为桌面应用');
  }

  const css = String((await get('/css/app.css')).body);
  assert.ok(/\.modal, \.drawer \{[^}]*display: none/.test(css), '遮罩层必须默认 display:none，不能只依赖 hidden 属性');
  assert.ok(/\.modal\.open, \.drawer\.open \{ display: grid/.test(css), '遮罩层需通过 .open 类显式打开');
  const html = String((await get('/')).body);
  for (const id of ['modal', 'drawer', 'toast']) {
    assert.ok(new RegExp(`id="${id}"(?! hidden)`).test(html), `${id} 只能由类名控制可见性，否则 [hidden] 会压过 .open`);
  }
  assert.ok(!/id="modal"[^>]*class="[^"]*open/.test(html), '首屏 HTML 不应带着已打开的弹层');
});

test('未知路径与非法静态路径不会泄露文件', async () => {
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/nope.html')).status, 404);
  const traversal = await get('/../package.json');
  assert.ok([400, 404].includes(traversal.status), '目录穿越必须被拒绝');
});

test('POST /api/diagnose/path 分析真实目录并落盘', async () => {
  const before = (await get('/api/bootstrap')).body.history.length;
  const { status, body } = await post('/api/diagnose/path', { path: path.join(ROOT, 'samples', 'rag-copilot') });
  assert.equal(status, 200);
  assert.ok(body.report.scores.overall > 0);
  assert.match(body.report.runId, /^diag_\d{8}_\d{4}$/);
  assert.equal(body.summary.name, 'rag-copilot');
  const after = (await get('/api/bootstrap')).body.history.length;
  assert.equal(after, before + 1, '诊断结果必须写入历史');
});

test('POST /api/diagnose/upload 支持直接传入源码文本', async () => {
  const { status, body } = await post('/api/diagnose/upload', {
    name: '我的 Agent',
    files: [
      { path: 'agent.py', content: 'while True:\n    step += 1\n    r = run_tool(name, args)\n    messages.append(r)\n' },
      { path: 'README.md', content: '# demo\n使用 RAG 与 long-term memory\n' },
    ],
  });
  assert.equal(status, 200);
  assert.equal(body.summary.name, '我的 Agent');
  assert.ok(body.report.findings.find((f) => f.id === 'agent_loop').status !== 'absent');
  assert.ok(body.report.issues.some((i) => i.id === 'loop_without_budget'));
});

test('非法输入返回 400 与可读中文错误', async () => {
  const missing = await post('/api/diagnose/path', { path: 'Z:/definitely/not/here' });
  assert.equal(missing.status, 400);
  assert.ok(/路径不存在/.test(missing.body.error));

  const empty = await post('/api/diagnose/upload', { name: 'x', files: [] });
  assert.equal(empty.status, 400);
  assert.ok(/没有收到任何文件/.test(empty.body.error));

  const badRun = await get('/api/report?runId=../../etc/passwd');
  assert.equal(badRun.status, 404, '非法 runId 必须被拒绝而不是读取任意文件');
});

test('记录可读取、可删除，删除后焦点自动切换', async () => {
  const created = await post('/api/diagnose/sample', { key: 'production-orchestrator' });
  assert.equal(created.status, 200);
  const runId = created.body.summary.runId;

  const one = await get(`/api/report?runId=${runId}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.report.runId, runId);
  assert.ok(one.body.report.scores.dimensions.length === 8);

  const del = await fetch(`${base}/api/report?runId=${runId}`, { method: 'DELETE' });
  const delBody = await del.json();
  assert.equal(del.status, 200);
  assert.equal(delBody.ok, true);
  assert.ok(!delBody.history.some((r) => r.runId === runId), '删除后不应再出现在历史中');
  assert.equal((await get(`/api/report?runId=${runId}`)).status, 404);
});

test('清空历史只影响本机记录', async () => {
  const cleared = await post('/api/clear', {});
  assert.equal(cleared.status, 200);
  assert.ok(cleared.body.removed >= 1);
  assert.equal((await get('/api/bootstrap')).body.history.length, 0, '用户主动清空后不得再自动塞示例数据');
  assert.equal((await get('/api/bootstrap')).body.focus, null, '无记录时焦点为空');
  ensureSeedData({ force: true });
  assert.ok((await get('/api/bootstrap')).body.history.length >= 3);
});

test('全新安装首次请求即自动补齐基线数据（无需先跑启动脚本）', async () => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-fresh-'));
  const probeFile = path.join(ROOT, 'tests', '.first-run-probe.mjs');
  fs.writeFileSync(probeFile, `
import { createServer } from '../server.js';
const s = createServer();
await new Promise((r) => s.listen(0, '127.0.0.1', r));
const b = 'http://127.0.0.1:' + s.address().port;
const boot = await (await fetch(b + '/api/bootstrap')).json();
const second = await (await fetch(b + '/api/bootstrap')).json();
console.log(JSON.stringify({ records: boot.history.length, focus: boot.focus?.scores?.overall ?? null, again: second.history.length }));
s.closeAllConnections?.();
s.close(() => {});
`, 'utf8');
  try {
    const { spawnSync } = await import('node:child_process');
    const run = spawnSync(process.execPath, [probeFile], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ARL_DATA_DIR: freshDir },
      timeout: 30_000,
    });
    assert.equal(run.status, 0, `子进程失败：${run.stderr}`);
    const result = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(result.records, 3, '全新数据目录应自动分析 3 个内置示例');
    assert.equal(result.again, 3, '第二次请求不得重复写入');
    assert.ok(result.focus > 0);
    assert.ok(fs.existsSync(path.join(freshDir, '.initialized')), '必须落初始化标记');
  } finally {
    fs.rmSync(probeFile, { force: true });
    fs.rmSync(freshDir, { recursive: true, force: true });
  }
});

test('报告体积可控，避免前端卡顿', async () => {
  const { body } = await get('/api/bootstrap');
  const text = JSON.stringify(body);
  assert.ok(text.length < 900_000, `bootstrap 响应过大：${text.length}`);
  assert.ok(body.focus.findings.every((f) => f.evidence.length <= 5));
});
