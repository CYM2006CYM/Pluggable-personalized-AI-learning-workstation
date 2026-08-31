@echo off
setlocal
chcp 65001 >nul
title Pi Study Helper - Competition Launcher

set "PROJECT_ROOT=%~dp0"
set "LAUNCHER_UI=%PROJECT_ROOT%scripts\competition-launcher-ui.ps1"

if not exist "%LAUNCHER_UI%" (
  echo [ERROR] Launcher not found: "%LAUNCHER_UI%"
  echo Please keep the complete pi-study-helper directory structure.
  pause
  exit /b 1
)

where pwsh.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  start "" pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%LAUNCHER_UI%"
) else (
  start "" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%LAUNCHER_UI%"
)
exit /b 0
