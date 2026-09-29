import { icon } from './icons.js';
import { sparkline, lineChart, donut, barList, gauge, esc, fmt, bindChartTips, emptyChart } from './charts.js';

const NAV = [
  { id: 'overview', label: '总览', icon: 'grid' },
  { id: 'records', label: '诊断记录', icon: 'records' },
  { id: 'issues', label: '问题分析', icon: 'alert' },
  { id: 'trace', label: 'Trace', icon: 'trace' },
  { id: 'knowledge', label: '知识检索', icon: 'book' },
  { id: 'suggestions', label: '优化建议', icon: 'wrench' },
  { id: 'config', label: '配置', icon: 'gear' },
];

const TREND_TABS = [
  { key: 'overall', label: '综合评分', color: '#2563eb', suffix: '分', name: '综合评分' },
  { key: 'coverage', label: '能力覆盖度', color: '#7c3aed', suffix: '%', name: '能力覆盖度' },
  { key: 'riskCount', label: '高危问题', color: '#ef4444', suffix: '个', name: '高危问题数' },
  { key: 'detected', label: '识别能力', color: '#10b981', suffix: '项', name: '识别专业功能' },
];

const SEVERITY_LABEL = { critical: '严重', high: '高', medium: '中', low: '低' };
const SEVERITY_PILL = { critical: 'red', high: 'amber', medium: 'amber', low: 'blue' };
const STATUS_LABEL = { strong: '强证据', present: '已识别', declared: '仅文档提及', absent: '未发现' };
const STATUS_PILL = { strong: 'green', present: 'blue', declared: 'violet', absent: 'gray' };
const STATE_LABEL = { ok: '已具备', partial: '部分具备', declared: '仅声明', missing: '缺失' };

const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|kt|scala|php|rb|sh|bash|zsh|sql|json|jsonc|ya?ml|toml|ini|cfg|env|md|mdx|txt|rst|html|htm|xml|css|scss|less|proto|graphql|dockerfile|makefile)$/i;
const MAX_UPLOAD_BYTES = 1024 * 1024;
const MAX_UPLOAD_FILES = 900;

const state = {
  page: 'overview',
  bootstrap: null,
  focus: null,
  trendTab: 'overall',
  search: '',
  from: '',
  to: '',
  issueSeverity: 'all',
  issueCategory: 'all',
  capStatus: 'all',
  sugPriority: 'all',
  diagTab: 'path',
  uploadFiles: [],
  selectedSample: null,
  busy: false,
  error: '',
};

const el = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: `服务返回了非 JSON 响应（HTTP ${res.status}）` };
  }
  if (!res.ok) throw new Error(payload.error || `请求失败（HTTP ${res.status}）`);
  return payload;
}

function toast(message, kind = 'ok') {
  const node = el('toast');
  node.textContent = message;
  node.classList.toggle('err', kind === 'err');
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.classList.remove('show'); }, 2600);
}

function historyInRange() {
  const all = state.bootstrap?.history ?? [];
  return all.filter((r) => {
    const day = String(r.createdAt).slice(0, 10);
    if (state.from && day < state.from) return false;
    if (state.to && day > state.to) return false;
    return true;
  });
}

function matchesSearch(haystack) {
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  return String(haystack ?? '').toLowerCase().includes(q);
}

/* ============================ views ============================ */

function renderNav() {
  const focus = state.focus;
  const counts = {
    records: (state.bootstrap?.history ?? []).length,
    issues: focus ? focus.issues.length : 0,
    knowledge: focus ? focus.coverage.detectedCount : 0,
    suggestions: focus ? focus.suggestions.length : 0,
    trace: focus ? focus.pipeline.filter((s) => s.state === 'missing').length : 0,
  };
  el('nav').innerHTML = NAV.map((item) => `
    <a href="#${item.id}" class="${state.page === item.id ? 'active' : ''}" data-nav="${item.id}">
      ${icon(item.icon)}<span>${item.label}</span>
      ${counts[item.id] ? `<span class="count">${counts[item.id]}</span>` : ''}
    </a>`).join('');
}

