@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is required. Install Node.js 20+ first.
  pause
  exit /b 1
)

if not exist "assets\icon.ico" node tools\make-icon.mjs
node tools\install-shortcut.mjs
echo.
pause
