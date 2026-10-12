@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required. Install Python, then run this file again.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r scripts\requirements-speech.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" scripts\setup-speech.py
if errorlevel 1 goto failed
echo Setup complete. VOICEVOX must also be installed locally.
pause
exit /b 0
:failed
echo Speech setup failed. Review the message above and retry.
pause
exit /b 1
