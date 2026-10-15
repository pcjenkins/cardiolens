@echo off
REM One-time setup: installs packages (web + API), builds the PostgreSQL database, builds the app.
REM Needs PostgreSQL running with a "cardiolens" role and database - see README.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 LTS or newer from https://nodejs.org and open a NEW command window.
  pause
  exit /b 1
)
echo Node version:
node -v
echo.
echo [1/3] Installing packages (web and API) ...
call npm install || goto :fail
echo.
echo [2/3] Building the PostgreSQL database (about 2 minutes) ...
call npm run db:reset || goto :fail
echo.
echo [3/3] Building the app ...
call release.bat || goto :fail
echo.
echo Setup complete. Double-click start.bat to run CardioLens.
pause
exit /b 0
:fail
echo.
echo Setup failed - scroll up for the error.
pause
exit /b 1
