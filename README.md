# YouTube Downloader (Node.js)

This simple script downloads a YouTube video and merges the best video and audio streams into a single file.

By default it outputs `.mkv` for maximum compatibility without re-encoding (fast).
You can also request `.mp4` via a flag; the script will prefer MP4 streams and remux to MP4 when possible.

Only download content you have the rights or permission to download. Respect YouTube's Terms of Service and your local laws.

## Prerequisites

- Node.js 18+ recommended

## Install

Dependencies are already listed in `package.json`. If needed, install them:

```bash
npm install
```

## Web UI

Start the server and open the UI:

```bash
npm run build
npm start
```

Paste a YouTube URL, then either:
- Get MP4 — downloads the MP4 file.
- Transcribe to VTT — generates and lets you download a .vtt transcript.

To enable transcription, configure a self-hosted OpenAI-compatible Whisper server via `.env`:

```
WHISPER_BASE_URL=http://localhost:11434
WHISPER_API_KEY=
WHISPER_MODEL=whisper-1
TRANSCRIPT_LANG=en
TRANSCRIPT_OUTPUT=vtt
TRANSCRIPT_CHUNK_MIN=15
```

Notes:
- The server downloads audio-only, splits long audio into chunks, calls your Whisper server for each, then merges captions into a single VTT.
- Default language is English; set `TRANSCRIPT_LANG` for other languages or auto-detection.
- Transcripts are saved to the `downloads/` folder and can be fetched via `GET /api/transcripts/:file`.

## CLI Usage

Run with default URL (the script uses the provided video by default):

```bash
node index.js
```

Show info only (no download):

```bash
node index.js --info
```

Specify a URL:

```bash
node index.js --url "https://www.youtube.com/watch?v=ngDCxlZcecw"
```

Choose output directory or file:

```bash
# Save to a directory (auto-filename)
node index.js --out "./downloads"

# Save to a specific file name
node index.js --out "./downloads/myfile.mkv"
# Output MP4 instead of MKV
```

Output MP4 instead of MKV:

```bash
# Auto filename with mp4 extension
node index.js --mp4

# Explicit URL and directory
node index.js --mp4 --url "https://www.youtube.com/watch?v=ngDCxlZcecw" --out "./downloads"

# Save to a specific mp4 filename
node index.js --url "https://www.youtube.com/watch?v=ngDCxlZcecw" --out "./downloads/myfile.mp4"
```

## Notes

- The script bundles ffmpeg via `ffmpeg-static`; no system install required.
- Default container is MKV to avoid re-encoding and keep it fast and high quality.
- MP4 mode prefers MP4-compatible streams (video mp4, audio m4a) and remuxes to MP4 when possible. If your video only has incompatible streams, yt-dlp may fall back to non-MP4 or fail to remux without re-encoding. If you need forced re-encode to MP4, we can add an option; note it is slower.
- Transcription requires a self-hosted Whisper server exposing an OpenAI-compatible `POST /v1/audio/transcriptions` endpoint. The request includes fields `model`, `language`, `response_format=vtt`, and the uploaded `file`.
