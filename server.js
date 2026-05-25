const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Sajikan file HTML frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper: jalankan perintah ───────────────────────────
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout.trim());
    });
  });
}

// ── Validasi URL TikTok ─────────────────────────────────
function isValidTikTok(url) {
  return /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(url);
}

// ── API: ambil info video ───────────────────────────────
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidTikTok(url)) {
    return res.status(400).json({ error: 'URL TikTok tidak valid.' });
  }

  try {
    // Ambil metadata video (judul, thumbnail, durasi)
    const infoJson = await run(
      `python -m yt_dlp --no-warnings --dump-json --no-playlist "${url}"`
    );
    const info = JSON.parse(infoJson);

    res.json({
      title: info.title || 'TikTok Video',
      thumbnail: info.thumbnail || '',
      duration: info.duration || 0,
      uploader: info.uploader || 'Unknown',
    });
  } catch (err) {
    console.error('[INFO ERROR]', err);
    res.status(500).json({ error: 'Gagal mengambil info video. Cek apakah URL valid.' });
  }
});

// ── API: download video (MP4 tanpa watermark) ───────────
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;

  if (!url || !isValidTikTok(url)) {
    return res.status(400).json({ error: 'URL tidak valid.' });
  }

  const tmpDir = os.tmpdir();
  const filename = `vidsnap_${Date.now()}`;
  const isAudio = format === 'mp3';
  const outPath = path.join(tmpDir, isAudio ? `${filename}.mp3` : `${filename}.mp4`);

  try {
    if (isAudio) {
      // Download audio saja
      await run(
        `python -m yt_dlp --no-warnings -x --audio-format mp3 -o "${outPath}" "${url}"`
      );
    } else {
      // Download video MP4 tanpa watermark (kualitas terbaik)
      await run(
        `python -m yt_dlp --no-warnings -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${outPath}" "${url}"`
      );
    }

    if (!fs.existsSync(outPath)) {
      throw new Error('File tidak terbuat.');
    }

    const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';
    const dlFilename = isAudio ? 'vidsnap_audio.mp3' : 'vidsnap_video.mp4';

    res.setHeader('Content-Disposition', `attachment; filename="${dlFilename}"`);
    res.setHeader('Content-Type', mimeType);

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);

    // Hapus file sementara setelah selesai dikirim
    stream.on('end', () => {
      fs.unlink(outPath, () => {});
    });
    stream.on('error', () => {
      fs.unlink(outPath, () => {});
      res.status(500).end();
    });

  } catch (err) {
    console.error('[DOWNLOAD ERROR]', err);
    if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
    res.status(500).json({ error: 'Gagal mengunduh video.' });
  }
});

// ── Jalankan server ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ VidSnap server berjalan di http://localhost:${PORT}`);
  console.log(`   Buka browser dan akses http://localhost:${PORT}\n`);
});
