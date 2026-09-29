const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

export function sparkline(values, { color = '#2563eb', width = 96, height = 30 } = {}) {
  const data = (values ?? []).map(Number).filter((v) => Number.isFinite(v));
  if (data.length === 0) return `<svg class="spark" viewBox="0 0 ${width} ${height}"></svg>`;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 8)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const gid = `sg${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${data.length > 1 ? `<path d="${area}" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.4" fill="${color}"/>
  </svg>`;
}

export function lineChart(values, { labels = [], color = '#2563eb', height = 232, suffix = '', name = '数值' } = {}) {
  const data = (values ?? []).map(Number).filter((v) => Number.isFinite(v));
  if (data.length === 0) return emptyChart(height, '暂无数据，先完成一次诊断');
  const W = 760;
  const H = height;
  const pad = { l: 46, r: 18, t: 18, b: 30 };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const lo = Math.max(0, Math.floor((min - (max - min) * 0.35) / 5) * 5);
  const hi = Math.ceil((max + (max - min) * 0.25) / 5) * 5 || lo + 10;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i) => (data.length === 1 ? pad.l + innerW / 2 : pad.l + (i / (data.length - 1)) * innerW);
  const y = (v) => pad.t + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  const ticks = 4;
  const gridLines = [];
  const yLabels = [];
  for (let i = 0; i <= ticks; i += 1) {
    const value = lo + ((hi - lo) / ticks) * i;
    const py = y(value);
    gridLines.push(`<line x1="${pad.l}" y1="${py.toFixed(1)}" x2="${W - pad.r}" y2="${py.toFixed(1)}" stroke="#eef1f6" stroke-width="1"/>`);
    yLabels.push(`<text x="${pad.l - 10}" y="${(py + 4).toFixed(1)}" text-anchor="end" class="axis">${Math.round(value)}${suffix === '%' ? '%' : ''}</text>`);
  }

  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${pad.t + innerH} L${x(0).toFixed(1)} ${pad.t + innerH} Z`;
  const dots = data.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.6" fill="#fff" stroke="${color}" stroke-width="2"/>`).join('');
  const gid = `lg${Math.random().toString(36).slice(2, 8)}`;
  const labelStep = Math.max(1, Math.ceil(data.length / 7));
  const xLabels = data.map((_, i) => {
    const label = labels[i];
    if (!label) return '';
    const last = i === data.length - 1;
    if (!last && i % labelStep !== 0) return '';
    const anchor = last ? 'end' : i === 0 ? 'start' : 'middle';
    const px = last ? W - pad.r : i === 0 ? pad.l : x(i);
    return `<text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}" class="axis">${esc(label)}</text>`;
  }).join('');

  const tipData = data.map((v, i) => `${((x(i) / W) * 100).toFixed(3)}|${esc(labels[i] ?? `#${i + 1}`)}|${fmt(v)}${esc(suffix)}`).join(';');

  return `<div class="chart-wrap" data-tip="${esc(tipData)}" data-color="${color}" data-name="${esc(name)}" data-suffix="${esc(suffix)}">
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg" style="width:100%;height:${H}px">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".22"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${gridLines.join('')}${yLabels.join('')}${xLabels}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
      <line class="cursor" x1="0" y1="${pad.t}" x2="0" y2="${pad.t + innerH}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

export function donut(items, { size = 168, thickness = 26, centerValue = '', centerLabel = '' } = {}) {
  const list = (items ?? []).filter((i) => i.count > 0);
  const total = list.reduce((sum, i) => sum + i.count, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = list.length === 0
    ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#eef1f6" stroke-width="${thickness}"/>`
    : list.map((item) => {
      const len = (item.count / total) * circumference;
      const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${item.color}" stroke-width="${thickness}"
        stroke-dasharray="${len.toFixed(2)} ${(circumference - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${c} ${c})"><title>${esc(item.label)} ${item.count}</title></circle>`;
      offset += len;
      return seg;
    }).join('');

  return `<div class="donut">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f1f4f9" stroke-width="${thickness}"/>
      ${segments}
      <text x="${c}" y="${c - 2}" text-anchor="middle" class="donut-value">${esc(centerValue)}</text>
      <text x="${c}" y="${c + 16}" text-anchor="middle" class="donut-label">${esc(centerLabel)}</text>
    </svg>
  </div>`;
}

export function barList(items, { suffix = '' } = {}) {
  const max = Math.max(1, ...(items ?? []).map((i) => i.value));
  return `<div class="bars">${(items ?? []).map((item) => `
    <div class="bar-row">
      <span class="bar-name">${esc(item.label)}</span>
      <span class="bar-track"><i style="width:${((item.value / max) * 100).toFixed(1)}%;background:${item.color ?? '#2563eb'}"></i></span>
      <span class="bar-value">${fmt(item.value)}${esc(suffix)}</span>
    </div>`).join('')}</div>`;
}

export function gauge(score, { size = 132, label = '综合评分' } = {}) {
  const r = (size - 16) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const color = pct >= 72 ? '#10b981' : pct >= 58 ? '#2563eb' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return `<div class="gauge" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#eef1f6" stroke-width="12"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${((pct / 100) * circumference).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>
      <text x="${c}" y="${c + 4}" text-anchor="middle" class="gauge-value">${Math.round(pct)}</text>
      <text x="${c}" y="${c + 24}" text-anchor="middle" class="gauge-label">${esc(label)}</text>
    </svg>
  </div>`;
}

export function emptyChart(height = 200, text = '暂无数据') {
  return `<div class="empty-chart" style="height:${height}px"><span>${esc(text)}</span></div>`;
}

export function bindChartTips(root) {
  root.querySelectorAll('.chart-wrap').forEach((wrap) => {
    const svg = wrap.querySelector('svg');
    const tip = wrap.querySelector('.chart-tip');
    const cursor = wrap.querySelector('.cursor');
    const rows = (wrap.dataset.tip ?? '').split(';').filter(Boolean).map((entry) => {
      const [pct, label, value] = entry.split('|');
      return { pct: Number(pct), label, value };
    });
    if (!svg || !tip || rows.length === 0) return;
    const move = (event) => {
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      let nearest = rows[0];
      for (const row of rows) if (Math.abs(row.pct - ratio * 100) < Math.abs(nearest.pct - ratio * 100)) nearest = row;
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(nearest.label)}</b><span><i style="background:${wrap.dataset.color}"></i>${esc(wrap.dataset.name)} ${esc(nearest.value)}</span>`;
      const w = tip.offsetWidth || 150;
      tip.style.left = `${Math.max(4, Math.min(rect.width - w - 4, (nearest.pct / 100) * rect.width + 12))}px`;
      if (cursor) {
        cursor.setAttribute('x1', `${(nearest.pct / 100) * 760}`);
        cursor.setAttribute('x2', `${(nearest.pct / 100) * 760}`);
        cursor.setAttribute('opacity', '1');
      }
    };
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', () => {
      tip.hidden = true;
      if (cursor) cursor.setAttribute('opacity', '0');
    });
  });
}

export { esc };
