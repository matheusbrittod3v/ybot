import fs from 'fs';
import path from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { db, DATA_DIR } from '../db.js';
import { downloader } from './downloader.js';
import { ensureStandbyVideo, getStandbyFilePath, standbyFileExists } from './standby.js';
import { youtubeUpdater } from '../utils/youtube-updater.js';
import { resolveDownloadUrl } from '../utils/web_downloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);
const RESOLVER_SCRIPT = path.join(__dirname, '../utils/stream_resolver.py');

function secondsToTimeStr(totalSeconds) {
  const s = Math.floor(Math.max(0, totalSeconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return [hrs, mins, secs].map(v => String(v).padStart(2, '0')).join(':');
}

async function resolveDirectStreams(url) {
  // 1. Motor Primário via stream_resolver (pytubefix / yt-dlp - GoogleVideo CDN ultra estável)
  try {
    console.log('[Streamer Direct] Resolvendo fluxo via stream_resolver (GoogleVideo CDN)...');
    const { stdout } = await execFileAsync('python3', [RESOLVER_SCRIPT, url], { timeout: 25000, input: '' });
    const data = JSON.parse(stdout.trim());
    if (data.success && data.videoUrl) {
      console.log(`[Streamer Direct] Fluxo resolvido via ${data.provider} (${data.resolution}) com sucesso!`);
      return data;
    }
  } catch (err) {
    console.warn('[Streamer Direct] stream_resolver falhou:', err.message);
  }

  // 2. Fallback Secundário Web Resolver
  try {
    console.log('[Streamer Direct] Tentando fallback via Web Resolver...');
    const webData = await resolveDownloadUrl(url, ['720', '1080', '480', '360']);
    if (webData && webData.downloadUrl) {
      console.log(`[Streamer Direct] Fluxo Web resolvido em ${webData.quality}p!`);
      return {
        success: true,
        provider: `WebResolver_${webData.quality}p`,
        videoUrl: webData.downloadUrl,
        audioUrl: null,
        isProgressive: true,
        resolution: `${webData.quality}p`
      };
    }
  } catch (err) {
    console.warn('[Streamer Direct] Web Resolver fallback indisponível:', err.message);
  }

  // 3. Fallback Terciário via yt-dlp CLI direto
  try {
    console.log('[Streamer Direct] Tentando fallback direto via yt-dlp CLI com bypass...');
    const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
    const ytArgs = ['--no-playlist', '--extractor-args', 'youtube:player_client=android,web', '-g', '-f', 'b/bestvideo+bestaudio/best', url];
    if (fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0) {
      ytArgs.splice(1, 0, '--cookies', cookiesPath);
    }
    const { stdout } = await execFileAsync('yt-dlp', ytArgs, { timeout: 30000 });
    const lines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      console.log(`[Streamer Direct] Fluxo resolvido via yt-dlp CLI direto!`);
      return {
        success: true,
        provider: 'yt-dlp_cli_direct',
        videoUrl: lines[0],
        audioUrl: lines.length > 1 ? lines[1] : null,
        isProgressive: lines.length === 1,
        resolution: '720p'
      };
    }
  } catch (err) {
    console.warn('[Streamer Direct] Fallback yt-dlp CLI indisponível:', err.message);
  }

  return null;
}

class StreamerEngine {
  constructor() {
    this.ffmpegProc = null;
    this.pipeProc = null;
    this.currentMode = 'STOPPED'; // 'STOPPED', 'STANDBY', 'VIDEO'
    this.currentItem = null;
    this.listeners = new Set();
    this.monitorInterval = null;
    this.shouldRun = false;
    this.standbyCheckInterval = null;
    this.isReloading = false;
    this.isResolving = false;
    this.watchdogInterval = null;

    downloader.onEvent((event, payload) => {
      if (event === 'download_complete') {
        if (this.shouldRun && this.currentMode === 'STANDBY') {
          console.log('[Streamer] Novo vídeo ficou pronto durante standby. Iniciando transição...');
          this.playNextInQueue();
        }
      }
    });
  }

  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      if (!this.shouldRun) return;
      if (!this.ffmpegProc && !this.isResolving) {
        console.warn('[Streamer Watchdog] ⚠️ FFmpeg inativo detectado! Restaurando vinheta Standby para manter a Live 100% online...');
        this.streamStandby();
      }
    }, 2500);
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
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
    console.log('[Streamer] Iniciando Playout 24/7 TV Braza com Failsafe Anti-Queda...');
    await ensureStandbyVideo();
    this.startWatchdog();

    if (!this.getStreamTarget()) {
      try {
        console.log('[Streamer] Chave de transmissão RTMP não detectada no banco. Consultando YouTube Studio...');
        await youtubeUpdater.detectAndSaveActiveBroadcast();
      } catch (_) {}
    }

    this.playNextInQueue();
  }

  stop() {
    this.shouldRun = false;
    this.stopWatchdog();
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
    if (this.pipeProc) {
      try {
        this.pipeProc.kill('SIGKILL');
      } catch (_) {}
      this.pipeProc = null;
    }
    if (this.ffmpegProc) {
      try {
        this.ffmpegProc.kill('SIGKILL');
      } catch (_) {}
      this.ffmpegProc = null;
    }
  }

  async playNextInQueue() {
    if (!this.shouldRun || this.isResolving) return;

    const queue = db.getQueue();
    // Procura qualquer item na fila que ainda não foi finalizado e não tem erro
    let readyItem = queue.find(i => i.status !== 'finished' && i.status !== 'error');

    if (readyItem) {
      const isLocalUpload = Boolean(readyItem.filePath && fs.existsSync(readyItem.filePath));
      if (readyItem.status !== 'ready') {
        db.updateQueueItem(readyItem.id, {
          status: 'ready',
          streamMode: isLocalUpload ? 'upload' : 'direct',
          downloadProgress: 100,
          downloadSpeed: isLocalUpload ? 'Pronto no Disco' : '⚡ Stream Direto (Sem Anúncios)'
        });
        readyItem.status = 'ready';
        readyItem.streamMode = isLocalUpload ? 'upload' : 'direct';
      }
      this.streamVideo(readyItem);
    } else {
      // Se não há vídeo na fila, entra em tela de Standby contínua
      console.log('[Streamer] Nenhum vídeo na fila. Entrando em vinheta Standby TV Braza 24h...');
      this.streamStandby();
    }
  }

  async streamVideo(item) {
    if (!item || this.isResolving) return;
    if (this.currentMode === 'VIDEO' && this.currentItem && this.currentItem.id === item.id && this.ffmpegProc) {
      return;
    }
    this.isResolving = true;
    const hasLocalFile = Boolean(item.filePath && fs.existsSync(item.filePath));
    const isDirect = !hasLocalFile || item.streamMode === 'direct';

    console.log(`[Streamer] PREPARANDO TRANSMISSÃO: "${item.title}" ${isDirect ? '[Modo: ⚡ Stream Direto (Sem Anúncios)]' : '[Arquivo Local]'}`);

    // Mantém vinheta Standby no ar durante a resolução do link para garantir transmissão RTMP 100% contínua
    if (!this.ffmpegProc) {
      this.streamStandby();
    }

    try {
      let rtmpTarget = this.getStreamTarget();
      if (!rtmpTarget) {
        console.log('[Streamer] Chave RTMP ausente. Detectando Stream Key automaticamente no YouTube Studio...');
        await youtubeUpdater.detectAndSaveActiveBroadcast();
        rtmpTarget = this.getStreamTarget();
      }

      const settings = db.getSettings();
      let inputArgs = [];
      let pipeSourceProc = null;

      if (isDirect) {
        console.log(`[Streamer] ⚡ Invocando motor de Stream Direto para: ${item.url}`);
        const streamData = await resolveDirectStreams(item.url);

        if (streamData && streamData.videoUrl) {
          console.log(`[Streamer Direct] Fluxos resolvidos via ${streamData.provider} (${streamData.resolution})! Iniciando broadcast...`);
          const httpOptions = [
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-rw_timeout', '15000000',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5'
          ];
          if (streamData.audioUrl && !streamData.isProgressive) {
            inputArgs = [
              ...httpOptions,
              '-i', streamData.videoUrl,
              ...httpOptions,
              '-i', streamData.audioUrl,
              '-map', '0:v:0',
              '-map', '1:a:0'
            ];
          } else {
            inputArgs = [
              ...httpOptions,
              '-i', streamData.videoUrl
            ];
          }
        } else {
          throw new Error('Não foi possível obter links de streaming reproduzíveis para o vídeo');
        }
      } else {
        if (!item.filePath || !fs.existsSync(item.filePath)) {
          throw new Error(`Arquivo local de vídeo não encontrado: ${item.filePath}`);
        }
        inputArgs = ['-re', '-i', item.filePath];
      }

      const videoBitrate = settings.videoBitrate || '4500k';
      const audioBitrate = settings.audioBitrate || '160k';

      const args = [
        ...inputArgs,
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

      let filterSteps = [];
      let currentInput = 'in';

      // 1. Logo d'Água (canto inferior esquerdo, sem caixa preta no topo)
      if (settings.enableWatermark) {
        let logoPngPath = '';
        if (settings.customLogoPath && fs.existsSync(settings.customLogoPath)) {
          logoPngPath = settings.customLogoPath;
        } else {
          const defaultLogo = path.resolve(__dirname, '../../public/assets/logo.png');
          if (fs.existsSync(defaultLogo)) logoPngPath = defaultLogo;
        }

        if (logoPngPath) {
          const escapedLogoPath = logoPngPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
          filterSteps.push(`movie='${escapedLogoPath}',scale=220:-1[logo];[${currentInput}][logo]overlay=x=35:y=H-h-35[v_logo]`);
          currentInput = 'v_logo';
        }
      }

      // 2. Banner Animado Popup "A SEGUIR NA GRADE" (exibe a cada X minutos por Y segundos)
      const enableOverlay = settings.enableScheduleOverlay !== false;
      if (enableOverlay) {
        const queue = db.getQueue();
        const nextItem = queue.find(i => i.id !== item.id && i.status !== 'finished');
        const nextTitleRaw = nextItem ? (nextItem.liveTitle || nextItem.title) : 'Programação Contínua 24h TV Braza';
        const cleanNextTitle = nextTitleRaw
          .substring(0, 55)
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "'\\''")
          .replace(/:/g, '\\:');

        const intervalMins = Number(settings.scheduleOverlayInterval) || 5;
        const intervalSecs = Math.max(1, intervalMins) * 60;
        const durationSecs = Number(settings.scheduleOverlayDuration) || 12;
        const enableExpr = `between(mod(t\\,${intervalSecs})\\,0\\,${durationSecs})`;

        filterSteps.push(`[${currentInput}]drawbox=x=50:y=h-140:w=w-100:h=76:color=0x0b0f19@0.85:t=fill:enable='${enableExpr}'[v_b1]`);
        filterSteps.push(`[v_b1]drawbox=x=50:y=h-140:w=6:h=76:color=0xf59e0b:t=fill:enable='${enableExpr}'[v_b2]`);
        filterSteps.push(`[v_b2]drawtext=text='A SEGUIR NA GRADE':fontcolor=0xf59e0b:fontsize=18:x=75:y=h-128:enable='${enableExpr}'[v_h]`);
        filterSteps.push(`[v_h]drawtext=text='${cleanNextTitle}':fontcolor=0xffffff:fontsize=24:x=75:y=h-98:enable='${enableExpr}'[v_out]`);
        currentInput = 'v_out';
      }

      if (filterSteps.length > 0) {
        let finalVf = filterSteps.join(';');
        if (!finalVf.includes('[in]')) {
          finalVf = `[in]${finalVf}`;
        }
        args.push('-vf', finalVf);
      }

      if (rtmpTarget) {
        args.push('-f', 'flv', rtmpTarget);
      } else {
        args.push('-f', 'null', '-');
      }

      // Mata a vinheta Standby imediatamente antes de disparar o FFmpeg do vídeo
      this.killProcess();
      this.currentMode = 'VIDEO';
      this.currentItem = item;
      this.isResolving = false;

      db.updatePlayoutState({
        state: 'PLAYING',
        activeItemId: item.id,
        startedAt: Date.now(),
        duration: item.duration || 0,
        elapsed: 0
      });

      this.broadcast('video_started', { item });

      youtubeUpdater.syncItemMetadata(item).catch(err => {
        console.warn('[Streamer] Erro ao sincronizar metadados no YouTube:', err.message);
      });

      this.spawnFfmpeg(args, (code) => {
        if (this.isReloading) {
          console.log(`[Streamer] Recarregamento ativo. Mantendo item "${item.title}" no ar...`);
          return;
        }

        if (code === 0 || code === null) {
          console.log(`[Streamer] VÍDEO CONCLUÍDO COM SUCESSO: "${item.title}". Arquivando e avançando...`);
          db.archiveFinishedItem(item.id);
        } else {
          console.warn(`[Streamer] FFmpeg encerrou prematuramente para "${item.title}" (código ${code}). Marcando erro e avançando...`);
          db.updateQueueItem(item.id, {
            status: 'error',
            error: `Transmissão encerrada (código ${code})`
          });
        }

        this.currentItem = null;
        this.playNextInQueue();
      }, pipeSourceProc);

      if (rtmpTarget) {
        setTimeout(async () => {
          try {
            const currentSet = db.getSettings();
            const broadcastId = currentSet.youtubeBroadcastVideoId;
            if (broadcastId && this.currentMode === 'VIDEO') {
              await youtubeUpdater.transitionBroadcastToLive(broadcastId);
            }
          } catch (_) {}
        }, 10000);
      }
    } catch (err) {
      console.error(`[Streamer] Falha ao preparar transmissão de "${item.title}":`, err.message);
      db.updateQueueItem(item.id, { status: 'error', error: err.message });
      this.isResolving = false;
      this.currentItem = null;
      this.playNextInQueue();
    }
  }

  spawnFfmpeg(args, onFinish, pipeSourceProc = null) {
    console.log(`[Streamer] Executando FFmpeg: ffmpeg ${args.slice(0, 6).join(' ')} ...`);
    let proc;
    try {
      proc = spawn('ffmpeg', args);
    } catch (e) {
      console.warn(`[Streamer] Falha ao disparar ffmpeg: ${e.message}`);
      if (pipeSourceProc) {
        try { pipeSourceProc.kill('SIGKILL'); } catch (_) {}
      }
      onFinish(-2);
      return;
    }
    this.ffmpegProc = proc;

    if (pipeSourceProc) {
      pipeSourceProc.stdout.pipe(proc.stdin);
      proc.stdin.on('error', () => {});
      pipeSourceProc.on('error', (err) => {
        console.error('[Streamer Direct yt-dlp erro]', err.message);
      });
      pipeSourceProc.on('close', (code) => {
        if (code !== 0) {
          console.warn(`[Streamer Direct yt-dlp fechado (código ${code})]`);
        }
      });
    }

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
      } else {
        const trimmed = line.trim();
        if (trimmed && (trimmed.includes('Error') || trimmed.includes('error') || trimmed.includes('Server returned') || trimmed.includes('Connection refused') || trimmed.includes('Invalid data') || trimmed.includes('Failed to open'))) {
          console.warn(`[Streamer FFmpeg aviso] ${trimmed.slice(0, 180)}`);
        }
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
      const maskedTarget = rtmpTarget.replace(/live2\/[a-zA-Z0-9_-]+$/, 'live2/****');
      console.log(`[Streamer Standby] 📡 Transmitindo Standby para: ${maskedTarget}`);
      args.push('-f', 'flv', rtmpTarget);
    } else {
      console.warn('[Streamer Standby] ⚠️ Chave RTMP ausente no Standby. Buscando automaticamente no YouTube Studio...');
      args.push('-f', 'null', '-');
      youtubeUpdater.detectAndSaveActiveBroadcast().then((broadcast) => {
        if (broadcast && this.getStreamTarget() && this.currentMode === 'STANDBY') {
          console.log('[Streamer Standby] Stream Key obtida com sucesso. Conectando Standby à Live do YouTube...');
          this.streamStandby();
        }
      }).catch(() => {});
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
        const nextReady = queue.find(i => i.status !== 'finished' && i.status !== 'error');
        if (nextReady) {
          clearInterval(this.standbyCheckInterval);
          this.playNextInQueue();
        }
      }
    }, 2000);
  }

  skipCurrent() {
    if (this.currentMode === 'VIDEO' && this.currentItem) {
      console.log(`[Streamer] ⏭️ Pulando vídeo atual: "${this.currentItem.title}"`);
      const itemToSkip = this.currentItem;
      this.currentItem = null;
      this.killProcess();
      // Remove da fila imediatamente ao pular
      db.archiveFinishedItem(itemToSkip.id);
      setTimeout(() => {
        this.playNextInQueue();
      }, 150);
      return true;
    } else if (this.currentMode === 'STANDBY') {
      console.log('[Streamer] ⏭️ Forçando saída do Standby para o próximo vídeo da fila...');
      this.killProcess();
      setTimeout(() => {
        this.playNextInQueue();
      }, 150);
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

  reloadCurrentStream() {
    if (!this.shouldRun) return;
    console.log('[Streamer] 🔄 Aplicando alterações de watermark/logo na transmissão em tempo real...');
    if (this.currentMode === 'STANDBY') {
      this.killProcess();
      setTimeout(() => {
        if (this.shouldRun && this.currentMode === 'STANDBY') {
          this.streamStandby();
        }
      }, 400);
    } else if (this.currentMode === 'VIDEO' && this.currentItem) {
      this.isReloading = true;
      const current = this.currentItem;
      this.killProcess();
      setTimeout(() => {
        this.isReloading = false;
        if (this.shouldRun && current) {
          this.streamVideo(current);
        }
      }, 400);
    }
  }
}

export const streamer = new StreamerEngine();
