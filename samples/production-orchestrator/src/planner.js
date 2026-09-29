/** 规划器：把目标拆成有序子任务并估计复杂度。 */
import { z } from 'zod';

const PlanSchema = z.object({
  complexity: z.enum(['low', 'medium', 'high']),
  subtasks: z.array(z.object({ id: z.string(), goal: z.string(), dependsOn: z.array(z.string()).default([]) })).min(1),
  estimatedSteps: z.number().int().min(1),
});

export class Planner {
  constructor({ provider, maxSubtasks = 8 }) {
    this.provider = provider;
    this.maxSubtasks = maxSubtasks;
  }

  async decompose(goal, { maxSubtasks = this.maxSubtasks } = {}) {
    const raw = await this.provider.complete({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: await loadPrompt('planner.v2') },
        { role: 'user', content: goal },
      ],
      response_format: { type: 'json_schema', json_schema: { schema: toJsonSchema(PlanSchema), strict: true } },
    });
    const parsed = PlanSchema.safeParse(JSON.parse(raw.text));
    if (!parsed.success) {
      return { complexity: 'medium', subtasks: [{ id: 's1', goal, dependsOn: [] }], estimatedSteps: 3 };
    }
    return { ...parsed.data, subtasks: parsed.data.subtasks.slice(0, maxSubtasks) };
  }
}

async function loadPrompt(key) {
  return (await import(`../prompts/${key}.js`)).default;
}

function toJsonSchema(schema) {
  return schema?._def?.schema ?? { type: 'object' };
}
