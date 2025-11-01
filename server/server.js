require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { z } = require('zod');
const sanitize = require('sanitize-filename');
const ytdlp = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');
const { transcribeUrlToVtt, transcribeLocalFileToVtt } = require('./mastra-transcription');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer config for file uploads
const upload = multer({ 
  dest: path.join(os.tmpdir(), 'uploads'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB max
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const RequestSchema = z.object({
  url: z.string().url().refine(v => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(v), {
    message: 'Must be a YouTube URL'
  })
});

app.post('/api/download', async (req, res) => {
  const parse = RequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.issues.map(i => i.message).join('; ') });
  }
  const url = parse.data.url;

  // Create temp dir and file path
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ytmp-'));
  const baseName = sanitize(`video-${Date.now()}.mp4`) || `video-${Date.now()}.mp4`;
  const outPath = path.join(tmpDir, baseName);

  // Build flags to prefer mp4
  const flags = {
    format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best',
    mergeOutputFormat: 'mp4',
    remuxVideo: 'mp4',
    output: outPath,
    ffmpegLocation: ffmpegPath,
    noWarnings: true
  };

  try {
    await new Promise((resolve, reject) => {
      const proc = ytdlp.exec(url, flags, { stdio: 'pipe' });
      proc.on('error', reject);
      proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`))));
    });

    const stat = await fs.promises.stat(outPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}"`);

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('close', async () => {
      try { await fs.promises.unlink(outPath); } catch {}
      try { await fs.promises.rmdir(tmpDir); } catch {}
    });
  } catch (err) {
    // Cleanup on error
    try { await fs.promises.unlink(outPath); } catch {}
    try { await fs.promises.rmdir(tmpDir); } catch {}
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to process download.' });
  }
});

// In-memory job store (simple; resets on server restart)
const jobs = new Map();
let jobCounter = 0;

const TranscribeRequestSchema = z.object({
  url: z.string().url().refine(v => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(v), {
    message: 'Must be a YouTube URL'
  }),
  format: z.enum(['vtt']).optional(),
  language: z.string().optional(),
  persist: z.boolean().optional()
});

app.post('/api/transcribe', async (req, res) => {
  const parse = TranscribeRequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.issues.map(i => i.message).join('; ') });
  }
  const { url, format = 'vtt', language = process.env.TRANSCRIPT_LANG || 'en', persist = true } = parse.data;

  const id = String(++jobCounter) + '-' + Date.now();
  jobs.set(id, { status: 'queued', progress: 0 });
  res.json({ jobId: id });

  // Process asynchronously
  (async () => {
    try {
      jobs.set(id, { status: 'processing', progress: 5 });
      const result = await transcribeUrlToVtt({
        url,
        language,
        onProgress: (p) => {
          const pct = Math.max(5, Math.min(89, Math.round(Number(p) || 0)));
          jobs.set(id, { status: 'processing', progress: pct });
        }
      });
      jobs.set(id, { status: 'processing', progress: 90 });

      let downloadPath = null;
      let downloadUrl = null;
      const vttText = result.vtt;
      const fileName = sanitize(result.fileName || `transcript-${Date.now()}.vtt`);

      if (persist) {
        const outDir = path.join(process.cwd(), 'downloads');
        try { await fs.promises.mkdir(outDir, { recursive: true }); } catch {}
        downloadPath = path.join(outDir, fileName);
        await fs.promises.writeFile(downloadPath, vttText, 'utf8');
        downloadUrl = `/api/transcripts/${encodeURIComponent(fileName)}`;
      }

      jobs.set(id, {
        status: 'done',
        progress: 100,
        format,
        language,
        fileName,
        vtt: persist ? undefined : vttText,
        downloadUrl
      });

      // cleanup temp dir
      try { await fs.promises.rm(result.tmpDir, { recursive: true, force: true }); } catch {}
    } catch (err) {
      console.error('Transcription error (URL job):', err);
      const msg = (err && (err.message || err.stack)) ? (err.message || err.stack) : String(err);
      jobs.set(id, { status: 'error', error: msg || 'Failed to transcribe.' });
    }
  })();
});

app.post('/api/transcribe/file', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const language = req.body.language || process.env.TRANSCRIPT_LANG || 'en';
  const persist = req.body.persist !== 'false';

  const id = String(++jobCounter) + '-' + Date.now();
  jobs.set(id, { status: 'queued', progress: 0 });
  res.json({ jobId: id });

  const uploadedPath = req.file.path;

  // Process asynchronously
  (async () => {
    try {
      jobs.set(id, { status: 'processing', progress: 5 });
      const result = await transcribeLocalFileToVtt({
        filePath: uploadedPath,
        language,
        onProgress: (p) => {
          const pct = Math.max(5, Math.min(89, Math.round(Number(p) || 0)));
          jobs.set(id, { status: 'processing', progress: pct });
        }
      });
      jobs.set(id, { status: 'processing', progress: 90 });

      let downloadUrl = null;
      const vttText = result.vtt;
      const fileName = sanitize(result.fileName || `transcript-${Date.now()}.vtt`);

      if (persist) {
        const outDir = path.join(process.cwd(), 'downloads');
        try { await fs.promises.mkdir(outDir, { recursive: true }); } catch {}
        const downloadPath = path.join(outDir, fileName);
        await fs.promises.writeFile(downloadPath, vttText, 'utf8');
        downloadUrl = `/api/transcripts/${encodeURIComponent(fileName)}`;
      }

      jobs.set(id, {
        status: 'done',
        progress: 100,
        format: 'vtt',
        language,
        fileName,
        vtt: persist ? undefined : vttText,
        downloadUrl
      });

      // cleanup
      try { await fs.promises.unlink(uploadedPath); } catch {}
      try { await fs.promises.rm(result.tmpDir, { recursive: true, force: true }); } catch {}
    } catch (err) {
      console.error('Transcription error (file job):', err);
      const msg = (err && (err.message || err.stack)) ? (err.message || err.stack) : String(err);
      jobs.set(id, { status: 'error', error: msg || 'Failed to transcribe file.' });
      try { await fs.promises.unlink(uploadedPath); } catch {}
    }
  })();
});

app.get('/api/transcribe/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Serve saved transcripts
app.get('/api/transcripts/:file', async (req, res) => {
  const file = sanitize(req.params.file || '');
  if (!file || !/\.vtt$/i.test(file)) return res.status(400).json({ error: 'Invalid file' });
  const full = path.join(process.cwd(), 'downloads', file);
  try {
    const stat = await fs.promises.stat(full);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    fs.createReadStream(full).pipe(res);
  } catch {
    res.status(404).json({ error: 'Transcript not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Web server listening on http://localhost:${PORT}`);
});
