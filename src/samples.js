import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE_ROOT = path.resolve(HERE, '..', 'samples');

const DEFINITIONS = [
  {
    key: 'naive-react-agent',
    name: '示例 · 最小 ReAct Agent',
    blurb: '只有循环和工具调用的原型实现，缺少预算、超时与校验，用于展示低分画像。',
  },
  {
    key: 'rag-copilot',
    name: '示例 · RAG 知识库助手',
    blurb: '带向量检索、会话窗口与重试的中等成熟度实现，缺少引用溯源与重排。',
  },
  {
    key: 'production-orchestrator',
    name: '示例 · 生产级编排 Agent',
    blurb: '规划/反思/护栏/审批/评测/追踪齐备的高分实现，用于对照参考架构。',
  },
];

export function listSamples() {
  return DEFINITIONS
    .map((def) => {
      const dir = path.join(SAMPLE_ROOT, def.key);
      if (!fs.existsSync(dir)) return null;
      return { ...def, dir };
    })
    .filter(Boolean);
}
