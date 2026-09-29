import fs from 'node:fs';
import path from 'node:path';
import { detectLanguage, languageFamily } from './languages.js';

export const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'coverage',
  '.next', '.nuxt', '.turbo', '.cache', '__pycache__', '.venv', 'venv', 'env',
  '.idea', '.vscode', '.gradle', 'vendor', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'site-packages', '.tox', 'playwright-report', 'test-results', 'logs', 'tmp', '.tmp',
  '.sunra', '.serverless', 'bower_components', '.nyc_output', 'data',
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.woff', '.woff2',
  '.ttf', '.eot', '.otf', '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.pdf', '.doc', '.docx', '.xls',
  '.xlsx', '.ppt', '.pptx', '.so', '.dll', '.dylib', '.exe', '.class', '.jar', '.war',
  '.pyc', '.pyo', '.wasm', '.sqlite', '.db', '.db-journal', '.sqlite-wal', '.sqlite-shm',
  '.lock', '.bin', '.obj', '.a', '.lib', '.pdb', '.map',
]);

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_FILES = 6000;

const GENERATED_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock',
  'bun.lockb', 'composer.lock', 'poetry.lock', 'cargo.lock', 'uv.lock', 'deno.lock',
  'pubspec.lock', 'mix.lock', 'gradle.lockfile', 'go.sum', '.package-lock.json',
  'thumbs.db', '.ds_store',
]);

const GENERATED_SUFFIX = [
  '.min.js', '.min.css', '.bundle.js', '.lock', '.snap', '.svg', '.map',
  '-lock.json', '.d.ts', '.generated.ts', '.generated.js', '.g.dart', '.pb.go',
];

export function isGeneratedArtifact(name) {
  const lower = name.toLowerCase();
  if (GENERATED_NAMES.has(lower)) return true;
  return GENERATED_SUFFIX.some((suffix) => lower.endsWith(suffix));
}

function isIgnoredName(name, ignoreDirs) {
  if (ignoreDirs.has(name)) return true;
  if (name.startsWith('.') && name !== '.env' && name !== '.env.example') return true;
  return false;
}

export function walkDirectory(root, options = {}) {
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
  const maxFiles = options.maxFiles ?? MAX_TOTAL_FILES;
  const files = [];
  const skipped = { binary: 0, tooLarge: 0, ignored: 0 };

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (isIgnoredName(entry.name, ignoreDirs)) {
          skipped.ignored += 1;
          continue;
        }
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (isGeneratedArtifact(lower)) {
        skipped.binary += 1;
        continue;
      }
      const dot = lower.lastIndexOf('.');
      const ext = dot > 0 ? lower.slice(dot) : '';
      if (BINARY_EXT.has(ext)) {
        skipped.binary += 1;
        continue;
      }
      let stat = null;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        skipped.tooLarge += 1;
        continue;
      }
      if (files.length >= maxFiles) {
        skipped.ignored += 1;
        continue;
      }
      files.push({ absolute: full, relative: path.relative(root, full).replace(/\\/g, '/') });
    }
  }
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return { files, skipped };
}

export function loadProjectFiles(root, options = {}) {
  const { files, skipped } = walkDirectory(root, options);
  const loaded = [];
  for (const item of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(item.absolute, 'utf8');
    } catch {
      continue;
    }
    if (raw.includes('\u0000')) continue;
    loaded.push(toFileRecord(item.relative, raw));
  }
  return { files: loaded, skipped };
}

export function toFileRecord(relativePath, rawContent) {
  const normalized = String(rawContent).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const language = detectLanguage(relativePath);
  const lines = normalized.split('\n');
  return {
    path: relativePath.replace(/\\/g, '/'),
    name: relativePath.replace(/\\/g, '/').split('/').pop(),
    language,
    family: languageFamily(language),
    content: normalized,
    lineCount: lines.length,
    bytes: Buffer.byteLength(normalized, 'utf8'),
  };
}
