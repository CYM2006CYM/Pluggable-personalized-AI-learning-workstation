@echo off
setlocal
chcp 65001 >nul
title Pi Study Helper - Competition Launcher

set "PROJECT_ROOT=%~dp0"
set "LAUNCHER=%PROJECT_ROOT%scripts\competition-launcher.ps1"

if not exist "%LAUNCHER%" (
  echo [ERROR] Launcher not found: "%LAUNCHER%"
  echo Please keep the complete pi-study-helper directory structure.
  pause
  exit /b 1
)

where pwsh.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
)

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Startup did not complete. See the message above and the deployment guide.
  pause
)
exit /b %EXIT_CODE%
