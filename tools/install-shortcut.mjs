/**
 * 在桌面创建带自定义图标的快捷方式。
 * 通过带 BOM 的临时 PowerShell 脚本执行，避免中文在 Windows PowerShell 5.1 下被按 ANSI 解码。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const iconPath = path.join(ROOT, 'assets', 'icon.ico');
const launcher = path.join(ROOT, 'start-agent-diagnostic.bat');
const shortcutName = process.argv[2] || 'Agent 诊断中心';

if (!fs.existsSync(iconPath)) {
  console.error(`找不到图标：${iconPath}\n请先执行：node tools/make-icon.mjs`);
  process.exit(1);
}
if (!fs.existsSync(launcher)) {
  console.error(`找不到启动脚本：${launcher}`);
  process.exit(1);
}

// 桌面可能被 OneDrive 重定向，交给 PowerShell 解析真实路径
const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', '[Environment]::GetFolderPath(\"Desktop\")'], { encoding: 'utf8' });
const desktop = String(probe.stdout ?? '').trim() || path.join(os.homedir(), 'Desktop');
if (!fs.existsSync(desktop)) fs.mkdirSync(desktop, { recursive: true });
const lnkPath = path.join(desktop, `${shortcutName}.lnk`);

const script = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut('${escape(lnkPath)}')
$link.TargetPath = '${escape(launcher)}'
$link.WorkingDirectory = '${escape(ROOT)}'
$link.IconLocation = '${escape(iconPath)},0'
$link.Description = 'Agent 诊断中心 - 专业能力识别 / 评分 / 优化建议'
$link.WindowStyle = 1
$link.Save()
if (Test-Path -LiteralPath '${escape(lnkPath)}') { Write-Output 'OK' } else { Write-Error 'shortcut not created' }
`;

function escape(text) {
  return text.replace(/'/g, "''");
}

const tmp = path.join(os.tmpdir(), `arl-shortcut-${Date.now()}.ps1`);
fs.writeFileSync(tmp, `\uFEFF${script}`, { encoding: 'utf8' });
const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' });
fs.rmSync(tmp, { force: true });

if (result.status !== 0 || !String(result.stdout).includes('OK')) {
  console.error('创建桌面快捷方式失败：');
  console.error(result.stderr || result.stdout || `PowerShell 退出码 ${result.status}`);
  console.error('你也可以手动把 start-agent-diagnostic.bat 发送到桌面快捷方式，图标在 assets/icon.ico。');
  process.exit(1);
}

console.log(`桌面快捷方式已创建：${lnkPath}`);
console.log(`图标：${iconPath}`);
