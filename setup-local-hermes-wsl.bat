@echo off
setlocal

echo Preparing the isolated HermHerm runtime in WSL.
echo This does not modify your default Hermes/Discord setup.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enable-hermes-api-wsl.ps1"
pause
