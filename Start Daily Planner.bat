@echo off
setlocal EnableExtensions
title Daily Planner
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  Daily Planner - local launcher
rem
rem    Double-click                         start the planner and open it in your browser
rem    "Start Daily Planner.bat" shortcut   put a "Daily Planner" shortcut on the desktop
rem    "Start Daily Planner.bat" dist       serve the production build (builds it if needed)
rem    "Start Daily Planner.bat" lan        also reachable from your phone on the same Wi-Fi
rem
rem  The planner always uses http://localhost:8080. Browsers keep your plans per
rem  address, so keeping the same port keeps the same data you already have.
rem ---------------------------------------------------------------------------

set "PORT=8080"
set "MODE=%~1"

if /i "%MODE%"=="shortcut" goto :shortcut

where node >nul 2>nul
if errorlevel 1 goto :python

set "EXTRA="
if /i "%MODE%"=="lan" set "EXTRA=--lan"
if /i "%MODE%"=="dist" goto :node_dist

node scripts\serve.mjs --port %PORT% --open %EXTRA%
if errorlevel 1 pause
goto :end

:node_dist
if exist "dist\index.html" goto :node_dist_run
echo Building the production version first...
call npm run build
if errorlevel 1 goto :fail

:node_dist_run
node scripts\serve.mjs --dist --port %PORT% --open
if errorlevel 1 pause
goto :end

:python
rem Run a real check: "where python" also finds the Microsoft Store placeholder.
set "PY="
py -c "import sys" >nul 2>nul && set "PY=py"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto :missing
set "HOST=127.0.0.1"
if /i "%MODE%"=="lan" set "HOST=0.0.0.0"
if /i "%MODE%"=="dist" if exist "dist\index.html" cd /d "%~dp0dist"
echo.
echo   Node.js was not found - using Python instead.
echo   Daily Planner is running at http://localhost:%PORT%
echo   Your plans stay in this browser. Close this window or press Ctrl+C to stop.
echo.
rem The server binds first, then opens the browser, then serves. JavaScript MIME
rem types are forced because some Windows registries map .js to text/plain.
%PY% -c "import http.server as s,webbrowser;H=s.SimpleHTTPRequestHandler;H.extensions_map.update({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'});srv=s.ThreadingHTTPServer(('%HOST%',%PORT%),H);webbrowser.open('http://localhost:%PORT%');srv.serve_forever()"
if errorlevel 1 pause
goto :end

:shortcut
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Daily Planner.lnk');$s.TargetPath='%~f0';$s.WorkingDirectory='%~dp0';$s.IconLocation='%~dp0favicon.ico';$s.WindowStyle=7;$s.Description='Start Daily Planner';$s.Save()"
if errorlevel 1 goto :fail
echo.
echo   A "Daily Planner" shortcut is now on your desktop.
echo   It starts the planner with this window minimised.
echo.
pause
goto :end

:missing
echo.
echo   Daily Planner needs Node.js (recommended) or Python to run locally.
echo   Install Node.js LTS from https://nodejs.org, then double-click this file again.
echo.
pause
exit /b 1

:fail
echo.
echo   Something went wrong - see the messages above.
echo.
pause
exit /b 1

:end
endlocal
