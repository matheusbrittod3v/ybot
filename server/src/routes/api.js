import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { db, THUMBS_DIR } from '../db.js';
import { streamer } from '../engine/streamer.js';
import { downloader } from '../engine/downloader.js';
import { fetchVideoInfo } from '../utils/youtube.js';
import { getSystemStats } from '../utils/system.js';
import { youtubeUpdater } from '../utils/youtube-updater.js';

const router = express.Router();

// Configuração do Multer para upload de thumbnails personalizadas
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, THUMBS_DIR);
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
    customThumbUrl
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
    const finalLiveTitle = (liveTitle || `${settings.defaultLiveTitlePrefix || ''}${videoData.title}`).substring(0, 100);

    const newItem = db.addToQueue({
      id: crypto.randomUUID(),
      url,
      ...videoData,
      liveTitle: finalLiveTitle,
      customThumbPath: customThumbPath || null,
      customThumbUrl: customThumbUrl || null,
      status: 'queued'
    });

    // Dispara checagem do Downloader para ver se este item deve ser pré-baixado
    downloader.checkQueue();

    // Se o streamer estiver em standby ou sem vídeo no ar, notifica
    if (streamer.shouldRun && streamer.currentMode === 'STANDBY') {
      setTimeout(() => {
        streamer.playNextInQueue();
      }, 500);
    }

    res.json({ success: true, item: newItem });
  } catch (err) {
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
  db.removeFromQueue(id);
  // Reavalia a fila após remoção
  downloader.checkQueue();
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
  const updates = req.body;
  const updated = db.updateSettings(updates);
  res.json({ success: true, settings: updated });
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
  const cookiesPath = path.join(db.data ? path.resolve(process.env.DATA_DIR || './data') : './data', 'cookies.txt');
  const exists = fs.existsSync(cookiesPath);
  let size = 0;
  if (exists) {
    try {
      size = fs.statSync(cookiesPath).size;
    } catch (_) {}
  }
  res.json({ success: true, exists, size });
});

router.post('/cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies || typeof cookies !== 'string' || !cookies.trim()) {
    return res.status(400).json({ success: false, error: 'Conteúdo de cookies vazio' });
  }
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  const cookiesPath = path.join(dataDir, 'cookies.txt');
  fs.writeFileSync(cookiesPath, cookies.trim(), 'utf-8');
  console.log(`[Cookies] Arquivo cookies.txt salvo na VPS com sucesso (${cookies.length} bytes)!`);
  res.json({ success: true, message: 'Arquivo cookies.txt salvo com sucesso!' });
});

router.delete('/cookies', (req, res) => {
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  const cookiesPath = path.join(dataDir, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    fs.unlinkSync(cookiesPath);
    console.log('[Cookies] Arquivo cookies.txt removido.');
  }
  res.json({ success: true });
});

export default router;
