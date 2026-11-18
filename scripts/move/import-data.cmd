@echo off
rem Move to another machine, step 2 (new machine, inside the cloned project). See import-data.ps1 for options.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0import-data.ps1" %*
set RC=%ERRORLEVEL%
echo %cmdcmdline% | find /i "%~0" >nul && pause
exit /b %RC%
