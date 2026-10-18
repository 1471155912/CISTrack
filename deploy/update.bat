@echo off
rem ===========================================================================
rem  CISTrack one-click update (Windows)
rem    pull latest orbital elements -> rebuild bundled data -> repackage the
rem    single-file HTML -> sync the versioned snapshot.
rem
rem  Usage:  double-click this file, or run  deploy\update.bat  from a console.
rem  Requirements: Node.js 18+ (https://nodejs.org/). No npm install needed:
rem    the build chain has zero npm dependencies.
rem
rem  If a step fails (most often refresh.mjs when you are offline), that is OK:
rem    just open the existing CISTrack.html -- it carries bundled data and also
rem    tries to update itself online at runtime.
rem ===========================================================================
setlocal
cd /d %~dp0..

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo         Please install Node.js 18 or newer from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)

rem ★ V1.9.8: wiki first (satellite names / cards). Failure is NOT fatal: the build
rem   falls back to the bundled wiki.json + wiki_tables.json + the known-NORAD table.
echo ==^> 0/5  Updating the Satellite Wiki data       (wiki: stats / tables / cards)
call node scripts\fetch_wiki.mjs
if errorlevel 1 echo    [warn] wiki stats failed - keeping the previous wiki.json
call node scripts\fetch_wiki_tables.mjs
if errorlevel 1 echo    [warn] wiki tables failed - keeping the previous wiki_tables.json
call node scripts\fetch_wiki_cards.mjs
if errorlevel 1 echo    [warn] wiki cards failed - keeping the previous wiki_cards.json

echo ==^> 1/4  Fetching the latest orbital elements  (refresh.mjs)
call node refresh.mjs
if errorlevel 1 goto :failed

echo ==^> 2/4  Rebuilding the bundled data           (mkdata.mjs)
call node mkdata.mjs
if errorlevel 1 goto :failed

echo ==^> 3/4  Repackaging the single-file HTML      (build.mjs)
call node build.mjs
if errorlevel 1 goto :failed

echo ==^> 4/4  Syncing the versioned snapshot        (release.mjs)
call node release.mjs
if errorlevel 1 goto :failed

echo.
echo [DONE] CISTrack.html is up to date -- double-click it to open.
pause
exit /b 0

:failed
echo.
echo [FAILED] One of the steps above reported an error.
echo          If you are offline, refresh.mjs cannot reach CelesTrak -- that is expected.
echo          The existing CISTrack.html still works (bundled data + runtime self-update).
pause
exit /b 1
