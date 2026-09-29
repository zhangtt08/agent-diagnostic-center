/** 运行级 trace 采集：按 seq 记录六类 step，落库前统一脱敏。 */
import { redactSecrets } from './guardrails.js';

export class TraceCollector {
  constructor({ runId, sessionId }) {
    this.runId = runId;
    this.sessionId = sessionId;
    this.signal = AbortController ? new AbortController().signal : null;
    this.steps = [];
    this.seq = 0;
  }

  record(step) {
    this.seq += 1;
    this.steps.push({
      seq: this.seq,
      at: new Date().toISOString(),
      runId: this.runId,
      sessionId: this.sessionId,
      ...step,
      detail: step.detail ? JSON.parse(redactSecrets(JSON.stringify(step.detail))) : undefined,
    });
  }
}
