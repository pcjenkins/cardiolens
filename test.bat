@echo off
REM Runs the Jest + React Testing Library suite with a coverage report.
cd /d "%~dp0"
call npx jest --coverage
pause
