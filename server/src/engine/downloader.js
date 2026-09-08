import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { db, MEDIA_DIR } from '../db.js';

class DownloaderEngine {
  constructor() {
    this.activeDownload = null; // { itemId, process, promise }
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
   * Baixa um item específico da fila usando yt-dlp
   */
  async downloadItem(item) {
    if (this.activeDownload) {
      console.log('[Downloader] Já existe um download em andamento.');
      return;
    }

    const targetFile = this.getFilePath(item.id);
    const tempPrefix = path.join(MEDIA_DIR, `temp_${item.id}`);

    db.updateQueueItem(item.id, {
      status: 'downloading',
      downloadProgress: 0,
      downloadSpeed: 'Iniciando...'
    });
    this.broadcast('download_start', { item: db.getQueueItem(item.id) });

    return new Promise((resolve) => {
      // yt-dlp arguments com formato universal compatível com YouTube
      const args = [
        '--newline',
        '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--no-mtime',
        '-o', targetFile,
        item.url
      ];

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
        // Exemplo: [download]  45.2% of  120.50MiB at  10.20MiB/s ETA 00:06
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

        if (code === 0 && fs.existsSync(targetFile)) {
          const stats = fs.statSync(targetFile);
          const updated = db.updateQueueItem(item.id, {
            status: 'ready',
            downloadProgress: 100,
            downloadSpeed: 'Concluído',
            filePath: targetFile,
            fileSize: stats.size
          });
          console.log(`[Downloader] Download de "${item.title}" concluído com sucesso (${(stats.size / 1024 / 1024).toFixed(1)} MB)!`);
          this.broadcast('download_complete', { item: updated });
          resolve({ success: true, item: updated });
        } else {
          console.error(`[Downloader] Falha no download do item ${item.id} (exit code ${code})`);
          const updated = db.updateQueueItem(item.id, {
            status: 'error',
            error: `Erro ao baixar vídeo (código ${code})`
          });
          this.broadcast('download_error', { item: updated, code });
          resolve({ success: false, error: code });
        }
      });

      proc.on('error', (err) => {
        console.error('[Downloader] Erro ao disparar processo yt-dlp:', err.message);
        this.activeDownload = null;
        const updated = db.updateQueueItem(item.id, {
          status: 'error',
          error: `yt-dlp não encontrado ou erro de execução: ${err.message}`
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
