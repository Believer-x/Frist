@echo off
setlocal
cd /d "%~dp0.."
if exist .venv\Scripts\python.exe goto install
where py >nul 2>nul
if errorlevel 1 (
  python -m venv .venv
) else (
  py -3 -m venv .venv
)
if errorlevel 1 goto failed
:install
.venv\Scripts\python.exe -m pip install -r server\requirements.txt
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8765
if errorlevel 1 goto failed
exit /b 0
:failed
echo Setup or speech service failed. Check Python 3.10-3.12 and Internet access.
pause
exit /b 1
