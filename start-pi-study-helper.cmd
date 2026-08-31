@echo off
setlocal
chcp 65001 >nul
set "APP_LAUNCHER=%~dp0pi-study-helper\start-competition-demo.cmd"

if not exist "%APP_LAUNCHER%" (
  echo [ERROR] Missing: "%APP_LAUNCHER%"
  echo Please download and extract the complete GitHub repository.
  pause
  exit /b 1
)

call "%APP_LAUNCHER%"
exit /b %ERRORLEVEL%
