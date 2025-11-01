const fs = require('fs');
const path = require('path');
const os = require('os');
const ytdlp = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');
const sanitize = require('sanitize-filename');
const { OpenAIVoice } = require('@mastra/voice-openai');

// Configuration defaults
const DEFAULT_CHUNK_SECONDS = Number(process.env.TRANSCRIPT_CHUNK_MIN || 15) * 60; // minutes -> seconds
const DEFAULT_CHUNK_OVERLAP = 2; // seconds
const DEFAULT_LANGUAGE = process.env.TRANSCRIPT_LANG || 'en';
const DEFAULT_FORMAT = (process.env.TRANSCRIPT_OUTPUT || 'vtt').toLowerCase();

// Initialize Mastra OpenAI Voice
// This will use OPENAI_API_KEY from environment or WHISPER_API_KEY if provided
const WHISPER_API_KEY = process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || '';
const WHISPER_BASE_URL = process.env.WHISPER_BASE_URL || '';

let mastraVoice;

function initializeMastraVoice() {
  if (mastraVoice) return mastraVoice;
  
  const config = {
    listeningModel: {
      name: 'whisper-1',
      apiKey: WHISPER_API_KEY
    },
    speechModel: {
      name: 'tts-1',
      apiKey: WHISPER_API_KEY  // Use same key for speech (though we only use listening)
    }
  };
  
  mastraVoice = new OpenAIVoice(config);
  
  // If custom base URL is provided, override the OpenAI client
  if (WHISPER_BASE_URL && WHISPER_BASE_URL.trim().length > 0) {
    const OpenAI = require('openai');
    const baseURL = WHISPER_BASE_URL.endsWith('/v1') 
      ? WHISPER_BASE_URL 
      : `${WHISPER_BASE_URL}/v1`;
    
    mastraVoice.listeningClient = new OpenAI({
      apiKey: WHISPER_API_KEY,
      baseURL
    });
  }
  
  return mastraVoice;
}

async function getVideoTitle(url) {
  try {
    const infoJson = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
      skipDownload: true
    });
    let info;
    if (typeof infoJson === 'string') {
      info = JSON.parse(infoJson);
    } else if (infoJson && typeof infoJson === 'object' && !infoJson.stdout) {
      info = infoJson;
    } else if (infoJson && typeof infoJson.stdout === 'string') {
      info = JSON.parse(infoJson.stdout);
    }
    const titleRaw = info?.title || 'video';
    return sanitize(titleRaw).trim() || 'video';
  } catch {
    return 'video';
  }
}

async function downloadAudioOnly(url, outPath) {
  const flags = {
    extractAudio: true,
    audioFormat: 'm4a',
    audioQuality: 0,
    output: outPath,
    ffmpegLocation: ffmpegPath,
    noWarnings: true
  };
  await new Promise((resolve, reject) => {
    const proc = ytdlp.exec(url, flags, { stdio: 'pipe' });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`))));
  });
}

function formatTimeVtt(totalMs) {
  const ms = Math.floor(totalMs % 1000);
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad = (n, z = 2) => String(n).padStart(z, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad3(ms)}`;
}

function parseTimestampToMs(ts) {
  // Expects HH:MM:SS.mmm
  const m = ts.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (!m) return 0;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4]);
  return (((h * 60 + mi) * 60) + s) * 1000 + ms;
}

