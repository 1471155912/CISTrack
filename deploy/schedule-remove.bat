@echo off
rem ===========================================================================
rem  Remove the daily automatic update task registered by schedule-install.bat
rem ===========================================================================
setlocal
set "TASK=CISTrack-Update"

schtasks /query /tn "%TASK%" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Task "%TASK%" does not exist -- nothing to remove.
  pause
  exit /b 0
)

echo Removing task "%TASK%" ...
schtasks /delete /tn "%TASK%" /f
if errorlevel 1 (
  echo [FAILED] Could not remove the task.
  pause
  exit /b 1
)
echo [DONE] Task "%TASK%" removed.
pause
exit /b 0
