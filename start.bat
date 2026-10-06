@echo off
REM Runs the built app at http://localhost:3000 and opens your browser. Close this window to stop it.
cd /d "%~dp0"
if not exist ".next\BUILD_ID" (
  echo App is not built yet. Run setup.bat first.
  pause
  exit /b 1
)
start "" http://localhost:3000
call npm start
