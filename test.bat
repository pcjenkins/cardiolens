@echo off
REM Runs both test suites: the data API (node:test, against the database) and the web app (Jest + React Testing Library).
cd /d "%~dp0"
call npm run test:api
call npx jest --coverage
pause
