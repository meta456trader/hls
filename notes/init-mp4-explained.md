# What is init.mp4?

`init.mp4` is the **initialization segment** required by the fMP4 (fragmented MP4) variant of HLS.

## Background

In regular HLS, each `.ts` segment is self-contained — the decoder can start from any segment.  
But when using fMP4 segments (`.m4s` files), the codec metadata is **not** repeated in every segment.  
Instead it is written once into a separate "init" file and referenced in the playlist:

```
#EXT-X-MAP:URI="init.mp4"
```

## What it contains

- Video resolution, codec (H.264), profile/level
- Audio sample rate, channels, codec (AAC)
- Track IDs and timing offsets
- Any other decoder bootstrap information

## Why it is critical

The browser's Media Source Extensions (MSE) API **must** fetch and process `init.mp4` **first**
before it can decode any `.m4s` segment.

If `init.mp4` returns 404:
- hls.js has no decoder context
- Every segment fails with `fragLoadError`
- The player shows "Network error – retrying…" indefinitely

## The bug we fixed (2026-03-20)

FFmpeg was called with the absolute Windows path as the init filename:

```python
# BROKEN – FFmpeg writes this literal string into #EXT-X-MAP:URI
init_path = str(HLS_DIR / "init.mp4")
# → URI="C:\Users\Administrator\Documents\hls\server\hls_output\init.mp4"
```

**Fix 1** – use a relative filename so the playlist contains `URI="init.mp4"`:

```python
init_path = "init.mp4"
```

**Fix 2** – set FFmpeg's working directory to `HLS_DIR` so the file is actually
written into `hls_output/` (not the `server/` directory):

```python
ffmpeg_proc = subprocess.Popen(
    args,
    cwd=str(HLS_DIR),   # ← init.mp4 lands in hls_output/
    ...
)
```
