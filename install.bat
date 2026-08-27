@echo off
setlocal enabledelayedexpansion
title OMP-Jarvis Installer
chcp 65001 >nul

echo ============================================
echo   OMP-Jarvis - Oh My Pi + Jarvis Frontend
echo ============================================
echo.

REM ---------- Admin check (required for service registration) ----------
net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: This installer must be run as Administrator
  echo        (required to register the Windows service).
  echo.
  echo        Right-click install.bat and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

REM ---------- 1. Check/install Bun ----------
where bun >nul 2>nul
if %errorlevel%==0 (
  echo [1/5] Bun found.
) else (
  echo [1/5] Bun not found - installing...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  if errorlevel 1 (
    echo ERROR: Bun install failed. Install manually from https://bun.sh
    pause
    exit /b 1
  )
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
)

REM ---------- 2. Install Oh My Pi backend ----------
echo.
echo [2/5] Installing Oh My Pi backend (omp)...
call bun add --global @oh-my-pi/pi-coding-agent
if errorlevel 1 (
  echo ERROR: omp install failed.
  pause
  exit /b 1
)
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
omp --version >nul 2>nul
if errorlevel 1 (
  echo WARNING: omp not on PATH after install. Reopen terminal, rerun this script.
  pause
  exit /b 1
)
echo       omp version:
omp --version

REM ---------- 3. Install Edge TTS ----------
echo.
echo [3/5] Installing Edge TTS (voice)...
where python >nul 2>nul
if errorlevel 1 (
  echo       WARNING: python not found - server TTS will fall back to browser speech.
  echo       Install Python from https://python.org then rerun this script.
) else (
  python -m pip install --quiet --upgrade edge-tts
  if errorlevel 1 (
    echo       WARNING: edge-tts install failed - server TTS will fall back to browser speech.
  ) else (
    echo       edge-tts installed.
  )
)

REM ---------- 4. Fetch Jarvis frontend ----------
echo.
echo [4/5] Fetching Jarvis frontend...
set "JARVIS_DIR=%USERPROFILE%\jarvis"
if exist "%JARVIS_DIR%\server.js" (
  echo       Existing install found at %JARVIS_DIR% - updating...
  pushd "%JARVIS_DIR%"
  git pull --ff-only
  if errorlevel 1 (
    echo       WARNING: git pull failed - keeping existing files.
  )
  popd
) else (
  git clone https://github.com/ZHpike0478/OMP-Jarvis_FrontEnd.git "%JARVIS_DIR%"
  if errorlevel 1 (
    echo ERROR: clone failed. Check the URL and your network.
    pause
    exit /b 1
  )
)

REM ---------- 5. Register + start Windows service ----------
echo.
echo [5/5] Registering Jarvis as a Windows service...
set "SVC=OMP-Jarvis"
set "NODE_EXE="
for /f "delims=" %%i in ('where node') do (
  if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
  echo ERROR: node.exe not found.
  pause
  exit /b 1
)
echo       node:    %NODE_EXE%
echo       service: %JARVIS_DIR%\server.js

REM Remove any prior instance of this service.
sc query %SVC% >nul 2>nul
if not errorlevel 1 (
  echo       Removing existing service...
  sc stop %SVC% >nul 2>nul
  timeout /t 2 /nobreak >nul
  sc delete %SVC% >nul 2>nul
  timeout /t 2 /nobreak >nul
)

sc create %SVC% binPath= "\"%NODE_EXE%\" \"%JARVIS_DIR%\server.js\"" start= auto DisplayName= "OMP-Jarvis (Oh My Pi)"
if errorlevel 1 (
  echo ERROR: sc create failed.
  pause
  exit /b 1
)
sc description %SVC% "Oh My Pi Jarvis frontend - RPC bridge + web UI on http://127.0.0.1:8765"
reg add "HKLM\SYSTEM\CurrentControlSet\Services\%SVC%\Parameters" /v AppDirectory /d "%JARVIS_DIR%" /f >nul 2>&1

echo       Starting service...
sc start %SVC%
timeout /t 3 /nobreak >nul
sc query %SVC% | find "STATE" >nul
if errorlevel 1 (
  echo WARNING: service may not have started. Check: sc query %SVC%
) else (
  echo       Service registered and started.
)

echo.
echo ============================================
echo   Jarvis installed as Windows service.
echo ============================================
echo.
echo   Web UI:    http://127.0.0.1:8765
echo   Logs:      %JARVIS_DIR%\jarvis.log
echo.
echo   Manage with:
echo     sc query   %SVC%
echo     sc stop    %SVC%
echo     sc start   %SVC%
echo     sc delete  %SVC%   (to uninstall)
echo.
exit /b 0