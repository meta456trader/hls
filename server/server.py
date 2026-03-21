"""
HLS Streaming Server (Python / Flask)

Responsibilities:
  1. Spawn FFmpeg to generate a live test-card + tone stream
  2. Encode it as HLS (2-second segments, rolling 5-segment window)
  3. Serve the .m3u8 playlist + .ts segments over HTTP with CORS headers
  4. Serve the web client (client/) as static files
  5. /api/status endpoint
"""

import os
import sys
import signal
import time
import threading
import subprocess
import shutil
from pathlib import Path
from flask import Flask, send_from_directory, jsonify, send_file
from flask_cors import CORS

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
CLIENT_DIR = BASE_DIR.parent / "client"
HLS_DIR    = BASE_DIR / "hls_output"
PLAYLIST   = HLS_DIR / "stream.m3u8"

# ─── FFmpeg location (populated by setup.py or auto-detected) ─────────────────
FFMPEG_CANDIDATES = [
    str(BASE_DIR.parent / "bin" / "ffmpeg.exe"),  # Windows – downloaded by setup.py
    str(BASE_DIR.parent / "bin" / "ffmpeg"),       # Linux   – downloaded by setup.py
    str(BASE_DIR / "bin" / "ffmpeg.exe"),          # Windows – alternative location
    str(BASE_DIR / "bin" / "ffmpeg"),              # Linux   – alternative location
    "ffmpeg",                                       # system PATH (any OS)
    r"C:\ffmpeg\bin\ffmpeg.exe",                    # common Windows manual install
    "/usr/local/bin/ffmpeg",                        # common Linux manual install
    "/usr/bin/ffmpeg",                              # Ubuntu apt install ffmpeg
]

def find_ffmpeg():
    for candidate in FFMPEG_CANDIDATES:
        if shutil.which(candidate) or Path(candidate).exists():
            return candidate
    return None

# ─── Config ───────────────────────────────────────────────────────────────────
PORT              = int(os.environ.get("PORT", 8080))
SEGMENT_DURATION  = 2    # seconds per segment
SEGMENT_LIST_SIZE = 5    # rolling window kept in playlist

# ─── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# Serve web client at root
@app.route("/")
def index():
    return send_file(CLIENT_DIR / "index.html")

@app.route("/<path:filename>")
def client_static(filename):
    return send_from_directory(CLIENT_DIR, filename)

# Serve HLS files with correct MIME types
@app.route("/hls/<path:filename>")
def hls_files(filename):
    file_path = HLS_DIR / filename
    if not file_path.exists():
        return "Not Found", 404
    if filename.endswith(".m3u8"):
        mime = "application/vnd.apple.mpegurl"
    elif filename.endswith(".ts"):
        mime = "video/mp2t"
    elif filename.endswith(".m4s"):
        mime = "video/iso.segment"
    elif filename.endswith(".mp4"):
        mime = "video/mp4"
    else:
        mime = "application/octet-stream"
    resp = send_from_directory(HLS_DIR, filename, mimetype=mime)
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp

@app.route("/health")
def health():
    return "OK", 200

@app.route("/api/status")
def status():
    segments = [f for f in os.listdir(HLS_DIR) if f.endswith(".ts")] if HLS_DIR.exists() else []
    return jsonify({
        "status"  : "streaming" if ffmpeg_proc and ffmpeg_proc.poll() is None else "stopped",
        "uptime"  : time.time() - START_TIME,
        "segments": len(segments),
        "playlist": PLAYLIST.exists(),
    })

# ─── FFmpeg process management ────────────────────────────────────────────────
ffmpeg_proc = None
ffmpeg_thread = None
START_TIME  = time.time()
_stop_event = threading.Event()

def clean_hls_dir():
    """Remove old segments and playlist before a fresh start."""
    if HLS_DIR.exists():
        for f in HLS_DIR.iterdir():
            if f.suffix in (".ts", ".m3u8", ".m4s", ".mp4"):
                f.unlink(missing_ok=True)
    HLS_DIR.mkdir(parents=True, exist_ok=True)

