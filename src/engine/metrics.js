import { splitSource } from './languages.js';

const CODE_FAMILY = new Set(['code']);

export function prepareSources(files) {
  return files.map((file) => {
    if (CODE_FAMILY.has(file.family) || file.family === 'config' || file.family === 'markup') {
      const { code, doc } = splitSource(file.content, file.language);
      return { ...file, code, doc };
    }
    return { ...file, code: '', doc: file.content };
  });
}

function countMatches(text, re) {
  if (!text) return 0;
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) {
    n += 1;
    if (n > 100000) break;
  }
  return n;
}

export function computeMetrics(sources) {
  const byLanguage = new Map();
  let totalLines = 0;
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let maxNesting = 0;
  let totalBranch = 0;
  let totalFunction = 0;
  let errorHandling = 0;
  let testFiles = 0;
  let typeAnnotated = 0;

  for (const file of sources) {
    const lang = file.language ?? 'unknown';
    const bucket = byLanguage.get(lang) ?? { files: 0, lines: 0, code: 0 };
    bucket.files += 1;
    bucket.lines += file.lineCount;
    byLanguage.set(lang, bucket);

    if (file.family === 'doc') continue;
    const body = file.code ?? '';
    const doc = file.doc ?? '';
    totalLines += file.lineCount;
    codeLines += countNonBlank(body);
    commentLines += countNonBlank(doc);
    blankLines += Math.max(0, file.lineCount - countNonBlank(body) - countNonBlank(doc));

    if (/(^|\/)(tests?|__tests__|spec)(\/|\.)/i.test(file.path) || /\.(test|spec)\.[jt]sx?$/i.test(file.path) || /(^|\/)test_[^/]+\.py$/i.test(file.path)) {
      testFiles += 1;
    }

    const nesting = maxBraceDepth(body);
    if (nesting > maxNesting) maxNesting = nesting;
    totalBranch += countMatches(body, /\b(if|elif|else\s*if|switch|case|catch|except|rescue)\b/g);
    totalFunction += countMatches(body, /\b(def|function|func|fn|sub)\s+[A-Za-z_$][\w$]*|\b[A-Za-z_$][\w$]*\s*(?:\([^)]*\))?\s*=>|=>\s*\{|\basync\s+def\b/g);
    errorHandling += countMatches(body, /\b(try|catch|except|finally|throw|raise|panic|recover|Result<|Either<)/g);
    typeAnnotated += countMatches(body, /:\s*(string|number|boolean|void|any|unknown|Promise<|Array<|List<|Dict<|int|str|float|bool|Optional\[)/g);
  }

  const functionCount = Math.max(totalFunction, 1);
  return {
    totalFiles: sources.length,
    totalLines,
    codeLines,
    commentLines,
    blankLines,
    testFiles,
    languages: [...byLanguage.entries()]
      .map(([language, v]) => ({ language, files: v.files, lines: v.lines }))
      .sort((a, b) => b.lines - a.lines),
    maxNesting,
    avgBranchPerFunction: round(totalBranch / functionCount, 2),
    avgFunctionDensity: round((functionCount / Math.max(codeLines, 1)) * 100, 2),
    errorHandlingDensity: round((errorHandling / Math.max(codeLines, 1)) * 100, 2),
    typeCoverage: round((typeAnnotated / Math.max(codeLines, 1)) * 100, 2),
    commentRatio: round((commentLines / Math.max(totalLines, 1)) * 100, 1),
    functionCount,
  };
}

function countNonBlank(text) {
  if (!text) return 0;
  let n = 0;
  let current = '';
  let has = false;
  for (const ch of text) {
    if (ch === '\n') {
      if (has) n += 1;
      has = false;
      current = '';
      continue;
    }
    if (ch !== ' ' && ch !== '\t') has = true;
    current += ch;
  }
  if (has) n += 1;
  return n;
}

function maxBraceDepth(text) {
  let depth = 0;
  let max = 0;
  for (const ch of text) {
    if (ch === '{') {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