function shiftVttTimestamps(vttText, offsetSeconds) {
  const offsetMs = Math.round(offsetSeconds * 1000);
  const lines = vttText.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Timestamp line example: 00:00:01.000 --> 00:00:04.000
    if (/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(line)) {
      const [left, right] = line.split(/\s+-->\s+/);
      const start = parseTimestampToMs(left);
      const end = parseTimestampToMs(right);
      const newStart = Math.max(0, start + offsetMs);
      const newEnd = Math.max(newStart, end + offsetMs);
      out.push(`${formatTimeVtt(newStart)} --> ${formatTimeVtt(newEnd)}`);
    } else if (/^WEBVTT/i.test(line)) {
      if (out.length === 0) out.push('WEBVTT');
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

async function segmentAudio(inputFile, segmentSeconds, overlapSeconds, tmpDir, onProgress) {
  console.log('[Transcription] Segmenting audio into chunks...');
  const segmentPattern = path.join(tmpDir, 'seg-%04d.wav');
  const { spawn } = require('child_process');
  const args = [
    '-hide_banner', '-y',
    '-i', inputFile,
    '-f', 'segment',
    '-segment_time', String(segmentSeconds),
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    segmentPattern
  ];
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  
  const files = (await fs.promises.readdir(tmpDir))
    .filter(f => /^seg-\d{4}\.wav$/.test(f))
    .sort();
  const segments = files.map((f, i) => ({
    file: path.join(tmpDir, f),
    offsetSeconds: i * segmentSeconds
  }));
  console.log(`[Transcription] Created ${segments.length} audio segments`);
  if (onProgress) {
    try { onProgress(30); } catch {}
  }
  return segments;
}

async function transcribeFileVtt(filePath, language = DEFAULT_LANGUAGE, onProgress) {
  const voice = initializeMastraVoice();
  
  if (!voice.listeningClient) {
    throw new Error('Mastra listening client not configured. Ensure OPENAI_API_KEY or WHISPER_API_KEY is set.');
  }
  
  console.log('[Transcription] Transcribing with Mastra OpenAIVoice...');
  if (onProgress) { try { onProgress(50); } catch {} }
  
  // Use Mastra's underlying OpenAI client to get VTT format
  // We need to use the client directly because Mastra's listen() only returns text
  const file = await fs.promises.readFile(filePath);
  const fileObj = new File([file], path.basename(filePath));
  
  try {
    const response = await voice.listeningClient.audio.transcriptions.create({
      model: 'whisper-1',
      file: fileObj,
      response_format: 'vtt',
      language: language,
      temperature: 0
    });
    
    console.log('[Transcription] Mastra transcription successful');
    if (onProgress) { try { onProgress(70); } catch {} }
    
    // The response will be the VTT text directly
    return response;
  } catch (e) {
    const status = e?.response?.status;
    const data = e?.response?.data;
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    const msg = `Mastra transcription failed${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`;
    throw new Error(msg);
  }
}

async function transcribeUrlToVtt({ url, chunkSeconds = DEFAULT_CHUNK_SECONDS, language = DEFAULT_LANGUAGE, onProgress }) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yttr-'));
  const audioPath = path.join(tmpDir, 'audio.m4a');

  try {
    console.log('[Transcription] Downloading audio from YouTube…');
    if (onProgress) { try { onProgress(10); } catch {} }
    await downloadAudioOnly(url, audioPath);
    if (onProgress) { try { onProgress(20); } catch {} }

    const segments = await segmentAudio(audioPath, chunkSeconds, DEFAULT_CHUNK_OVERLAP, tmpDir, onProgress);

    const parts = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      console.log(`[Transcription] Transcribing segment ${i + 1}/${segments.length} with Mastra`);
      const vtt = await transcribeFileVtt(seg.file, language, onProgress);
      const shifted = shiftVttTimestamps(String(vtt), seg.offsetSeconds);
      const clean = i === 0 ? shifted : shifted.replace(/^WEBVTT\s*\n?/, '');
      parts.push(clean.trim());
      if (onProgress) {
        const pct = 30 + Math.floor(((i + 1) / segments.length) * 55);
        try { onProgress(Math.min(85, pct)); } catch {}
      }
    }

    let combined = parts.join('\n\n').trim();
    if (!/^WEBVTT/.test(combined)) {
      combined = 'WEBVTT\n\n' + combined;
    }

    const title = await getVideoTitle(url);
    const fileName = `${title}.vtt`;

    if (onProgress) { try { onProgress(90); } catch {} }
    return { vtt: combined, fileName, tmpDir, audioPath };
  } catch (err) {
    try { await fs.promises.unlink(audioPath); } catch {}
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

async function extractAudioFromVideo(videoPath, outAudioPath, onProgress) {
  console.log('[Transcription] Extracting audio from video...');
  const { spawn } = require('child_process');
  const args = [
    '-hide_banner', '-y',
    '-i', videoPath,
    '-vn',
    '-acodec', 'aac',
    '-b:a', '192k',
    outAudioPath
  ];
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[Transcription] Audio extraction complete');
        resolve();
      } else {
        reject(new Error(`ffmpeg exited ${code}`));
      }
    });
  });
  if (onProgress) { try { onProgress(20); } catch {} }
}

async function transcribeLocalFileToVtt({ filePath, chunkSeconds = DEFAULT_CHUNK_SECONDS, language = DEFAULT_LANGUAGE, onProgress }) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yttr-'));
  const audioPath = path.join(tmpDir, 'audio.m4a');

  try {
    await extractAudioFromVideo(filePath, audioPath, onProgress);
    const segments = await segmentAudio(audioPath, chunkSeconds, DEFAULT_CHUNK_OVERLAP, tmpDir, onProgress);

    const parts = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      console.log(`[Transcription] Transcribing segment ${i + 1}/${segments.length} with Mastra`);
      const vtt = await transcribeFileVtt(seg.file, language, onProgress);
      const shifted = shiftVttTimestamps(String(vtt), seg.offsetSeconds);
      const clean = i === 0 ? shifted : shifted.replace(/^WEBVTT\s*\n?/, '');
      parts.push(clean.trim());
      if (onProgress) {
        const pct = 30 + Math.floor(((i + 1) / segments.length) * 55);
        try { onProgress(Math.min(85, pct)); } catch {}
      }
    }

    let combined = parts.join('\n\n').trim();
    if (!/^WEBVTT/.test(combined)) {
      combined = 'WEBVTT\n\n' + combined;
    }

    const baseName = path.basename(filePath, path.extname(filePath));
    const fileName = `${sanitize(baseName)}.vtt`;

    if (onProgress) { try { onProgress(90); } catch {} }
    return { vtt: combined, fileName, tmpDir, audioPath };
  } catch (err) {
    try { await fs.promises.unlink(audioPath); } catch {}
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

module.exports = {
  transcribeUrlToVtt,
  transcribeLocalFileToVtt,
};
