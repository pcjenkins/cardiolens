@echo off
REM Runs the built app and the data API, then opens your browser. Close this window to stop both.
cd /d "%~dp0"
if not exist ".next\BUILD_ID" (
  echo App is not built yet. Run setup.bat first.
  pause
  exit /b 1
)
start "" http://localhost:3000
call npm run start:stack
