const STAGES = [
  {
    key: 'intake',
    label: 'User Query',
    sub: '用户输入',
    icon: 'user',
    capabilities: ['session_isolation'],
    fallback: (ctx) => ctx.evidenceOf('api_surface', 1),
    note: '入口与会话标识',
  },
  {
    key: 'planner',
    label: 'Planner',
    sub: '任务规划',
    icon: 'plan',
    capabilities: ['planner', 'state_graph'],
    note: '目标拆解为可执行步骤',
  },
  {
    key: 'retriever',
    label: 'Retriever',
    sub: '知识检索',
    icon: 'search',
    capabilities: ['rag', 'vector_store', 'chunking'],
    note: '从知识库召回上下文',
  },
  {
    key: 'tools',
    label: 'Tool Call',
    sub: '工具调用',
    icon: 'tool',
    capabilities: ['tool_calling', 'mcp'],
    note: '执行外部动作并观察结果',
  },
  {
    key: 'reasoner',
    label: 'Reasoner',
    sub: '结果推理',
    icon: 'brain',
    capabilities: ['agent_loop', 'reflection', 'structured_output'],
    note: '基于观察迭代收敛答案',
  },
  {
    key: 'answer',
    label: 'Final Answer',
    sub: '最终答案',
    icon: 'doc',
    capabilities: ['streaming', 'api_surface'],
    note: '交付与呈现',
  },
];

export function buildPipeline(findings, ctx) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  return STAGES.map((stage) => {
    const matched = stage.capabilities.map((id) => byId.get(id)).filter(Boolean);
    const strong = matched.filter((f) => f.status === 'strong');
    const present = matched.filter((f) => f.status === 'present');
    const declared = matched.filter((f) => f.status === 'declared');
    let state = 'missing';
    if (strong.length > 0) state = 'ok';
    else if (present.length > 0) state = 'partial';
    else if (declared.length > 0) state = 'declared';

    const evidence = state === 'missing'
      ? (stage.fallback ? stage.fallback(ctx) : [])
      : matched.flatMap((f) => f.evidence.slice(0, 2)).slice(0, 3);

    const blockers = ctx.issuesForStage?.(stage.key) ?? [];
    return {
      key: stage.key,
      label: stage.label,
      sub: stage.sub,
      icon: stage.icon,
      state,
      note: stage.note,
      capabilities: matched.map((f) => ({ id: f.id, label: f.label, status: f.status, confidence: f.confidence })),
      evidence,
      blockers,
    };
  });
}
