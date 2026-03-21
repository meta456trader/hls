@echo off
setlocal

echo.
echo ============================================================
echo  HLS Live Player  –  offline / VPN mode
echo ============================================================
echo.

:: ── locate Python ──────────────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found on PATH. Please install Python 3.9+.
    pause & exit /b 1
)

:: ── check FFmpeg binary is present ─────────────────────────────
set FFMPEG=%~dp0bin\ffmpeg.exe
if not exist "%FFMPEG%" (
    echo [INFO] FFmpeg not found – running setup.py to download it now…
    python "%~dp0setup.py"
    if errorlevel 1 ( echo [ERROR] Setup failed. & pause & exit /b 1 )
)

:: ── check pip deps ─────────────────────────────────────────────
python -c "import flask, flask_cors" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Python packages missing – installing from local wheels/ cache…
    if exist "%~dp0wheels\" (
        python -m pip install --no-index --find-links="%~dp0wheels" -r "%~dp0requirements.txt"
    ) else (
        echo [INFO] No wheel cache found – trying pip install with internet…
        python -m pip install -r "%~dp0requirements.txt"
    )
    if errorlevel 1 ( echo [ERROR] pip install failed. & pause & exit /b 1 )
)

:: ── start Flask server in background ───────────────────────────
echo [INFO] Starting Flask HLS server on http://localhost:8080 ...
start "HLS-Server" /min cmd /c "python %~dp0server\server.py"

:: ── wait for the server to be ready (poll /health) ─────────────
echo [INFO] Waiting for server…
set TRIES=0
:wait_loop
    timeout /t 1 /nobreak >nul
    python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health', timeout=2)" >nul 2>&1
    if not errorlevel 1 goto server_ready
    set /a TRIES+=1
    if %TRIES% geq 20 (
        echo [WARN] Server did not respond in 20s – opening browser anyway.
        goto open_browser
    )
    goto wait_loop

:server_ready
echo [INFO] Server is up.

:open_browser
echo [INFO] Opening player in default browser…
start "" "http://localhost:8080"
echo.
echo ============================================================
echo  Player is running at:  http://localhost:8080
echo  Press Ctrl+C in the "HLS-Server" window to stop streaming.
echo ============================================================
echo.
pause
