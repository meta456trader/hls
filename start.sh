#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "============================================================"
echo " HLS Live Player – offline / VPN mode (Linux)"
echo "============================================================"
echo ""

# ── locate Python ──────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] python3 not found. Install it with:  sudo apt install python3"
    exit 1
fi
PYTHON=python3

# ── check FFmpeg binary is present ─────────────────────────────
FFMPEG="$(dirname "$0")/bin/ffmpeg"
if [ ! -f "$FFMPEG" ]; then
    echo "[INFO] FFmpeg not found – running setup.py to download it now…"
    "$PYTHON" "$(dirname "$0")/setup.py"
fi

# ── check pip deps ─────────────────────────────────────────────
if ! "$PYTHON" -c "import flask, flask_cors" &>/dev/null; then
    echo "[INFO] Python packages missing – installing…"
    WHEELS="$(dirname "$0")/wheels"
    REQ="$(dirname "$0")/requirements.txt"
    if [ -d "$WHEELS" ]; then
        "$PYTHON" -m pip install --no-index --find-links="$WHEELS" -r "$REQ"
    else
        "$PYTHON" -m pip install -r "$REQ"
    fi
fi

# ── start Flask server in background ───────────────────────────
echo "[INFO] Starting Flask HLS server on http://localhost:8080 ..."
"$PYTHON" "$(dirname "$0")/server/server.py" &
SERVER_PID=$!
echo "[INFO] Server PID: $SERVER_PID"

# ── wait for the server to be ready (poll /health) ─────────────
echo "[INFO] Waiting for server…"
TRIES=0
until "$PYTHON" -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health', timeout=2)" &>/dev/null; do
    sleep 1
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 20 ]; then
        echo "[WARN] Server did not respond in 20s – opening browser anyway."
        break
    fi
done

echo "[INFO] Server is up."

# ── open browser ───────────────────────────────────────────────
echo "[INFO] Opening player in default browser…"
if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:8080" &
elif command -v sensible-browser &>/dev/null; then
    sensible-browser "http://localhost:8080" &
fi

echo ""
echo "============================================================"
echo " Player is running at:  http://localhost:8080"
echo " Press Ctrl+C to stop the server."
echo "============================================================"
echo ""

# Keep script alive; kill server on Ctrl+C
trap "echo ''; echo '[INFO] Stopping server…'; kill $SERVER_PID 2>/dev/null; exit 0" INT TERM
wait $SERVER_PID
