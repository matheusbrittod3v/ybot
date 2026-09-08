import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { db, DATA_DIR, MEDIA_DIR } from '../db.js';
import { extractYouTubeId } from '../utils/youtube.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTUBE_DOWNLOADER_SCRIPT = path.join(__dirname, '../utils/pytube_downloader.py');

class DownloaderEngine {
  constructor() {
    this.activeDownload = null; // { itemId, proc, promiseResolve }
    this.isChecking = false;
    this.listeners = new Set();
  }

  onEvent(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  broadcast(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch (err) {
        console.error('[Downloader] Erro em listener:', err.message);
      }
    }
  }

  getFilePath(id) {
    return path.join(MEDIA_DIR, `${id}.mp4`);
  }

  /**
   * Checa e gerencia os downloads da fila:
   * Garante que apenas o vídeo ATUAL e o PRÓXIMO fiquem baixados no disco,
   * poupando espaço na VPS!
   */
  async checkQueue(activePlayingId = null) {
    if (this.isChecking || this.activeDownload) {
      return;
    }
    this.isChecking = true;

    try {
      const queue = db.getQueue();
      if (queue.length === 0) {
        this.isChecking = false;
        return;
      }

      // Identifica o vídeo atual (ou primeiro não finalizado)
      let currentIdx = queue.findIndex(i => i.status === 'playing' || (activePlayingId && i.id === activePlayingId));
      if (currentIdx === -1) {
        currentIdx = queue.findIndex(i => i.status !== 'finished');
      }

      if (currentIdx === -1) {
        this.isChecking = false;
        return;
      }

      const currentItem = queue[currentIdx];
      const nextItem = queue.slice(currentIdx + 1).find(i => i.status !== 'finished');

      // 1. Se o vídeo atual não estiver baixado ou com arquivo ausente, baixa ele primeiro!
      const currentFilePath = this.getFilePath(currentItem.id);
      const currentHasFile = fs.existsSync(currentFilePath) && fs.statSync(currentFilePath).size > 10240;

      if (!currentHasFile && currentItem.status !== 'downloading') {
        console.log(`[Downloader] Prioridade: Baixando vídeo atual da programação (${currentItem.title})`);
        await this.downloadItem(currentItem);
        this.isChecking = false;
        return;
      }

      // 2. Se o vídeo atual já está pronto/baixado, baixa antecipadamente o PRÓXIMO da fila!
      if (nextItem) {
        const nextFilePath = this.getFilePath(nextItem.id);
        const nextHasFile = fs.existsSync(nextFilePath) && fs.statSync(nextFilePath).size > 10240;

        if (!nextHasFile && nextItem.status !== 'downloading') {
          console.log(`[Downloader] Pré-download do próximo vídeo para troca suave (${nextItem.title})`);
          await this.downloadItem(nextItem);
        } else if (nextHasFile && nextItem.status !== 'ready' && nextItem.status !== 'playing') {
          db.updateQueueItem(nextItem.id, {
            status: 'ready',
            downloadProgress: 100,
            filePath: nextFilePath
          });
        }
      }

      // 3. Garantia de economia de espaço:
      // Qualquer outro vídeo que NÃO seja o atual e NÃO seja o próximo não deve ocupar disco
      this.enforceStorageLimits(currentItem?.id, nextItem?.id);

    } catch (err) {
      console.error('[Downloader] Erro em checkQueue:', err.message);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Orquestra o download com prioridade para a biblioteca nativa pytubefix
   * (que possui bypass anti-bot automático sem exigir upload de cookies)
   * e fallback transparente para yt-dlp.
   */
  async downloadItem(item) {
    if (this.activeDownload) {
      console.log('[Downloader] Já existe um download em andamento.');
      return;
    }

    const targetFile = this.getFilePath(item.id);
    const videoId = extractYouTubeId(item.url);
    const cleanUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : item.url;

    db.updateQueueItem(item.id, {
      status: 'downloading',
      downloadProgress: 0,
      downloadSpeed: 'Iniciando...'
    });
    this.broadcast('download_start', { item: db.getQueueItem(item.id) });

    // 1. Tenta baixar via biblioteca pytubefix (Bypass anti-bot sem precisar de cookies)
    const pytubeResult = await this.downloadWithPytube(item, cleanUrl, targetFile);
    if (pytubeResult.success) {
      return pytubeResult;
    }

    console.warn(`[Downloader] pytubefix não completou. Acionando motor de fallback (yt-dlp)...`);

    // 2. Fallback via yt-dlp
    return await this.downloadWithYtDlp(item, cleanUrl, targetFile);
  }

  /**
   * Download via biblioteca pytubefix com clientes sem bot-challenge (VISION_OS, IOS, MWEB, etc.)
   */
  downloadWithPytube(item, downloadUrl, targetFile) {
    return new Promise((resolve) => {
      if (!fs.existsSync(PYTUBE_DOWNLOADER_SCRIPT)) {
        return resolve({ success: false, error: 'pytube_downloader.py não encontrado' });
      }

      console.log(`[Downloader] Executando biblioteca pytubefix para ${item.id} (${downloadUrl})...`);
      const proc = spawn('python3', [PYTUBE_DOWNLOADER_SCRIPT, downloadUrl, targetFile]);

      this.activeDownload = {
        itemId: item.id,
        proc,
        promiseResolve: resolve
      };

      let lastProgressUpdate = 0;

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        const match = text.match(/\[PROGRESS\]\s+([\d.]+)%/);
        if (match) {
          const percent = Math.min(99.9, parseFloat(match[1]));
          const now = Date.now();
          if (now - lastProgressUpdate > 500) {
            lastProgressUpdate = now;
            db.updateQueueItem(item.id, {
              downloadProgress: percent,
              downloadSpeed: 'Baixando via lib...'
            });
            this.broadcast('download_progress', {
              id: item.id,
              progress: percent,
              speed: 'pytubefix (sem cookies)',
              eta: '',
              totalSize: ''
            });
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const errText = chunk.toString();
        if (errText.includes('Erro') || errText.includes('Error')) {
          console.warn(`[Downloader pytube stderr] ${errText.trim()}`);
        }
      });

      proc.on('close', (code) => {
        this.activeDownload = null;

        if (code === 0 && fs.existsSync(targetFile) && fs.statSync(targetFile).size > 10240) {
          const stats = fs.statSync(targetFile);
          const updated = db.updateQueueItem(item.id, {
            status: 'ready',
            downloadProgress: 100,
            downloadSpeed: 'Concluído',
            filePath: targetFile,
            fileSize: stats.size
          });
          console.log(`[Downloader] Download de "${item.title}" concluído com sucesso via lib (${(stats.size / 1024 / 1024).toFixed(1)} MB)!`);
          this.broadcast('download_complete', { item: updated });
          resolve({ success: true, item: updated });
        } else {
          resolve({ success: false, code });
        }
      });

      proc.on('error', (err) => {
        console.warn('[Downloader] Erro no processo pytube:', err.message);
        this.activeDownload = null;
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Fallback via yt-dlp
   */
  downloadWithYtDlp(item, targetFile) {
    return new Promise((resolve) => {
      const args = [
        '--newline',
        '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--no-mtime',
        '--extractor-args', 'youtube:player_client=android,ios,web'
      ];

      const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
      if (fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0) {
        console.log(`[Downloader] Utilizando cookies.txt para autenticação no yt-dlp`);
        args.push('--cookies', cookiesPath);
      }

      args.push('-o', targetFile, item.url);

      console.log(`[Downloader] Executando yt-dlp para item ${item.id} (${item.url})`);
      const proc = spawn('yt-dlp', args);

      this.activeDownload = {
        itemId: item.id,
        proc,
        promiseResolve: resolve
      };

      let lastProgressUpdate = 0;

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        const match = text.match(/\[download\]\s+([\d.]+)%\s+of\s+([~a-zA-Z0-9.]+)\s+at\s+([a-zA-Z0-9.\/]+)\s+ETA\s+([\d:]+)/);
        if (match) {
          const percent = parseFloat(match[1]);
          const totalSize = match[2];
          const speed = match[3];
          const eta = match[4];

          const now = Date.now();
          if (now - lastProgressUpdate > 500 || percent >= 100) {
            lastProgressUpdate = now;
            const updated = db.updateQueueItem(item.id, {
              downloadProgress: percent,
              downloadSpeed: `${speed} (ETA ${eta})`
            });
            this.broadcast('download_progress', {
              id: item.id,
              progress: percent,
              speed,
              eta,
              totalSize
            });
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const errText = chunk.toString();
        if (errText.includes('ERROR:')) {
          console.warn(`[Downloader yt-dlp stderr] ${errText.trim()}`);
        }
      });

      proc.on('close', (code) => {
        this.activeDownload = null;

        if (code === 0 && fs.existsSync(targetFile) && fs.statSync(targetFile).size > 10240) {
          const stats = fs.statSync(targetFile);
          const updated = db.updateQueueItem(item.id, {
            status: 'ready',
            downloadProgress: 100,
            downloadSpeed: 'Concluído',
            filePath: targetFile,
            fileSize: stats.size
          });
          console.log(`[Downloader] Download de "${item.title}" concluído via yt-dlp (${(stats.size / 1024 / 1024).toFixed(1)} MB)!`);
          this.broadcast('download_complete', { item: updated });
          resolve({ success: true, item: updated });
        } else {
          console.error(`[Downloader] Falha em todos os motores para o item ${item.id} (exit code ${code})`);
          const updated = db.updateQueueItem(item.id, {
            status: 'error',
            error: `Erro ao baixar vídeo (código ${code})`
          });
          this.broadcast('download_error', { item: updated, code });
          resolve({ success: false, error: code });
        }
      });

      proc.on('error', (err) => {
        console.error('[Downloader] Erro ao disparar yt-dlp:', err.message);
        this.activeDownload = null;
        const updated = db.updateQueueItem(item.id, {
          status: 'error',
          error: `Erro de execução no downloader: ${err.message}`
        });
        this.broadcast('download_error', { item: updated, error: err.message });
        resolve({ success: false, error: err.message });
      });
    });
  }

  cancelActiveDownload(itemId) {
    if (this.activeDownload && (!itemId || this.activeDownload.itemId === itemId)) {
      try {
        this.activeDownload.proc.kill('SIGKILL');
        console.log(`[Downloader] Download cancelado para o item ${this.activeDownload.itemId}`);
      } catch (_) {}
      this.activeDownload = null;
    }
  }

  /**
   * Remove vídeos antigos ou fora do par (Atual + Próximo)
   */
  enforceStorageLimits(allowedId1, allowedId2) {
    try {
      if (!fs.existsSync(MEDIA_DIR)) return;
      const files = fs.readdirSync(MEDIA_DIR);
      const allowedNames = new Set([
        'standby.mp4',
        allowedId1 ? `${allowedId1}.mp4` : null,
        allowedId2 ? `${allowedId2}.mp4` : null
      ].filter(Boolean));

      for (const file of files) {
        if (file.endsWith('.mp4') && !allowedNames.has(file)) {
          const filePath = path.join(MEDIA_DIR, file);
          try {
            fs.unlinkSync(filePath);
            console.log(`[StorageCleaner] Arquivo excedente removido para poupar disco: ${file}`);
          } catch (err) {
            console.warn(`[StorageCleaner] Falha ao deletar ${file}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('[StorageCleaner] Erro na limpeza de disco:', err.message);
    }
  }
}

export const downloader = new DownloaderEngine();
