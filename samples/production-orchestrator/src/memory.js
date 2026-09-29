/** 长期记忆：按 tenant:user 作用域存取，向量召回。 */
import { embed } from './vector.js';

export async function recallMemories({ scope, query, topK = 5 }) {
  const vector = await embed(query);
  return db().query(
    'select id, text, score from memories where scope = $1 order by embedding <=> $2 limit $3',
    [scope, vector, topK],
  );
}

export async function persistMemories({ scope, facts = [] }) {
  for (const fact of facts) {
    const vector = await embed(fact.text);
    await db().execute(
      'insert into memories(scope, key, text, embedding) values ($1,$2,$3,$4) on conflict (scope, key) do update set text = excluded.text',
      [scope, fact.key, fact.text, vector],
    );
  }
}

function db() {
  return globalThis.__memoryDb ?? { query: async () => [], execute: async () => {} };
}
