/**
 * 桌面启动器：启动本地服务，并用 Edge / Chrome 的应用模式打开独立窗口。
 * 不依赖 Electron，不写注册表，不联网下载任何东西。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import { ensureSeedData } from './src/seed.js';
import { findFreePort } from './src/net.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ID = 'AgentDiagnosticCenter';
const PREFERRED_PORT = Number(process.env.PORT || 4173);

const BROWSER_CANDIDATES = [
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

function waitForServer(url, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('本地服务启动超时'));
        else setTimeout(tick, 180);
      });
      req.setTimeout(1200, () => {
        req.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error('本地服务启动超时'));
        else setTimeout(tick, 180);
      });
    };
    tick();
  });
}

function launchWindow(url) {
  const profile = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || HERE, '.app-profile'), APP_ID);
  try {
    fs.mkdirSync(profile, { recursive: true });
  } catch { /* ignore */ }
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    '--window-size=1500,940',
    '--window-position=60,40',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    // 独立 profile 是应用窗口的身份来源，但也要给它设上限，别让它无限长
    '--disk-cache-size=41943040',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-service-autorun',
    '--report-upload-disabled',
    url,
  ];
  for (const exe of BROWSER_CANDIDATES) {
    if (!fs.existsSync(exe)) continue;
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* fall through to shell open */ });
    child.unref();
    return { mode: 'app-window', browser: path.basename(exe) };
  }
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  return { mode: 'system-browser', browser: 'default' };
}

const port = await findFreePort(PREFERRED_PORT);
const url = `http://127.0.0.1:${port}/`;
const seed = ensureSeedData();
const server = createServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});

console.log('='.repeat(58));
console.log('  Agent 诊断中心 已启动');
console.log(`  地址：${url}`);
console.log(`  数据目录：${path.join(HERE, 'data')}`);
if (seed.seeded) console.log(`  首次运行：已分析 ${seed.seeded} 个内置示例工程作为基线数据`);
console.log('  关闭此窗口即退出应用。');
console.log('='.repeat(58));

try {
  await waitForServer(url);
  const launched = launchWindow(url);
  if (launched.mode === 'app-window') {
    console.log(`已用 ${launched.browser} 应用窗口打开。`);
  } else {
    console.log('未找到 Edge/Chrome，已用系统默认浏览器打开。');
  }
} catch (err) {
  console.error('窗口打开失败：', err.message);
}

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n收到 ${signal}，正在退出…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
