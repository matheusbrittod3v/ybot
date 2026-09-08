import express from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { streamer } from '../engine/streamer.js';
import { downloader } from '../engine/downloader.js';
import { fetchVideoInfo } from '../utils/youtube.js';
import { getSystemStats } from '../utils/system.js';

const router = express.Router();

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

// Prévia de link do YouTube antes de adicionar
router.post('/queue/preview', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Informe a URL do vídeo do YouTube' });
  }

  try {
    const info = await fetchVideoInfo(url);
    res.json({ success: true, info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Adicionar vídeo à fila
router.post('/queue/add', async (req, res) => {
  const { url, title, duration, durationFormatted, thumbnail, channel } = req.body;
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

    const newItem = db.addToQueue({
      id: crypto.randomUUID(),
      url,
      ...videoData,
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

export default router;
