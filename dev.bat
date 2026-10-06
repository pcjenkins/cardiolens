@echo off
REM Development mode: edits to files reload instantly in the browser at http://localhost:3000
cd /d "%~dp0"
start "" http://localhost:3000
call npm run dev
