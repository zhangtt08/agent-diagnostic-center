import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { analyzeDirectory, analyzeUploaded, analyzeFiles } from '../src/engine/index.js';
import { splitSource } from '../src/engine/languages.js';
import { isGeneratedArtifact } from '../src/engine/scanner.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const sample = (name) => path.join(ROOT, 'samples', name);

const statusOf = (report, id) => report.findings.find((f) => f.id === id)?.status;
const hasIssue = (report, id) => report.issues.some((i) => i.id === id);

test('识别 Loop / Memory / Tool 等核心专业能力', () => {
  const report = analyzeDirectory(sample('naive-react-agent'));
  assert.equal(statusOf(report, 'agent_loop'), 'strong');
  assert.equal(statusOf(report, 'short_term_memory'), 'strong');
  assert.ok(['strong', 'present'].includes(statusOf(report, 'tool_calling')), 'tool_calling 应被识别');
  const loop = report.findings.find((f) => f.id === 'agent_loop');
  assert.ok(loop.evidence.length > 0 && loop.evidence[0].line > 0, '证据必须带真实行号');
  assert.ok(loop.evidence.every((e) => e.snippet.length > 0));
});

test('识别 RAG / 向量检索 / 切分 / 上下文管理', () => {
  const report = analyzeDirectory(sample('rag-copilot'));
  assert.equal(statusOf(report, 'rag'), 'strong');
  assert.equal(statusOf(report, 'vector_store'), 'strong');
  assert.equal(statusOf(report, 'chunking'), 'strong');
  assert.equal(statusOf(report, 'context_management'), 'strong');
  assert.equal(statusOf(report, 'retry_resilience'), 'strong');
});

test('质量越高的工程得分越高', () => {
  const scores = ['naive-react-agent', 'rag-copilot', 'production-orchestrator']
    .map((name) => analyzeDirectory(sample(name)).scores.overall);
  assert.ok(scores[0] < scores[1], `naive(${scores[0]}) 应低于 rag(${scores[1]})`);
  assert.ok(scores[1] < scores[2], `rag(${scores[1]}) 应低于 production(${scores[2]})`);
  assert.ok(scores.every((s) => s >= 0 && s <= 100));
});

test('缺陷工程必须被检出对应高危问题', () => {
  const report = analyzeDirectory(sample('naive-react-agent'));
  assert.ok(hasIssue(report, 'loop_without_budget'), '无上限循环');
  assert.ok(hasIssue(report, 'unbounded_context'), '历史无裁剪');
  assert.ok(hasIssue(report, 'hardcoded_secret'), '硬编码密钥');
  assert.ok(hasIssue(report, 'exec_without_sandbox'), '无沙箱执行');
  assert.ok(hasIssue(report, 'swallowed_errors'), '吞异常');
  assert.ok(hasIssue(report, 'tool_without_timeout'), '工具无超时');
});

test('守卫存在时不得误报缺失', () => {
  const report = analyzeDirectory(sample('production-orchestrator'));
  assert.ok(!hasIssue(report, 'loop_without_budget'), '有 maxIterations 时不应报无预算');
  assert.ok(!hasIssue(report, 'tool_without_timeout'), '有超时保护时不应报无超时');
  assert.ok(!hasIssue(report, 'tool_without_schema'), '有 schema 校验时不应报无校验');
  assert.ok(!hasIssue(report, 'hardcoded_secret'), '没有明文密钥时不应报');
});

test('每条建议都必须可执行且带优先级', () => {
  const report = analyzeDirectory(sample('naive-react-agent'));
  assert.ok(report.suggestions.length > 5);
  for (const s of report.suggestions) {
    assert.ok(s.title && s.rationale && s.action, '建议需含标题/现状/动作');
    assert.ok(['high', 'medium', 'low'].includes(s.priority));
    assert.ok(s.expectedGain >= 0);
  }
  assert.ok(report.suggestions.some((s) => s.kind === 'fix'));
  assert.ok(report.suggestions.some((s) => s.kind === 'capability'));
});

test('注释内容不得被当成代码证据', () => {
  const js = splitSource('const a = 1; // max_iterations = 50\n/* memory store */', 'javascript');
  assert.ok(!js.code.includes('max_iterations'), '行注释应从代码中剥离');
  assert.ok(js.doc.includes('max_iterations'));
  assert.equal(js.code.split('\n').length, 2, '必须保留行号几何');

  const py = splitSource('x = 1\n# tool_calls 解析\n', 'python');
  assert.ok(!py.code.includes('tool_calls'));
  assert.ok(py.doc.includes('tool_calls'));
});