function renderKpis() {
  const kpis = state.bootstrap?.kpis;
  if (!kpis || !kpis.cards || kpis.cards.length === 0) {
    return `<div class="kpis">${[0, 1, 2, 3, 4].map(() => '<div class="kpi card skeleton" style="height:104px"></div>').join('')}</div>`;
  }
  return `<div class="kpis">${kpis.cards.map((card) => {
    const delta = card.delta;
    const arrow = !delta || delta.value === 0 ? '→' : delta.value > 0 ? '↑' : '↓';
    const deltaClass = delta ? (delta.good === true ? 'up' : delta.good === false ? 'down' : 'flat') : 'flat';
    return `<div class="kpi card" data-action="kpi" data-key="${card.key}">
      <div class="kpi-top"><span class="kpi-icon tone-${card.tone}">${icon(card.icon === 'spark' ? 'spark' : card.icon)}</span><span class="kpi-label">${esc(card.label)}</span></div>
      <div class="kpi-value">${esc(card.value)}<small>${esc(card.unit)}</small></div>
      <div class="kpi-foot">
        ${delta ? `<span class="kpi-delta ${deltaClass}">${arrow} ${esc(fmt(Math.abs(delta.value)))}</span>` : '<span class="kpi-delta flat">— 首次诊断</span>'}
        <span class="kpi-hint">${esc(card.hint)}</span>
        <span class="kpi-spark">${sparkline(card.series, { color: sparkColor(card.tone) })}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function sparkColor(tone) {
  return { green: '#10b981', blue: '#2563eb', violet: '#7c3aed', amber: '#f59e0b', cyan: '#0891b2' }[tone] ?? '#2563eb';
}

function renderTrend() {
  const tab = TREND_TABS.find((t) => t.key === state.trendTab) ?? TREND_TABS[0];
  const rows = historyInRange().slice().reverse();
  const values = rows.map((r) => r[tab.key]);
  const days = rows.map((r) => String(r.createdAt).slice(0, 10));
  const repeated = new Set(days).size < days.length;
  const labels = rows.map((r, i) => (repeated ? `${days[i].slice(5)} ${String(r.createdAt).slice(11, 16)}` : days[i].slice(5)));
  return `<section class="card">
    <div class="card-head"><h3>诊断趋势</h3><span class="hint-i" title="每次诊断都会落盘一条记录，趋势按时间正序展示">i</span><span class="spacer"></span>
      <div class="seg">${TREND_TABS.map((t) => `<button data-action="trend" data-key="${t.key}" class="${t.key === state.trendTab ? 'active' : ''}">${t.label}</button>`).join('')}</div>
    </div>
    <div class="card-body">${values.length ? lineChart(values, { labels, color: tab.color, suffix: tab.suffix, name: tab.name }) : emptyChart(232, '所选时间范围内没有诊断记录')}</div>
  </section>`;
}

function renderDistribution() {
  const focus = state.focus;
  const items = focus ? focus.distribution : [];
  const total = items.reduce((sum, i) => sum + i.count, 0);
  return `<section class="card">
    <div class="card-head"><h3>问题类型分布</h3><span class="hint-i" title="按问题所属能力类别统计">i</span><span class="spacer"></span>
      <select class="mini" data-action="range-noop"><option>全部类别</option></select>
    </div>
    <div class="card-body">
      ${total === 0 ? emptyChart(200, '未发现问题，暂无分布') : `${donut(items, { centerValue: String(total), centerLabel: '问题总数' })}
      <div class="legend">${items.map((item) => `<div class="legend-row"><i style="background:${item.color}"></i><span>${esc(item.label)}</span><span class="n">${item.count}</span><span class="p">${item.percent}%</span></div>`).join('')}</div>`}
    </div>
  </section>`;
}

function renderPipeline(compactMode = false) {
  const focus = state.focus;
  if (!focus) return '';
  return `<section class="card">
    <div class="card-head"><h3>Agent 执行链路（静态还原）</h3><span class="hint-i" title="根据代码证据还原 Agent 的关键阶段，点击节点查看证据文件">i</span><span class="spacer"></span>
      <a class="link" data-action="nav" data-page="trace">查看完整 Trace ${icon('arrowRight')}</a>
    </div>
    <div class="card-body">
      <div class="pipeline">${focus.pipeline.map((stage, i) => `
        <div class="stage">
          <div class="stage-node state-${stage.state}" data-action="stage" data-key="${stage.key}">
            <div class="stage-row">
              <span class="stage-icon">${icon(stage.icon)}</span>
              <span style="min-width:0">
                <span class="stage-name">${esc(stage.label)}</span><br/>
                <span class="stage-sub">${esc(stage.sub)}</span>
              </span>
              <span class="stage-state ${stage.state === 'ok' ? 'tone-green' : stage.state === 'missing' ? 'tone-red' : stage.state === 'partial' ? 'tone-blue' : 'tone-violet'}">${icon(stage.state === 'ok' ? 'check' : stage.state === 'missing' ? 'close' : 'alert')}</span>
            </div>
            ${compactMode ? '' : `<div class="stage-meta">${stage.capabilities.map((c) => `<span class="stage-chip">${esc(c.label)}</span>`).join('') || '<span class="stage-chip">无证据</span>'}</div>`}
            ${stage.blockers.length ? `<div class="stage-blocker">${esc(stage.blockers[0].title)}</div>` : ''}
          </div>
          ${i < focus.pipeline.length - 1 ? `<span class="stage-arrow">${icon('arrow')}</span>` : ''}
        </div>`).join('')}</div>
    </div>
  </section>`;
}

function renderSuggestionsPanel() {
  const focus = state.focus;
  const items = focus ? focus.suggestions.slice(0, 4) : [];
  return `<section class="card">
    <div class="card-head">${icon('bulb')}<h3>优化建议</h3><span class="spacer"></span>
      <a class="link" data-action="nav" data-page="suggestions">查看全部 ${focus ? focus.suggestions.length : 0} 条 ${icon('arrowRight')}</a>
    </div>
    <div class="card-body">
      ${items.length === 0 ? emptyChart(160, '没有可执行的优化建议') : `<div class="sug-list">${items.map((s) => `
        <div class="sug" data-action="suggestion" data-id="${esc(s.id)}">
          <span class="sug-icon tone-${s.tone === 'red' ? 'red' : s.tone === 'amber' ? 'amber' : 'blue'}">${icon(s.kind === 'fix' ? 'wrench' : 'spark')}</span>
          <div class="sug-main">
            <div class="sug-title"><strong>${esc(s.title)}</strong><span class="pill ${s.tone}">${esc(s.priorityLabel)}</span></div>
            <div class="sug-text">${esc(s.rationale)}</div>
          </div>
          <span class="sug-arrow">${icon('arrowRight')}</span>
        </div>`).join('')}</div>`}
    </div>
  </section>`;
}

function renderRecentTable(limit = 6) {
  const rows = historyInRange().slice(0, limit);
  return `<section class="card">
    <div class="card-head"><h3>最近诊断记录</h3><span class="spacer"></span>
      <a class="link" data-action="nav" data-page="records">查看全部 ${icon('arrowRight')}</a>
    </div>
    ${rows.length === 0 ? '<div class="card-body">' + emptyChart(120, '还没有诊断记录，点击右上角「开始诊断」') + '</div>' : `
    <table class="table"><thead><tr><th>Run ID</th><th>工程</th><th>评分</th><th>能力</th><th>高危</th><th>文件数</th><th>状态</th><th>诊断时间</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-action="focus-run" data-id="${esc(r.runId)}">
      <td class="mono">${esc(r.runId)}</td>
      <td class="strong">${esc(r.name)}</td>
      <td><b>${r.overall}</b> <span class="muted">${esc(r.grade)}</span></td>
      <td>${r.detected}</td>
      <td>${r.riskCount ? `<span class="pill ${r.critical ? 'red' : 'amber'}">${r.riskCount}</span>` : '<span class="pill green">0</span>'}</td>
      <td>${r.files}</td>
      <td><span class="status-dot"><i style="background:${statusColor(r.status)}"></i>${esc(r.status)}</span></td>
      <td class="mono">${esc(String(r.createdAt).slice(0, 16).replace('T', ' '))}</td>
      <td><a class="link" data-action="focus-run" data-id="${esc(r.runId)}">查看</a></td>
    </tr>`).join('')}</tbody></table>`}
  </section>`;
}

function statusColor(status) {
  return { 严重: '#ef4444', 警告: '#f59e0b', 就绪: '#10b981', 需加固: '#2563eb' }[status] ?? '#94a3b8';
}

function viewOverview() {
  return `
    ${renderKpis()}
    <div class="grid-2">${renderTrend()}${renderDistribution()}</div>
    <div class="grid-2"><div class="stack">${renderPipeline(true)}${renderRecentTable()}</div>${renderSuggestionsPanel()}</div>`;
}

function viewRecords() {
  const rows = historyInRange().filter((r) => matchesSearch(`${r.runId} ${r.name} ${r.root} ${r.gradeLabel} ${r.topCategories.join(' ')}`));
  return `<section class="card">
    <div class="card-head"><h3>诊断记录</h3><span class="spacer"></span>
      <button class="ghost-btn" data-action="re-diagnose">${icon('refresh')} 重新诊断当前焦点</button>
      <button class="ghost-btn" data-action="clear-history">清空历史</button>
    </div>
    <div class="card-body" style="padding-bottom:0"><div class="stat-strip">
      <div class="stat"><b>${historyInRange().length}</b><span>记录总数（含筛选）</span></div>
      <div class="stat"><b>${rows.length}</b><span>匹配当前搜索</span></div>
      <div class="stat"><b>${rows.length ? Math.max(...rows.map((r) => r.overall)) : 0}</b><span>最高分</span></div>
      <div class="stat"><b>${rows.length ? Math.min(...rows.map((r) => r.overall)) : 0}</b><span>最低分</span></div>
      <div class="stat"><b>${rows.reduce((s, r) => s + r.riskCount, 0)}</b><span>累计高危问题</span></div>
    </div></div>
    ${rows.length === 0 ? '<div class="card-body">' + emptyChart(140, '没有匹配的诊断记录') + '</div>' : `
    <table class="table"><thead><tr><th>Run ID</th><th>工程</th><th>来源</th><th>评分</th><th>等级</th><th>覆盖度</th><th>能力</th><th>严重</th><th>高</th><th>中</th><th>低</th><th>文件</th><th>代码行</th><th>状态</th><th>时间</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-action="focus-run" data-id="${esc(r.runId)}" ${state.focus?.runId === r.runId ? 'style="background:#f7faff"' : ''}>
      <td class="mono">${esc(r.runId)}</td>
      <td class="strong">${esc(r.name)}</td>
      <td>${r.kind === 'upload' ? '上传' : '本地目录'}</td>
      <td><b>${r.overall}</b></td>
      <td><span class="pill ${r.tone === 'green' ? 'green' : r.tone === 'amber' ? 'amber' : 'red'}">${esc(r.grade)}</span></td>
      <td>${r.coverage}%</td>
      <td>${r.detected}</td>
      <td>${r.critical || '<span class="muted">0</span>'}</td>
      <td>${r.high || '<span class="muted">0</span>'}</td>
      <td>${r.medium || '<span class="muted">0</span>'}</td>
      <td>${r.low || '<span class="muted">0</span>'}</td>
      <td>${r.files}</td>
      <td>${r.codeLines}</td>
      <td><span class="status-dot"><i style="background:${statusColor(r.status)}"></i>${esc(r.status)}</span></td>
      <td class="mono">${esc(String(r.createdAt).slice(0, 16).replace('T', ' '))}</td>
      <td><a class="link" data-action="delete-run" data-id="${esc(r.runId)}">删除</a></td>
    </tr>`).join('')}</tbody></table>`}
  </section>`;
}

