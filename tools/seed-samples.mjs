/** 命令行补齐示例基线数据：node tools/seed-samples.mjs [--force] */
import { ensureSeedData } from '../src/seed.js';

const result = ensureSeedData({ force: process.argv.includes('--force') });
console.log(`种子记录：新增 ${result.seeded} 条，当前共 ${result.total} 条。`);
if (result.failures?.length) {
  console.error('失败：\n' + result.failures.join('\n'));
  process.exit(1);
}
