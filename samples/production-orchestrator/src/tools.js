/** 工具注册表：schema 校验 + 超时 + 破坏性标记。 */
import { z } from 'zod';

const definitions = [
  { name: 'search_kb', destructive: false, schema: z.object({ query: z.string().min(1), topK: z.number().int().min(1).max(50).default(8) }) },
  { name: 'http_fetch', destructive: false, schema: z.object({ url: z.string().url() }) },
  { name: 'send_email', destructive: true, schema: z.object({ to: z.string().email(), subject: z.string(), body: z.string() }) },
  { name: 'delete_record', destructive: true, schema: z.object({ id: z.string().uuid(), reason: z.string().min(4) }) },
];

const handlers = new Map();

export const TOOL_REGISTRY = {
  register(name, handler) {
    handlers.set(name, handler);
  },
  schemas() {
    return definitions.map((d) => ({ type: 'function', function: { name: d.name, parameters: jsonSchema(d.schema) } }));
  },
  isDestructive(name) {
    return definitions.find((d) => d.name === name)?.destructive === true;
  },
  async invoke(name, args, { timeoutMs = 10_000, signal } = {}) {
    const def = definitions.find((d) => d.name === name);
    const started = Date.now();
    if (!def) return { status: 'unknown_tool', text: '', ms: 0, errorCode: 'unknown_tool' };
    const parsed = def.schema.safeParse(args);
    if (!parsed.success) {
      return { status: 'invalid_arguments', text: JSON.stringify(parsed.error.issues), ms: 0, issues: parsed.error.issues };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    signal?.addEventListener('abort', () => controller.abort());
    try {
      const result = await handlers.get(name)(parsed.data, { signal: controller.signal });
      return { status: 'ok', text: JSON.stringify(result).slice(0, 20_000), ms: Date.now() - started };
    } catch (err) {
      const timedOut = err.name === 'AbortError';
      return { status: timedOut ? 'timeout' : 'tool_error', text: '', ms: Date.now() - started, errorCode: timedOut ? 'tool_timeout' : 'tool_error' };
    } finally {
      clearTimeout(timer);
    }
  },
};

function jsonSchema(zodSchema) {
  return zodSchema?._def?.schema ?? { type: 'object' };
}
