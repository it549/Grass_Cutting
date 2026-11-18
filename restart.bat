@echo off
setlocal
rem Stop whatever is on the app port, build, then start in production mode.
set PORT=3004

cd /d "%~dp0"

echo ===== [1/3] Stopping processes on port %PORT% =====
set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    if not "%%P"=="0" (
        echo Killing PID %%P
        taskkill /F /T /PID %%P >nul 2>&1
        set FOUND=1
    )
)
if "%FOUND%"=="0" echo Nothing is running on port %PORT%.

echo.
echo ===== [2/3] Building =====
call npm run build
if errorlevel 1 (
    echo.
    echo Build FAILED - server not started.
    pause
    exit /b 1
)

echo.
echo ===== [3/3] Starting on http://localhost:%PORT% =====
call npm run start

pause
