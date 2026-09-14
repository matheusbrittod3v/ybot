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
import {
  checkCppEngineHealth,
  isCppEngineAvailable,
  startStreamViaGrpc,
  stopStreamViaGrpc,
  triggerStandbyViaGrpc,
  subscribeToNativeMetrics
} from './grpc_client.js';

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

function getSystemFontOption() {
  const candidates = [
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return `:fontfile='${c}'`;
    }
  }
  return '';
}

function sanitizeDrawtext(str) {
  if (!str) return '';
  return str
    .substring(0, 55)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
    .trim();
}

export const RESOLUTION_CONFIGS = {
  '8k': { width: 7680, height: 4320, label: '8K UHD (7680x4320)', scaleFactor: 4.0 },
  '4320p': { width: 7680, height: 4320, label: '8K UHD (7680x4320)', scaleFactor: 4.0 },
  '4k': { width: 3840, height: 2160, label: '4K UHD (3840x2160)', scaleFactor: 2.0 },
  '2160p': { width: 3840, height: 2160, label: '4K UHD (3840x2160)', scaleFactor: 2.0 },
  '2k': { width: 2560, height: 1440, label: '2K QHD (2560x1440)', scaleFactor: 1.33 },
  '1440p': { width: 2560, height: 1440, label: '2K QHD (2560x1440)', scaleFactor: 1.33 },
  '1080p': { width: 1920, height: 1080, label: 'Full HD (1920x1080)', scaleFactor: 1.0 },
  '720p': { width: 1280, height: 720, label: 'HD (1280x720)', scaleFactor: 0.67 },
  '480p': { width: 854, height: 480, label: 'SD (854x480)', scaleFactor: 0.45 },
  '360p': { width: 640, height: 360, label: '360p (640x360)', scaleFactor: 0.33 },
  '240p': { width: 426, height: 240, label: '240p (426x240)', scaleFactor: 0.22 },
  'native': { width: null, height: null, label: 'Nativa / Automática', scaleFactor: 1.0 }
};

/**
 * Constrói a cadeia de filtros para a vinheta animada "A SEGUIR NA GRADE".
 * Desliza suavemente de baixo para cima, com dimensões adaptadas proporcionalmente
 * para qualquer resolução selecionada (de 240p até 8K UHD).
 */
function buildScheduleOverlaySteps(currentInput, settings, currentItemId = null, resConfig = null) {
  const enableOverlay = settings.enableScheduleOverlay !== false;
  if (!enableOverlay) return [];

  const queue = db.getQueue();
  const nextItem = queue.find(i => (!currentItemId || i.id !== currentItemId) && i.status !== 'finished' && i.status !== 'error')
                || queue.find(i => (!currentItemId || i.id !== currentItemId) && i.status !== 'finished');

  const nextTitleRaw = nextItem ? (nextItem.liveTitle || nextItem.title) : 'Programação Contínua 24h TV Braza';
  const cleanNextTitle = sanitizeDrawtext(nextTitleRaw);
  const fontOpt = getSystemFontOption();

  const intervalMins = Number(settings.scheduleOverlayInterval) || 5;
  const intervalSecs = Math.max(1, intervalMins) * 60;
  const maxAllowedDuration = Math.max(10, intervalSecs - 5);
  const rawDuration = Number(settings.scheduleOverlayDuration) || 12;
  const durationSecs = Math.max(5, Math.min(maxAllowedDuration, rawDuration));
  const startOffset = 15;

  const enableExpr = `between(mod(t\\,${intervalSecs})\\,${startOffset}\\,${startOffset + durationSecs})`;

  const scaleFactor = (resConfig && resConfig.scaleFactor) ? resConfig.scaleFactor : 1.0;
  const cardHeight = Math.round(Math.max(42, Math.min(300, 76 * scaleFactor)));
  const cardMarginX = Math.round(Math.max(20, Math.min(200, 50 * scaleFactor)));
  const cardOffsetY = Math.round(Math.max(80, Math.min(560, 140 * scaleFactor)));
  const barWidth = Math.round(Math.max(4, Math.min(24, 6 * scaleFactor)));
  const titleFontSize = Math.round(Math.max(14, Math.min(96, 24 * scaleFactor)));
  const labelFontSize = Math.round(Math.max(11, Math.min(72, 18 * scaleFactor)));
  const textPaddingX = cardMarginX + Math.round(Math.max(15, Math.min(100, 26 * scaleFactor)));
  const labelOffsetY = cardOffsetY - Math.round(Math.max(8, Math.min(56, 14 * scaleFactor)));
  const titleOffsetY = cardOffsetY - Math.round(Math.max(26, Math.min(170, 44 * scaleFactor)));

  return [
    // 1. Card backdrop translúcido moderno proporcional
    `[${currentInput}]drawbox=x=${cardMarginX}:y=ih-${cardOffsetY}:w=iw-${cardMarginX * 2}:h=${cardHeight}:color=0x0b0f19@0.92:t=fill:enable='${enableExpr}'[v_b1]`,
    // 2. Barra de destaque neon âmbar na borda esquerda
    `[v_b1]drawbox=x=${cardMarginX}:y=ih-${cardOffsetY}:w=${barWidth}:h=${cardHeight}:color=0xf59e0b:t=fill:enable='${enableExpr}'[v_b2]`,
    // 3. Rótulo da vinheta
    `[v_b2]drawtext=text='● A SEGUIR NA GRADE':fontsize=${labelFontSize}:fontcolor=0xf59e0b:x=${textPaddingX}:y=main_h-${labelOffsetY}${fontOpt}:enable='${enableExpr}'[v_txt1]`,
    // 4. Título do próximo programa
    `[v_txt1]drawtext=text='${cleanNextTitle}':fontsize=${titleFontSize}:fontcolor=0xffffff:x=${textPaddingX}:y=main_h-${titleOffsetY}${fontOpt}:enable='${enableExpr}'`
  ];
}

