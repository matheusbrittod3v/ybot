import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import multer from 'multer';
import { db, DATA_DIR, THUMBS_DIR, MEDIA_DIR, ensureDirectories } from '../db.js';
import { streamer } from '../engine/streamer.js';
import { downloader } from '../engine/downloader.js';
import { fetchVideoInfo, formatDuration } from '../utils/youtube.js';
import { getSystemStats } from '../utils/system.js';
import { youtubeUpdater } from '../utils/youtube-updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COOKIE_GENERATOR_SCRIPT = path.join(__dirname, '../utils/cookie_generator.py');
const execFileAsync = promisify(execFile);

const router = express.Router();

// Helper para obter duração de arquivo de vídeo via FFmpeg
async function getVideoDuration(filePath) {
  try {
    const { stderr } = await execFileAsync('ffmpeg', ['-i', filePath], { timeout: 10000 }).catch(e => e);
    const match = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      return Math.round(hours * 3600 + minutes * 60 + seconds);
    }
  } catch (_) {}
  return 0;
}

// Multer para cookies.txt
const uploadCookie = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

// Configuração do Multer para upload de thumbnails personalizadas
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureDirectories();
      cb(null, THUMBS_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const filename = `thumb_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de imagem são permitidos (JPG, PNG, WebP)'));
    }
  }
});

// Configuração do Multer para upload manual de vídeos (MP4, MKV, MOV, TS, WebM)
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureDirectories();
      cb(null, MEDIA_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const id = crypto.randomUUID();
    req.uploadedVideoId = id;
    cb(null, `${id}.mp4`);
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB máximo
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.mp4', '.mkv', '.mov', '.avi', '.ts', '.webm', '.m4v', '.flv'];
    if (allowed.includes(ext) || (file.mimetype && file.mimetype.startsWith('video/'))) {
      cb(null, true);
    } else {
      cb(new Error('Formato de vídeo não suportado. Envie arquivos MP4, MKV, MOV, TS ou WebM.'));
    }
  }
});

// Multer para upload de logo da marca d'água
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureDirectories();
      cb(null, DATA_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `watermark_logo${ext}`);
  }
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de imagem são permitidos (PNG, JPG, WebP, SVG)'));
    }
  }
});

// Upload de Logo personalizada para marca d'água na transmissão
router.post('/watermark/logo', uploadLogo.single('logo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Nenhum arquivo de imagem enviado' });
  }

  // Atualiza settings com o caminho da logo customizada
  const logoPath = req.file.path;
  db.updateSettings({ customLogoPath: logoPath });

  // Aplica a nova logo em tempo real na transmissão ativa
  streamer.reloadCurrentStream();

  res.json({
    success: true,
    logoPath,
    filename: req.file.filename,
    size: req.file.size,
    message: 'Logo atualizada com sucesso em tempo real na transmissão!'
  });
});

// Obter a logo atual da marca d'água
router.get('/watermark/logo', (req, res) => {
  const settings = db.getSettings();
  const customPath = settings.customLogoPath;

  if (customPath && fs.existsSync(customPath)) {
    return res.sendFile(customPath);
  }

  // Fallback para a logo padrão
  const defaultLogo = path.resolve(__dirname, '../../public/assets/logo.png');
  if (fs.existsSync(defaultLogo)) {
    return res.sendFile(defaultLogo);
  }

  res.status(404).json({ success: false, error: 'Nenhuma logo encontrada' });
});

// Remover logo customizada (volta ao padrão)
router.delete('/watermark/logo', (req, res) => {
  const settings = db.getSettings();
  const customPath = settings.customLogoPath;

  if (customPath && fs.existsSync(customPath)) {
    try { fs.unlinkSync(customPath); } catch (_) {}
  }

  db.updateSettings({ customLogoPath: '' });
  // Aplica a logo padrão em tempo real
  streamer.reloadCurrentStream();

  res.json({ success: true, message: 'Logo customizada removida. Voltando à logo padrão em tempo real.' });
});

// Status completo do sistema
router.get('/status', (req, res) => {
  const playoutState = db.getPlayoutState();
  const queue = db.getQueue();
  const settings = db.getSettings();
  const stats = getSystemStats();

  let activeItem = null;
  if (playoutState.activeItemId) {
    activeItem = queue.find(i => i.id === playoutState.activeItemId) || null;
  }

  // Próximo vídeo na sequência
  let nextItem = null;
  if (activeItem) {
    nextItem = queue.find(i => i.id !== activeItem.id && i.status !== 'finished') || null;
  } else {
    nextItem = queue.find(i => i.status !== 'finished') || null;
  }

  res.json({
    success: true,
    playout: {
      ...playoutState,
      isConfigured: Boolean(settings.youtubeStreamKey && settings.youtubeStreamKey.trim().length > 5)
    },
    activeItem,
    nextItem,
    queueCount: queue.length,
    system: stats
  });
});

// Listar fila de reprodução
router.get('/queue', (req, res) => {
  const queue = db.getQueue();
  res.json({ success: true, queue });
});

// Upload de Thumbnail Personalizada
router.post('/upload-thumb', upload.single('thumbnail'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Nenhum arquivo de imagem enviado' });
  }

  const thumbUrl = `/thumbs/${req.file.filename}`;
  const thumbPath = req.file.path;

  res.json({
    success: true,
    thumbUrl,
    thumbPath,
    filename: req.file.filename,
    size: req.file.size
  });
});

// Prévia de link do YouTube antes de adicionar
router.post('/queue/preview', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Informe a URL do vídeo do YouTube' });
  }

  try {
    const info = await fetchVideoInfo(url);
    const settings = db.getSettings();
    const suggestedLiveTitle = `${settings.defaultLiveTitlePrefix || ''}${info.title}`.substring(0, 100);

    res.json({
      success: true,
      info: {
        ...info,
        suggestedLiveTitle
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Adicionar vídeo rápido diretamente (1 clique, sem preview)
router.post('/queue/quick-add', async (req, res) => {
  const { url, streamMode } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL do vídeo é obrigatória' });
  }

  try {
    const videoData = await fetchVideoInfo(url);
    const settings = db.getSettings();
    const isDirect = (streamMode || settings.defaultStreamMode || 'direct') === 'direct';
    const finalLiveTitle = `${settings.defaultLiveTitlePrefix || ''}${videoData.title}`.substring(0, 100);

    const newItem = db.addToQueue({
      id: crypto.randomUUID(),
      url: videoData.url || url,
      ...videoData,
      liveTitle: finalLiveTitle,
      customThumbPath: null,
      customThumbUrl: null,
      streamMode: isDirect ? 'direct' : 'download',
      status: isDirect ? 'ready' : 'queued',
      downloadProgress: isDirect ? 100 : 0,
      downloadSpeed: isDirect ? '⚡ Stream Direto (Sem Anúncios)' : '',
      filePath: null
    });

    console.log(`[Queue] Vídeo "${newItem.title}" adicionado [Modo: ${isDirect ? '⚡ Stream Direto' : '💾 Download'}].`);

    // Notifica WebSocket instantaneamente
    downloader.broadcast('download_complete', { item: newItem });
    streamer.broadcast('queue_updated', { queue: db.getQueue() });

    if (!isDirect) {
      downloader.checkQueue();
    }

    if (streamer.shouldRun) {
      if (streamer.currentMode === 'STANDBY') {
        setTimeout(() => streamer.playNextInQueue(), 300);
      }
    } else if (settings.autoLoopStandby) {
      streamer.start();
    }

    res.json({ success: true, item: newItem });
  } catch (err) {
    console.error('[Queue Quick-Add Erro]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adicionar vídeo à fila com Título e Thumbnail Personalizada
router.post('/queue/add', async (req, res) => {
  const {
    url,
    title,
    duration,
    durationFormatted,
    thumbnail,
    channel,
    liveTitle,
    customThumbPath,
    customThumbUrl,
    streamMode
  } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL do vídeo é obrigatória' });
  }

  try {
    let videoData = {
      title,
      duration: duration || 0,
      durationFormatted: durationFormatted || '',
      thumbnail,
      channel
    };

    // Se os metadados não vieram no body, busca agora
    if (!title || !thumbnail) {
      const fetched = await fetchVideoInfo(url);
      videoData = {
        title: fetched.title,
        duration: fetched.duration,
        durationFormatted: fetched.durationFormatted,
        thumbnail: fetched.thumbnail,
        channel: fetched.channel
      };
    }

    const settings = db.getSettings();
    const isDirect = (streamMode || settings.defaultStreamMode || 'direct') === 'direct';
    const finalLiveTitle = (liveTitle || `${settings.defaultLiveTitlePrefix || ''}${videoData.title}`).substring(0, 100);

    const newItem = db.addToQueue({
      id: crypto.randomUUID(),
      url,
      ...videoData,
      liveTitle: finalLiveTitle,
      customThumbPath: customThumbPath || null,
      customThumbUrl: customThumbUrl || null,
      streamMode: isDirect ? 'direct' : 'download',
      status: isDirect ? 'ready' : 'queued',
      downloadProgress: isDirect ? 100 : 0,
      downloadSpeed: isDirect ? '⚡ Stream Direto (Sem Anúncios)' : '',
      filePath: null
    });

    // Notifica WebSocket instantaneamente
    downloader.broadcast('download_complete', { item: newItem });
    streamer.broadcast('queue_updated', { queue: db.getQueue() });

    if (!isDirect) {
      downloader.checkQueue();
    }

    if (streamer.shouldRun) {
      if (streamer.currentMode === 'STANDBY') {
        setTimeout(() => streamer.playNextInQueue(), 300);
      }
    } else if (settings.autoLoopStandby) {
      streamer.start();
    }

    res.json({ success: true, item: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload manual de arquivo de vídeo direto para a grade de programação
router.post('/queue/upload', uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo de vídeo foi enviado.' });
    }

    const id = req.uploadedVideoId || crypto.randomUUID();
    const filePath = req.file.path;
    const stats = fs.statSync(filePath);

    const originalName = req.file.originalname.replace(/\.[^/.]+$/, '');
    const title = (req.body.title && req.body.title.trim()) || originalName || 'Vídeo Manual';
    const settings = db.getSettings();
    const liveTitle = (req.body.liveTitle && req.body.liveTitle.trim()) || `${settings.defaultLiveTitlePrefix || ''}${title}`.substring(0, 100);
    const customThumbUrl = req.body.customThumbUrl || null;
    const customThumbPath = req.body.customThumbPath || null;

    const duration = await getVideoDuration(filePath);
    const durationFormatted = formatDuration(duration);

    const newItem = db.addToQueue({
      id,
      title,
      liveTitle,
      url: `local://upload/${id}`,
      channel: 'Upload Local',
      duration,
      durationFormatted,
      thumbnail: customThumbUrl || '/assets/logo.svg',
      customThumbUrl,
      customThumbPath,
      status: 'ready', // Já está no disco pronto para transmissão!
      filePath,
      fileSize: stats.size,
      downloadProgress: 100,
      downloadSpeed: 'Pronto no Disco',
      source: 'upload'
    });

    console.log(`[Queue] Vídeo manual adicionado com sucesso: "${title}" (${(stats.size / 1024 / 1024).toFixed(1)} MB)!`);

    // Notifica instantaneamente todos os navegadores conectados
    downloader.broadcast('download_complete', { item: newItem });
    streamer.broadcast('queue_updated', { queue: db.getQueue() });

    // Se o streamer estiver em standby ou parado mas configurado para loop contínuo, toca imediatamente!
    if (streamer.shouldRun) {
      if (streamer.currentMode === 'STANDBY') {
        console.log('[Streamer] Standby ativo: iniciando reprodução imediata do vídeo enviado...');
        setTimeout(() => {
          streamer.playNextInQueue();
        }, 300);
      }
    } else if (settings.autoLoopStandby) {
      console.log('[Streamer] Inicializando streamer após upload...');
      streamer.start();
    }

    // Dispara checagem do Downloader
    downloader.checkQueue();

    res.json({
      success: true,
      item: newItem,
      message: `Vídeo "${title}" enviado e adicionado à grade com sucesso!`
    });
  } catch (err) {
    console.error('[Upload Video Erro]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Atualizar dados de um item da fila (Título da Live ou Thumbnail)
router.put('/queue/:id', async (req, res) => {
  const { id } = req.params;
  const { liveTitle, customThumbPath, customThumbUrl } = req.body;

  const item = db.getQueueItem(id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Item não encontrado na fila' });
  }

  const updates = {};
  if (liveTitle !== undefined) updates.liveTitle = liveTitle.substring(0, 100);
  if (customThumbPath !== undefined) updates.customThumbPath = customThumbPath;
  if (customThumbUrl !== undefined) updates.customThumbUrl = customThumbUrl;

  const updatedItem = db.updateQueueItem(id, updates);

  // Se o item estiver NO AR AGORA, sincroniza com o YouTube imediatamente!
  if (updatedItem.status === 'playing') {
    youtubeUpdater.syncItemMetadata(updatedItem).catch(err => {
      console.warn('[API] Erro ao sincronizar metadados atualizados:', err.message);
    });
  }

  res.json({ success: true, item: updatedItem });
});

// Remover item da fila
router.delete('/queue/:id', (req, res) => {
  const { id } = req.params;
  downloader.cancelActiveDownload(id);

  // Se o item deletado estiver tocando agora no ar, avança imediatamente para o próximo da fila!
  if (streamer.currentItem && streamer.currentItem.id === id) {
    console.log(`[Streamer] Item ativo no ar ("${streamer.currentItem.title}") foi removido da grade. Avançando para o próximo...`);
    streamer.skipCurrent();
  } else {
    db.removeFromQueue(id);
  }

  // Reavalia a fila após remoção e notifica painel
  downloader.checkQueue();
  streamer.broadcast('queue_updated', { queue: db.getQueue() });
  res.json({ success: true });
});

// Reordenar fila
router.post('/queue/reorder', (req, res) => {
  const { order } = req.body; // Array de IDs
  if (!Array.isArray(order)) {
    return res.status(400).json({ success: false, error: 'Formato de ordenação inválido' });
  }
  const updatedQueue = db.reorderQueue(order);
  downloader.checkQueue();
  res.json({ success: true, queue: updatedQueue });
});

// Limpar fila
router.post('/queue/clear', (req, res) => {
  const queue = db.getQueue();
  for (const item of queue) {
    if (item.status !== 'playing') {
      downloader.cancelActiveDownload(item.id);
      db.removeFromQueue(item.id);
    }
  }
  res.json({ success: true });
});

// Forçar nova tentativa de download de um item da fila
router.post('/queue/:id/retry', (req, res) => {
  const { id } = req.params;
  const item = db.getQueueItem(id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Item não encontrado na fila' });
  }

  downloader.cancelActiveDownload(id);
  db.updateQueueItem(id, {
    status: 'queued',
    downloadProgress: 0,
    downloadSpeed: 'Reiniciando...',
    error: null
  });

  console.log(`[Queue] Download reiniciado manualmente para o item ${id} (${item.title})`);
  downloader.checkQueue();
  res.json({ success: true, message: 'Download reiniciado com sucesso' });
});

// Forçar verificação imediata do Downloader
router.post('/downloader/check', (req, res) => {
  downloader.checkQueue();
  res.json({ success: true });
});

// Controles do Playout
router.post('/control/start', async (req, res) => {
  await streamer.start();
  res.json({ success: true, state: db.getPlayoutState() });
});

router.post('/control/stop', (req, res) => {
  streamer.stop();
  res.json({ success: true, state: db.getPlayoutState() });
});

router.post('/control/skip', (req, res) => {
  const skipped = streamer.skipCurrent();
  res.json({ success: true, skipped });
});

router.post('/control/restart', (req, res) => {
  streamer.restart();
  res.json({ success: true });
});

// Configurações
router.get('/settings', (req, res) => {
  const settings = db.getSettings();
  // Retorna configurações
  res.json({ success: true, settings });
});

router.post('/settings', (req, res) => {
  const oldSettings = db.getSettings();
  const updates = req.body;
  const updated = db.updateSettings(updates);

  // Se alterou a marca d'água (texto ou ativação), recarrega o stream em tempo real
  const watermarkChanged = 
    ('watermarkText' in updates && updates.watermarkText !== oldSettings.watermarkText) ||
    ('enableWatermark' in updates && updates.enableWatermark !== oldSettings.enableWatermark);

  if (watermarkChanged) {
    streamer.reloadCurrentStream();
  }

  res.json({ success: true, settings: updated });
});

// Detectar live ativa automaticamente no canal do YouTube
router.post('/settings/detect-live', async (req, res) => {
  try {
    const broadcast = await youtubeUpdater.detectAndSaveActiveBroadcast();
    if (broadcast && broadcast.id) {
      return res.json({
        success: true,
        broadcast,
        message: `Live detectada com sucesso: "${broadcast.title}" (${broadcast.id})`
      });
    }
    return res.status(404).json({
      success: false,
      error: 'Nenhuma transmissão ao vivo ativa encontrada no canal tvbraza.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Histórico de transmissões
router.get('/history', (req, res) => {
  res.json({ success: true, history: db.getHistory() });
});

router.post('/history/clear', (req, res) => {
  db.clearHistory();
  res.json({ success: true });
});

// Gerenciamento de Cookies do YouTube (Anti-Bot na VPS)
router.get('/cookies', (req, res) => {
  const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
  const exists = fs.existsSync(cookiesPath);
  let size = 0;
  if (exists) {
    try {
      size = fs.statSync(cookiesPath).size;
    } catch (_) {}
  }
  res.json({ success: true, exists, size });
});

router.post('/cookies', uploadCookie.single('cookiesFile'), (req, res) => {
  const cookiesPath = path.join(DATA_DIR, 'cookies.txt');

  if (req.file) {
    fs.writeFileSync(cookiesPath, req.file.buffer.toString('utf-8'));
    console.log(`[Cookies] Arquivo cookies.txt enviado via upload salvo na VPS (${req.file.size} bytes)!`);
    return res.json({ success: true, message: 'Arquivo cookies.txt enviado e salvo com sucesso!' });
  }

  const { cookies } = req.body;
  if (!cookies || typeof cookies !== 'string' || !cookies.trim()) {
    return res.status(400).json({ success: false, error: 'Conteúdo de cookies vazio' });
  }
  fs.writeFileSync(cookiesPath, cookies.trim(), 'utf-8');
  console.log(`[Cookies] Arquivo cookies.txt salvo na VPS com sucesso (${cookies.length} bytes)!`);
  res.json({ success: true, message: 'Arquivo cookies.txt salvo com sucesso!' });
});

router.delete('/cookies', (req, res) => {
  const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    fs.unlinkSync(cookiesPath);
    console.log('[Cookies] Arquivo cookies.txt removido.');
  }
  res.json({ success: true });
});

// Gerar cookies sintéticos/falsos automaticamente na VPS
router.post('/cookies/generate', async (req, res) => {
  const cookiesPath = path.join(DATA_DIR, 'cookies.txt');
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    await execFileAsync('python3', [COOKIE_GENERATOR_SCRIPT, cookiesPath], { timeout: 15000 });
    const exists = fs.existsSync(cookiesPath);
    const size = exists ? fs.statSync(cookiesPath).size : 0;
    console.log(`[Cookies] Cookies automáticos gerados com sucesso (${size} bytes)!`);
    res.json({ success: true, message: 'Cookies sintéticos gerados e salvos com sucesso na VPS!', size });
  } catch (err) {
    console.error('[Cookies] Erro ao gerar cookies:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
