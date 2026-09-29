import { analyzeDirectory } from './engine/index.js';
import { saveReport, listSummaries, isInitialized, markInitialized } from './store.js';
import { listSamples } from './samples.js';

/**
 * 首次运行时把内置示例工程真实分析一遍并落盘，保证界面一打开就有可用数据。
 * 写入的每条记录都来自真实扫描结果，不是占位假数据。
 * 用户主动清空历史后不会再次补齐（靠 .initialized 标记区分）。
 */
export function ensureSeedData({ force = false } = {}) {
  if (!force && (isInitialized() || listSummaries().length > 0)) {
    if (!isInitialized()) markInitialized();
    return { seeded: 0, total: listSummaries().length };
  }
  const samples = listSamples();
  let seeded = 0;
  const failures = [];
  for (const sample of samples) {
    try {
      saveReport(analyzeDirectory(sample.dir, { name: sample.name }));
      seeded += 1;
    } catch (err) {
      failures.push(`${sample.key}: ${err.message}`);
    }
  }
  markInitialized();
  return { seeded, total: listSummaries().length, failures };
}
