import fs from 'fs';
import os from 'os';
import path from 'path';
import { DATA_DIR, MEDIA_DIR } from '../db.js';

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

let cachedStats = null;
let lastStatsTime = 0;

export function getSystemStats(forceRefresh = false) {
  const now = Date.now();
  if (cachedStats && !forceRefresh && (now - lastStatsTime < 2500)) {
    return cachedStats;
  }

  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = Math.round((usedMem / totalMem) * 100);

  // CPU
  const loadAvg = os.loadavg();
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Generic CPU';
  const cpuCores = cpus.length;

  // Disk stats
  let disk = {
    total: 0,
    free: 0,
    used: 0,
    usedPercent: 0,
    totalFormatted: 'N/A',
    freeFormatted: 'N/A',
    usedFormatted: 'N/A'
  };

  try {
    if (fs.existsSync(DATA_DIR)) {
      const stats = fs.statfsSync(DATA_DIR);
      const totalBytes = stats.bsize * stats.blocks;
      const freeBytes = stats.bsize * stats.bavail;
      const usedBytes = totalBytes - freeBytes;
      const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

      disk = {
        total: totalBytes,
        free: freeBytes,
        used: usedBytes,
        usedPercent,
        totalFormatted: formatBytes(totalBytes),
        freeFormatted: formatBytes(freeBytes),
        usedFormatted: formatBytes(usedBytes)
      };
    }
  } catch (_) {}

  // Media folder stats
  let mediaStats = {
    fileCount: 0,
    totalSize: 0,
    totalSizeFormatted: '0 B',
    files: []
  };

  try {
    if (fs.existsSync(MEDIA_DIR)) {
      const files = fs.readdirSync(MEDIA_DIR);
      let totalSize = 0;
      const fileList = [];

      for (const file of files) {
        const fullPath = path.join(MEDIA_DIR, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            totalSize += stat.size;
            fileList.push({
              name: file,
              size: stat.size,
              sizeFormatted: formatBytes(stat.size),
              mtime: stat.mtime
            });
          }
        } catch (_) {}
      }

      mediaStats = {
        fileCount: fileList.length,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
        files: fileList
      };
    }
  } catch (err) {
    console.error('[SystemStats] Erro ao listar pasta de mídia:', err.message);
  }

  cachedStats = {
    uptime: Math.round(process.uptime()),
    osUptime: Math.round(os.uptime()),
    platform: os.platform(),
    hostname: os.hostname(),
    cpu: {
      model: cpuModel,
      cores: cpuCores,
      load1m: loadAvg[0].toFixed(2),
      load5m: loadAvg[1].toFixed(2)
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usedPercent: memUsagePercent,
      totalFormatted: formatBytes(totalMem),
      freeFormatted: formatBytes(freeMem),
      usedFormatted: formatBytes(usedMem)
    },
    disk,
    media: mediaStats
  };
  lastStatsTime = now;

  return cachedStats;
}
