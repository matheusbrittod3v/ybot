import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { db } from '../db.js';
import { downloader } from './downloader.js';
import { ensureStandbyVideo, getStandbyFilePath, standbyFileExists } from './standby.js';
import { youtubeUpdater } from '../utils/youtube-updater.js';

class StreamerEngine {
  constructor() {
    this.ffmpegProc = null;
    this.currentMode = 'STOPPED'; // 'STOPPED', 'STANDBY', 'VIDEO'
    this.currentItem = null;
    this.listeners = new Set();
    this.monitorInterval = null;
    this.shouldRun = false;
    this.standbyCheckInterval = null;

    // Escuta eventos de download concluído para iniciar reprodução se estiver em standby
    downloader.onEvent((event, payload) => {
      if (event === 'download_complete') {
        if (this.shouldRun && this.currentMode === 'STANDBY') {
          console.log('[Streamer] Novo vídeo ficou pronto durante standby. Iniciando transição...');
          this.playNextInQueue();
        }
      }
    });
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
        console.error('[Streamer] Erro em listener:', err.message);
      }
    }
  }

  getStreamTarget() {
    const settings = db.getSettings();
    if (!settings.youtubeStreamKey) {
      return null;
    }
    const cleanKey = settings.youtubeStreamKey.trim();
    let rtmpUrl = (settings.youtubeRtmpUrl || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/+$/, '');
    return `${rtmpUrl}/${cleanKey}`;
  }

  async start() {
    this.shouldRun = true;
    console.log('[Streamer] Iniciando Playout 24/7 TV Braza...');
    await ensureStandbyVideo();
    this.playNextInQueue();
  }

  stop() {
    this.shouldRun = false;
    this.killProcess();
    this.currentMode = 'STOPPED';
    this.currentItem = null;
    db.updatePlayoutState({
      state: 'STOPPED',
      activeItemId: null,
      fps: 0,
      bitrate: '0k'
    });
    this.broadcast('playout_stopped', {});
  }

  killProcess() {
    if (this.ffmpegProc) {
      try {
        this.ffmpegProc.kill('SIGKILL');
      } catch (_) {}
      this.ffmpegProc = null;
    }
  }

  async playNextInQueue() {
    if (!this.shouldRun) return;

    const queue = db.getQueue();
    // Procura primeiro item disponível para transmissão
    const readyItem = queue.find(i => i.status === 'ready');

    if (readyItem && readyItem.filePath && fs.existsSync(readyItem.filePath)) {
      this.streamVideo(readyItem);
    } else {
      // Se não há vídeo baixado pronto, aciona o downloader e entra em tela de Standby contínua!
      console.log('[Streamer] Nenhum vídeo pronto na fila. Entrando em vinheta Standby TV Braza 24h...');
      downloader.checkQueue();
      this.streamStandby();
    }
  }

  streamVideo(item) {
    this.killProcess();
    this.currentMode = 'VIDEO';
    this.currentItem = item;

    const settings = db.getSettings();
    const rtmpTarget = this.getStreamTarget();

    console.log(`[Streamer] INICIANDO NO AR: "${item.title}"`);
    db.updateQueueItem(item.id, {
      status: 'playing',
      startedAt: new Date().toISOString()
    });

    db.updatePlayoutState({
      state: 'PLAYING',
      activeItemId: item.id,
      startedAt: Date.now(),
      duration: item.duration || 0,
      elapsed: 0
    });

    this.broadcast('video_started', { item });

    // Atualiza automaticamente o título da Live e a Thumbnail no YouTube Studio
    youtubeUpdater.syncItemMetadata(item).catch(err => {
      console.warn('[Streamer] Erro ao sincronizar metadados no YouTube:', err.message);
    });

    // Pede ao Downloader para já ir baixando o PRÓXIMO vídeo da fila antecipadamente!
    downloader.checkQueue(item.id);

    const videoBitrate = settings.videoBitrate || '4500k';
    const audioBitrate = settings.audioBitrate || '160k';

    // Se a chave do YouTube não foi configurada, emite aviso mas roda localmente ou em loop
    if (!rtmpTarget) {
      console.warn('[Streamer] AVISO: Chave do YouTube não configurada! Configure a Stream Key no Painel Web.');
    }

    const outputTarget = rtmpTarget || '-f null -';

    // Montagem do comando FFmpeg para transmissão profissional contínua
    const args = [
      '-re',
      '-i', item.filePath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', videoBitrate,
      '-maxrate', videoBitrate,
      '-bufsize', '9000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60',
      '-keyint_min', '60',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '44100'
    ];

    // Adiciona marca d'água opcional TV Braza
    if (settings.enableWatermark) {
      args.push('-vf', `drawbox=x=w-230:y=30:w=190:h=45:color=0x000000@0.6:t=fill,drawtext=text='TV BRAZA':fontcolor=0xf59e0b:fontsize=28:x=w-215:y=40,drawtext=text='AO VIVO':fontcolor=0xffffff:fontsize=18:x=w-95:y=47`);
    }

    if (rtmpTarget) {
      args.push('-f', 'flv', rtmpTarget);
    } else {
      args.push('-f', 'null', '-');
    }

    this.spawnFfmpeg(args, () => {
      // Callback executado ao terminar o vídeo
      console.log(`[Streamer] VÍDEO CONCLUÍDO: "${item.title}". Limpando disco e avançando...`);
      
      // Remove o vídeo concluído da fila e apaga o arquivo do disco imediatamente!
      if (settings.autoDeleteFinished) {
        db.archiveFinishedItem(item.id);
      }

      this.currentItem = null;
      this.playNextInQueue();
    });
  }

  spawnFfmpeg(args, onFinish) {
    console.log(`[Streamer] Executando FFmpeg: ffmpeg ${args.slice(0, 6).join(' ')} ...`);
    let proc;
    try {
      proc = spawn('ffmpeg', args);
    } catch (e) {
      console.warn(`[Streamer] Falha ao disparar ffmpeg: ${e.message}`);
      onFinish(-2);
      return;
    }
    this.ffmpegProc = proc;

    proc.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      // Parse métricas do FFmpeg: frame= 120 fps= 30 q=28.0 size= 1240kB time=00:00:04.00 bitrate=2540.2kbits/s speed=1.00x
      const match = line.match(/fps=\s*([\d.]+).*time=\s*([\d:.]+).*bitrate=\s*([\d.]+kbits\/s)/);
      if (match) {
        const fps = parseFloat(match[1]);
        const timeStr = match[2];
        const bitrate = match[3];

        db.updatePlayoutState({
          fps,
          bitrate,
          lastHeartbeat: Date.now()
        });

        this.broadcast('stream_stats', {
          fps,
          time: timeStr,
          bitrate,
          mode: this.currentMode
        });
      }
    });

    proc.on('close', (code) => {
      console.log(`[Streamer] Processo FFmpeg finalizado (código ${code})`);
      if (this.ffmpegProc === proc) {
        this.ffmpegProc = null;
        onFinish(code);
      }
    });

    proc.on('error', (err) => {
      console.warn('[Streamer] FFmpeg indisponível no host ou erro de execução:', err.message);
      this.broadcast('stream_error', { error: err.message });
      if (this.ffmpegProc === proc) {
        this.ffmpegProc = null;
      }
      if (err.code === 'ENOENT') {
        // FFmpeg não instalado no ambiente atual (ex: teste fora do container)
        this.ffmpegAvailable = false;
      }
    });
  }

  streamStandby() {
    // Se já estiver transmitindo standby ativamente, não reinicie!
    if (this.currentMode === 'STANDBY' && this.ffmpegProc) {
      return;
    }

    this.killProcess();
    this.currentMode = 'STANDBY';
    this.currentItem = null;

    db.updatePlayoutState({
      state: 'STANDBY',
      activeItemId: null,
      startedAt: Date.now(),
      elapsed: 0,
      duration: 0,
      fps: 30,
      bitrate: '4500k'
    });

    this.broadcast('standby_started', {});

    if (this.ffmpegAvailable === false) {
      console.log('[Streamer] [Modo Simulado] Standby TV Braza ativo (FFmpeg ausente neste host). No container Docker na VPS o FFmpeg transmitirá normalmente.');
      return;
    }

    const settings = db.getSettings();
    const rtmpTarget = this.getStreamTarget();
    const videoBitrate = settings.videoBitrate || '4500k';
    const audioBitrate = settings.audioBitrate || '160k';

    let args = [];
    const standbyFile = getStandbyFilePath();

    if (standbyFileExists()) {
      // Transmite o vídeo de standby em loop contínuo
      args = [
        '-stream_loop', '-1',
        '-re',
        '-i', standbyFile,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-b:v', videoBitrate,
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-ar', '44100'
      ];
    } else {
      // Standby sintético nativo do FFmpeg com tela TV Braza
      args = [
        '-re',
        '-f', 'lavfi',
        '-i', 'color=c=0x0b0f19:s=1920x1080:r=30',
        '-f', 'lavfi',
        '-i', 'sine=frequency=220',
        '-filter_complex',
        `[0:v]drawbox=x=0:y=440:w=1920:h=200:color=0xf59e0b@0.2:t=fill,drawtext=text='TV BRAZA':fontcolor=white:fontsize=100:x=(w-text_w)/2:y=460,drawtext=text='AO VIVO 24H - PROGRAMACAO EM INSTANTES':fontcolor=0x94a3b8:fontsize=34:x=(w-text_w)/2:y=580[v];[1:a]volume=0.03[a]`,
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-b:v', videoBitrate,
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-ar', '44100'
      ];
    }

    if (rtmpTarget) {
      args.push('-f', 'flv', rtmpTarget);
    } else {
      args.push('-f', 'null', '-');
    }

    this.spawnFfmpeg(args, (code) => {
      // Se FFmpeg não existe ou saiu com erro de inicialização, não reexecuta em loop apertado
      if (this.ffmpegAvailable === false) {
        return;
      }
      if (this.shouldRun && this.currentMode === 'STANDBY') {
        setTimeout(() => this.streamStandby(), 3000);
      }
    });

    // Monitora a cada 4 segundos se algum vídeo novo da fila ficou pronto para trocar imediatamente
    if (this.standbyCheckInterval) clearInterval(this.standbyCheckInterval);
    this.standbyCheckInterval = setInterval(() => {
      if (this.shouldRun && this.currentMode === 'STANDBY') {
        const queue = db.getQueue();
        const nextReady = queue.find(i => i.status === 'ready');
        if (nextReady && nextReady.filePath && fs.existsSync(nextReady.filePath)) {
          clearInterval(this.standbyCheckInterval);
          this.playNextInQueue();
        }
      }
    }, 4000);
  }

  skipCurrent() {
    if (this.currentMode === 'VIDEO' && this.currentItem) {
      console.log(`[Streamer] Pulando vídeo atual manualmente: "${this.currentItem.title}"`);
      const itemToSkip = this.currentItem;
      this.killProcess();
      // Remove do disco imediatamente ao pular
      db.archiveFinishedItem(itemToSkip.id);
      this.playNextInQueue();
      return true;
    }
    return false;
  }

  restart() {
    console.log('[Streamer] Reiniciando transmissão...');
    this.killProcess();
    setTimeout(() => {
      this.playNextInQueue();
    }, 1500);
  }
}

export const streamer = new StreamerEngine();
