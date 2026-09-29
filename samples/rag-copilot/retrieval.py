"""知识库切分 + 向量检索。使用 pgvector 存储 embedding，召回 top-k 后拼接进提示词。"""

import hashlib
import re
from dataclasses import dataclass

import psycopg2

EMBEDDING_MODEL = "bge-large-zh"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
TOP_K = 6


@dataclass
class Chunk:
    doc_id: str
    chunk_id: str
    text: str
    vector: list


def split_markdown(markdown: str, doc_id: str):
    sections = re.split(r"\n(?=#{1,3} )", markdown)
    chunks = []
    for sec in sections:
        for i in range(0, len(sec), CHUNK_SIZE - CHUNK_OVERLAP):
            piece = sec[i : i + CHUNK_SIZE]
            if len(piece.strip()) < 20:
                continue
            chunks.append(Chunk(doc_id, hashlib.sha1(piece.encode()).hexdigest()[:12], piece, []))
    return chunks


def embed(texts):
    import requests

    resp = requests.post(
        "http://embeddings:8080/embed",
        json={"model": EMBEDDING_MODEL, "inputs": texts, "truncate": True},
        timeout=30,
    )
    return resp.json()["embeddings"]


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb + 1e-9)


class KnowledgeStore:
    def __init__(self, dsn):
        self.conn = psycopg2.connect(dsn)

    def upsert(self, chunks):
        vectors = embed([c.text for c in chunks])
        with self.conn.cursor() as cur:
            for chunk, vector in zip(chunks, vectors):
                cur.execute(
                    "insert into chunks(doc_id, chunk_id, text, embedding) values (%s,%s,%s,%s) "
                    "on conflict (chunk_id) do update set embedding = excluded.embedding",
                    (chunk.doc_id, chunk.chunk_id, chunk.text, vector),
                )
        self.conn.commit()

    def search(self, query, top_k=TOP_K):
        qv = embed([query])[0]
        with self.conn.cursor() as cur:
            cur.execute("select chunk_id, doc_id, text, embedding from chunks")
            rows = cur.fetchall()
        scored = [(cosine(qv, r[3]), r) for r in rows]
        scored.sort(key=lambda x: -x[0])
        return [{"chunk_id": r[1], "doc_id": r[2], "text": r[3], "score": s} for s, r in scored[:top_k]]


def build_context(question, store):
    hits = store.search(question)
    joined = "\n\n".join([h["text"] for h in hits])
    return f"参考资料：\n{joined}\n\n问题：{question}", hits
