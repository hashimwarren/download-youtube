#!/usr/bin/env node

/*
  YouTube downloader script
  - Defaults to: https://www.youtube.com/watch?v=ngDCxlZcecw
  - Merges best video+audio into an .mkv without re-encoding (fast)
  - Requires ffmpeg (bundled via ffmpeg-static)

  Usage:
    node index.js [--url <youtube_url>] [--out <output_dir_or_file>] [--info] [--mp4]

  Examples:
    node index.js --info
    node index.js --url "https://www.youtube.com/watch?v=ngDCxlZcecw"
    node index.js --out "./downloads"
    node index.js --out "./downloads/myfile.mkv"

  Notes:
    - Only download content you have the rights or permission to download.
    - Respect YouTube's Terms of Service and local laws.
*/

const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');
const ffmpegPath = require('ffmpeg-static');
const ytdlp = require('yt-dlp-exec');

const DEFAULT_URL = 'https://www.youtube.com/watch?v=ngDCxlZcecw';

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: process.cwd(), info: false, mp4: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) { args.url = argv[++i]; continue; }
    if (a === '--out' && argv[i + 1]) { args.out = argv[++i]; continue; }
    if (a === '--info') { args.info = true; continue; }
    if (a === '--mp4') { args.mp4 = true; continue; }
    if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`\nUsage: node index.js [--url <youtube_url>] [--out <output_dir_or_file>] [--info] [--mp4]\n`);
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function isLikelyFilePath(p) {
  // Heuristic: contains an extension or ends with .mkv/.mp4/etc
  return /\.[a-zA-Z0-9]{2,6}$/.test(p);
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args.url || DEFAULT_URL;

  console.log('Fetching video info...');
  const infoJson = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCallHome: true,
    preferFreeFormats: true,
    skipDownload: true
  });
  let info;
  try {
    // yt-dlp-exec may resolve to parsed JSON or raw stdout; handle both
    if (typeof infoJson === 'string') {
      info = JSON.parse(infoJson);
    } else if (infoJson && typeof infoJson === 'object' && !infoJson.stdout) {
      info = infoJson;
    } else if (infoJson && typeof infoJson.stdout === 'string') {
      info = JSON.parse(infoJson.stdout);
    } else {
      throw new Error('Unexpected metadata output');
    }
  } catch (e) {
    console.error('Failed to parse video metadata.');
    throw e;
  }
  const titleRaw = info?.title || 'video';
  const title = sanitize(titleRaw).trim() || 'video';

  if (args.info) {
    console.log(`\nTitle: ${titleRaw}`);
    console.log(`Channel: ${info?.uploader || info?.channel || 'Unknown'}`);
    console.log(`Length: ${info?.duration || info?.duration_string || 'Unknown'}`);
    console.log(`Views: ${info?.view_count || 'Unknown'}`);
    console.log(`URL: ${url}`);
    return; // info-only mode
  }

  // Determine output path
  let outputPath = args.out;
  let outputDir = process.cwd();
  if (isLikelyFilePath(outputPath)) {
    outputDir = path.dirname(path.resolve(outputPath));
    await ensureDir(outputDir);
  } else {
    // treat as directory; ensure exists and produce filename
    outputDir = path.resolve(outputPath);
    await ensureDir(outputDir);
    outputPath = path.join(outputDir, `${title}.${args.mp4 ? 'mp4' : 'mkv'}`);
  }

  console.log(`\nDownloading: ${titleRaw}`);
  console.log(`Output: ${outputPath}`);

  // Build yt-dlp flags
  const mp4Preferred = args.mp4 || (isLikelyFilePath(args.out) && String(args.out).toLowerCase().endsWith('.mp4'));
  const flags = {
    // Prefer mp4 video+audio when requested; otherwise best quality regardless of container
    format: mp4Preferred
      ? 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]'
      : 'bv*+ba/best',
    output: outputPath,
    ffmpegLocation: ffmpegPath,
    noWarnings: true
  };
  if (mp4Preferred) {
    // Try to remux to mp4 if needed without re-encoding
    flags.mergeOutputFormat = 'mp4';
    flags.remuxVideo = 'mp4';
  } else {
    flags.mergeOutputFormat = 'mkv';
  }

  // Let yt-dlp handle fetching and merging via ffmpeg-static
  const proc = ytdlp.exec(url, flags, { stdio: 'pipe' });

  await new Promise((resolve, reject) => {
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.stdout.on('data', (d) => process.stdout.write(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`yt-dlp exited with code ${code}`));
    });
  });

  console.log('Done.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
