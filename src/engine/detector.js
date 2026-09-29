import { CAPABILITIES, CATEGORIES } from './capabilities.js';

const MAX_EVIDENCE_PER_CAP = 8;
const MAX_HITS_PER_PATTERN = 40;

function isProbablyMinified(file) {
  if (file.lineCount < 5) return file.bytes > 20000;
  return file.bytes / file.lineCount > 400;
}

function snippetAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end).trim().slice(0, 200);
}

function collect(text, regex, file, bucket, seen) {
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  let m;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex += 1;
    n += 1;
    if (n > MAX_HITS_PER_PATTERN) break;
    const line = text.slice(0, m.index).split('\n').length;
    const key = `${file.path}:${line}:${m[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.push({
      path: file.path,
      line,
      pattern: regex.label,
      match: String(m[0]).slice(0, 80),
      snippet: snippetAt(text, m.index),
    });
  }
  return n;
}

export function detectCapabilities(sources) {
  const codeFiles = sources.filter(
    (f) => (f.family === 'code' || f.family === 'config' || f.family === 'markup') && !isProbablyMinified(f),
  );
  const docFiles = sources.filter((f) => f.family === 'doc');

  return CAPABILITIES.map((cap) => {
    const evidence = [];
    const seen = new Set();
    const patternsHit = new Set();
    const filesHit = new Set();

    for (const file of codeFiles) {
      const text = file.code || '';
      if (!text) continue;
      for (const regex of cap.patterns) {
        const before = evidence.length;
        collect(text, regex, file, evidence, seen);
        if (evidence.length > before) {
          patternsHit.add(regex.label);
          filesHit.add(file.path);
        }
      }
    }
    evidence.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

    const docEvidence = [];
    const docSeen = new Set();
    for (const file of docFiles) {
      for (const regex of cap.docPatterns ?? []) {
        collect(file.content, regex, file, docEvidence, docSeen);
      }
    }

    const distinctPatterns = patternsHit.size;
    const distinctFiles = filesHit.size;
    const totalHits = evidence.length;

    let status;
    let confidence;
    if (distinctPatterns >= 2 && (totalHits >= 3 || distinctFiles >= 2)) {
      status = 'strong';
      confidence = Math.min(98, 64 + distinctPatterns * 7 + Math.min(distinctFiles, 6) * 3);
    } else if (distinctPatterns >= 1 && totalHits >= 1) {
      status = 'present';
      confidence = Math.min(74, 44 + distinctPatterns * 10 + Math.min(totalHits, 8) * 3);
    } else if (docEvidence.length > 0) {
      status = 'declared';
      confidence = 24;
    } else {
      status = 'absent';
      confidence = 0;
    }

    return {
      id: cap.id,
      label: cap.label,
      en: cap.en,
      category: cap.category,
      categoryLabel: CATEGORIES[cap.category].label,
      dimension: cap.dimension,
      weight: cap.weight,
      headline: cap.headline,
      detail: cap.detail,
      tags: cap.tags,
      status,
      confidence,
      hits: totalHits + docEvidence.length,
      patterns: [...patternsHit],
      files: [...filesHit],
      evidence: evidence.slice(0, MAX_EVIDENCE_PER_CAP),
      docEvidence: docEvidence.slice(0, 3),
    };
  });
}

export function buildContext(findings, sources, metrics) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const codeBlobs = sources
    .filter((f) => f.family !== 'doc')
    .map((f) => ({ path: f.path, text: f.code || '' }));
  const hitCache = new Map();

  function regexHits(pattern) {
    const key = `${pattern.source}::${pattern.flags}`;
    if (hitCache.has(key)) return hitCache.get(key);
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    const hits = [];
    for (const blob of codeBlobs) {
      if (!blob.text) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(blob.text)) !== null) {
        if (m.index === re.lastIndex) re.lastIndex += 1;
        const line = blob.text.slice(0, m.index).split('\n').length;
        hits.push({ path: blob.path, line, match: m[0].slice(0, 60), snippet: snippetAt(blob.text, m.index), pattern: '守卫检查', regex: pattern.source });
        if (hits.length >= 60) break;
      }
      if (hits.length >= 60) break;
    }
    hitCache.set(key, hits);
    return hits;
  }

  const ctx = {
    sources,
    metrics,
    findings,
    byId,
    has(id) {
      const f = byId.get(id);
      return !!f && (f.status === 'strong' || f.status === 'present');
    },
    declared(id) {
      const f = byId.get(id);
      return !!f && f.status !== 'absent';
    },
    regex(pattern) {
      return regexHits(pattern);
    },
    hit(pattern) {
      return regexHits(pattern).length > 0;
    },
    evidenceOf(id, limit = 4) {
      const f = byId.get(id);
      if (!f) return [];
      return f.evidence.slice(0, limit);
    },
  };
  return ctx;
}

export function capabilityDictionary() {
  return CAPABILITIES.map((cap) => ({
    id: cap.id,
    label: cap.label,
    en: cap.en,
    category: cap.category,
    categoryLabel: CATEGORIES[cap.category].label,
    headline: cap.headline,
    detail: cap.detail,
    tags: cap.tags,
    weight: cap.weight,
  }));
}
