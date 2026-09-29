const DEFINITIONS = {
  javascript: {
    display: 'JavaScript',
    exts: ['.js', '.jsx', '.mjs', '.cjs'],
    line: ['//'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\'], ['`', '\\']],
    family: 'code',
  },
  typescript: {
    display: 'TypeScript',
    exts: ['.ts', '.mts', '.cts'],
    line: ['//'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\'], ['`', '\\']],
    family: 'code',
  },
  tsx: {
    display: 'TypeScript React',
    exts: ['.tsx'],
    line: ['//'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\'], ['`', '\\']],
    family: 'code',
  },
  python: {
    display: 'Python',
    exts: ['.py', '.pyi'],
    line: ['#'],
    block: [['"""', '"""'], ["'''", "'''"]],
    strings: [["'", '\\'], ['"', '\\']],
    family: 'code',
  },
  go: {
    display: 'Go',
    exts: ['.go'],
    line: ['//'],
    block: [['/*', '*/']],
    strings: [['"', '\\'], ['`', '']],
    family: 'code',
  },
  java: {
    display: 'Java',
    exts: ['.java', '.kt', '.kts', '.scala'],
    line: ['//'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\']],
    family: 'code',
  },
  rust: {
    display: 'Rust',
    exts: ['.rs'],
    line: ['//'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\']],
    family: 'code',
  },
  csharp: {
    display: 'C#',
    exts: ['.cs'],
    line: ['//'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\'], ['`', '\\']],
    family: 'code',
  },
  php: {
    display: 'PHP',
    exts: ['.php'],
    line: ['//', '#'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\']],
    family: 'code',
  },
  ruby: {
    display: 'Ruby',
    exts: ['.rb'],
    line: ['#'],
    block: [['=begin', '=end']],
    strings: [["'", '\\'], ['"', '\\']],
    family: 'code',
  },
  shell: {
    display: 'Shell',
    exts: ['.sh', '.bash', '.zsh'],
    line: ['#'],
    block: [],
    strings: [["'", '\\'], ['"', '\\']],
    family: 'code',
  },
  sql: {
    display: 'SQL',
    exts: ['.sql'],
    line: ['--'],
    block: [['/*', '*/']],
    strings: [["'", '\\'], ['"', '\\']],
    family: 'code',
  },
  yaml: { display: 'YAML', exts: ['.yml', '.yaml'], line: ['#'], block: [], strings: [['"', '\\'], ["'", '\\']], family: 'config' },
  json: { display: 'JSON', exts: ['.json', '.jsonc'], line: ['//'], block: [['/*', '*/']], strings: [['"', '\\']], family: 'config' },
  toml: { display: 'TOML', exts: ['.toml', '.env', '.ini', '.cfg'], line: ['#', ';'], block: [], strings: [['"', '\\'], ["'", '\\']], family: 'config' },
  markdown: { display: 'Markdown', exts: ['.md', '.mdx', '.txt', '.rst'], line: [], block: [['<!--', '-->']], strings: [], family: 'doc' },
  html: { display: 'HTML', exts: ['.html', '.htm', '.xml', '.svg'], line: [], block: [['<!--', '-->']], strings: [['"', '\\'], ["'", '\\']], family: 'markup' },
  css: { display: 'CSS', exts: ['.css', '.scss', '.less'], line: ['//'], block: [['/*', '*/']], strings: [['"', '\\'], ["'", '\\']], family: 'markup' },
}

const BY_EXT = new Map();
for (const [id, def] of Object.entries(DEFINITIONS)) {
  for (const ext of def.exts) BY_EXT.set(ext, id);
}

const SPECIAL_FILES = {
  'dockerfile': 'shell',
  'makefile': 'shell',
  'procfile': 'shell',
  '.env': 'toml',
  '.env.example': 'toml',
  'cmakelists.txt': 'shell',
};

export function detectLanguage(path) {
  const lower = path.toLowerCase().replace(/\\/g, '/');
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (SPECIAL_FILES[base]) return SPECIAL_FILES[base];
  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const ext = base.slice(dot);
    if (BY_EXT.has(ext)) return BY_EXT.get(ext);
  }
  return null;
}

export function languageFamily(id) {
  return DEFINITIONS[id]?.family ?? 'unknown';
}

function startsWith(source, index, token) {
  if (token.length > source.length - index) return false;
  for (let i = 0; i < token.length; i += 1) {
    if (source.charCodeAt(index + i) !== token.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Removes comments while preserving line/column geometry, so every match keeps a
 * trustworthy line number. Extracted comment text is returned separately because a
 * capability mentioned only in a docstring is weaker evidence than one in code.
 */
export function splitSource(source, langId) {
  const def = DEFINITIONS[langId];
  if (!def) {
    return { code: source, doc: '' };
  }
  if (def.family === 'doc') {
    return { code: '', doc: source };
  }
  const out = [];
  const docParts = [];
  const { line = [], block = [], strings = [] } = def;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    let matchedString = false;
    for (const [quote, escapeChar] of strings) {
      if (!startsWith(source, i, quote)) continue;
      if (quote === "'" && langId === 'rust' && startsWith(source, i, "r\"")) continue;
      out.push(ch);
      i += 1;
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (escapeChar && c === escapeChar && i + 1 < source.length) {
          out.push(c, source[i + 1]);
          i += 2;
          continue;
        }
        if (c === '\n' && quote !== '`' && !(langId === 'go' && quote === '`')) break;
        if (startsWith(source, i, quote)) {
          out.push(quote);
          i += quote.length;
          closed = true;
          break;
        }
        out.push(c);
        i += 1;
      }
      if (!closed && ch !== '\n') {
        // unterminated string literal: keep consuming to newline handled above
        void 0;
      }
      matchedString = true;
      break;
    }
    if (matchedString) continue;

    let matchedLine = false;
    for (const token of line) {
      if (!startsWith(source, i, token)) continue;
      let j = i;
      while (j < source.length && source[j] !== '\n') j += 1;
      docParts.push(source.slice(i, j));
      out.push(' '.repeat(j - i));
      i = j;
      matchedLine = true;
      break;
    }
    if (matchedLine) continue;

    let matchedBlock = false;
    for (const [open, close] of block) {
      if (!startsWith(source, i, open)) continue;
      let j = i + open.length;
      while (j < source.length && !startsWith(source, j, close)) j += 1;
      const end = Math.min(source.length, j + close.length);
      const text = source.slice(i, end);
      docParts.push(text);
      for (const c of text) out.push(c === '\n' ? '\n' : ' ');
      i = end;
      matchedBlock = true;
      break;
    }
    if (matchedBlock) continue;

    out.push(ch);
    i += 1;
  }
  return { code: out.join(''), doc: docParts.join('\n') };
}
