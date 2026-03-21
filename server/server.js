/**
 * HLS Streaming Server
 *
 * Responsibilities:
 *  1. Spawn FFmpeg to generate a live test-card + tone stream
 *  2. Encode it as HLS (low-latency, 2-second segments, rolling 5-segment window)
 *  3. Serve the .m3u8 playlist + .ts segments over HTTP with proper CORS headers
 *  4. Expose a /status endpoint with server uptime and segment stats
 */

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

// ─── Locate FFmpeg binary ────────────────────────────────────────────────────
function findFFmpeg() {
  const isWin = process.platform === 'win32';
  const candidates = [
    path.join(__dirname, '..', 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg'), // local bin/
    path.join(__dirname, 'bin',  isWin ? 'ffmpeg.exe' : 'ffmpeg'),       // server/bin/
    isWin ? 'ffmpeg.exe' : 'ffmpeg',                                      // system PATH
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) {}
    // also accept non-executable flag on Windows (accessSync X_OK is unreliable)
    if (isWin) { try { fs.accessSync(c); return c; } catch (_) {} }
  }
  return null;
}

const FFMPEG_BIN = findFFmpeg();
if (!FFMPEG_BIN) {
  console.error('\n❌  FFmpeg not found.');
  console.error('   Run  python setup.py  to download it automatically, or');
  console.error('   install it manually and add it to PATH.');
  console.error('   Download: https://ffmpeg.org/download.html\n');
  process.exit(1);
}
console.log(`[FFmpeg] Binary: ${FFMPEG_BIN}`);

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 8080;
const HLS_DIR      = path.join(__dirname, 'hls_output');
const PLAYLIST     = path.join(HLS_DIR, 'stream.m3u8');
const SEGMENT_DURATION = 2;   // seconds per segment
const SEGMENT_LIST_SIZE = 5;  // number of segments kept in playlist

// ─── Ensure output directory exists ──────────────────────────────────────────
fs.mkdirSync(HLS_DIR, { recursive: true });

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(morgan('dev'));

// Serve the static web client
app.use(express.static(path.join(__dirname, '..', 'client')));

// Serve HLS files with correct MIME types + no-cache so players always fetch fresh playlists
app.use('/hls', (req, res, next) => {
  if (req.path.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (req.path.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
}, express.static(HLS_DIR));

// Status / health endpoint
app.get('/api/status', (req, res) => {
  const segments = fs.existsSync(HLS_DIR)
    ? fs.readdirSync(HLS_DIR).filter(f => f.endsWith('.ts'))
    : [];

  res.json({
    status  : ffmpegProcess ? 'streaming' : 'stopped',
    uptime  : process.uptime(),
    segments: segments.length,
    playlist: fs.existsSync(PLAYLIST),
  });
});

// ─── FFmpeg spawner ───────────────────────────────────────────────────────────
let ffmpegProcess = null;

function startFFmpeg() {
  // Clean up previous segments so the player never gets stale data
  if (fs.existsSync(HLS_DIR)) {
    fs.readdirSync(HLS_DIR)
      .filter(f => f.endsWith('.ts') || f.endsWith('.m3u8'))
      .forEach(f => fs.unlinkSync(path.join(HLS_DIR, f)));
  }

  /**
   * FFmpeg command breakdown:
   *  -stream_loop -1           → loop the file forever (simulates a live source)
   *  -re                       → read input at native frame-rate
   *  -i videos/test.mp4        → source video file
   *  -c:v libx264 -preset ultrafast -tune zerolatency → low-latency H.264
   *  -c:a aac                  → AAC audio
   *  -f hls                    → HLS muxer
   *  -hls_time                 → segment duration
   *  -hls_list_size            → rolling playlist window
   *  -hls_flags delete_segments+append_list  → auto-delete old .ts files
   */
  const videoFile = path.join(__dirname, '..', 'videos', 'test.mp4');
  if (!fs.existsSync(videoFile)) {
    console.error(`\n❌  Source video not found: ${videoFile}`);
    console.error('   Place a video file at  videos/test.mp4  and restart the server.\n');
    process.exit(1);
  }
  console.log(`[FFmpeg] Source: ${videoFile}`);

  const args = [
    '-hide_banner',
    '-stream_loop', '-1',   // loop forever → simulates live stream
    '-re',                  // read at real-time speed
    '-i', videoFile,
    // Video codec
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '3.1',
    '-g', '60',           // keyframe interval = 2 s @ 30 fps (aligns with segment duration)
    '-keyint_min', '60',
    '-sc_threshold', '0',
    '-b:v', '2000k',
    '-maxrate', '2000k',
    '-bufsize', '4000k',
    // Audio codec
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    // HLS output
    '-f', 'hls',
    '-hls_time', String(SEGMENT_DURATION),
    '-hls_list_size', String(SEGMENT_LIST_SIZE),
    '-hls_flags', 'delete_segments+append_list+omit_endlist',
    '-hls_segment_filename', path.join(HLS_DIR, 'seg%05d.ts'),
    PLAYLIST,
  ];

  console.log('[FFmpeg] Starting with args:\n ', args.join(' '));
  ffmpegProcess = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpegProcess.stderr.on('data', (data) => {
    // FFmpeg writes progress to stderr; only print "frame=" lines to avoid log spam
    const line = data.toString();
    if (line.includes('frame=') || line.includes('error') || line.includes('Error')) {
      process.stdout.write('[FFmpeg] ' + line);
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`[FFmpeg] Process exited with code ${code}. Restarting in 2 s…`);
    ffmpegProcess = null;
    setTimeout(startFFmpeg, 2000);
  });

  ffmpegProcess.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error('\n❌  FFmpeg not found in PATH.');
      console.error('   Install FFmpeg and make sure it is accessible via the PATH environment variable.\n');
      console.error('   Download: https://ffmpeg.org/download.html\n');
    } else {
      console.error('[FFmpeg] Error:', err.message);
    }
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown() {
  console.log('\n[Server] Shutting down…');
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
  }
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬  HLS Server running at  http://localhost:${PORT}`);
  console.log(`📺  Web player at          http://localhost:${PORT}/`);
  console.log(`📡  HLS playlist at        http://localhost:${PORT}/hls/stream.m3u8\n`);
  startFFmpeg();
});
