@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
if not exist node_modules\typescript\bin\tsc call npm ci
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
node dist\desktop\main.js --open
if errorlevel 1 goto failed
exit /b 0
:failed
echo Gateway could not start. Review the message above.
pause
exit /b 1
