@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local-model.ps1"
if errorlevel 1 pause