function viewIssues() {
  const focus = state.focus;
  if (!focus) return emptyCard('还没有诊断结果');
  const cats = [...new Set(focus.issues.map((i) => i.category))];
  const issues = focus.issues
    .filter((i) => state.issueSeverity === 'all' || i.severity === state.issueSeverity)
    .filter((i) => state.issueCategory === 'all' || i.category === state.issueCategory)
    .filter((i) => matchesSearch(`${i.title} ${i.problem} ${i.impact} ${i.fix} ${i.evidence.map((e) => e.path).join(' ')}`));
  return `<div class="grid-2">
    <section class="card">
      <div class="card-head"><h3>问题分析</h3><span class="spacer"></span>
        <div class="filters">
          ${['all', 'critical', 'high', 'medium', 'low'].map((s) => `<button class="chip ${state.issueSeverity === s ? 'active' : ''}" data-action="issue-sev" data-key="${s}">${s === 'all' ? '全部' : SEVERITY_LABEL[s]}${s !== 'all' ? ` ${focus.issues.filter((i) => i.severity === s).length}` : ''}</button>`).join('')}
        </div>
      </div>
      <div class="card-body">
        ${cats.length > 1 ? `<div class="filters" style="margin-bottom:10px">${['all', ...cats].map((c) => `<button class="chip ${state.issueCategory === c ? 'active' : ''}" data-action="issue-cat" data-key="${esc(c)}">${c === 'all' ? '全部类别' : esc(labelForCategory(focus, c))}</button>`).join('')}</div>` : ''}
        ${issues.length === 0 ? emptyChart(140, '当前筛选下没有问题') : `<div class="stack">${issues.map((i) => `
          <article class="issue sev-${i.severity}" data-action="issue" data-id="${esc(i.id)}">
            <div class="issue-head">
              <span class="pill ${SEVERITY_PILL[i.severity]}">${esc(i.severityLabel)}</span>
              <strong>${esc(i.title)}</strong>
              <span class="spacer"></span>
              <span class="muted" style="font-size:11.5px">${esc(labelForCategory(focus, i.category))} · ${i.evidence.length} 处证据</span>
            </div>
            <div class="issue-body">${esc(i.problem)}</div>
            ${i.evidence.length ? evidenceHtml(i.evidence.slice(0, 2)) : ''}
          </article>`).join('')}</div>`}
      </div>
    </section>
    <div class="stack">
      <section class="card">
        <div class="card-head"><h3>评分构成</h3></div>
        <div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          ${gauge(focus.scores.overall)}
          <div style="flex:1;min-width:180px">${barList(focus.scores.dimensions.map((d) => ({ label: d.label, value: d.score, color: d.score >= 72 ? '#10b981' : d.score >= 55 ? '#2563eb' : d.score >= 40 ? '#f59e0b' : '#ef4444' })), { suffix: '' })}</div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>结论</h3></div>
        <div class="card-body"><p style="margin:0;color:var(--text-2);font-size:12.5px">${esc(focus.scores.summary)}</p>
          <div class="section-title">问题最多的维度</div>
          <div class="legend">${focus.scores.dimensions.filter((d) => d.penalty > 0).sort((a, b) => b.penalty - a.penalty).slice(0, 4).map((d) => `<div class="legend-row"><i style="background:#ef4444"></i><span>${esc(d.label)}</span><span class="n">-${d.penalty}</span><span class="p">${d.issues.length} 项</span></div>`).join('') || '<span class="muted">无扣分维度</span>'}</div>
        </div>
      </section>
    </div>
  </div>`;
}

function labelForCategory(report, category) {
  return report.categories?.find((c) => c.key === category)?.label
    ?? report.findings?.find((f) => f.category === category)?.categoryLabel
    ?? (category === 'engineering' ? '工程质量' : '其他问题');
}

