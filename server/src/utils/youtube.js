import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { DATA_DIR } from '../db.js';
import { resolveVideoInfo } from './web_downloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTUBE_INFO_SCRIPT = path.join(__dirname, 'pytube_info.py');

const execFileAsync = promisify(execFile);

export function getCookiesFilePath() {
  const candidates = [
    path.join(DATA_DIR, 'cookies.txt'),
    path.resolve(__dirname, '../../../data/cookies.txt'),
    path.resolve(__dirname, '../../data/cookies.txt'),
    '/app/data/cookies.txt'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 20) {
      return p;
    }
  }
  return null;
}

export function extractYouTubeId(url) {
  if (!url) return null;
  const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export async function fetchVideoInfo(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    throw new Error('URL inválida do YouTube. Insira um link válido do YouTube.');
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const cookiesPath = getCookiesFilePath();

  // 1. Fast-Path: yt-dlp nativo com cookies (Precisão 100% de primeira)
  const ytAttempts = [
    { cmd: 'python3', args: ['-m', 'yt_dlp'] },
    { cmd: 'yt-dlp', args: [] }
  ];

  for (const attempt of ytAttempts) {
    try {
      const args = [
        ...attempt.args,
        '--dump-json',
        '--no-warnings',
        '--no-playlist',
        '--extractor-args', 'youtube:player_client=android,web'
      ];
      if (cookiesPath) {
        args.push('--cookies', cookiesPath);
      }
      args.push(cleanUrl);

      const { stdout } = await execFileAsync(attempt.cmd, args, { timeout: 12000 });
      // Remove warnings de bibliotecas para extrair apenas o JSON
      const jsonLine = stdout.trim().split('\n').find(l => l.trim().startsWith('{'));
      if (jsonLine) {
        const data = JSON.parse(jsonLine);
        return {
          videoId,
          url: cleanUrl,
          title: data.title || 'Vídeo do YouTube',
          channel: data.uploader || data.channel || 'Desconhecido',
          duration: data.duration || 0,
          durationFormatted: formatDuration(data.duration || 0),
          thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          views: data.view_count || null
        };
      }
    } catch (_) {
      continue;
    }
  }

  // 2. Fallback Ultrarrápido via oEmbed Oficial do YouTube (200ms, sem bloqueio de bot)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      return {
        videoId,
        url: cleanUrl,
        title: data.title || 'Vídeo do YouTube',
        channel: data.author_name || 'Desconhecido',
        duration: 0,
        durationFormatted: '00:00',
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        views: null
      };
    }
  } catch (_) {}

  // 3. Fallback pytubefix
  try {
    if (fs.existsSync(PYTUBE_INFO_SCRIPT)) {
      const { stdout } = await execFileAsync('python3', [PYTUBE_INFO_SCRIPT, cleanUrl], { timeout: 10000 });
      const data = JSON.parse(stdout.trim());
      if (data && data.title && !data.error) {
        return {
          videoId,
          url: cleanUrl,
          title: data.title,
          channel: data.channel || 'YouTube',
          duration: data.duration || 0,
          durationFormatted: formatDuration(data.duration || 0),
          thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          views: data.views || null
        };
      }
    }
  } catch (_) {}

  // 4. Fallback genérico
  return {
    videoId,
    url: cleanUrl,
    title: `Vídeo YouTube (${videoId})`,
    channel: 'YouTube',
    duration: 0,
    durationFormatted: 'Aguardando',
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  };
}
