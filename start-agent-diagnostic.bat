@echo off
setlocal
chcp 65001 >nul
title Agent Diagnostic Center
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js is required but was not found in PATH.
  echo          Install Node.js 20 or newer, then run this file again.
  echo.
  pause
  exit /b 1
)

node desktop.js
if errorlevel 1 (
  echo.
  echo  [ERROR] Failed to start. See the message above.
  echo.
  pause
)
