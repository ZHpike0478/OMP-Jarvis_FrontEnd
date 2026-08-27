@echo off
setlocal enabledelayedexpansion
title OMP-Jarvis Installer
chcp 65001 >nul

echo ============================================
echo   OMP-Jarvis - Oh My Pi + Jarvis Frontend
echo ============================================
echo.

REM ---------- 1. Check/install Bun ----------
where bun >nul 2>nul
if %errorlevel%==0 (
  echo [1/4] Bun found: bun
) else (
  echo [1/4] Bun not found - installing...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  if errorlevel 1 (
    echo ERROR: Bun install failed. Install manually from https://bun.sh
    pause
    exit /b 1
  )
  REM refresh PATH for this session
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
)

REM ---------- 2. Install Oh My Pi backend ----------
echo.
echo [2/4] Installing Oh My Pi backend (omp)...
call bun add --global @oh-my-pi/pi-coding-agent
if errorlevel 1 (
  echo ERROR: omp install failed.
  pause
  exit /b 1
)
where omp >nul 2>nul
if errorlevel 1 set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
omp --version >nul 2>nul
if errorlevel 1 (
  echo WARNING: omp not on PATH. Reopen your terminal, then run this script again.
  pause
  exit /b 1
)
REM ---------- 3. Install Edge TTS (voice) ----------
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
if exist "%JARVIS_DIR%" (
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

REM ---------- 5. Start ----------
echo.
echo [5/5] Starting Jarvis at http://127.0.0.1:8765
echo       Press Ctrl+C to stop.
echo.
cd /d "%JARVIS_DIR%"
node server.js

REM ---------- 3. Fetch Jarvis frontend ----------
echo.
echo [3/4] Fetching Jarvis frontend...
set "JARVIS_DIR=%USERPROFILE%\jarvis"
if exist "%JARVIS_DIR%" (
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

REM ---------- 4. Start ----------
echo.
echo [4/4] Starting Jarvis at http://127.0.0.1:8765
echo       Press Ctrl+C to stop.
echo.
cd /d "%JARVIS_DIR%"
node server.js
