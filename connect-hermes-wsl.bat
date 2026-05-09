@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enable-hermes-api-wsl.ps1"
pause
