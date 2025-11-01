const form = document.getElementById('download-form') as HTMLFormElement;
const urlInput = document.getElementById('url') as HTMLInputElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const transcribeBtn = document.getElementById('transcribe-btn') as HTMLButtonElement;
const videoFileInput = document.getElementById('video-file') as HTMLInputElement;
const transcribeFileBtn = document.getElementById('transcribe-file-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const transcriptSection = document.getElementById('transcript-section') as HTMLElement;
const transcriptOutput = document.getElementById('transcript-output') as HTMLPreElement;
const transcriptControls = document.getElementById('transcript-controls') as HTMLDivElement;
const downloadVttLink = document.getElementById('download-vtt') as HTMLAnchorElement;

function setStatus(msg: string, isError = false) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#ff8a8a' : 'var(--muted)';
}

function resetStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

async function download(url: string) {
  setStatus('Preparing your MP4…');
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!res.ok) {
      let err = 'Failed to download.';
      try { const j = await res.json(); if (j?.error) err = j.error; } catch {}
      throw new Error(err);
    }

    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="(.+?)"/i);
    const filename = match?.[1] || 'video.mp4';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    setStatus('Download started. You can submit another link.');
  } catch (e: any) {
    setStatus(e?.message || 'Something went wrong.', true);
  } finally {
    submitBtn.disabled = false;
  }
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  resetStatus();
  const url = urlInput.value.trim();
  if (!url) {
    setStatus('Please paste a YouTube URL.', true);
    return;
  }
  download(url);
});

async function startTranscription(url: string) {
  setStatus('Starting transcription…');
  submitBtn.disabled = true;
  transcribeBtn.disabled = true;
  transcriptSection.hidden = false;
  transcriptControls.hidden = true;
  transcriptOutput.textContent = '';
  try {
    const startRes = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: 'vtt', language: 'en', persist: true })
    });
    if (!startRes.ok) {
      let err = 'Failed to start transcription.';
      try { const j = await startRes.json(); if (j?.error) err = j.error; } catch {}
      throw new Error(err);
    }
    const { jobId } = await startRes.json();
    if (!jobId) throw new Error('No job ID returned');

    // Poll
    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`/api/transcribe/${encodeURIComponent(jobId)}`);
      if (!pollRes.ok) throw new Error('Failed to poll job');
      const data = await pollRes.json();
      if (data.status === 'error') throw new Error(data.error || 'Transcription failed.');
      if (data.status === 'done') {
        done = true;
        setStatus('Transcription complete.');
        if (data.vtt) {
          transcriptOutput.textContent = data.vtt;
          transcriptControls.hidden = false;
          downloadVttLink.href = URL.createObjectURL(new Blob([data.vtt], { type: 'text/vtt' }));
          downloadVttLink.download = data.fileName || 'transcript.vtt';
        } else if (data.downloadUrl) {
          transcriptControls.hidden = false;
          downloadVttLink.href = data.downloadUrl;
          downloadVttLink.download = data.fileName || 'transcript.vtt';
          // Fetch to display
          try {
            const vttRes = await fetch(data.downloadUrl);
            if (vttRes.ok) transcriptOutput.textContent = await vttRes.text();
          } catch {}
        }
        break;
      }
      if (typeof data.progress === 'number') {
        setStatus(`Transcribing… ${Math.max(0, Math.min(100, Math.round(data.progress)))}%`);
      } else {
        setStatus('Transcribing…');
      }
    }
  } catch (e: any) {
    setStatus(e?.message || 'Something went wrong.', true);
  } finally {
    submitBtn.disabled = false;
    transcribeBtn.disabled = false;
  }
}

transcribeBtn.addEventListener('click', () => {
  resetStatus();
  const url = urlInput.value.trim();
  if (!url) {
    setStatus('Please paste a YouTube URL.', true);
    return;
  }
  startTranscription(url);
});

async function startFileTranscription(file: File) {
  setStatus('Uploading file…');
  submitBtn.disabled = true;
  transcribeBtn.disabled = true;
  transcribeFileBtn.disabled = true;
  transcriptSection.hidden = false;
  transcriptControls.hidden = true;
  transcriptOutput.textContent = '';
  try {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('language', 'en');
    formData.append('persist', 'true');

    const startRes = await fetch('/api/transcribe/file', {
      method: 'POST',
      body: formData
    });
    if (!startRes.ok) {
      let err = 'Failed to start transcription.';
      try { const j = await startRes.json(); if (j?.error) err = j.error; } catch {}
      throw new Error(err);
    }
    const { jobId } = await startRes.json();
    if (!jobId) throw new Error('No job ID returned');

    // Poll
    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`/api/transcribe/${encodeURIComponent(jobId)}`);
      if (!pollRes.ok) throw new Error('Failed to poll job');
      const data = await pollRes.json();
      if (data.status === 'error') throw new Error(data.error || 'Transcription failed.');
      if (data.status === 'done') {
        done = true;
        setStatus('Transcription complete.');
        if (data.vtt) {
          transcriptOutput.textContent = data.vtt;
          transcriptControls.hidden = false;
          downloadVttLink.href = URL.createObjectURL(new Blob([data.vtt], { type: 'text/vtt' }));
          downloadVttLink.download = data.fileName || 'transcript.vtt';
        } else if (data.downloadUrl) {
          transcriptControls.hidden = false;
          downloadVttLink.href = data.downloadUrl;
          downloadVttLink.download = data.fileName || 'transcript.vtt';
          // Fetch to display
          try {
            const vttRes = await fetch(data.downloadUrl);
            if (vttRes.ok) transcriptOutput.textContent = await vttRes.text();
          } catch {}
        }
        break;
      }
      if (typeof data.progress === 'number') {
        setStatus(`Transcribing… ${Math.max(0, Math.min(100, Math.round(data.progress)))}%`);
      } else {
        setStatus('Transcribing…');
      }
    }
  } catch (e: any) {
    setStatus(e?.message || 'Something went wrong.', true);
  } finally {
    submitBtn.disabled = false;
    transcribeBtn.disabled = false;
    transcribeFileBtn.disabled = false;
  }
}

transcribeFileBtn.addEventListener('click', () => {
  resetStatus();
  const file = videoFileInput.files?.[0];
  if (!file) {
    setStatus('Please select a video file.', true);
    return;
  }
  startFileTranscription(file);
});
