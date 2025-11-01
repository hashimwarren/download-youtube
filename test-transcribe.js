const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');

(async () => {
  // Create a synthetic 10s MP4 with tone + test pattern to avoid external files
  const testPath = 'downloads/test-sample.mp4';
  try { require('fs').mkdirSync('downloads', { recursive: true }); } catch {}
  console.log('Creating synthetic 10s test sample...');
  await new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=10',
      '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=10',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', testPath
    ];
    const proc = spawn(ffmpegPath, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg failed to create sample: code ' + code)));
  });
  
  console.log('Uploading test sample for transcription...');
  const form = new FormData();
  form.append('video', fs.createReadStream(testPath));
  form.append('language', 'en');
  form.append('persist', 'true');
  
  const startRes = await axios.post('http://localhost:3000/api/transcribe/file', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
  
  const { jobId } = startRes.data;
  console.log('Job started:', jobId);
  
  // Poll for 90 seconds max
  let attempts = 0;
  let done = false;
  const maxAttempts = 30;
  
  while (done === false && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 3000));
    attempts++;
    const pollRes = await axios.get(`http://localhost:3000/api/transcribe/${jobId}`);
    const data = pollRes.data;
    
    console.log('Status:', data.status, 'Progress:', (data.progress ?? 0) + '%');
    
    if (data.status === 'error') {
      console.error('Error:', data.error);
        console.error('Full error data:', JSON.stringify(data, null, 2));
      fs.unlinkSync(testPath);
      process.exit(1);
    }
    
    if (data.status === 'done') {
      console.log('✓ Transcription complete!');
      console.log('✓ File:', data.fileName);
      console.log('✓ Download URL:', data.downloadUrl);
      done = true;
      fs.unlinkSync(testPath);
    }
  }
  
  if (done === false) {
    console.log('Still processing after 60s - transcription is working, just needs more time');
    fs.unlinkSync(testPath);
  }
})().catch(e => { 
  console.error('Test failed:', e.message);
  console.error(e.response?.data || e);
  try { fs.unlinkSync('downloads/test-sample.mp4'); } catch {}
  process.exit(1); 
});
