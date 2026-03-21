/**
 * HLS Live Player – Client-side application
 *
 * Uses hls.js to decode and play an HLS stream.
 * Displays real-time stats: resolution, bitrate, buffer length,
 * estimated latency, dropped frames, bandwidth, quality levels.
 */

'use strict';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const video          = document.getElementById('video');
const spinner        = document.getElementById('spinner');
const spinnerMsg     = document.getElementById('spinnerMsg');
const liveTag        = document.getElementById('liveTag');
const btnPlayPause   = document.getElementById('btnPlayPause');
const btnMute        = document.getElementById('btnMute');
const btnFullscreen  = document.getElementById('btnFullscreen');
const btnLoad        = document.getElementById('btnLoad');
const btnStop        = document.getElementById('btnStop');
const volumeSlider   = document.getElementById('volumeSlider');
const qualitySelect  = document.getElementById('qualitySelect');
const streamUrlInput = document.getElementById('streamUrl');
const eventLog       = document.getElementById('eventLog');

// ─── Stat card helpers ────────────────────────────────────────────────────────
const statCards = {
  resolution : document.querySelector('#statResolution .stat-value'),
  bitrate    : document.querySelector('#statBitrate    .stat-value'),
  fps        : document.querySelector('#statFps        .stat-value'),
  bufferLen  : document.querySelector('#statBufferLen  .stat-value'),
  latency    : document.querySelector('#statLatency    .stat-value'),
  dropped    : document.querySelector('#statDropped    .stat-value'),
  bandwidth  : document.querySelector('#statBandwidth  .stat-value'),
  segments   : document.querySelector('#statSegments   .stat-value'),
};

/** Update a stat card value and briefly flash its border */
function setStat(key, value) {
  const el = statCards[key];
  if (!el) return;
  if (el.textContent === String(value)) return;   // no change
  el.textContent = value;
  const card = el.closest('.stat-card');
  card.classList.add('updated');
  setTimeout(() => card.classList.remove('updated'), 600);
}

// ─── Event log ────────────────────────────────────────────────────────────────
const MAX_LOG_ENTRIES = 60;