function viewTrace() {
  const focus = state.focus;
  if (!focus) return emptyCard('还没有诊断结果');
  return `<div class="stack">
    ${renderPipeline(false)}
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>阶段证据明细</h3></div>
        <div class="card-body"><div class="stack">${focus.pipeline.map((stage) => `
          <article class="issue ${stage.state === 'missing' ? 'sev-high' : 'sev-low'}" data-action="stage" data-key="${stage.key}">
            <div class="issue-head"><strong>${esc(stage.label)}</strong><span class="stage-sub">${esc(stage.sub)} · ${esc(stage.note)}</span>
              <span class="spacer"></span><span class="pill ${stage.state === 'ok' ? 'green' : stage.state === 'missing' ? 'red' : 'blue'}">${esc(STATE_LABEL[stage.state])}</span></div>
            <div class="issue-body">${stage.capabilities.length ? stage.capabilities.map((c) => `${esc(c.label)}（${esc(STATUS_LABEL[c.status])} ${c.confidence}%）`).join(' · ') : '该阶段未发现任何实现证据'}</div>
            ${evidenceHtml(stage.evidence.slice(0, 3))}
            ${stage.blockers.length ? `<div class="stage-blocker" style="margin-top:8px">阻塞项：${stage.blockers.map((b) => esc(b.title)).join('；')}</div>` : ''}
          </article>`).join('')}</div></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>能力密度最高的文件</h3></div>
        <div class="card-body">
          <table class="table" style="margin:-6px -6px 0"><thead><tr><th>文件</th><th>行数</th><th>能力</th></tr></thead><tbody>
            ${focus.fileIndex.slice(0, 14).map((f) => `<tr data-action="file" data-path="${esc(f.path)}">
              <td class="mono" style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.path)}</td>
              <td>${f.lines}</td>
              <td>${f.capabilities.length}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">无证据文件</td></tr>'}
          </tbody></table>
        </div>
      </section>
    </div>
  </div>`;
}

function viewKnowledge() {
  const focus = state.focus;
  if (!focus) return emptyCard('还没有诊断结果');
  const groups = new Map();
  for (const finding of focus.findings) {
    if (state.capStatus !== 'all' && finding.status !== state.capStatus) continue;
    if (!matchesSearch(`${finding.label} ${finding.en} ${finding.headline} ${finding.tags.join(' ')} ${finding.categoryLabel}`)) continue;
    const list = groups.get(finding.categoryLabel) ?? [];
    list.push(finding);
    groups.set(finding.categoryLabel, list);
  }
  return `<section class="card">
    <div class="card-head"><h3>专业能力识别 · ${focus.target.name}</h3><span class="spacer"></span>
      <div class="filters">${[['all', '全部'], ['strong', '强证据'], ['present', '已识别'], ['declared', '仅文档'], ['absent', '未发现']].map(([k, l]) => `<button class="chip ${state.capStatus === k ? 'active' : ''}" data-action="cap-status" data-key="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="card-body">
      <div class="stat-strip" style="margin-bottom:14px">
        <div class="stat"><b>${focus.coverage.detectedCount}</b><span>已识别能力</span></div>
        <div class="stat"><b>${focus.coverage.declaredCount}</b><span>仅文档提及</span></div>
        <div class="stat"><b>${focus.coverage.absentCount}</b><span>未发现</span></div>
        <div class="stat"><b>${focus.coverage.weightedCoverage}%</b><span>加权覆盖度</span></div>
        <div class="stat"><b>${focus.findings.length}</b><span>规则库能力项</span></div>
      </div>
      ${groups.size === 0 ? emptyChart(120, '当前筛选没有匹配的能力') : [...groups.entries()].map(([label, items]) => `
        <div class="section-title">${esc(label)} · ${items.length}</div>
        <div class="cap-grid" style="margin-bottom:14px">${items.map((f) => `
          <article class="cap" data-action="capability" data-id="${esc(f.id)}">
            <div class="cap-top"><span class="cap-name">${esc(f.label)}</span><span class="spacer"></span><span class="pill ${STATUS_PILL[f.status]}">${esc(STATUS_LABEL[f.status])}</span></div>
            <div class="cap-en">${esc(f.en)}</div>
            <div class="cap-desc">${esc(f.headline)}</div>
            <div class="cap-foot">
              <span class="cap-meter"><i style="width:${f.confidence}%;background:${f.status === 'absent' ? '#cbd5e1' : f.status === 'strong' ? '#10b981' : f.status === 'present' ? '#2563eb' : '#a78bfa'}"></i></span>
              <span class="cap-tag">${f.hits} 处证据</span>
            </div>
          </article>`).join('')}</div>`).join('')}
    </div>
  </section>`;
}

function viewSuggestions() {
  const focus = state.focus;
  if (!focus) return emptyCard('还没有诊断结果');
  const items = focus.suggestions
    .filter((s) => state.sugPriority === 'all' || s.priority === state.sugPriority)
    .filter((s) => matchesSearch(`${s.title} ${s.rationale} ${s.action} ${s.impact}`));
  const totalGain = items.reduce((sum, s) => sum + s.expectedGain, 0);
  return `<div class="grid-2">
    <section class="card">
      <div class="card-head"><h3>优化建议</h3><span class="spacer"></span>
        <div class="filters">${[['all', '全部'], ['high', '高优先级'], ['medium', '中优先级'], ['low', '低优先级']].map(([k, l]) => `<button class="chip ${state.sugPriority === k ? 'active' : ''}" data-action="sug-pri" data-key="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="card-body">
        ${items.length === 0 ? emptyChart(140, '当前筛选没有建议') : `<div class="sug-list">${items.map((s) => `
          <div class="sug" data-action="suggestion" data-id="${esc(s.id)}">
            <span class="sug-icon tone-${s.tone === 'red' ? 'red' : s.tone === 'amber' ? 'amber' : 'blue'}">${icon(s.kind === 'fix' ? 'wrench' : 'spark')}</span>
            <div class="sug-main">
              <div class="sug-title"><strong>${esc(s.title)}</strong><span class="pill ${s.tone}">${esc(s.priorityLabel)}</span>${s.kind === 'capability' ? '<span class="pill gray">能力补齐</span>' : ''}</div>
              <div class="sug-text">${esc(s.rationale)}</div>
              <div class="cap-foot"><span class="cap-tag">预计提升 ${s.expectedGain} 分</span><span class="cap-tag">${esc(labelForCategory(focus, s.category))}</span></div>
            </div>
            <span class="sug-arrow">${icon('arrowRight')}</span>
          </div>`).join('')}</div>`}
      </div>
    </section>
    <div class="stack">
      <section class="card"><div class="card-head"><h3>预期收益</h3></div><div class="card-body">
        <div class="stat-strip">
          <div class="stat"><b>${items.length}</b><span>建议条数</span></div>
          <div class="stat"><b>${Math.round(totalGain * 10) / 10}</b><span>累计可提分</span></div>
          <div class="stat"><b>${Math.min(100, focus.scores.overall + Math.round(totalGain))}</b><span>理论上限分</span></div>
        </div>
        <p class="muted" style="font-size:11.5px;margin-bottom:0">收益按"该维度扣分可回收 + 覆盖度提升"线性估算，实际取决于改法是否彻底。</p>
      </div></section>
      <section class="card"><div class="card-head"><h3>已具备的能力</h3></div><div class="card-body">
        ${focus.strengths.length === 0 ? '<span class="muted">暂无强证据能力</span>' : `<div class="legend">${focus.strengths.slice(0, 10).map((s) => `<div class="legend-row"><i style="background:#10b981"></i><span>${esc(s.label)}</span><span class="n">${s.confidence}</span><span class="p">${s.files} 文件</span></div>`).join('')}</div>`}
      </div></section>
    </div>
  </div>`;
}

function viewConfig() {
  const b = state.bootstrap;
  const focus = state.focus;
  return `<div class="grid-2">
    <div class="stack">
      <section class="card"><div class="card-head"><h3>引擎与数据</h3></div><div class="card-body"><dl class="kv">
        <dt>分析引擎</dt><dd>v${esc(b?.engine ?? '—')}（纯静态，不执行目标代码）</dd>
        <dt>能力规则库</dt><dd>${focus ? focus.findings.length : 30} 项专业能力 · 24 项风险检查</dd>
        <dt>评分维度</dt><dd>${focus ? focus.scores.dimensions.map((d) => esc(d.label)).join(' · ') : '—'}</dd>
        <dt>诊断记录</dt><dd>${(b?.history ?? []).length} 条（最多保留 120 条）</dd>
        <dt>服务地址</dt><dd class="mono">${esc(location.origin)}</dd>
      </dl></div></section>
      <section class="card"><div class="card-head"><h3>忽略规则</h3></div><div class="card-body">
        <p class="muted" style="margin-top:0">扫描时自动跳过以下目录与产物，避免噪声污染识别结果：</p>
        <div class="filters">${['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', 'venv', '.next', 'vendor', 'logs', 'data'].map((d) => `<span class="chip" style="cursor:default">${esc(d)}</span>`).join('')}</div>
        <p class="muted" style="margin-bottom:0">同时跳过 package-lock.json / *.min.js / *.d.ts / 二进制与超过 1MB 的文件。</p>
      </div></section>
    </div>
    <div class="stack">
      <section class="card"><div class="card-head"><h3>内置示例工程</h3></div><div class="card-body"><div class="samples">
        ${(b?.samples ?? []).map((s) => `<div class="sample" data-action="run-sample" data-key="${esc(s.key)}"><div><b>${esc(s.name)}</b><p>${esc(s.blurb)}</p></div><span class="sug-arrow">${icon('arrowRight')}</span></div>`).join('') || '<span class="muted">未找到示例目录</span>'}
      </div></div></section>
      <section class="card"><div class="card-head"><h3>危险操作</h3></div><div class="card-body">
        <div class="row"><button class="ghost-btn" data-action="clear-history">清空全部诊断历史</button><span class="muted">仅删除本机记录，不影响任何工程文件。</span></div>
      </div></section>
    </div>
  </div>`;
}

function emptyCard(text) {
  return `<section class="card"><div class="card-body">${emptyChart(200, text)}</div></section>`;
}

function evidenceHtml(items) {
  if (!items || items.length === 0) return '';
  return `<div class="evidence">${items.map((e) => `<div class="ev"><span class="loc">${esc(e.path)}:${e.line}</span><span class="snip">${esc(e.snippet)}</span><span class="tag">${esc(e.pattern ?? '')}</span></div>`).join('')}</div>`;
}

/* ============================ drawer ============================ */

function openDrawer(title, html) {
  el('drawer-title').textContent = title;
  el('drawer-body').innerHTML = html;
  el('drawer').classList.add('open');
  bindChartTips(el('drawer-body'));
}

function closeDrawer() {
  el('drawer').classList.remove('open');
}

function drawerCapability(id) {
  const focus = state.focus;
  const f = focus?.findings.find((x) => x.id === id);
  if (!f) return;
  const related = focus.suggestions.filter((s) => s.refs.includes(`capability:${id}`));
  openDrawer(f.label, `
    <div class="row"><span class="pill ${STATUS_PILL[f.status]}">${esc(STATUS_LABEL[f.status])} ${f.confidence}%</span><span class="pill gray">${esc(f.categoryLabel)}</span><span class="muted">${esc(f.en)}</span></div>
    <p style="color:var(--text-2)">${esc(f.headline)}</p>
    <div class="section-title">识别依据</div>
    <p style="color:var(--text-2);margin-top:0">${esc(f.detail)}</p>
    <div class="stat-strip">
      <div class="stat"><b>${f.hits}</b><span>命中次数</span></div>
      <div class="stat"><b>${f.files.length}</b><span>涉及文件</span></div>
      <div class="stat"><b>${f.patterns.length}</b><span>命中模式</span></div>
      <div class="stat"><b>${f.weight}</b><span>规则权重</span></div>
    </div>
    ${f.patterns.length ? `<div class="section-title">命中的模式</div><div class="filters">${f.patterns.map((p) => `<span class="chip" style="cursor:default">${esc(p)}</span>`).join('')}</div>` : ''}
    ${f.evidence.length ? `<div class="section-title">代码证据</div>${evidenceHtml(f.evidence)}` : ''}
    ${f.docEvidence.length ? `<div class="section-title">文档提及</div>${evidenceHtml(f.docEvidence)}` : ''}
    ${related.length ? `<div class="section-title">相关建议</div><div class="stack">${related.map((s) => `<article class="issue sev-${s.priority === 'high' ? 'high' : 'low'}"><div class="issue-head"><strong>${esc(s.title)}</strong><span class="spacer"></span><span class="pill ${s.tone}">${esc(s.priorityLabel)}</span></div><div class="issue-body">${esc(s.action)}</div></article>`).join('')}</div>` : ''}
  `);
}

function drawerIssue(id) {
  const focus = state.focus;
  const i = focus?.issues.find((x) => x.id === id);
  if (i) {
    openDrawer(i.title, `
      <div class="row"><span class="pill ${SEVERITY_PILL[i.severity]}">${esc(i.severityLabel)}风险</span><span class="pill gray">${esc(labelForCategory(focus, i.category))}</span></div>
      <div class="section-title">发现了什么</div><p style="margin-top:0">${esc(i.problem)}</p>
      <div class="section-title">为什么重要</div><p style="margin-top:0">${esc(i.impact)}</p>
      <div class="section-title">怎么改</div><p style="margin-top:0">${esc(i.fix)}</p>
      ${i.snippet ? `<pre class="code">${esc(i.snippet)}</pre>` : ''}
      ${i.evidence.length ? `<div class="section-title">证据位置</div>${evidenceHtml(i.evidence)}` : '<div class="section-title">证据位置</div><p class="muted">该问题为"缺失型"判断，无对应代码行。</p>'}
    `);
    return;
  }
  const s = focus?.suggestions.find((x) => x.id === id);
  if (s) drawerSuggestion(s.id);
}

function drawerSuggestion(id) {
  const focus = state.focus;
  const s = focus?.suggestions.find((x) => x.id === id);
  if (!s) return;
  const issue = s.refs.find((r) => r.startsWith('risk:'))?.slice(5);
  openDrawer(s.title, `
    <div class="row"><span class="pill ${s.tone}">${esc(s.priorityLabel)}</span><span class="pill gray">${esc(labelForCategory(focus, s.category))}</span><span class="pill blue">预计 +${s.expectedGain} 分</span>${s.kind === 'capability' ? '<span class="pill gray">能力补齐</span>' : '<span class="pill gray">缺陷修复</span>'}</div>
    <div class="section-title">现状</div><p style="margin-top:0">${esc(s.rationale)}</p>
    <div class="section-title">价值</div><p style="margin-top:0">${esc(s.impact)}</p>
    <div class="section-title">建议动作</div><p style="margin-top:0">${esc(s.action)}</p>
    ${s.snippet ? `<pre class="code">${esc(s.snippet)}</pre>` : ''}
    ${s.evidence.length ? `<div class="section-title">证据位置</div>${evidenceHtml(s.evidence)}` : ''}
    ${issue ? `<div class="modal-foot" style="border-top:0;padding:14px 0 0"><button class="ghost-btn" data-action="issue" data-id="${esc(issue)}">查看对应问题</button></div>` : ''}
  `);
}

function drawerStage(key) {
  const focus = state.focus;
  const stage = focus?.pipeline.find((s) => s.key === key);
  if (!stage) return;
  openDrawer(`${stage.label} · ${stage.sub}`, `
    <div class="row"><span class="pill ${stage.state === 'ok' ? 'green' : stage.state === 'missing' ? 'red' : 'blue'}">${esc(STATE_LABEL[stage.state])}</span><span class="muted">${esc(stage.note)}</span></div>
    <div class="section-title">关联能力</div>
    <div class="stack">${stage.capabilities.map((c) => {
    const f = focus.findings.find((x) => x.id === c.id);
    return `<article class="issue sev-low" data-action="capability" data-id="${esc(c.id)}">
        <div class="issue-head"><strong>${esc(c.label)}</strong><span class="spacer"></span><span class="pill ${STATUS_PILL[c.status]}">${esc(STATUS_LABEL[c.status])} ${c.confidence}%</span></div>
        <div class="issue-body">${esc(f?.headline ?? '')}</div>
      </article>`;
  }).join('') || '<span class="muted">该阶段没有识别到任何实现</span>'}</div>
    ${stage.evidence.length ? `<div class="section-title">代码证据</div>${evidenceHtml(stage.evidence)}` : ''}
    ${stage.blockers.length ? `<div class="section-title">阻塞项</div><div class="stack">${stage.blockers.map((b) => `<article class="issue sev-${b.severity}" data-action="issue" data-id="${esc(b.id)}"><div class="issue-head"><strong>${esc(b.title)}</strong><span class="spacer"></span><span class="pill ${SEVERITY_PILL[b.severity]}">${esc(b.severityLabel)}</span></div></article>`).join('')}</div>` : ''}
  `);
}

function drawerRun(id) {
  const summary = (state.bootstrap?.history ?? []).find((r) => r.runId === id);
  if (!summary) return;
  openDrawer(`诊断记录 ${summary.runId}`, `
    <dl class="kv">
      <dt>工程名称</dt><dd>${esc(summary.name)}</dd>
      <dt>来源</dt><dd>${summary.kind === 'upload' ? '上传内容' : '本地目录'}</dd>
      <dt>路径</dt><dd class="mono">${esc(summary.root)}</dd>
      <dt>诊断时间</dt><dd class="mono">${esc(String(summary.createdAt).slice(0, 19).replace('T', ' '))}</dd>
      <dt>综合评分</dt><dd>${summary.overall} 分 · ${esc(summary.gradeLabel)}</dd>
      <dt>能力覆盖度</dt><dd>${summary.coverage}%（${summary.detected} 项已识别 / ${summary.strong} 项强证据）</dd>
      <dt>问题</dt><dd>严重 ${summary.critical} · 高 ${summary.high} · 中 ${summary.medium} · 低 ${summary.low}</dd>
      <dt>规模</dt><dd>${summary.files} 个文件 / ${summary.codeLines} 行代码 / 耗时 ${summary.durationMs} ms</dd>
    </dl>
    <div class="section-title">识别到的专业能力</div>
    <div class="filters">${(summary.capabilities ?? []).map((c) => {
    const f = state.focus?.findings.find((x) => x.id === c);
    return `<span class="chip" style="cursor:default">${esc(f ? f.label : c)}</span>`;
  }).join('') || '<span class="muted">无</span>'}</div>
    <div class="modal-foot" style="border-top:0;padding:16px 0 0">
      <button class="primary-btn" data-action="focus-run" data-id="${esc(id)}">设为当前焦点</button>
      <button class="ghost-btn" data-action="delete-run" data-id="${esc(id)}">删除记录</button>
    </div>
  `);
}

function drawerFile(p) {
  const focus = state.focus;
  const entry = focus?.fileIndex.find((f) => f.path === p);
  if (!entry) return;
  openDrawer(entry.path, `
    <div class="row"><span class="pill gray">${esc(entry.language ?? '未知')}</span><span class="muted">${entry.lines} 行</span></div>
    <div class="section-title">该文件承载的能力</div>
    <div class="stack">${entry.capabilities.map((id) => {
    const f = focus.findings.find((x) => x.id === id);
    if (!f) return '';
    const evs = f.evidence.filter((e) => e.path === entry.path);
    return `<article class="issue sev-low" data-action="capability" data-id="${esc(id)}"><div class="issue-head"><strong>${esc(f.label)}</strong><span class="spacer"></span><span class="pill ${STATUS_PILL[f.status]}">${esc(STATUS_LABEL[f.status])}</span></div>${evidenceHtml(evs.slice(0, 3))}</article>`;
  }).join('')}</div>
  `);
}

/* ============================ render ============================ */

function render() {
  renderNav();
  const view = el('view');
  const pages = {
    overview: viewOverview,
    records: viewRecords,
    issues: viewIssues,
    trace: viewTrace,
    knowledge: viewKnowledge,
    suggestions: viewSuggestions,
    config: viewConfig,
  };
  view.innerHTML = (pages[state.page] ?? viewOverview)();
  bindChartTips(view);
  renderTopbar();
  el('foot-engine').textContent = `Agent 诊断中心 · 引擎 v${state.bootstrap?.engine ?? '—'} · 规则库 ${state.focus?.findings.length ?? 30} 项能力 / 24 项风险检查`;
}

function renderTopbar() {
  const history = state.bootstrap?.history ?? [];
  const select = el('env-select');
  const seen = new Set();
  const options = [];
  for (const r of history) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    options.push(r);
  }
  select.innerHTML = options.length === 0
    ? '<option value="">暂无诊断记录</option>'
    : options.map((r) => `<option value="${esc(r.runId)}" ${state.focus?.name === r.name ? 'selected' : ''}>${esc(r.name)} · ${r.overall}分</option>`).join('');
  const tone = state.focus ? (state.focus.scores.overall >= 72 ? '#10b981' : state.focus.scores.overall >= 55 ? '#f59e0b' : '#ef4444') : '#94a3b8';
  el('env-dot').style.background = tone;
  const risk = state.focus ? state.focus.issues.filter((i) => i.severity === 'critical' || i.severity === 'high').length : 0;
  el('bell-badge').textContent = String(risk);
  el('bell-badge').style.display = risk ? '' : 'none';
  el('user-name').textContent = state.focus ? state.focus.target.name.slice(0, 12) : '本机';
  el('avatar').textContent = (state.focus?.target.name ?? '本机').slice(0, 1).toUpperCase();
}

/* ============================ actions ============================ */

async function loadBootstrap(runId) {
  const query = runId ? `?run=${encodeURIComponent(runId)}` : '';
  const data = await api(`/api/bootstrap${query}`);
  state.bootstrap = data;
  state.focus = data.focus;
  if (data.history.length === 0) {
    state.focus = null;
  }
  render();
}

async function runDiagnose(payload) {
  state.busy = true;
  state.error = '';
  el('diag-busy').hidden = false;
  el('diag-run').disabled = true;
  el('diag-error').hidden = true;
  try {
    const data = await api(payload.url, { method: 'POST', body: JSON.stringify(payload.body) });
    state.bootstrap = { ...state.bootstrap, history: data.history, kpis: data.kpis, samples: state.bootstrap?.samples ?? [] };
    state.focus = data.report;
    state.page = 'overview';
    location.hash = '#overview';
    closeModal();
    render();
    toast(`诊断完成：${data.summary.name} · ${data.summary.overall} 分（${data.summary.grade}）`);
  } catch (err) {
    state.error = err.message;
    el('diag-error').textContent = err.message;
    el('diag-error').hidden = false;
  } finally {
    state.busy = false;
    el('diag-busy').hidden = true;
    el('diag-run').disabled = false;
  }
}

function openModal() {
  el('modal').classList.add('open');
  switchTab(state.diagTab);
  renderSamples();
  renderQuickPaths();
  setTimeout(() => el('path-input')?.focus(), 30);
}

function closeModal() {
  el('modal').classList.remove('open');
}

function switchTab(tab) {
  state.diagTab = tab;
  document.querySelectorAll('#diag-tabs .tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === tab));
  document.querySelectorAll('.modal-body section').forEach((node) => { node.hidden = node.dataset.pane !== tab; });
  el('diag-run').textContent = tab === 'upload' ? `开始诊断${state.uploadFiles.length ? `（${state.uploadFiles.length} 个文件）` : ''}` : '开始诊断';
}

function renderSamples() {
  const host = el('sample-list');
  host.innerHTML = (state.bootstrap?.samples ?? []).map((s) => `
    <div class="sample ${state.selectedSample === s.key ? 'selected' : ''}" data-sample="${esc(s.key)}"><div><b>${esc(s.name)}</b><p>${esc(s.blurb)}</p></div></div>`).join('')
    || '<span class="muted">未找到内置示例目录</span>';
  host.querySelectorAll('.sample').forEach((node) => node.addEventListener('click', () => {
    state.selectedSample = node.dataset.sample;
    renderSamples();
  }));
}

function renderQuickPaths() {
  const host = el('quick-paths');
  const known = [
    ...(state.bootstrap?.samples ?? []).map((s) => s.dir),
    ...(state.bootstrap?.history ?? []).slice(0, 3).map((r) => r.root).filter((r) => r && !r.startsWith('(')),
  ];
  const unique = [...new Map(known.map((p) => [p, p])).values()];
  host.innerHTML = unique.slice(0, 5).map((p) => `<button data-quick="${esc(p)}">${esc(p)}</button>`).join('');
  host.querySelectorAll('button').forEach((node) => node.addEventListener('click', () => {
    el('path-input').value = node.dataset.quick;
  }));
}

function readFileEntries(fileList) {
  const files = [...fileList]
    .filter((f) => f.size <= MAX_UPLOAD_BYTES)
    .filter((f) => TEXT_EXT.test(f.name) || (f.type ?? '').startsWith('text/') || /\.(dockerfile|makefile|procfile)$/i.test(f.name))
    .slice(0, MAX_UPLOAD_FILES);
  el('upload-count').textContent = `已选择 ${files.length} 个文件${files.length < fileList.length ? `（跳过 ${fileList.length - files.length} 个过大或二进制文件）` : ''}`;
  el('filelist').innerHTML = files.slice(0, 60).map((f) => `<li>${esc(f.webkitRelativePath || f.path || f.name)} · ${(f.size / 1024).toFixed(1)} KB</li>`).join('');
  return Promise.all(files.map((f) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ path: f.webkitRelativePath || f.path || f.name, content: String(reader.result ?? '') });
    reader.onerror = () => resolve(null);
    reader.readAsText(f);
  }))).then((entries) => entries.filter(Boolean));
}

async function submitDiagnose() {
  if (state.diagTab === 'path') {
    const value = el('path-input').value.trim().replace(/^"|"$/g, '');
    if (!value) {
      state.error = '请输入要诊断的目录路径';
      el('diag-error').textContent = state.error;
      el('diag-error').hidden = false;
      return;
    }
    await runDiagnose({ url: '/api/diagnose/path', body: { path: value } });
    return;
  }
  if (state.diagTab === 'upload') {
    if (state.uploadFiles.length === 0) {
      el('diag-error').textContent = '请先选择要上传的文件';
      el('diag-error').hidden = false;
      return;
    }
    const name = el('path-input').value.trim() || `上传工程 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    await runDiagnose({ url: '/api/diagnose/upload', body: { name, files: state.uploadFiles } });
    return;
  }
  if (!state.selectedSample) {
    el('diag-error').textContent = '请选择一个示例工程';
    el('diag-error').hidden = false;
    return;
  }
  await runDiagnose({ url: '/api/diagnose/sample', body: { key: state.selectedSample } });
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    event.preventDefault();
    location.hash = `#${nav.dataset.nav}`;
    return;
  }
  if (event.target.matches('[data-close]')) {
    closeModal();
    return;
  }
  if (event.target.matches('[data-drawer-close]')) {
    closeDrawer();
    return;
  }
  const tab = event.target.closest('#diag-tabs .tab');
  if (tab) {
    switchTab(tab.dataset.tab);
    return;
  }
  const node = event.target.closest('[data-action]');
  if (!node) return;
  const { action, id, key, path } = node.dataset;

  const handlers = {
    trend: () => { state.trendTab = key; render(); },
    nav: () => { location.hash = `#${node.dataset.page}`; },
    kpi: () => {
      const map = { overall: 'issues', coverage: 'knowledge', detected: 'knowledge', riskCount: 'issues', suggestions: 'suggestions' };
      state.page = map[key] ?? 'overview';
      location.hash = `#${state.page}`;
    },
    capability: () => drawerCapability(id),
    issue: () => drawerIssue(id),
    suggestion: () => drawerSuggestion(id),
    stage: () => drawerStage(key),
    file: () => drawerFile(path),
    'focus-run': async () => {
      await loadBootstrap(id);
      closeDrawer();
      toast(`已切换到 ${state.focus?.target.name ?? id}`);
    },
    'delete-run': async (stop) => {
      if (!window.confirm(`删除诊断记录 ${id}？`)) return;
      const data = await api(`/api/report?runId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.bootstrap = { ...state.bootstrap, history: data.history };
      if (state.focus?.runId === id) {
        const next = data.history[0];
        if (next) {
          await loadBootstrap(next.runId);
        } else {
          state.focus = null;
          render();
        }
      } else {
        render();
      }
      closeDrawer();
      toast('记录已删除');
    },
    're-diagnose': async () => {
      if (!state.focus) return;
      if (state.focus.target.kind === 'directory') {
        await runDiagnose({ url: '/api/diagnose/path', body: { path: state.focus.target.root } });
      } else {
        toast('上传记录请直接重新上传文件', 'err');
      }
    },
    'clear-history': async () => {
      if (!window.confirm('确认清空全部诊断历史？该操作只删除本机记录。')) return;
      await api('/api/clear', { method: 'POST' });
      state.focus = null;
      await loadBootstrap();
      toast('历史已清空');
    },
    'run-sample': async () => { await runDiagnose({ url: '/api/diagnose/sample', body: { key: id } }); },
    'issue-sev': () => { state.issueSeverity = key; render(); },
    'issue-cat': () => { state.issueCategory = key; render(); },
    'cap-status': () => { state.capStatus = key; render(); },
    'sug-pri': () => { state.sugPriority = key; render(); },
    'range-noop': () => {},
  };
  await handlers[action]?.();
});

el('start-btn').addEventListener('click', openModal);
el('diag-run').addEventListener('click', () => { submitDiagnose().catch((err) => toast(err.message, 'err')); });
el('bell-btn').addEventListener('click', () => { location.hash = '#issues'; });
el('promo-icon').parentElement.addEventListener('click', () => { location.hash = '#knowledge'; });
el('env-select').addEventListener('change', (event) => { loadBootstrap(event.target.value).catch((err) => toast(err.message, 'err')); });
el('global-search').addEventListener('input', (event) => {
  state.search = event.target.value;
  if (state.page === 'overview') state.page = 'knowledge';
  render();
});
el('date-from').addEventListener('change', (event) => { state.from = event.target.value; render(); });
el('date-to').addEventListener('change', (event) => { state.to = event.target.value; render(); });

el('pick-files').addEventListener('click', () => el('file-input').click());
el('file-input').addEventListener('change', async (event) => {
  state.uploadFiles = await readFileEntries(event.target.files);
  switchTab('upload');
});
el('pick-dir').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = true;
  input.onchange = async () => {
    state.uploadFiles = await readFileEntries(input.files);
    switchTab('upload');
  };
  input.click();
});
const drop = el('drop');
drop.addEventListener('click', () => el('file-input').click());
drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  state.uploadFiles = await readFileEntries(event.dataTransfer.files);
  switchTab('upload');
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    el('global-search').focus();
    el('global-search').select();
  }
  if (event.key === 'Escape') {
    if (el('drawer').classList.contains('open')) closeDrawer();
    else if (el('modal').classList.contains('open')) closeModal();
  }
});

window.addEventListener('hashchange', () => {
  const page = location.hash.replace('#', '') || 'overview';
  state.page = NAV.some((n) => n.id === page) ? page : 'overview';
  render();
});

el('brand-mark').innerHTML = `<svg viewBox="0 0 32 32" width="26" height="26"><defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><path d="M16 3l13 24H3z" fill="url(#bm)"/><path d="M16 11l7 13H9z" fill="#fff" opacity=".9"/></svg>`;
el('promo-icon').innerHTML = icon('spark');
el('promo-arrow').innerHTML = icon('arrowRight');
el('search-icon').parentElement.firstElementChild.innerHTML = icon('search');
el('cal-icon').innerHTML = icon('cal');
el('bell-icon').innerHTML = icon('bell');
el('start-icon').innerHTML = icon('play');

state.page = NAV.some((n) => n.id === location.hash.replace('#', '')) ? location.hash.replace('#', '') : 'overview';

loadBootstrap().catch((err) => {
  el('view').innerHTML = `<section class="card"><div class="card-body"><h3>初始化失败</h3><p class="muted">${esc(err.message)}</p></div></section>`;
});
