@echo off
setlocal

call npm.cmd run check:system
if errorlevel 1 (
  pause
  exit /b 1
)

call npm.cmd run build
pause