function logEvent(msg, type = 'info') {
  const li = document.createElement('li');
  li.className = type;
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  li.textContent = `[${ts}] ${msg}`;
  eventLog.prepend(li);
  // keep the log from growing forever
  while (eventLog.children.length > MAX_LOG_ENTRIES) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

// ─── HLS player state ─────────────────────────────────────────────────────────
let hls = null;
let segmentsLoaded  = 0;
let statsInterval   = null;
let mediaErrorCount = 0;

function showSpinner(msg = 'Loading…') {
  spinnerMsg.textContent = msg;
  spinner.classList.remove('hidden');
}

function hideSpinner() {
  spinner.classList.add('hidden');
}

function setLiveStatus(live) {
  liveTag.textContent = live ? '● LIVE' : '● OFFLINE';
  liveTag.className   = 'live-tag ' + (live ? 'live-tag--live' : 'live-tag--offline');
}

// ─── Quality level selector ───────────────────────────────────────────────────
function populateQualityLevels() {
  if (!hls) return;
  qualitySelect.innerHTML = '<option value="-1">Auto</option>';
  hls.levels.forEach((level, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${level.height}p  ${Math.round(level.bitrate / 1000)} kbps`;
    qualitySelect.appendChild(opt);
  });
}

qualitySelect.addEventListener('change', () => {
  if (!hls) return;
  const val = parseInt(qualitySelect.value, 10);
  hls.currentLevel = val;   // -1 = ABR auto
  logEvent(`Quality → ${val === -1 ? 'Auto ABR' : qualitySelect.options[qualitySelect.selectedIndex].text}`, 'info');
});

// ─── Real-time stats polling ──────────────────────────────────────────────────
function startStatsPolling() {
  stopStatsPolling();
  statsInterval = setInterval(updateStats, 500);
}

function stopStatsPolling() {
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
}

function updateStats() {
  if (!hls || !video) return;

  // ── Resolution ──────────────────────────────────────────
  const level = hls.levels[hls.currentLevel];
  if (level) {
    setStat('resolution', `${level.width}×${level.height}`);
    setStat('bitrate', formatBitrate(level.bitrate));
  }

  // ── Buffer length ────────────────────────────────────────
  if (video.buffered.length > 0) {
    const bufEnd = video.buffered.end(video.buffered.length - 1);
    const bufLen = Math.max(0, bufEnd - video.currentTime);
    setStat('bufferLen', `${bufLen.toFixed(1)} s`);
  }

  // ── Latency (estimated from live edge) ───────────────────
  if (hls.liveSyncPosition != null) {
    const latency = hls.liveSyncPosition - video.currentTime;
    setStat('latency', latency > 0 ? `${latency.toFixed(1)} s` : '—');
  }

  // ── Dropped frames ───────────────────────────────────────
  if (video.getVideoPlaybackQuality) {
    const q = video.getVideoPlaybackQuality();
    setStat('dropped', q.droppedVideoFrames.toLocaleString());
  }

  // ── Bandwidth ─────────────────────────────────────────────
  if (hls.bandwidthEstimate) {
    setStat('bandwidth', formatBitrate(hls.bandwidthEstimate));
  }

  // ── FPS (via playback quality API) ───────────────────────
  if (video.getVideoPlaybackQuality) {
    const q = video.getVideoPlaybackQuality();
    setStat('fps', q.totalVideoFrames > 0 && level?.frameRate
      ? `${level.frameRate} fps`
      : '—');
  }

  setStat('segments', segmentsLoaded.toLocaleString());
}

function formatBitrate(bps) {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000)     return `${Math.round(bps / 1_000)} kbps`;
  return `${bps} bps`;
}

// ─── Reset stats ──────────────────────────────────────────────────────────────
function resetStats() {
  Object.keys(statCards).forEach(k => setStat(k, '—'));
  segmentsLoaded = 0;
}

// ─── Load / destroy HLS instance ─────────────────────────────────────────────
function loadStream(url) {
  // Clean up previous instance
  if (hls) {
    hls.destroy();
    hls = null;
  }

  segmentsLoaded  = 0;
  mediaErrorCount = 0;
  resetStats();
  showSpinner('Connecting…');
  setLiveStatus(false);
  logEvent(`Loading stream: ${url}`, 'info');

  // ── Native HLS (Safari / iOS) ────────────────────────────
  if (!Hls.isSupported()) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
      logEvent('Using native HLS (Safari)', 'info');
      hideSpinner();
      setLiveStatus(true);
      startStatsPolling();
      btnStop.disabled = false;
      btnLoad.disabled = false;
    } else {
      logEvent('HLS not supported in this browser', 'error');
      spinnerMsg.textContent = 'HLS not supported in this browser';
    }
    return;
  }

  // ── hls.js path ──────────────────────────────────────────
  hls = new Hls({
    // Low-latency tuning
    lowLatencyMode      : false,
    maxBufferLength     : 30,
    maxMaxBufferLength  : 60,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 5,
    enableWorker        : true,
    startLevel          : -1,   // auto
    debug               : false,
  });

  // Attach media element
  hls.attachMedia(video);

  // ── Core events ──────────────────────────────────────────
  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    logEvent('Media attached', 'info');
    hls.loadSource(url);
  });

  hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
    logEvent(`Manifest parsed – ${data.levels.length} quality level(s)`, 'success');
    populateQualityLevels();
    hideSpinner();
    setLiveStatus(true);
    startStatsPolling();
    video.play().catch(err => {
      if (err.name === 'NotSupportedError') {
        logEvent('Codec error on play – reloading stream…', 'error');
        setTimeout(() => loadStream(streamUrlInput.value.trim()), 1500);
      } else {
        logEvent(`Autoplay blocked: ${err.message}`, 'warn');
      }
    });
    btnStop.disabled = false;
    btnLoad.disabled = false;
  });

  hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
    const l = hls.levels[data.level];
    if (l) logEvent(`Quality → ${l.height}p @ ${formatBitrate(l.bitrate)}`, 'info');
    qualitySelect.value = data.level;
  });

  hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
    segmentsLoaded++;
    const size = (data.frag.stats.total / 1024).toFixed(1);
    logEvent(`Seg #${segmentsLoaded}  ${data.frag.sn}  ${size} KB`, 'info');
  });

  hls.on(Hls.Events.BUFFER_STALLED, () => {
    showSpinner('Buffering…');
    logEvent('Buffer stalled – waiting for data', 'warn');
  });

  hls.on(Hls.Events.BUFFER_FLUSHED, () => {
    hideSpinner();
  });

  hls.on(Hls.Events.ERROR, (event, data) => {
    if (data.fatal) {
      logEvent(`Fatal error: ${data.type} – ${data.details}`, 'error');
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          logEvent('Network error – retrying…', 'warn');
          showSpinner('Network error – retrying…');
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          mediaErrorCount++;
          if (mediaErrorCount <= 2) {
            logEvent(`Media error – recovering (attempt ${mediaErrorCount})…`, 'warn');
            hls.recoverMediaError();
          } else {
            logEvent('Repeated media errors – doing full reload…', 'warn');
            showSpinner('Reloading…');
            const url = streamUrlInput.value.trim();
            setTimeout(() => loadStream(url), 1500);
          }
          break;
        default:
          logEvent('Unrecoverable error – stopping', 'error');
          stopStream();
          break;
      }
    } else {
      logEvent(`Non-fatal: ${data.details}`, 'warn');
    }
  });

  // ── Video element events ──────────────────────────────────
  video.addEventListener('waiting',  () => showSpinner('Buffering…'), { once: false });
  video.addEventListener('playing',  hideSpinner,                     { once: false });
  video.addEventListener('pause',    () => btnPlayPause.textContent = '▶',  { once: false });
  video.addEventListener('play',     () => btnPlayPause.textContent = '⏸', { once: false });
}

function stopStream() {
  stopStatsPolling();
  if (hls) { hls.destroy(); hls = null; }
  video.src       = '';
  video.removeAttribute('src');
  resetStats();
  setLiveStatus(false);
  showSpinner('Stream stopped');
  btnStop.disabled = true;
  logEvent('Stream stopped', 'info');
}

// ─── UI button handlers ───────────────────────────────────────────────────────
btnLoad.addEventListener('click', () => {
  const url = streamUrlInput.value.trim();
  if (!url) return;
  loadStream(url);
});

btnStop.addEventListener('click', stopStream);

btnPlayPause.addEventListener('click', () => {
  if (video.paused) video.play().catch(() => {});
  else              video.pause();
});

btnMute.addEventListener('click', () => {
  video.muted = !video.muted;
  btnMute.textContent = video.muted ? '🔇' : '🔊';
});

volumeSlider.addEventListener('input', () => {
  video.volume  = volumeSlider.value;
  video.muted   = (volumeSlider.value == 0);
  btnMute.textContent = video.muted ? '🔇' : '🔊';
});

btnFullscreen.addEventListener('click', () => {
  const wrapper = video.closest('.video-wrapper');
  if (!document.fullscreenElement) {
    wrapper.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// ─── Auto-load on page open ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  logEvent('Player ready – connecting…', 'success');
  showSpinner('Connecting to stream…');
  setTimeout(() => loadStream(streamUrlInput.value.trim()), 500);
});
