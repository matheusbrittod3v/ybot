import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { runMigrations } from './migrations/migrate.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatMySqlDateTime(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function resolveDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    path.resolve(path.join(__dirname, '../../data')),
    '/app/data',
    path.resolve('./data'),
    '/tmp/tvbraza_data'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      const testFile = path.join(resolved, `.write_test_${process.pid}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return resolved;
    } catch (err) {
      console.warn(`[DB] Aviso: Diretório candidato "${candidate}" inacessível (${err.message}). Tentando próximo...`);
    }
  }

  const fallback = path.resolve(path.join(__dirname, '../../data'));
  try { fs.mkdirSync(fallback, { recursive: true }); } catch (_) {}
  return fallback;
}

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');

export function ensureDirectories() {
  for (const dir of [DATA_DIR, MEDIA_DIR, THUMBS_DIR]) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.error(`[DB] Erro ao garantir diretório ${dir}:`, err.message);
    }
  }
}

ensureDirectories();

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
  customLogoPath: '',
  autoLoopStandby: true,
  enableSponsorBlock: true,
  defaultStreamMode: 'direct',
  enableScheduleOverlay: true,
  scheduleOverlayInterval: 5,
  scheduleOverlayDuration: 12,
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
};

const DEFAULT_DATA = {
  settings: DEFAULT_SETTINGS,
  queue: [],
  history: [],
  playoutState: {
    state: 'STANDBY',
    activeItemId: null,
    startedAt: null,
    elapsed: 0,
    elapsedSeconds: 0,
    elapsedFormatted: '00:00:00',
    duration: 0,
    fps: 0,
    bitrate: '0k',
    streamUptime: 0,
    currentLiveTitle: '',
    currentLiveThumb: ''
  }
};

class Database {
  constructor() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    this.pool = null;
    this.isInitialized = false;
    this.initPromise = null;
    this.dbUrl = process.env.DATABASE_URL || 'mysql://mysql:AY6JJOKzty08XXou0pN4@209.126.81.68:3306/boty';
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // 1. Sempre carrega JSON local primeiro para garantir persistência imediata
      this.loadJsonFallback();

      try {
        console.log(`[DB] Pool MySQL configurado para: ${this.dbUrl.replace(/:[^:@]+@/, ':****@')}`);
        this.pool = mysql.createPool({
          uri: this.dbUrl,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000
        });

        console.log('[DB] Inicializando banco de dados MySQL e aplicando migrations...');
        await runMigrations();

        await this.syncSettings();
        await this.syncQueue();
        await this.syncHistory();
        await this.syncPlayoutState();

        this.isInitialized = true;
        console.log(`[DB] Banco MySQL sincronizado com sucesso! (Fila: ${this.data.queue.length} vídeos, Histórico: ${this.data.history.length})`);
        this.saveJsonBackup();
      } catch (err) {
        console.error('[DB] Falha ao inicializar MySQL, usando fallback em db.json:', err.message);
      }
    })();

    return this.initPromise;
  }

  loadJsonFallback() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
          queue: parsed.queue || [],
          history: (parsed.history || []).slice(-50),
          playoutState: { ...DEFAULT_DATA.playoutState, ...(parsed.playoutState || {}) }
        };
      }
    } catch (_) {}
  }

  saveJsonBackup() {
    try {
      const dataToSave = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(DB_FILE, dataToSave, 'utf-8');
    } catch (err) {
      console.warn('[DB JSON Backup] Erro ao salvar db.json:', err.message);
    }
  }

  async syncSettings() {
    const [rows] = await this.pool.query('SELECT * FROM settings WHERE id = 1 LIMIT 1');
    if (rows.length === 0) {
      let initialSettings = { ...DEFAULT_SETTINGS, ...this.data.settings };
      await this.pool.query(
        `INSERT INTO settings (
          id, youtube_stream_key, youtube_rtmp_url, youtube_broadcast_video_id,
          google_client_id, google_client_secret, google_refresh_token,
          auto_update_youtube_metadata, default_live_title_prefix, resolution,
          fps, video_bitrate, audio_bitrate, auto_delete_finished,
          enable_watermark, watermark_text, custom_logo_path, auto_loop_standby,
          enable_sponsor_block, default_stream_mode, admin_password
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          initialSettings.youtubeStreamKey || '',
          initialSettings.youtubeRtmpUrl || 'rtmp://a.rtmp.youtube.com/live2',
          initialSettings.youtubeBroadcastVideoId || '',
          initialSettings.googleClientId || '',
          initialSettings.googleClientSecret || '',
          initialSettings.googleRefreshToken || '',
          initialSettings.autoUpdateYouTubeMetadata !== false,
          initialSettings.defaultLiveTitlePrefix || 'TV BRAZA AO VIVO: ',
          initialSettings.resolution || '1080p',
          initialSettings.fps || 30,
          initialSettings.videoBitrate || '4500k',
          initialSettings.audioBitrate || '160k',
          initialSettings.autoDeleteFinished !== false,
          initialSettings.enableWatermark !== false,
          initialSettings.watermarkText || 'TV BRAZA - AO VIVO',
          initialSettings.customLogoPath || '',
          initialSettings.autoLoopStandby !== false,
          initialSettings.enableSponsorBlock !== false,
          initialSettings.defaultStreamMode || 'direct',
          initialSettings.adminPassword || 'admin123'
        ]
      );
      this.data.settings = initialSettings;
    } else {
      const r = rows[0];
      this.data.settings = {
        youtubeStreamKey: r.youtube_stream_key || '',
        youtubeRtmpUrl: r.youtube_rtmp_url || 'rtmp://a.rtmp.youtube.com/live2',
        youtubeBroadcastVideoId: r.youtube_broadcast_video_id || '',
        googleClientId: r.google_client_id || '',
        googleClientSecret: r.google_client_secret || '',
        googleRefreshToken: r.google_refresh_token || '',
        autoUpdateYouTubeMetadata: Boolean(r.auto_update_youtube_metadata),
        defaultLiveTitlePrefix: r.default_live_title_prefix || 'TV BRAZA AO VIVO: ',
        resolution: r.resolution || '1080p',
        fps: r.fps || 30,
        videoBitrate: r.video_bitrate || '4500k',
        audioBitrate: r.audio_bitrate || '160k',
        autoDeleteFinished: Boolean(r.auto_delete_finished),
        enableWatermark: Boolean(r.enable_watermark),
        watermarkText: r.watermark_text || 'TV BRAZA - AO VIVO',
        customLogoPath: r.custom_logo_path || '',
        autoLoopStandby: Boolean(r.auto_loop_standby),
        enableSponsorBlock: Boolean(r.enable_sponsor_block),
        defaultStreamMode: r.default_stream_mode || 'direct',
        enableScheduleOverlay: r.enable_schedule_overlay !== undefined ? Boolean(r.enable_schedule_overlay) : true,
        scheduleOverlayInterval: Number(r.schedule_overlay_interval) || 10,
        scheduleOverlayDuration: Number(r.schedule_overlay_duration) || 12,
        adminPassword: r.admin_password || 'admin123'
      };
    }
  }

  async syncQueue() {
    const [rows] = await this.pool.query('SELECT * FROM queue_items ORDER BY order_index ASC');
    if (rows && rows.length > 0) {
      this.data.queue = rows.map(r => this.mapRowToQueueItem(r));
    } else if (this.data.queue.length > 0) {
      // Re-sincroniza a fila local para o MySQL caso a tabela estivesse limpa
      for (const item of this.data.queue) {
        await this.insertQueueItemToDb(item);
      }
    }
  }

  async syncHistory() {
    const [rows] = await this.pool.query('SELECT * FROM playback_history ORDER BY created_at DESC LIMIT 50');
    this.data.history = rows.map(r => ({
      id: r.id,
      title: r.title,
      url: r.url,
      duration: r.duration,
      streamMode: r.stream_mode,
      thumbnail: r.thumbnail_url,
      finishedAt: r.finished_at
    }));
  }

  async syncPlayoutState() {
    const [rows] = await this.pool.query('SELECT * FROM playout_state WHERE id = 1 LIMIT 1');
    if (rows.length === 0) {
      await this.pool.query(
        `INSERT INTO playout_state (
          id, state, active_item_id, started_at, elapsed_seconds,
          elapsed_formatted, duration, fps, bitrate, stream_uptime,
          current_live_title, current_live_thumb
        ) VALUES (1, 'STANDBY', NULL, NULL, 0, '00:00:00', 0, 0, '0k', 0, '', '')`
      );
    } else {
      const r = rows[0];
      this.data.playoutState = {
        state: r.state || 'STANDBY',
        activeItemId: r.active_item_id || null,
        startedAt: r.started_at ? Number(r.started_at) : null,
        elapsed: Number(r.elapsed_seconds) || 0,
        elapsedSeconds: Number(r.elapsed_seconds) || 0,
        elapsedFormatted: r.elapsed_formatted || '00:00:00',
        duration: Number(r.duration) || 0,
        fps: Number(r.fps) || 0,
        bitrate: r.bitrate || '0k',
        streamUptime: Number(r.stream_uptime) || 0,
        currentLiveTitle: r.current_live_title || '',
        currentLiveThumb: r.current_live_thumb || ''
      };
    }
  }

  mapRowToQueueItem(r) {
    return {
      id: r.id,
      order: r.order_index,
      title: r.title,
      url: r.url,
      duration: Number(r.duration) || 0,
      status: r.status,
      streamMode: r.stream_mode || 'direct',
      filePath: r.file_path || null,
      thumbnail: r.thumbnail_url || null,
      customThumbPath: r.custom_thumb_path || null,
      downloadProgress: Number(r.download_progress) || 0,
      downloadSpeed: r.download_speed || '',
      lastPositionSeconds: Number(r.last_position_seconds) || 0,
      startAtSeconds: Number(r.start_at_seconds) || 0,
      createdAt: r.created_at || '',
      finishedAt: r.finished_at || null
    };
  }

  async insertQueueItemToDb(item) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO queue_items (
        id, order_index, title, url, duration, status,
        stream_mode, file_path, thumbnail_url, custom_thumb_path,
        download_progress, download_speed, last_position_seconds, start_at_seconds,
        created_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        order_index = VALUES(order_index),
        title = VALUES(title),
        url = VALUES(url),
        status = VALUES(status),
        stream_mode = VALUES(stream_mode),
        file_path = VALUES(file_path),
        thumbnail_url = VALUES(thumbnail_url),
        custom_thumb_path = VALUES(custom_thumb_path),
        download_progress = VALUES(download_progress),
        download_speed = VALUES(download_speed),
        last_position_seconds = VALUES(last_position_seconds),
        start_at_seconds = VALUES(start_at_seconds)`,
      [
        item.id,
        item.order || 0,
        item.title || 'Vídeo sem título',
        item.url || '',
        item.duration || 0,
        item.status || 'ready',
        item.streamMode || 'direct',
        item.filePath || null,
        item.thumbnail || null,
        item.customThumbPath || null,
        item.downloadProgress !== undefined ? item.downloadProgress : 100,
        item.downloadSpeed || '⚡ Stream Direto (Sem Anúncios)',
        item.lastPositionSeconds || 0,
        item.startAtSeconds || 0,
        formatMySqlDateTime(item.createdAt) || formatMySqlDateTime(new Date()),
        formatMySqlDateTime(item.finishedAt)
      ]
    );
  }

  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    if (this.pool) {
      const s = this.data.settings;
      this.pool.query(
        `UPDATE settings SET
          youtube_stream_key = ?, youtube_rtmp_url = ?, youtube_broadcast_video_id = ?,
          google_client_id = ?, google_client_secret = ?, google_refresh_token = ?,
          auto_update_youtube_metadata = ?, default_live_title_prefix = ?, resolution = ?,
          fps = ?, video_bitrate = ?, audio_bitrate = ?, auto_delete_finished = ?,
          enable_watermark = ?, watermark_text = ?, custom_logo_path = ?, auto_loop_standby = ?,
          enable_sponsor_block = ?, default_stream_mode = ?, enable_schedule_overlay = ?,
          schedule_overlay_interval = ?, schedule_overlay_duration = ?, admin_password = ?
        WHERE id = 1`,
        [
          s.youtubeStreamKey, s.youtubeRtmpUrl, s.youtubeBroadcastVideoId,
          s.googleClientId, s.googleClientSecret, s.googleRefreshToken,
          s.autoUpdateYouTubeMetadata, s.defaultLiveTitlePrefix, s.resolution,
          s.fps, s.videoBitrate, s.audioBitrate, s.autoDeleteFinished,
          s.enableWatermark, s.watermarkText, s.customLogoPath, s.autoLoopStandby,
          s.enableSponsorBlock, s.defaultStreamMode, s.enableScheduleOverlay !== false,
          s.scheduleOverlayInterval || 10, s.scheduleOverlayDuration || 12, s.adminPassword
        ]
      ).catch(err => console.error('[DB MySQL] Erro ao atualizar settings:', err.message));
    }
    this.saveJsonBackup();
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
      streamMode: item.streamMode || 'direct',
      status: item.status || 'ready',
      downloadProgress: item.downloadProgress !== undefined ? item.downloadProgress : 100,
      downloadSpeed: item.downloadSpeed || '⚡ Stream Direto (Sem Anúncios)',
      lastPositionSeconds: item.lastPositionSeconds || 0,
      startAtSeconds: item.startAtSeconds || 0,
      filePath: item.filePath || null
    };

    this.data.queue.push(newItem);

    if (this.pool) {
      this.insertQueueItemToDb(newItem).catch(err => {
        console.error('[DB MySQL] Erro ao inserir item na fila:', err.message);
      });
    }

    this.saveJsonBackup();
    return newItem;
  }

  updateQueueItem(id, updates) {
    const index = this.data.queue.findIndex(item => item.id === id);
    if (index !== -1) {
      this.data.queue[index] = { ...this.data.queue[index], ...updates };
      const item = this.data.queue[index];

      if (this.pool) {
        this.pool.query(
          `UPDATE queue_items SET
            title = ?, url = ?, status = ?, duration = ?, file_path = ?,
            thumbnail_url = ?, custom_thumb_path = ?, download_progress = ?, download_speed = ?,
            stream_mode = ?, last_position_seconds = ?, start_at_seconds = ?,
            finished_at = ?
          WHERE id = ?`,
          [
            item.title, item.url || '', item.status, item.duration || 0, item.filePath || null,
            item.thumbnail || null, item.customThumbPath || null, item.downloadProgress || 0, item.downloadSpeed || '',
            item.streamMode || 'direct', item.lastPositionSeconds || 0, item.startAtSeconds || 0,
            formatMySqlDateTime(item.finishedAt), id
          ]
        ).catch(err => console.error('[DB MySQL] Erro ao atualizar item da fila:', err.message));
      }

      this.saveJsonBackup();
      return item;
    }
    return null;
  }

  removeFromQueue(id) {
    const item = this.getQueueItem(id);
    if (item && item.filePath && fs.existsSync(item.filePath)) {
      try {
        fs.unlinkSync(item.filePath);
        console.log(`[Cleaner] Arquivo local deletado: ${item.filePath}`);
      } catch (_) {}
    }
    if (item && item.customThumbPath && fs.existsSync(item.customThumbPath)) {
      try {
        fs.unlinkSync(item.customThumbPath);
      } catch (_) {}
    }
    this.data.queue = this.data.queue.filter(i => i.id !== id);

    if (this.pool) {
      this.pool.query('DELETE FROM queue_items WHERE id = ?', [id])
        .catch(err => console.error('[DB MySQL] Erro ao remover item da fila:', err.message));
    }
    this.saveJsonBackup();
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
    for (const item of map.values()) {
      item.order = newQueue.length + 1;
      newQueue.push(item);
    }
    this.data.queue = newQueue;

    if (this.pool) {
      for (const item of newQueue) {
        this.pool.query('UPDATE queue_items SET order_index = ? WHERE id = ?', [item.order, item.id])
          .catch(err => console.error('[DB MySQL] Erro ao reordenar item:', err.message));
      }
    }

    this.saveJsonBackup();
    return this.getQueue();
  }

  archiveFinishedItem(id) {
    const index = this.data.queue.findIndex(item => item.id === id);
    if (index !== -1) {
      const item = this.data.queue[index];
      const finishedAt = new Date().toISOString();
      item.status = 'finished';
      item.finishedAt = finishedAt;

      if (item.filePath && fs.existsSync(item.filePath)) {
        try { fs.unlinkSync(item.filePath); } catch (_) {}
        item.filePath = null;
      }
      if (item.customThumbPath && fs.existsSync(item.customThumbPath)) {
        try { fs.unlinkSync(item.customThumbPath); } catch (_) {}
        item.customThumbPath = null;
      }

      this.data.history.unshift(item);
      if (this.data.history.length > 50) this.data.history.pop();
      this.data.queue.splice(index, 1);

      if (this.pool) {
        this.pool.query('DELETE FROM queue_items WHERE id = ?', [id]).catch(() => {});
        this.pool.query(
          `INSERT INTO playback_history (id, title, url, duration, stream_mode, thumbnail_url, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE finished_at = VALUES(finished_at)`,
          [item.id, item.title, item.url, item.duration || 0, item.streamMode || 'direct', item.thumbnail || '', formatMySqlDateTime(finishedAt)]
        ).catch(err => console.error('[DB MySQL] Erro ao arquivar histórico:', err.message));
      }
      this.saveJsonBackup();
    }
  }

  getHistory() {
    return this.data.history || [];
  }

  clearHistory() {
    this.data.history = [];
    if (this.pool) {
      this.pool.query('TRUNCATE TABLE playback_history').catch(() => {});
    }
  }

  getPlayoutState() {
    return { ...this.data.playoutState };
  }

  updatePlayoutState(updates) {
    this.data.playoutState = { ...this.data.playoutState, ...updates };

    if (this.pool && (updates.state || updates.activeItemId !== undefined || updates.elapsedSeconds !== undefined)) {
      const ps = this.data.playoutState;
      this.pool.query(
        `UPDATE playout_state SET
          state = ?, active_item_id = ?, elapsed_seconds = ?,
          elapsed_formatted = ?, duration = ?, fps = ?, bitrate = ?,
          current_live_title = ?, current_live_thumb = ?
        WHERE id = 1`,
        [
          ps.state || 'STANDBY', ps.activeItemId || null, ps.elapsedSeconds || 0,
          ps.elapsedFormatted || '00:00:00', ps.duration || 0, ps.fps || 0,
          ps.bitrate || '0k', ps.currentLiveTitle || '', ps.currentLiveThumb || ''
        ]
      ).catch(err => console.error('[DB MySQL] Erro ao atualizar playout state:', err.message));
    }

    return this.data.playoutState;
  }

  saveLivePlaybackPosition(activeItemId, elapsedSec, elapsedFormatted, fps, bitrate) {
    if (!activeItemId) return;
    const item = this.getQueueItem(activeItemId);
    if (item) {
      item.lastPositionSeconds = Math.floor(elapsedSec);
      if (this.pool) {
        this.pool.query(
          'UPDATE queue_items SET last_position_seconds = ? WHERE id = ?',
          [Math.floor(elapsedSec), activeItemId]
        ).catch(() => {});
      }
    }

    this.updatePlayoutState({
      activeItemId,
      elapsedSeconds: Math.floor(elapsedSec),
      elapsedFormatted,
      fps,
      bitrate
    });
  }

  async getLastSavedLivePosition() {
    if (this.pool) {
      try {
        const [rows] = await this.pool.query(
          `SELECT q.id as active_item_id, q.last_position_seconds, q.status, p.state
           FROM queue_items q
           LEFT JOIN playout_state p ON p.id = 1
           WHERE q.status IN ('playing', 'ready') AND q.last_position_seconds > 3
           ORDER BY q.order_index ASC LIMIT 1`
        );
        if (rows.length > 0) {
          return {
            activeItemId: rows[0].active_item_id,
            elapsedSeconds: Number(rows[0].last_position_seconds) || 0
          };
        }
      } catch (_) {}
    }

    const state = this.getPlayoutState();
    if (state.activeItemId && state.elapsedSeconds > 3) {
      return {
        activeItemId: state.activeItemId,
        elapsedSeconds: state.elapsedSeconds
      };
    }

    return null;
  }
}

export const db = new Database();
export { DATA_DIR, MEDIA_DIR, THUMBS_DIR };
