@echo off
rem Move to another machine, step 1 (old machine). See export-data.ps1 for options.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-data.ps1" %*
set RC=%ERRORLEVEL%
echo %cmdcmdline% | find /i "%~0" >nul && pause
exit /b %RC%