def run_ffmpeg(ffmpeg_bin):
    global ffmpeg_proc
    playlist_path = str(PLAYLIST)
    # Use a relative filename so FFmpeg writes URI="init.mp4" in the playlist
    # instead of an absolute Windows path that the browser cannot fetch.
    init_path     = "init.mp4"
    segment_path  = str(HLS_DIR / "seg%05d.m4s")

    # Video source: use test.mp4 if present, otherwise fall back to synthetic test card
    video_file = BASE_DIR.parent / "videos" / "test.mp4"
    if video_file.exists():
        source_args = [
            "-stream_loop", "-1",          # loop forever → simulates live stream
            "-re",                          # read at real-time speed
            "-i", str(video_file),
        ]
        print(f"[FFmpeg] Source: {video_file}", flush=True)
    else:
        source_args = [
            "-re",
            "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        ]
        print("[FFmpeg] Source: synthetic test card (no test.mp4 found)", flush=True)

    args = [
        ffmpeg_bin, "-hide_banner",
        *source_args,
        # H.264 video – high-compat settings for MSE
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-profile:v", "baseline",
        "-level", "3.1",
        "-g", str(30 * SEGMENT_DURATION),   # one keyframe per segment
        "-keyint_min", str(30 * SEGMENT_DURATION),
        "-sc_threshold", "0",
        "-b:v", "2000k", "-maxrate", "2000k", "-bufsize", "4000k",
        # AAC audio
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        # fMP4 HLS output – bypasses hls.js TS transmuxer, uses native MP4 MSE
        "-f", "hls",
        "-hls_time", str(SEGMENT_DURATION),
        "-hls_list_size", str(SEGMENT_LIST_SIZE),
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", init_path,
        "-hls_flags", "delete_segments+append_list+omit_endlist",
        "-hls_segment_filename", segment_path,
        playlist_path,
    ]

    while not _stop_event.is_set():
        clean_hls_dir()
        print(f"[FFmpeg] Starting stream…", flush=True)
        ffmpeg_proc = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(HLS_DIR),   # so "init.mp4" is written into hls_output/
        )

        # Stream stderr (progress) without blocking the loop
        for line in ffmpeg_proc.stderr:
            if "frame=" in line or "error" in line.lower():
                print("[FFmpeg]", line.rstrip(), flush=True)
            if _stop_event.is_set():
                ffmpeg_proc.terminate()
                break

        ret = ffmpeg_proc.wait()
        if _stop_event.is_set():
            break
        print(f"[FFmpeg] Exited ({ret}). Restarting in 2 s…", flush=True)
        time.sleep(2)

def start_ffmpeg_thread(ffmpeg_bin):
    global ffmpeg_thread
    _stop_event.clear()
    ffmpeg_thread = threading.Thread(target=run_ffmpeg, args=(ffmpeg_bin,), daemon=True)
    ffmpeg_thread.start()

def stop_ffmpeg():
    _stop_event.set()
    if ffmpeg_proc:
        try:
            ffmpeg_proc.terminate()
        except Exception:
            pass

# ─── Graceful shutdown ────────────────────────────────────────────────────────
def shutdown(sig, frame):
    print("\n[Server] Shutting down…", flush=True)
    stop_ffmpeg()
    sys.exit(0)

signal.signal(signal.SIGINT,  shutdown)
signal.signal(signal.SIGTERM, shutdown)

# ─── Entrypoint ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ffmpeg_bin = find_ffmpeg()
    if not ffmpeg_bin:
        print(
            "\n❌  FFmpeg not found.\n"
            "   Run  python setup.py  to download it automatically, or\n"
            "   install it manually and add it to PATH.\n"
            "   Download: https://ffmpeg.org/download.html\n",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"\n🎬  HLS Server running at  http://localhost:{PORT}")
    print(f"📺  Web player at          http://localhost:{PORT}/")
    print(f"📡  HLS playlist at        http://localhost:{PORT}/hls/stream.m3u8")
    print(f"🔧  FFmpeg binary:         {ffmpeg_bin}\n")

    start_ffmpeg_thread(ffmpeg_bin)

    # Give FFmpeg a moment to create the first segment before the server starts
    time.sleep(1)

    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)
