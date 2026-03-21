"""
setup.py – One-time setup script for the HLS Live Player.

Run this script ONCE while you have internet access (e.g. before going on VPN).
It will:
  1. Download FFmpeg static binary  →  hls/bin/ffmpeg.exe
  2. Install Python packages         →  pip (flask, flask-cors)
  3. Pre-download pip wheels         →  hls/wheels/  (for future offline installs)
  4. Download hls.js                 →  hls/client/hls.min.js  (already bundled)

After running setup.py once you can use the project fully offline / on VPN.
Start the player with:  start.bat  (or: python server/server.py)
"""

import urllib.request
import zipfile
import tarfile
import shutil
import sys
import ssl
import platform
import subprocess
from pathlib import Path

# Some corporate VPNs / proxies intercept TLS – bypass cert verification
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode    = ssl.CERT_NONE

def _urlopen(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, context=_ssl_ctx)

ROOT_DIR   = Path(__file__).parent
BIN_DIR    = ROOT_DIR / "bin"
WHEELS_DIR = ROOT_DIR / "wheels"
CLIENT_DIR = ROOT_DIR / "client"

IS_WINDOWS = platform.system() == "Windows"

# Static GPL builds – no DLL / .so dependencies, single self-contained binary
# Windows: zip from BtbN
FFMPEG_URL_WIN = (
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"
    "ffmpeg-master-latest-win64-gpl.zip"
)
# Linux (x86_64): static build from John Van Sickle – truly zero .so deps
FFMPEG_URL_LINUX = (
    "https://johnvansickle.com/ffmpeg/releases/"
    "ffmpeg-release-amd64-static.tar.xz"
)

FFMPEG_BIN   = BIN_DIR / ("ffmpeg.exe" if IS_WINDOWS else "ffmpeg")
FFMPEG_URL   = FFMPEG_URL_WIN if IS_WINDOWS else FFMPEG_URL_LINUX

HLS_JS_URL = (
    "https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js"
)

def download_ffmpeg():
    BIN_DIR.mkdir(parents=True, exist_ok=True)

    print("📥  Downloading FFmpeg…  (this may take a minute)")
    print(f"    Platform : {'Windows' if IS_WINDOWS else 'Linux'}")
    print(f"    Source   : {FFMPEG_URL}\n")

    archive_suffix = ".zip" if IS_WINDOWS else ".tar.xz"
    archive_path   = BIN_DIR / ("ffmpeg" + archive_suffix)

    def progress(blocks_done, block_size, total_size):
        downloaded = blocks_done * block_size
        if total_size > 0:
            pct = min(100, int(downloaded * 100 / total_size))
            bar = "█" * (pct // 4) + "░" * (25 - pct // 4)
            print(f"\r    [{bar}] {pct:>3}%  {downloaded//1024//1024} MB", end="", flush=True)

    try:
        with _urlopen(FFMPEG_URL) as resp, open(archive_path, "wb") as f:
            total = int(resp.headers.get("Content-Length", 0))
            done  = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                progress(done // 65536, 65536, total)
        print()
    except Exception as e:
        print(f"\n❌  Download failed: {e}", file=sys.stderr)
        print("    Please download FFmpeg manually from https://ffmpeg.org/download.html", file=sys.stderr)
        sys.exit(1)

    print("\n\n📦  Extracting…")

    if IS_WINDOWS:
        with zipfile.ZipFile(archive_path, "r") as zf:
            entries = [m for m in zf.namelist() if m.endswith("/bin/ffmpeg.exe")]
            if not entries:
                print("❌  Could not find ffmpeg.exe inside the archive.", file=sys.stderr)
                sys.exit(1)
            with zf.open(entries[0]) as src, open(FFMPEG_BIN, "wb") as dst:
                shutil.copyfileobj(src, dst)
    else:
        # John Van Sickle tar: contains a flat directory like ffmpeg-N-amd64-static/ffmpeg
        with tarfile.open(archive_path, "r:xz") as tf:
            entries = [m for m in tf.getmembers()
                       if m.name.endswith("/ffmpeg") and not m.name.endswith("/ffprobe")]
            if not entries:
                print("❌  Could not find ffmpeg binary inside the archive.", file=sys.stderr)
                sys.exit(1)
            member = entries[0]
            member.name = "ffmpeg"   # flatten path
            tf.extract(member, path=BIN_DIR)
        # Make executable
        import os
        os.chmod(FFMPEG_BIN, 0o755)

    archive_path.unlink()
    print(f"✅  FFmpeg extracted to {FFMPEG_BIN}\n")


def download_hls_js():
    dest = CLIENT_DIR / "hls.min.js"
    if dest.exists():
        print(f"✅  hls.min.js already present at {dest}")
        return
    print("📥  Downloading hls.js…")
    try:
        with _urlopen(HLS_JS_URL) as resp, open(dest, "wb") as f:
            f.write(resp.read())
        print(f"✅  hls.min.js saved to {dest}\n")
    except Exception as e:
        print(f"⚠️   Could not download hls.js: {e} (skipping – already bundled)", file=sys.stderr)


def install_packages():
    """Install packages AND cache wheels for later offline use."""
    req_file = ROOT_DIR / "requirements.txt"
    print("📦  Installing Python packages…")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req_file)])
    print()

    # Download wheels so they can be installed offline later
    WHEELS_DIR.mkdir(parents=True, exist_ok=True)
    existing_wheels = list(WHEELS_DIR.glob("*.whl"))
    if existing_wheels:
        print(f"✅  Wheel cache already populated ({len(existing_wheels)} files in wheels/)")
    else:
        print("📥  Caching wheels for offline installs → wheels/")
        subprocess.check_call([
            sys.executable, "-m", "pip", "download",
            "-r", str(req_file),
            "--dest", str(WHEELS_DIR),
        ])
        wheels = list(WHEELS_DIR.glob("*.whl"))
        print(f"✅  {len(wheels)} wheels cached in {WHEELS_DIR}\n")


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  HLS Live Player – Setup (run once, needs internet)")
    print("=" * 60 + "\n")

    # 1. FFmpeg
    if FFMPEG_BIN.exists():
        print(f"✅  FFmpeg already present at {FFMPEG_BIN}")
    else:
        download_ffmpeg()

    # 2. hls.js
    download_hls_js()

    # 3. Python packages + wheel cache
    install_packages()

    print("=" * 60)
    print("🎉  Setup complete – you can now go offline / use VPN.")
    print()
    print("   ▶  To start:  double-click  start.bat")
    print("      or run:   python server/server.py")
    print("=" * 60 + "\n")
