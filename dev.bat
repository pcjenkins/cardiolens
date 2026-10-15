@echo off
REM Development mode: runs the data API and the web app together; edits reload instantly.
cd /d "%~dp0"
start "" http://localhost:3000
call npm run stack
