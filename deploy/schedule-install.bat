@echo off
rem ===========================================================================
rem  Register a daily automatic update in Windows Task Scheduler.
rem  Runs deploy\update.bat every day at 06:00 (local time).
rem
rem  Usage:   right-click -> "Run as administrator" is NOT required for the
rem            current user; just double-click, or run  deploy\schedule-install.bat
rem  Remove:  deploy\schedule-remove.bat
rem ===========================================================================
setlocal
cd /d %~dp0..

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 18+ first, then run this again.
  pause
  exit /b 1
)

set "TASK=CISTrack-Update"
set "HERE=%~dp0update.bat"

echo Registering daily task "%TASK%" at 06:00 ...
schtasks /create /tn "%TASK%" /tr "\"%HERE%\"" /sc daily /st 06:00 /f
if errorlevel 1 (
  echo [FAILED] Could not register the task. Try running this from an administrator console.
  pause
  exit /b 1
)
echo.
echo [DONE] Task "%TASK%" registered. It runs update.bat every day at 06:00.
echo        Check it in Task Scheduler (taskschd.msc) under "Task Scheduler Library".
echo        Remove it later with  deploy\schedule-remove.bat
pause
exit /b 0
