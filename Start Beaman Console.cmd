@echo off
rem Starts Beaman Console: its database (if it isn't running), then the API and the web app
rem in their own windows, then opens the browser. Close the two windows to stop the app;
rem the database stops when Windows shuts down. First time? Run setup first (see README.md).
cd /d "%~dp0"

if not exist "server\.env" goto setup
set "PGDATA=%LOCALAPPDATA%\BeamanConsole\pgdata"
if not exist "%PGDATA%\PG_VERSION" goto setup

rem Find the PostgreSQL programs (the newest version installed).
set "PGBIN="
for /d %%d in ("C:\Program Files\PostgreSQL\*") do if exist "%%d\bin\pg_ctl.exe" set "PGBIN=%%d\bin"
if not defined PGBIN (
  echo PostgreSQL wasn't found under C:\Program Files\PostgreSQL.
  pause
  exit /b 1
)

"%PGBIN%\pg_ctl.exe" status -D "%PGDATA%" >nul 2>&1
if errorlevel 1 (
  echo Starting the database...
  "%PGBIN%\pg_ctl.exe" start -D "%PGDATA%" -l "%LOCALAPPDATA%\BeamanConsole\postgres.log" -w >nul
  if errorlevel 1 (
    echo The database didn't start. See %LOCALAPPDATA%\BeamanConsole\postgres.log
    pause
    exit /b 1
  )
)

start "Beaman Console - API" cmd /k "cd /d ""%~dp0server"" && npm start"
start "Beaman Console - web" cmd /k "cd /d ""%~dp0client"" && npm run dev"

rem Open the app once the web page answers (up to about 30 seconds).
echo Waiting for the app to start...
powershell -NoProfile -Command "for ($i = 0; $i -lt 30; $i++) { try { Invoke-WebRequest http://localhost:5173 -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 } }"
start "" http://localhost:5173
exit /b 0

:setup
echo Beaman Console isn't set up yet. Run this once in PowerShell, from this folder:
echo   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1
pause
exit /b 1
