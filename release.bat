@echo off
REM Builds a release: runs the tests (saving the results), then builds. Stops if any test fails.
cd /d "%~dp0"
echo [1/2] Running tests ...
call npm run test:report || goto :fail
echo.
echo [2/2] Building the app ...
call npm run build || goto :fail
echo.
echo Release built. Run start.bat to launch it.
pause
exit /b 0
:fail
echo.
echo Release FAILED - scroll up for the error. The previous build was not replaced.
pause
exit /b 1