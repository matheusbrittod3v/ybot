import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const MEDIA_DIR = path.join(DATA_DIR, 'media');
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');
if (!fs.existsSync(THUMBS_DIR)) {
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
}

const DEFAULT_SETTINGS = {
  youtubeStreamKey: process.env.YOUTUBE_STREAM_KEY || '',
  youtubeRtmpUrl: process.env.YOUTUBE_RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2',
  youtubeBroadcastVideoId: process.env.YOUTUBE_BROADCAST_VIDEO_ID || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  autoUpdateYouTubeMetadata: true,
  defaultLiveTitlePrefix: 'TV BRAZA AO VIVO: ',
  resolution: process.env.RESOLUTION || '1080p',
  fps: 30,
  videoBitrate: process.env.VIDEO_BITRATE || '4500k',
  audioBitrate: process.env.AUDIO_BITRATE || '160k',
  autoDeleteFinished: true,
  enableWatermark: true,
  watermarkText: 'TV BRAZA - AO VIVO',
  autoLoopStandby: true,
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
};

const DEFAULT_DATA = {
  settings: DEFAULT_SETTINGS,
  queue: [],
  history: [],
  playoutState: {
    state: 'STANDBY', // 'STANDBY', 'PLAYING', 'STOPPED', 'ERROR'
    activeItemId: null,
    startedAt: null,
    elapsed: 0,
    duration: 0,
    fps: 0,
    bitrate: '0k',
    streamUptime: 0
  }
};

class Database {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
          queue: parsed.queue || [],
          history: (parsed.history || []).slice(-50), // keep last 50 entries
          playoutState: { ...DEFAULT_DATA.playoutState, ...(parsed.playoutState || {}) }
        };
      }
    } catch (err) {
      console.error('[DB] Erro ao carregar banco, usando padrão:', err.message);
    }
    const initial = JSON.parse(JSON.stringify(DEFAULT_DATA));
    this.save(initial);
    return initial;
  }

  save(dataToSave = this.data) {
    try {
      const tmpFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      console.error('[DB] Erro ao salvar banco:', err.message);
    }
  }

  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  getQueue() {
    return [...this.data.queue].sort((a, b) => a.order - b.order);
  }

  getQueueItem(id) {
    return this.data.queue.find(item => item.id === id);
  }

  addToQueue(item) {
    const maxOrder = this.data.queue.reduce((max, i) => Math.max(max, i.order || 0), 0);
    const newItem = {
      ...item,
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
      status: item.status || 'queued',
      downloadProgress: 0,
      downloadSpeed: '',
      filePath: item.filePath || null
    };
    this.data.queue.push(newItem);
    this.save();
    return newItem;
  }

  updateQueueItem(id, updates) {
    const index = this.data.queue.findIndex(item => item.id === id);
    if (index !== -1) {
      this.data.queue[index] = { ...this.data.queue[index], ...updates };
      this.save();
      return this.data.queue[index];
    }
    return null;
  }

  removeFromQueue(id) {
    const item = this.getQueueItem(id);
    if (item && item.filePath && fs.existsSync(item.filePath)) {
      try {
        fs.unlinkSync(item.filePath);
        console.log(`[DB] Arquivo deletado ao remover da fila: ${item.filePath}`);
      } catch (err) {
        console.warn(`[DB] Não foi possível remover arquivo ${item.filePath}:`, err.message);
      }
    }
    if (item && item.customThumbPath && fs.existsSync(item.customThumbPath)) {
      try {
        fs.unlinkSync(item.customThumbPath);
        console.log(`[DB] Thumbnail customizada deletada: ${item.customThumbPath}`);
      } catch (_) {}
    }
    this.data.queue = this.data.queue.filter(i => i.id !== id);
    this.save();
  }

  reorderQueue(orderedIds) {
    const map = new Map(this.data.queue.map(i => [i.id, i]));
    const newQueue = [];
    orderedIds.forEach((id, idx) => {
      const item = map.get(id);
      if (item) {
        item.order = idx + 1;
        newQueue.push(item);
        map.delete(id);
      }
    });
    // Add any remaining
    for (const item of map.values()) {
      item.order = newQueue.length + 1;
      newQueue.push(item);
    }
    this.data.queue = newQueue;
    this.save();
    return this.getQueue();
  }

  archiveFinishedItem(id) {
    const index = this.data.queue.findIndex(item => item.id === id);
    if (index !== -1) {
      const item = this.data.queue[index];
      item.status = 'finished';
      item.finishedAt = new Date().toISOString();

      // Delete file immediately to free disk space!
      if (item.filePath && fs.existsSync(item.filePath)) {
        try {
          fs.unlinkSync(item.filePath);
          console.log(`[Cleaner] Vídeo finalizado removido do disco com sucesso: ${item.filePath}`);
        } catch (err) {
          console.warn(`[Cleaner] Falha ao deletar arquivo ${item.filePath}:`, err.message);
        }
        item.filePath = null;
      }

      // Delete custom thumbnail immediately to keep VPS disk 100% clean!
      if (item.customThumbPath && fs.existsSync(item.customThumbPath)) {
        try {
          fs.unlinkSync(item.customThumbPath);
          console.log(`[Cleaner] Thumbnail customizada excluída para liberar disco: ${item.customThumbPath}`);
        } catch (_) {}
        item.customThumbPath = null;
      }

      this.data.history.unshift(item);
      if (this.data.history.length > 50) {
        this.data.history.pop();
      }
      this.data.queue.splice(index, 1);
      this.save();
    }
  }

  getHistory() {
    return this.data.history || [];
  }

  clearHistory() {
    this.data.history = [];
    this.save();
  }

  getPlayoutState() {
    return { ...this.data.playoutState };
  }

  updatePlayoutState(updates) {
    this.data.playoutState = { ...this.data.playoutState, ...updates };
    this.save();
    return this.data.playoutState;
  }
}

export const db = new Database();
export { DATA_DIR, MEDIA_DIR, THUMBS_DIR };
