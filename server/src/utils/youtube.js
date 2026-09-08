import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { DATA_DIR } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTUBE_INFO_SCRIPT = path.join(__dirname, 'pytube_info.py');

const execFileAsync = promisify(execFile);

export function getCookiesFilePath() {
  const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
  return fs.existsSync(cookiesPath) ? cookiesPath : null;
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

  // 1. Tenta extrair com pytubefix (Bypass anti-bot nativo sem precisar de cookies)
  try {
    if (fs.existsSync(PYTUBE_INFO_SCRIPT)) {
      const { stdout } = await execFileAsync('python3', [PYTUBE_INFO_SCRIPT, url], { timeout: 15000 });
      const data = JSON.parse(stdout.trim());
      if (data && data.title && !data.error) {
        return {
          videoId,
          url,
          title: data.title,
          channel: data.channel || 'YouTube',
          duration: data.duration || 0,
          durationFormatted: formatDuration(data.duration || 0),
          thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          views: data.views || null
        };
      }
    }
  } catch (pyErr) {
    console.warn(`[YouTube] pytube_info falhou (${pyErr.message}). Tentando yt-dlp...`);
  }

  // 2. Fallback com yt-dlp
  try {
    const args = [
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=android,ios,web'
    ];

    const cookiesPath = getCookiesFilePath();
    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }

    args.push(url);

    const { stdout } = await execFileAsync('yt-dlp', args, { timeout: 15000 });
    const data = JSON.parse(stdout);
    return {
      videoId,
      url,
      title: data.title || 'Vídeo do YouTube',
      channel: data.uploader || data.channel || 'Desconhecido',
      duration: data.duration || 0,
      durationFormatted: formatDuration(data.duration || 0),
      thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      views: data.view_count || null
    };
  } catch (err) {
    console.warn(`[YouTube] yt-dlp não disponível ou falhou (${err.message}). Tentando oEmbed fallback...`);
  }

  // 2. Fallback via oEmbed (doesn't require yt-dlp or API key)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      return {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: data.title || 'Vídeo do YouTube',
        channel: data.author_name || 'Desconhecido',
        duration: 0, // oEmbed doesn't include duration
        durationFormatted: 'Aguardando download',
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      };
    }
  } catch (oembedErr) {
    console.warn(`[YouTube] oEmbed falhou: ${oembedErr.message}`);
  }

  // 3. Fallback genérico com o ID extraído
  return {
    videoId,
    url,
    title: `Vídeo YouTube (${videoId})`,
    channel: 'YouTube',
    duration: 0,
    durationFormatted: 'Aguardando download',
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  };
}
