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
  // 1. Motor Primário Web Resolver (Instantâneo, zero verificação de bot, CDN direta)
  try {
    console.log('[Streamer Direct] Resolvendo fluxo via Web Resolver (SaveTube)...');
    const webData = await resolveDownloadUrl(url, ['720', '1080', '480', '360']);
    if (webData && webData.downloadUrl) {
      console.log(`[Streamer Direct] Fluxo Web resolvido em ${webData.quality}p com sucesso!`);
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
    console.warn('[Streamer Direct] Web Resolver indisponível:', err.message);
  }

  // 2. Motor Secundário via pytubefix (VISION_OS / WEB_SAFARI bypass)
  try {
    console.log('[Streamer Direct] Tentando resolução via stream_resolver (pytubefix)...');
    const { stdout } = await execFileAsync('python3', [RESOLVER_SCRIPT, url], { timeout: 25000, input: '' });
    const data = JSON.parse(stdout.trim());
    if (data.success && data.videoUrl) {
      console.log(`[Streamer Direct] Fluxo resolvido via ${data.provider} (${data.resolution})!`);
      return data;
    }
  } catch (err) {
    console.warn('[Streamer Direct] stream_resolver falhou:', err.message);
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
    if (!this.shouldRun) return;

    const queue = db.getQueue();
    // Procura primeiro item disponível para transmissão (arquivo pronto ou stream direto)
    const readyItem = queue.find(i => i.status === 'ready');

    if (readyItem && ((readyItem.streamMode === 'direct' && readyItem.url) || (readyItem.filePath && fs.existsSync(readyItem.filePath)))) {
      this.streamVideo(readyItem);
    } else {
      // Se não há vídeo pronto na fila, entra em tela de Standby contínua e verifica downloads
      console.log('[Streamer] Nenhum vídeo pronto na fila. Entrando em vinheta Standby TV Braza 24h...');
      downloader.checkQueue();
      this.streamStandby();
    }
  }

  async streamVideo(item) {
    this.killProcess();
    this.currentMode = 'VIDEO';
    this.currentItem = item;

    const isDirect = item.streamMode === 'direct';

    console.log(`[Streamer] INICIANDO NO AR: "${item.title}" ${isDirect ? '[Modo: ⚡ Stream Direto (Sem Anúncios)]' : '[Arquivo Local]'}`);

    // Garante que o alvo RTMP está configurado ou detecta automaticamente via Google OAuth
    let rtmpTarget = this.getStreamTarget();
    if (!rtmpTarget) {
      console.log('[Streamer] Chave RTMP ausente. Detectando Stream Key automaticamente no YouTube Studio...');
      await youtubeUpdater.detectAndSaveActiveBroadcast();
      rtmpTarget = this.getStreamTarget();
    }

    const settings = db.getSettings();

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

    // Pede ao Downloader para já ir baixando o PRÓXIMO vídeo da fila se for modo download
    downloader.checkQueue(item.id);

    const videoBitrate = settings.videoBitrate || '4500k';
    const audioBitrate = settings.audioBitrate || '160k';

    if (rtmpTarget) {
      const maskedTarget = rtmpTarget.replace(/live2\/[a-zA-Z0-9_-]+$/, 'live2/****');
      console.log(`[Streamer] 📡 Destino RTMP ativo configurado: ${maskedTarget}`);
    } else {
      console.warn('[Streamer] ⚠️ Chave do YouTube não configurada! Configure a Stream Key no Painel Web ou via Google OAuth.');
    }

    let inputArgs = [];
    let pipeSourceProc = null;

    if (isDirect) {
      console.log(`[Streamer] ⚡ Invocando motor de Stream Direto (sem anúncios / estilo Brave) para: ${item.url}`);
      const streamData = await resolveDirectStreams(item.url);

      if (streamData && streamData.videoUrl) {
        console.log(`[Streamer Direct] Fluxos resolvidos via ${streamData.provider} (${streamData.resolution})! Iniciando broadcast...`);
        if (streamData.audioUrl && !streamData.isProgressive) {
          inputArgs = [
            '-re',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-i', streamData.videoUrl,
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-i', streamData.audioUrl,
            '-map', '0:v:0',
            '-map', '1:a:0'
          ];
        } else {
          inputArgs = [
            '-re',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-i', streamData.videoUrl
          ];
        }
      } else {
        console.warn('[Streamer Direct] Usando fallback secundário via yt-dlp android...');
        const ytdlpArgs = [
          '--no-playlist',
          '-f', 'b/best',
          '--extractor-args', 'youtube:player_client=android',
          '--no-warnings',
          '-o', '-'
        ];

        if (settings.enableSponsorBlock !== false) {
          ytdlpArgs.push('--sponsorblock-remove', 'sponsor,selfpromo');
        }

        const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
        if (fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0) {
          ytdlpArgs.push('--cookies', cookiesPath);
        }

        ytdlpArgs.push(item.url);

        pipeSourceProc = spawn('yt-dlp', ytdlpArgs);
        this.pipeProc = pipeSourceProc;

        pipeSourceProc.stderr.on('data', (d) => {
          const text = d.toString();
          if (text.includes('ERROR:')) {
            console.warn(`[Streamer Direct yt-dlp stderr] ${text.trim()}`);
          }
        });

        inputArgs = ['-re', '-i', 'pipe:0'];
      }
    } else {
      inputArgs = ['-re', '-i', item.filePath];
    }

    // Montagem do comando FFmpeg para transmissão profissional contínua
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

    // Adiciona marca d'água opcional com logo no canto inferior esquerdo e selo AO VIVO no canto superior direito
    if (settings.enableWatermark) {
      // Resolve a logo: customizada (DATA_DIR) → padrão (public/assets)
      let logoPngPath = '';
      if (settings.customLogoPath && fs.existsSync(settings.customLogoPath)) {
        logoPngPath = settings.customLogoPath;
      } else {
        const defaultLogo = path.resolve(__dirname, '../../public/assets/logo.png');
        if (fs.existsSync(defaultLogo)) logoPngPath = defaultLogo;
      }

      // Texto dinâmico da marca d'água (ex: "TV BRAZA", "MINHA TV", etc)
      const rawWatermarkText = settings.watermarkText || 'TV BRAZA';
      // Separa em label principal e sufixo "AO VIVO"
      const parts = rawWatermarkText.split(/\s*[-|]\s*/);
      const mainLabel = (parts[0] || 'TV BRAZA').replace(/'/g, "'\\''");

      if (logoPngPath) {
        const escapedLogoPath = logoPngPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
        args.push('-vf', `movie='${escapedLogoPath}',scale=260:-1[logo];[in][logo]overlay=x=35:y=H-h-35[v1];[v1]drawbox=x=w-320:y=28:w=280:h=46:color=0x000000@0.65:t=fill,drawtext=text='${mainLabel}':fontcolor=0xf59e0b:fontsize=24:x=w-305:y=38,drawbox=x=w-168:y=34:w=2:h=34:color=0xffffff@0.25:t=fill,drawbox=x=w-150:y=45:w=10:h=10:color=0xef4444:t=fill,drawtext=text='AO VIVO':fontcolor=0xffffff:fontsize=17:x=w-132:y=41`);
      } else {
        args.push('-vf', `drawbox=x=w-320:y=28:w=280:h=46:color=0x000000@0.65:t=fill,drawtext=text='${mainLabel}':fontcolor=0xf59e0b:fontsize=24:x=w-305:y=38,drawbox=x=w-168:y=34:w=2:h=34:color=0xffffff@0.25:t=fill,drawbox=x=w-150:y=45:w=10:h=10:color=0xef4444:t=fill,drawtext=text='AO VIVO':fontcolor=0xffffff:fontsize=17:x=w-132:y=41`);
      }
    }

    if (rtmpTarget) {
      args.push('-f', 'flv', rtmpTarget);
    } else {
      args.push('-f', 'null', '-');
    }

    this.spawnFfmpeg(args, () => {
      if (this.isReloading) {
        console.log(`[Streamer] Recarregamento ativo. Mantendo item "${item.title}" no ar...`);
        return;
      }
      // Callback executado ao terminar o vídeo
      console.log(`[Streamer] VÍDEO CONCLUÍDO: "${item.title}". Limpando e iniciando próximo da fila...`);
      
      // Arquiva o item para removê-lo da fila ativa (e liberar disco se for local)
      db.archiveFinishedItem(item.id);

      this.currentItem = null;
      // Inicia imediatamente o próximo vídeo disponível na fila
      setTimeout(() => {
        this.playNextInQueue();
      }, 200);
    }, pipeSourceProc);

    // Se estiver transmitindo para o YouTube, garante a ativação pública da Live no YouTube Studio
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
        const nextReady = queue.find(i => i.status === 'ready');
        const isReadyToPlay = nextReady && (
          (nextReady.streamMode === 'direct' && nextReady.url) ||
          (nextReady.filePath && fs.existsSync(nextReady.filePath))
        );
        if (isReadyToPlay) {
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