test('空 catch 判定基于原始文本而非剥离注释后的文本', () => {
  const onlyComment = [{ path: 'a.js', content: 'try { f(); } catch (e) {\n  // ignored on purpose\n}\n' }];
  const report = analyzeUploaded(onlyComment, { name: 'comment-only' });
  assert.ok(!report.issues.some((i) => i.id === 'swallowed_errors'), '注释不算吞异常');

  const trulyEmpty = [{ path: 'b.js', content: 'try { f(); } catch (e) {\n}\n' }];
  const report2 = analyzeUploaded(trulyEmpty, { name: 'empty-catch' });
  assert.ok(report2.issues.some((i) => i.id === 'swallowed_errors'));
});

test('lockfile 与构建产物不参与分析', () => {
  assert.ok(isGeneratedArtifact('package-lock.json'));
  assert.ok(isGeneratedArtifact('app.min.js'));
  assert.ok(isGeneratedArtifact('index.d.ts'));
  assert.ok(!isGeneratedArtifact('agent.py'));
  assert.ok(!isGeneratedArtifact('README.md'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-lock-'));
  fs.mkdirSync(path.join(dir, 'node_modules', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'foo', 'index.js'), 'const tool_calls = 1; const rag = 2; const retriever = 3;');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { a: { name: 'cache', resolved: 'https://fetch.example' } } }));
  fs.writeFileSync(path.join(dir, 'agent.js'), 'const history = []; history.push({role:"user"}); while (true) { step += 1 }');
  const report = analyzeDirectory(dir);
  assert.ok(!report.metrics.languages.some((l) => false));
  assert.ok(!report.findings.some((f) => f.evidence.some((e) => e.path === 'package-lock.json')), 'lockfile 不应出现在证据中');
  assert.ok(!report.findings.some((f) => f.evidence.some((e) => e.path.startsWith('node_modules/'))), 'node_modules 不应出现在证据中');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('上传入口与目录入口产出一致结构', () => {
  const files = fs.readdirSync(sample('naive-react-agent'))
    .filter((n) => /\.(py|md)$/.test(n))
    .map((n) => ({ path: n, content: fs.readFileSync(path.join(sample('naive-react-agent'), n), 'utf8') }));
  const uploaded = analyzeUploaded(files, { name: '上传测试' });
  const onDisk = analyzeDirectory(sample('naive-react-agent'));
  assert.equal(uploaded.findings.length, onDisk.findings.length);
  assert.equal(uploaded.scores.overall, onDisk.scores.overall);
  assert.equal(uploaded.target.kind, 'upload');
});

test('上传入口同样过滤 lockfile', () => {
  const report = analyzeUploaded([
    { path: 'agent.js', content: 'const history = []; history.push({ role: "user" }); while (true) { step += 1 }' },
    { path: 'package-lock.json', content: JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/cache': { resolved: 'https://fetch.example' }, 'node_modules/retriever': { integrity: 'sha512-rag' } } }) },
    { path: 'vendor/app.min.js', content: 'const embeddings=1;const rerank=2;const vectorStore=3;' },
  ], { name: '含 lock 的上传' });
  assert.equal(report.target.skipped.tooLarge, 2, '两个生成产物应被跳过');
  assert.ok(!report.findings.some((f) => f.evidence.some((e) => /package-lock|min\.js/.test(e.path))), '生成产物不得作为能力证据');
});

test('异常输入不崩溃', () => {
  const empty = analyzeFiles([], {});
  assert.equal(empty.metrics.totalFiles, 0);
  assert.equal(empty.findings.every((f) => f.status === 'absent'), true);
  assert.equal(typeof empty.scores.overall, 'number');

  const weird = analyzeUploaded([
    { path: 'a.bin', content: '\u0000\u0016\u0000binary' },
    { path: 'b.py', content: 'x = ' },
    { path: '', content: 'no path' },
    { path: 'c.json', content: '{ not json' },
    { path: 'd.unknownext', content: 'hello' },
  ], { name: '脏输入' });
  assert.ok(weird.metrics.totalFiles >= 0);
  assert.ok(Array.isArray(weird.suggestions));
});

test('每个问题与建议都能追溯到能力或规则', () => {
  const report = analyzeDirectory(sample('rag-copilot'));
  assert.ok(report.pipeline.length === 6);
  for (const stage of report.pipeline) {
    assert.ok(['ok', 'partial', 'declared', 'missing'].includes(stage.state), `未知阶段状态 ${stage.state}`);
  }
  for (const issue of report.issues) {
    assert.ok(issue.severity in { critical: 1, high: 1, medium: 1, low: 1 });
    assert.ok(issue.problem.length > 8 && issue.fix.length > 8);
  }
  assert.ok(report.distribution.reduce((s, d) => s + d.count, 0) === report.issues.length, '分布统计必须等于问题总数');
});