async function resolveDirectStreams(url) {
  // 1. Motor Primário: Web Resolver (Cloudflare CDN - Bypass Total de bloqueios de IP de Datacenter e Bots)
  try {
    console.log('[Streamer Direct] ⚡ Resolvendo via Motor Primário Web Resolver (Cloudflare CDN)...');
    const webData = await resolveDownloadUrl(url, ['720', '1080', '480', '360']);
    if (webData && webData.downloadUrl) {
      console.log(`[Streamer Direct] ✅ Fluxo resolvido de PRIMEIRA em ${webData.quality}p via Cloudflare CDN!`);
      return {
        success: true,
        provider: `CloudflareCDN_${webData.quality}p`,
        videoUrl: webData.downloadUrl,
        audioUrl: null,
        isProgressive: true,
        resolution: `${webData.quality}p`
      };
    }
  } catch (err) {
    console.warn('[Streamer Direct] Motor Primário Cloudflare indisponível:', err.message);
  }

  // 2. Fallback Secundário via stream_resolver (yt-dlp + ANDROID_VR)
  try {
    console.log('[Streamer Direct] Tentando fallback secundário via stream_resolver (ANDROID_VR)...');
    const { stdout, stderr } = await execFileAsync('python3', [RESOLVER_SCRIPT, url], { timeout: 25000, input: '' });
    if (stderr && stderr.trim()) {
      console.warn('[Streamer Direct Resolver Debug]:', stderr.trim().slice(0, 300));
    }
    const cleanOutput = stdout.trim().split('\n').find(l => l.trim().startsWith('{'));
    if (cleanOutput) {
      const data = JSON.parse(cleanOutput);
      if (data.success && data.videoUrl) {
        console.log(`[Streamer Direct] Fluxo resolvido via ${data.provider} (${data.resolution})!`);
        return data;
      }
    }
  } catch (err) {
    console.warn('[Streamer Direct] stream_resolver aviso:', err.message);
  }

  // 3. Fallback Terciário via yt-dlp CLI
  try {
    console.log('[Streamer Direct] Tentando fallback terciário via yt-dlp CLI...');
    const candidates = [
      path.join(DATA_DIR, 'cookies.txt'),
      path.resolve(__dirname, '../../../data/cookies.txt'),
      path.resolve(__dirname, '../../data/cookies.txt'),
      '/app/data/cookies.txt'
    ];
    let cookiesPath = candidates.find(p => fs.existsSync(p) && fs.statSync(p).size > 20);

    const attempts = [
      { cmd: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
      { cmd: 'yt-dlp', prefixArgs: [] },
      { cmd: '/usr/local/bin/yt-dlp', prefixArgs: [] }
    ];

    for (const att of attempts) {
      try {
        const ytArgs = [
          ...att.prefixArgs,
          '--no-playlist',
          '--no-warnings',
          '--extractor-args', 'youtube:player_client=android_vr,android,web',
          '-g',
          '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bestvideo+bestaudio/best',
          url
        ];
        if (cookiesPath) {
          ytArgs.splice(att.prefixArgs.length, 0, '--cookies', cookiesPath);
        }
        const { stdout } = await execFileAsync(att.cmd, ytArgs, { timeout: 30000 });
        const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l.startsWith('http://') || l.startsWith('https://'));
        if (lines.length > 0) {
          console.log(`[Streamer Direct] Fluxo resolvido com sucesso via fallback yt-dlp CLI!`);
          return {
            success: true,
            provider: 'yt-dlp_direct_fast',
            videoUrl: lines[0],
            audioUrl: lines.length > 1 ? lines[1] : null,
            isProgressive: lines.length === 1,
            resolution: '1080p'
          };
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[Streamer Direct] Fallback yt-dlp indisponível:', err.message);
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
    this.resolvingStartedAt = 0;
    this.lastFfmpegOutputTime = Date.now();
    this.watchdogInterval = null;
    this.prefetchCache = new Map();
    this.isPrefetching = false;

    downloader.onEvent((event, payload) => {
      if (event === 'download_complete') {
        if (this.shouldRun && this.currentMode === 'STANDBY') {
          console.log('[Streamer] Novo vídeo ficou pronto durante standby. Iniciando transição...');
          this.playNextInQueue();
        }
      }
    });
  }

  isStreamingAlive() {
    if (!this.shouldRun || !this.ffmpegProc) return false;
    return (Date.now() - this.lastFfmpegOutputTime) < 12000;
  }

  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      if (!this.shouldRun) return;

      // 1. Timeout de proteção na resolução de link (máx 25s)
      if (this.isResolving && this.resolvingStartedAt && (Date.now() - this.resolvingStartedAt > 25000)) {
        console.warn('[Streamer Watchdog] ⚠️ Timeout ao resolver link do vídeo (>25s). Destravando motor...');
        this.isResolving = false;
        this.resolvingStartedAt = 0;
        if (!this.ffmpegProc) {
          this.streamStandby();
        }
      }

      // 2. Detecção de congelamento / silêncio do FFmpeg (Anti-Hang / Anti-Freeze)
      if (this.ffmpegProc) {
        const silenceMs = Date.now() - this.lastFfmpegOutputTime;
        if (silenceMs > 15000) {
          console.warn(`[Streamer Watchdog] 🚨 TRAVAMENTO DO FFMPEG DETECTADO! Processo sem resposta há ${(silenceMs / 1000).toFixed(0)}s sem emitir frames. Reiniciando transmissão imediatamente para manter a live online no YouTube e Twitch...`);
          this.lastFfmpegOutputTime = Date.now();
          this.killProcess();
          db.updatePlayoutState({ fps: 0, bitrate: '0k' });

          if (this.currentMode === 'VIDEO' && this.currentItem) {
            console.warn(`[Streamer Watchdog] Marcando erro no vídeo travado "${this.currentItem.title}" para avançar a fila...`);
            db.updateQueueItem(this.currentItem.id, {
              status: 'error',
              error: 'Conexão travada ou timeout durante transmissão'
            });
            this.currentItem = null;
          }

          // Restaura sinal imediatamente via Standby
          this.streamStandby();
          setTimeout(() => this.playNextInQueue(), 1200);
          return;
        } else if (silenceMs > 6000) {
          db.updatePlayoutState({ fps: 0, bitrate: '0k' });
        }
      }

      // 3. Detecção de FFmpeg inativo / caído
      if (!this.ffmpegProc && !this.isResolving) {
        console.warn('[Streamer Watchdog] ⚠️ FFmpeg inativo detectado! Restaurando vinheta Standby para manter a Live 100% online...');
        this.streamStandby();
        setTimeout(() => this.playNextInQueue(), 1000);
      }

      // 4. Auto-recuperação de vídeos marcados com erro na fila
      const queue = db.getQueue();
      const hasErrors = queue.some(i => i.status === 'error');
      if (hasErrors) {
        console.log('[Streamer Watchdog] 🔄 Destravando automaticamente todos os vídeos da fila marcados com erro...');
        db.resetQueueErrors();
        this.broadcast('queue_updated', { queue: db.getQueue() });
        if (this.currentMode === 'STANDBY' && !this.isResolving) {
          setTimeout(() => this.playNextInQueue(), 500);
        }
      }
    }, 3000);
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * Pré-resolução em background (Zero-Gap Playout)
   * Resolve as URLs diretas do próximo item da fila antecipadamente para transição instantânea (0ms).
   */
  triggerPrefetchNext() {
    if (!this.shouldRun || this.isPrefetching) return;
    const queue = db.getQueue();
    const nextItem = queue.find(i => (!this.currentItem || i.id !== this.currentItem.id) && i.status !== 'finished' && i.status !== 'error');
    if (!nextItem) return;

    const hasLocalFile = Boolean(nextItem.filePath && fs.existsSync(nextItem.filePath));
    if (hasLocalFile) return;

    if (this.prefetchCache.has(nextItem.id)) {
      const cached = this.prefetchCache.get(nextItem.id);
      if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
        return;
      }
    }

    this.isPrefetching = true;
    console.log(`[Streamer Pre-fetch] 🚀 Pré-resolvendo em segundo plano: "${nextItem.title}"...`);
    resolveDirectStreams(nextItem.url).then(data => {
      if (data && data.videoUrl) {
        this.prefetchCache.set(nextItem.id, { data, timestamp: Date.now() });
        console.log(`[Streamer Pre-fetch] ✅ "${nextItem.title}" pré-resolvido em cache! Troca será instantânea.`);
      }
    }).catch(err => {
      console.warn('[Streamer Pre-fetch] Falha ao pré-resolver próximo vídeo:', err.message);
    }).finally(() => {
      this.isPrefetching = false;
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

  getStreamTargets() {
    const settings = db.getSettings();
    const targets = [];

    // 1. Interface Isolada: YouTube Live
    if (settings.youtubeStreamKey) {
      const cleanKey = settings.youtubeStreamKey.trim();
      const rtmpUrl = (settings.youtubeRtmpUrl || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/+$/, '');
      targets.push({
        id: 'youtube',
        name: 'YouTube',
        platform: 'youtube',
        url: `${rtmpUrl}/${cleanKey}`,
        masked: `${rtmpUrl}/****`,
        maxBitrateKbps: 8000,
        flvFlags: 'no_duration_filesize'
      });
    }

    // 2. Interface Isolada: Twitch Multistream
    const twitchKey = (settings.twitchStreamKey || process.env.TWITCH_STREAM_KEY || '').trim();
    const twitchEnabled = Boolean(settings.enableTwitchStream || process.env.ENABLE_TWITCH_STREAM === 'true');
    if (twitchEnabled && twitchKey) {
      const cleanTwitchKey = twitchKey;
      const twitchUrl = (settings.twitchRtmpUrl || process.env.TWITCH_RTMP_URL || 'rtmp://live.twitch.tv/app/').replace(/\/+$/, '');
      targets.push({
        id: 'twitch',
        name: 'Twitch',
        platform: 'twitch',
        url: `${twitchUrl}/${cleanTwitchKey}`,
        masked: `${twitchUrl}/****`,
        maxBitrateKbps: 5800, // Teto máximo rígido da Twitch (limite 6000k)
        flvFlags: 'no_duration_filesize'
      });
    }

    return targets;
  }

  getStreamTarget() {
    const targets = this.getStreamTargets();
    return targets.length > 0 ? targets[0].url : null;
  }

  getEffectiveBitrate(settings) {
    const targets = this.getStreamTargets();
    let videoBitrate = settings.videoBitrate || '4500k';
    let numericBitrate = parseInt(videoBitrate, 10) || 4500;

    // Regra da Interface Twitch: se a Twitch estiver ativa, crava no padrão broadcast estável de 4500k (teto seguro < 6000k)
    const hasTwitch = targets.some(t => t.id === 'twitch');
    if (hasTwitch && numericBitrate > 4800) {
      console.log(`[Streamer Multistream] ⚡ Interface Twitch ativa: ajustando taxa de ${videoBitrate} para 4500k para estabilidade máxima`);
      numericBitrate = 4500;
      videoBitrate = '4500k';
    }

    return {
      videoBitrate,
      numericBitrate,
      minRate: `${Math.round(numericBitrate * 0.9)}k`,
      maxRate: `${numericBitrate}k`,
      bufSize: `${numericBitrate}k`, // Buffer VBV de 1s para CBR estrito sem picos
      audioBitrate: settings.audioBitrate || '160k'
    };
  }

  appendRtmpOutputs(args) {
    const targets = this.getStreamTargets();
    if (targets.length === 0) {
      args.push('-f', 'null', '-');
      return targets;
    }

    // Garante que os streams de vídeo e áudio estejam explicitamente mapeados.
    // O muxer 'tee' do FFmpeg não executa stream selection automático por padrão;
    // sem -map explícito, ele encerra com o erro: "Output file #0 does not contain any stream".
    if (!args.includes('-map')) {
      args.push('-map', '0:v:0', '-map', '0:a:0?');
    }

    if (targets.length === 1) {
      const t = targets[0];
      const flvFlags = t.flvFlags || 'no_duration_filesize';
      args.push('-flvflags', flvFlags, '-f', 'flv', t.url);
      return targets;
    }

    // Multistream simultâneo (YouTube + Twitch) com interfaces isoladas via muxer 'tee':
    // Codifica vídeo (H.264) e áudio (AAC) UMA ÚNICA VEZ e replica para ambos os servidores RTMP.
    // O parâmetro 'onfail=ignore' garante que se uma das transmissões oscilar, a outra continua 100% no ar!
    // 'flvflags=no_duration_filesize' é indispensável para o YouTube Studio tratar como live contínua sem duração finita.
    args.push('-flags', '+global_header', '-f', 'tee');
    const teeOutputs = targets.map(t => {
      const flvFlags = t.flvFlags ? `:flvflags=${t.flvFlags}` : ':flvflags=no_duration_filesize';
      return `[f=flv:onfail=ignore${flvFlags}]${t.url}`;
    }).join('|');
    args.push(teeOutputs);

    return targets;
  }

  async start() {
    this.shouldRun = true;
    console.log('[Streamer] Iniciando Playout 24/7 TV Braza com Failsafe Anti-Queda...');
    await ensureStandbyVideo();
    this.startWatchdog();

    // Verificação de alta performance com motor nativo C++ via gRPC
    try {
      const cppHealth = await checkCppEngineHealth();
      if (cppHealth.ok) {
        console.log(`[Streamer] ⚡ Motor Nativo C++ (${cppHealth.version}) ATIVO! RSS: ${cppHealth.memoryRssKb} KB`);
        subscribeToNativeMetrics((metric) => {
          this.broadcast('telemetry', {
            fps: metric.fps,
            bitrate: `${metric.bitrate_kbps}k`,
            speed: `${metric.speed}x`,
            frameCount: metric.frame_count,
            state: metric.current_state,
            uptime: metric.uptime_seconds
          });
        }, 500);
      } else {
        console.log('[Streamer] ℹ️ Motor C++ offline/não detectado. Executando em modo Playout Integrado Node/FFmpeg.');
      }
    } catch (_) {}

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
    stopStreamViaGrpc('Stream parado pelo usuário').catch(() => {});
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
    // 1. Procura qualquer item na fila que ainda não foi finalizado e não tem erro
    let readyItem = queue.find(i => i.status !== 'finished' && i.status !== 'error');

    // 2. Se todos estiverem marcados com erro, pega o primeiro item com erro para retentar automaticamente!
    if (!readyItem) {
      const errorItem = queue.find(i => i.status === 'error');
      if (errorItem) {
        console.log(`[Streamer] 🔄 Auto-retentando transmissão de vídeo com erro prévio: "${errorItem.title}"`);
        db.updateQueueItem(errorItem.id, {
          status: 'ready',
          error: null,
          downloadProgress: 100,
          downloadSpeed: '⚡ Stream Direto (Sem Anúncios)'
        });
        errorItem.status = 'ready';
        readyItem = errorItem;
      }
    }

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

    // Zero-Gap: Se nenhum processo FFmpeg estiver ativo no ar, aciona o Standby imediatamente
    // para que a conexão RTMP com o YouTube nunca caia enquanto o novo vídeo é preparado
    if (!this.ffmpegProc && this.currentMode !== 'STANDBY') {
      console.log('[Streamer Zero-Gap] 🛡️ Mantendo Standby ativo no ar enquanto prepara o próximo vídeo...');
      this.streamStandby();
    }

    this.isResolving = true;
    this.resolvingStartedAt = Date.now();
    const hasLocalFile = Boolean(item.filePath && fs.existsSync(item.filePath));
    const isDirect = !hasLocalFile || item.streamMode === 'direct';

    console.log(`[Streamer] PREPARANDO TRANSMISSÃO: "${item.title}" ${isDirect ? '[Modo: ⚡ Stream Direto (Sem Anúncios)]' : '[Arquivo Local]'}`);

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
        let streamData = null;

        // 1. Verifica se o vídeo já foi pré-resolvido em cache (transição 0ms)
        if (this.prefetchCache && this.prefetchCache.has(item.id)) {
          const cached = this.prefetchCache.get(item.id);
          if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
            console.log(`[Streamer Pre-fetch] ⚡ Utilizando fluxo direto pré-resolvido em cache para: "${item.title}"`);
            streamData = cached.data;
          }
          this.prefetchCache.delete(item.id);
        }

        if (!streamData) {
          console.log(`[Streamer] ⚡ Invocando motor de Stream Direto para: ${item.url}`);
          streamData = await resolveDirectStreams(item.url);
        }

        if (streamData && streamData.videoUrl) {
          console.log(`[Streamer Direct] Fluxos resolvidos via ${streamData.provider} (${streamData.resolution})! Iniciando broadcast com -re...`);
          const httpOptions = [
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-timeout', '10000000',
            '-rw_timeout', '10000000',
            '-reconnect', '1',
            '-reconnect_at_eof', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '3',
            '-analyzeduration', '3000000',
            '-probesize', '3000000'
          ];
          if (streamData.audioUrl && !streamData.isProgressive) {
            inputArgs = [
              '-re',
              '-thread_queue_size', '4096',
              ...httpOptions,
              '-i', streamData.videoUrl,
              '-re',
              '-thread_queue_size', '4096',
              ...httpOptions,
              '-i', streamData.audioUrl,
              '-map', '0:v:0',
              '-map', '1:a:0?'
            ];
          } else {
            inputArgs = [
              '-re',
              '-thread_queue_size', '4096',
              ...httpOptions,
              '-i', streamData.videoUrl,
              '-map', '0:v:0',
              '-map', '0:a:0?'
            ];
          }
        } else {
          throw new Error('Não foi possível obter links de streaming reproduzíveis para o vídeo');
        }
      } else {
        if (!item.filePath || !fs.existsSync(item.filePath)) {
          throw new Error(`Arquivo local de vídeo não encontrado: ${item.filePath}`);
        }
        inputArgs = [
          '-re',
          '-thread_queue_size', '2048',
          '-i', item.filePath,
          '-map', '0:v:0',
          '-map', '0:a:0?'
        ];
      }

      const { videoBitrate, minRate, maxRate, bufSize, audioBitrate } = this.getEffectiveBitrate(settings);

      const args = [
        ...inputArgs,
        '-r', '30',
        '-vsync', '1',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-b:v', videoBitrate,
        '-minrate', minRate,
        '-maxrate', maxRate,
        '-bufsize', bufSize,
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        '-flags:v', '+cgop',
        '-bf', '0',
        '-threads', '0',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-ar', '48000',
        '-ac', '2',
        '-af', 'aresample=async=1:first_pts=0',
        '-max_muxing_queue_size', '4096'
      ];

      let filterSteps = [];
      const targetResKey = String(settings.resolution || '1080p').toLowerCase().trim();
      const resConfig = RESOLUTION_CONFIGS[targetResKey] || RESOLUTION_CONFIGS['1080p'];

      if (resConfig && resConfig.width) {
        // Escala para a resolução solicitada (até 8K 7680x4320) mantendo proporção e altura par (-2)
        filterSteps.push(`[in]scale=${resConfig.width}:-2:flags=fast_bilinear[v_scaled]`);
      } else {
        // Nativa: garante que dimensões sejam pares para o codec x264 sem alterar a escala
        filterSteps.push(`[in]scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=fast_bilinear[v_scaled]`);
      }
      let currentInput = 'v_scaled';

      // 1. Logo d'Água (canto inferior esquerdo, proporcional à resolução)
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
          const logoScaleFactor = (resConfig && resConfig.scaleFactor) ? resConfig.scaleFactor : 1.0;
          const logoWidth = Math.round(Math.max(100, Math.min(880, 220 * logoScaleFactor)));
          const margin = Math.round(Math.max(15, Math.min(140, 35 * logoScaleFactor)));
          filterSteps.push(`movie='${escapedLogoPath}',scale=${logoWidth}:-1[logo];[${currentInput}][logo]overlay=x=${margin}:y=H-h-${margin}[v_wm]`);
          currentInput = 'v_wm';
        }
      }

      // 2. Banner Animado Popup "A SEGUIR NA GRADE" (proporcional à resolução)
      const overlaySteps = buildScheduleOverlaySteps(currentInput, settings, item.id, resConfig);
      if (overlaySteps.length > 0) {
        filterSteps.push(...overlaySteps);
      } else {
        // Se não houve banner posterior, remove o rótulo de saída do último filtro para entregar direto ao encoder
        filterSteps[filterSteps.length - 1] = filterSteps[filterSteps.length - 1].replace(/\[[^\]]+\]$/, '');
      }

      if (filterSteps.length > 0) {
        let finalVf = filterSteps.join(';');
        if (!finalVf.startsWith('[in]')) {
          finalVf = `[in]${finalVf}`;
        }
        args.push('-vf', finalVf);
      }

      const activeTargets = this.appendRtmpOutputs(args);
      if (activeTargets.length > 0) {
        const targetSummary = activeTargets.map(t => `${t.name} (${t.masked})`).join(' + ');
        console.log(`[Streamer] 📡 Transmitindo vídeo para: ${targetSummary}`);
      }

      // Mata o Standby no exato instante anterior a disparar o FFmpeg do novo vídeo
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

      // Dispara a pré-resolução do próximo vídeo da fila após 4 segundos
      setTimeout(() => this.triggerPrefetchNext(), 4000);

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
        // Zero-Gap: se o próximo vídeo já está pré-resolvido em cache, vai direto para ele.
        // Caso contrário, ativa o Standby imediatamente para manter o fluxo RTMP vivo sem interrupção.
        if (this.shouldRun) {
          const queue = db.getQueue();
          const nextItem = queue.find(i => (!item || i.id !== item.id) && i.status !== 'finished' && i.status !== 'error');
          const hasInstantReady = nextItem && (
            (nextItem.filePath && fs.existsSync(nextItem.filePath)) ||
            (this.prefetchCache && this.prefetchCache.has(nextItem.id))
          );

          if (!hasInstantReady) {
            console.log('[Streamer Zero-Gap] 🛡️ Mantendo Standby ativo na transição de vídeos...');
            this.streamStandby();
          }
        }
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
      this.resolvingStartedAt = 0;
      this.currentItem = null;
      if (this.shouldRun && !this.ffmpegProc) {
        this.streamStandby();
      }
      this.playNextInQueue();
    }
  }

  spawnFfmpeg(args, onFinish, pipeSourceProc = null) {
    console.log(`[Streamer] Executando FFmpeg: ffmpeg ${args.slice(0, 6).join(' ')} ...`);
    this.lastFfmpegOutputTime = Date.now();
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

    const recentStderr = [];
    proc.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      recentStderr.push(line);
      if (recentStderr.length > 30) {
        recentStderr.shift();
      }

      // Parse métricas do FFmpeg: frame= 120 fps= 30 q=28.0 size= 1240kB time=00:00:04.00 bitrate=2540.2kbits/s speed=1.00x
      const match = line.match(/fps=\s*([\d.]+).*time=\s*([\d:.]+).*bitrate=\s*([\d.]+kbits\/s)/);
      const speedMatch = line.match(/speed=\s*([\d.]+x)/);
      if (match) {
        this.lastFfmpegOutputTime = Date.now();
        const fps = parseFloat(match[1]);
        const timeStr = match[2];
        const bitrate = match[3];
        const speed = speedMatch ? speedMatch[1] : '1.00x';

        let elapsedSec = 0;
        try {
          const parts = timeStr.split(':');
          if (parts.length === 3) {
            elapsedSec = Math.floor(parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]));
          }
        } catch (_) {}

        db.updatePlayoutState({
          fps,
          bitrate,
          speed,
          elapsedSeconds: elapsedSec,
          elapsedFormatted: timeStr.split('.')[0],
          lastHeartbeat: Date.now()
        });

        this.broadcast('stream_stats', {
          fps,
          time: timeStr,
          bitrate,
          speed,
          mode: this.currentMode
        });
      } else {
        const trimmed = line.trim();
        if (trimmed && (trimmed.includes('Output slave') || trimmed.includes('Broken pipe') || trimmed.includes('Connection reset by peer') || trimmed.includes('Server error') || trimmed.includes('Error') || trimmed.includes('error') || trimmed.includes('Server returned') || trimmed.includes('Connection refused') || trimmed.includes('Invalid data') || trimmed.includes('Failed to open') || trimmed.includes('Option') || trimmed.includes('incorrect codec'))) {
          console.warn(`[Streamer FFmpeg aviso] ${trimmed.slice(0, 200)}`);
        }
      }
    });

    proc.on('close', (code) => {
      console.log(`[Streamer] Processo FFmpeg finalizado (código ${code})`);
      db.updatePlayoutState({ fps: 0, bitrate: '0k' });
      if (code !== 0 && code !== null && recentStderr.length > 0) {
        const errorSummary = recentStderr.join('').split('\n').filter(l => l.trim().length > 0).slice(-10).join('\n');
        console.warn(`[Streamer FFmpeg detalhes do erro (código ${code})]:\n${errorSummary}`);
      }
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
    const { videoBitrate, minRate, maxRate, bufSize, audioBitrate } = this.getEffectiveBitrate(settings);
    const targetResKey = String(settings.resolution || '1080p').toLowerCase().trim();
    const resConfig = RESOLUTION_CONFIGS[targetResKey] || RESOLUTION_CONFIGS['1080p'];

    let args = [];
    const standbyFile = getStandbyFilePath();

    if (standbyFileExists()) {
      let standbyVf = [];
      let currentStandbyInput = 'in';
      if (resConfig && resConfig.width) {
        standbyVf.push(`[in]scale=${resConfig.width}:-2:flags=fast_bilinear[v_scaled]`);
        currentStandbyInput = 'v_scaled';
      }
      const overlaySteps = buildScheduleOverlaySteps(currentStandbyInput, settings, null, resConfig);
      if (overlaySteps.length > 0) {
        standbyVf.push(...overlaySteps);
      } else if (currentStandbyInput === 'v_scaled') {
        standbyVf[standbyVf.length - 1] = standbyVf[standbyVf.length - 1].replace(/\[[^\]]+\]$/, '');
      }

      // Transmite o vídeo de standby em loop contínuo
      args = [
        '-stream_loop', '-1',
        '-re',
        '-i', standbyFile,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-r', '30',
        '-vsync', '1',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-b:v', videoBitrate,
        '-minrate', minRate,
        '-maxrate', maxRate,
        '-bufsize', bufSize,
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        '-flags:v', '+cgop',
        '-bf', '0',
        '-threads', '0',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-ar', '48000',
        '-ac', '2',
        '-af', 'aresample=async=1:first_pts=0',
        '-max_muxing_queue_size', '4096'
      ];

      if (standbyVf.length > 0) {
        let finalStandbyVf = standbyVf.join(';');
        if (!finalStandbyVf.startsWith('[in]')) {
          finalStandbyVf = `[in]${finalStandbyVf}`;
        }
        args.push('-vf', finalStandbyVf);
      }
    } else {
      // Standby sintético nativo do FFmpeg com tela HD TV Braza e Música Ambiente
      const audioExpr = 'aevalsrc=\'0.05*sin(2*PI*220*t)*sin(0.3*PI*t)+0.05*sin(2*PI*277.18*t)+0.04*sin(2*PI*329.63*t)+0.03*sin(2*PI*440*t)+0.03*sin(2*PI*110*t)\':s=48000';
      const videoFilter = [
        '[0:v]drawbox=x=0:y=0:w=1920:h=1080:color=0x070a14@1:t=fill[bg]',
        '[bg]drawbox=x=310:y=210:w=1300:h=660:color=0x0f172a@0.9:t=fill[card]',
        '[card]drawbox=x=310:y=210:w=1300:h=8:color=0xf59e0b:t=fill[card_border]',
        '[card_border]drawtext=text=\'TV BRAZA\':fontcolor=0xffffff:fontsize=120:x=(w-text_w)/2:y=320:shadowcolor=0xf59e0b:shadowx=4:shadowy=4[t1]',
        '[t1]drawtext=text=\'ESTUDIO DE TRANSMISSAO 24H • PROGRAMACAO EM INSTANTES\':fontcolor=0x94a3b8:fontsize=30:x=(w-text_w)/2:y=470[t2]',
        '[t2]drawbox=x=760:y=560:w=400:h=56:color=0x10b981@0.15:t=fill[tag_bg]',
        '[tag_bg]drawbox=x=760:y=560:w=400:h=56:color=0x10b981@0.5:t=2[tag_border]',
        '[tag_border]drawtext=text=\'● SINAL NO AR • 1080p 60FPS\':fontcolor=0x10b981:fontsize=20:x=(w-text_w)/2:y=578[t3]',
        '[t3]drawtext=text=\'TV Braza Studio 24/7 - Transmissao Continua sem Interrupcao\':fontcolor=0x64748b:fontsize=20:x=(w-text_w)/2:y=760[v]'
      ].join(';');

      args = [
        '-re',
        '-f', 'lavfi', '-i', 'color=c=0x070a14:s=1920x1080:r=30',
        '-f', 'lavfi', '-i', audioExpr,
        '-filter_complex', videoFilter,
        '-map', '[v]',
        '-map', '1:a',
        '-r', '30',
        '-vsync', '1',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-b:v', videoBitrate,
        '-minrate', minRate,
        '-maxrate', maxRate,
        '-bufsize', bufSize,
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        '-flags:v', '+cgop',
        '-bf', '0',
        '-threads', '0',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-ar', '48000',
        '-ac', '2',
        '-af', 'aresample=async=1:first_pts=0',
        '-max_muxing_queue_size', '4096'
      ];
    }

    const activeTargets = this.appendRtmpOutputs(args);
    if (activeTargets.length > 0) {
      const targetSummary = activeTargets.map(t => `${t.name} (${t.masked})`).join(' + ');
      console.log(`[Streamer Standby] 📡 Transmitindo Standby para: ${targetSummary}`);
    } else {
      console.warn('[Streamer Standby] ⚠️ Nenhuma Chave RTMP ativa. Buscando automaticamente no YouTube Studio...');
      youtubeUpdater.detectAndSaveActiveBroadcast().then((broadcast) => {
        if (broadcast && this.getStreamTarget() && this.currentMode === 'STANDBY') {
          console.log('[Streamer Standby] Stream Key obtida com sucesso. Conectando Standby à Live...');
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
