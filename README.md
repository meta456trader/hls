# HLS Live Player – Step-by-Step Testing Guide

A live HLS streaming demo that uses **FFmpeg** to generate a synthetic test-card video, serves it over HTTP via **Flask (Python)** or **Node.js (Express)**, and plays it back in a browser using **hls.js**.

---

## Prerequisites

| Requirement | Minimum Version | Check Command |
|---|---|---|
| Python | 3.9+ | `python --version` |
| Node.js *(optional – JS server only)* | 18+ | `node --version` |
| pip | bundled with Python | `pip --version` |
| Internet access | *(for first-time setup only)* | — |

---

## Step 1 – Clone / Extract the Project

Ensure the project folder looks like this:

```
hls/
├── bin/                  ← ffmpeg.exe will be placed here by setup.py
├── client/               ← Web player (HTML, CSS, JS)
├── server/
│   ├── server.py         ← Flask streaming server
│   ├── server.js         ← Node.js streaming server (alternative)
│   └── hls_output/       ← Generated HLS segments land here
├── wheels/               ← Offline Python package cache
├── requirements.txt
├── setup.py
├── start.bat
└── package.json
```

---

## Step 2 – One-Time Setup (requires internet)

**First**, place your video file at `videos/test.mp4` inside the project folder. The server will not start without it.

Then run `setup.py` **once** while you have internet access. It will:

- Download **FFmpeg** → `bin/ffmpeg.exe`
- Install **Flask** and **flask-cors** Python packages
- Cache pip wheels to `wheels/` for future offline installs

```powershell
cd "C:\Users\Administrator\Documents\hls"
python setup.py
```

Expected output:
```
📥  Downloading FFmpeg…
    [████████████████████████░] 100%
📦  Extracting…
✅  FFmpeg extracted to bin\ffmpeg.exe
✅  hls.min.js already present
✅  Python packages installed
```

> **Already on VPN / offline?**  
> If `bin\ffmpeg.exe` already exists and the `wheels\` folder is populated, skip this step – everything will install from the local cache.

---

## Step 3 – Start the Server

### Option A – Quickest: Double-click `start.bat`

Double-click **`start.bat`** in File Explorer.  
It will automatically:
1. Verify Python is installed
2. Install Python packages from the `wheels\` cache if needed
3. Start the Flask server in a minimised window
4. Wait for the server to respond
5. Open **http://localhost:8080** in your default browser

### Option B – Run Flask server manually (Python)

```powershell
cd "C:\Users\Administrator\Documents\hls"
python server\server.py
```

### Option C – Run the Node.js server (alternative)

```powershell
# Install Node dependencies first (one time)
cd "C:\Users\Administrator\Documents\hls"
npm run install:server

# Start the Node server
npm start
```

---

## Step 4 – Verify the Server is Running

Open a new terminal and check the health endpoint:

```powershell
python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8080/health').read())"
```

Expected output:
```
b'OK'
```

Check the status API for streaming info:

```powershell
python -c "import urllib.request, json; print(json.dumps(json.loads(urllib.request.urlopen('http://localhost:8080/api/status').read()), indent=2))"
```

Expected output (after ~5 seconds of streaming):
```json
{
  "status": "streaming",
  "uptime": 8.34,
  "segments": 5,
  "playlist": true
}
```

---

## Step 5 – Open the Web Player

Open your browser and navigate to:

```
http://localhost:8080
```

You should see the **HLS Live Player** interface with:
- A **video player** in the centre
- A **Stream Stats** sidebar on the right
- An **Event Log** below the stats

---

## Step 6 – Load and Play the Stream

1. The **Stream URL** field is pre-filled with:
   ```
   http://localhost:8080/hls/stream.m3u8
   ```
2. Click the **`Load`** button.
3. The spinner will appear briefly while buffering.
4. The **● LIVE** tag in the header will turn green.
5. The video will start playing – `videos/test.mp4` looped continuously, simulating a live stream.

---

## Step 7 – Verify Live Stats Update

In the **Stream Stats** panel, confirm these values are updating in real time:

| Stat | Expected Value |
|---|---|
| **Resolution** | matches `test.mp4` source resolution |
| **Bitrate** | > 0 kbps |
| **Buffer Length** | 2–10 s |
| **Latency** | low (< 15 s) |
| **Bandwidth** | > 0 kbps |
| **Segments** | incrementing |

Stat cards flash their border briefly each time the value changes – this confirms live data is flowing.

---

## Step 8 – Test Player Controls

| Control | Expected Behaviour |
|---|---|
| **⏸ / ▶ button** | Pause and resume playback |
| **🔊 Mute button** | Toggle audio mute |
| **Volume slider** | Adjust volume from 0 to 100% |
| **Quality selector** | Switch between available HLS quality levels (Auto by default) |
| **⛶ Fullscreen button** | Enter / exit fullscreen |
| **Stop button** | Detach the hls.js instance and stop playback |

---

## Step 9 – Test Direct HLS Endpoints

You can verify the HLS files are being served correctly:

```powershell
# Playlist file
Invoke-WebRequest http://localhost:8080/hls/stream.m3u8 | Select-Object -ExpandProperty Content

# A specific segment (replace seg00035.ts with a current segment name from the playlist)
Invoke-WebRequest http://localhost:8080/hls/stream.m3u8 -OutFile test.m3u8
Get-Content test.m3u8
```

The playlist should contain `#EXTM3U` at the top and list `.ts` or `.m4s` segment file names.

---

## Step 10 – Test in a Second Player (Optional)

Test with **VLC** or another HLS-compatible player to confirm the stream is standards-compliant:

1. Open VLC → **Media → Open Network Stream**
2. Enter: `http://localhost:8080/hls/stream.m3u8`
3. Click **Play** – the same test-card should appear.

---

## Step 11 – Stop the Server

- If you used **`start.bat`**: Close the minimised **"HLS-Server"** console window, or press `Ctrl+C` inside it.
- If you ran the server manually: press **`Ctrl+C`** in the terminal where `server.py` is running.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `videos/test.mp4` missing | Place your video file at `videos\test.mp4` in the project root |
| `Python not found` | Install Python 3.9+ and add it to PATH |
| `FFmpeg not found` | Run `python setup.py` to download it, or place `ffmpeg.exe` in `bin\` |
| `ModuleNotFoundError: flask` | Run `python -m pip install --no-index --find-links=wheels -r requirements.txt` |
| Browser shows "Connecting…" forever | Check the server terminal for FFmpeg errors; ensure port 8080 is not in use |
| Port 8080 already in use | Set a different port: `set PORT=9090` then run `python server\server.py` |
| `/api/status` shows `"status": "stopped"` | FFmpeg failed to start – check server terminal output for the error |
| `npm install` fails | Check Node.js version (`node --version` must be ≥ 18) |
| VLC cannot open stream | Confirm the server is running and try from the same machine first |

---

## Project URLs Summary

| URL | Description |
|---|---|
| `http://localhost:8080/` | Web player |
| `http://localhost:8080/hls/stream.m3u8` | Live HLS playlist |
| `http://localhost:8080/api/status` | JSON status / health API |
| `http://localhost:8080/health` | Simple health check (returns `OK`) |
