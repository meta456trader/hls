# Linux FFmpeg Support (added 2026-03-20)

## The binary source

**John Van Sickle's static FFmpeg builds**
https://johnvansickle.com/ffmpeg/

- Truly **zero `.so` / shared-library dependencies** – runs on any Linux distro
- One fat binary, just copy and `chmod +x`
- Covers x86_64 (amd64), armhf, arm64, i686
- Updated frequently, tracks FFmpeg master

URL used by `setup.py`:
```
https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
```

## What changed in each file

### `setup.py`
- Added `import platform`, `import tarfile`
- `IS_WINDOWS = platform.system() == "Windows"`
- Two URLs: `FFMPEG_URL_WIN` (BtbN zip) and `FFMPEG_URL_LINUX` (John Van Sickle tar.xz)
- `FFMPEG_BIN` resolves to `bin/ffmpeg.exe` on Windows, `bin/ffmpeg` on Linux
- `download_ffmpeg()` extracts the right archive type for the current OS and `chmod 755`s the binary on Linux

### `server/server.py`
Added Linux paths to `FFMPEG_CANDIDATES`:
```python
str(BASE_DIR.parent / "bin" / "ffmpeg"),   # bin/ffmpeg  (no extension)
"/usr/local/bin/ffmpeg",                    # manual install
"/usr/bin/ffmpeg",                          # Ubuntu: apt install ffmpeg
```

### `start.sh` (new file)
Linux equivalent of `start.bat`:
```bash
chmod +x start.sh
./start.sh
```
- Uses `python3` instead of `python`
- Opens browser with `xdg-open` or `sensible-browser`
- Traps `Ctrl+C` to cleanly kill the Flask server

## How to use on Ubuntu

```bash
# 1. One-time setup (needs internet)
python3 setup.py

# 2. Start the player
./start.sh

# or manually:
python3 server/server.py
# then open http://localhost:8080
```

## Why NOT `apt install ffmpeg`?

`apt install ffmpeg` works too, but requires internet + sudo at deploy time.
The static binary from John Van Sickle lets you:
- Ship the binary alongside the project (no install step needed)
- Run fully offline / on VPN, same as on Windows
- Avoid version mismatches across different Ubuntu versions
