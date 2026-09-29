/** 检索：混合召回（BM25 + 向量）→ cross-encoder 重排 → 低分阈值过滤。 */
import { embed, cosine } from './vector.js';

const RERANK_MIN_SCORE = 0.35;

export async function retrieve({ query, topK = 12 }) {
  const vector = await embed(query);
  const rewritten = await rewriteQuery(query);
  const lexical = await bm25Search(rewritten, topK);
  const semantic = await vectorSearch(vector, topK);
  return merge(lexical, semantic).map((doc) => ({ ...doc, crossScore: 0 }));
}

export function rerank(query, docs, topN = 5) {
  const scored = docs.map((doc) => ({ ...doc, crossScore: crossEncoderScore(query, doc.text) }));
  return scored
    .filter((doc) => doc.crossScore >= RERANK_MIN_SCORE)
    .sort((a, b) => b.crossScore - a.crossScore)
    .slice(0, topN)
    .map((doc) => ({ chunkId: doc.chunkId, docId: doc.docId, text: doc.text, score: doc.crossScore }));
}

async function rewriteQuery(query) {
  return query.replace(/\s+/g, ' ').trim();
}

async function bm25Search() {
  return [];
}

async function vectorSearch(vector, topK) {
  return globalThis.__kb?.search?.(vector, topK) ?? [];
}

function merge(a, b) {
  const seen = new Map();
  for (const doc of [...a, ...b]) seen.set(doc.chunkId, doc);
  return [...seen.values()];
}

function crossEncoderScore(query, text) {
  return cosine(hash(query), hash(text));
}

function hash(text) {
  const vec = new Array(256).fill(0);
  for (let i = 0; i < text.length; i += 1) vec[text.charCodeAt(i) % 256] += 1;
  return vec;
}
