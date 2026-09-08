import fs from 'fs';
import path from 'path';
import { createDecipheriv } from 'crypto';
import { Readable } from 'stream';

const SECRET_KEY = '';
const FALLBACK_CDNS = [
  'cdn400.savetube.vip',
  'cdn500.savetube.vip',
  'cdn501.savetube.vip',
  'cdn502.savetube.vip',
  'cdn503.savetube.vip'
];

/**
 * Decodifica o payload AES-128-CBC do serviço SaveTube
 */
function decodePayload(enc) {
  try {
    const data = Buffer.from(enc, 'base64');
    const iv = data.slice(0, 16);
    const content = data.slice(16);
    const key = Buffer.from(SECRET_KEY, 'hex');

    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(content), decipher.final()]);
    return JSON.parse(decrypted.toString());
  } catch (error) {
    throw new Error(`Falha ao decodificar dados do serviço: ${error.message}`);
  }
}

/**
 * Obtém um CDN ativo para resolução
 */
async function getActiveCdn() {
  try {
    const res = await fetch('https://media.savetube.vip/api/random-cdn', {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.cdn) {
        return data.cdn;
      }
    }
  } catch (_) {}

  return FALLBACK_CDNS[Math.floor(Math.random() * FALLBACK_CDNS.length)];
}

/**
 * Consulta informações completas do vídeo através do motor web
 */
export async function resolveVideoInfo(url) {
  const cdn = await getActiveCdn();
  const res = await fetch(`https://${cdn}/v2/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://save-tube.com/'
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`Servidor web respondeu status ${res.status}`);
  }

  const json = await res.json();
  if (!json || !json.data) {
    throw new Error('Resposta inválida do serviço de resolução web');
  }

  const info = decodePayload(json.data);
  return {
    id: info.id,
    key: info.key,
    title: info.title,
    duration: typeof info.duration === 'number' ? info.duration : parseInt(info.duration) || 0,
    thumbnail: info.thumbnail || `https://img.youtube.com/vi/${info.id}/hqdefault.jpg`,
    videoFormats: info.video_formats || [],
    cdn
  };
}

/**
 * Obtém link direto de streaming/download em MP4
 */
export async function resolveDownloadUrl(url, preferredQualities = ['720', '1080', '480', '360']) {
  const info = await resolveVideoInfo(url);
  const cdn = info.cdn || (await getActiveCdn());

  for (const quality of preferredQualities) {
    try {
      const res = await fetch(`https://${cdn}/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://save-tube.com/'
        },
        body: JSON.stringify({
          downloadType: 'video',
          quality: `${quality}`,
          key: info.key
        }),
        signal: AbortSignal.timeout(9000)
      });

      if (!res.ok) continue;

      const data = await res.json();
      const downloadUrl = data?.data?.downloadUrl;
      if (downloadUrl && typeof downloadUrl === 'string' && downloadUrl.startsWith('http')) {
        return {
          downloadUrl,
          quality,
          title: info.title,
          duration: info.duration
        };
      }
    } catch (err) {
      // tenta próxima resolução
    }
  }

  throw new Error('Nenhuma URL de download pôde ser gerada pelo serviço web.');
}

/**
 * Faz o download do vídeo via streaming HTTP direto para o disco
 */
export async function downloadFromWebResolver(url, targetFile, onProgress = () => {}, abortSignal = null) {
  const resolved = await resolveDownloadUrl(url);
  const tempFile = `${targetFile}.part`;

  // Garante que o diretório de destino exista
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Remove arquivo temporário prévio se existir
  if (fs.existsSync(tempFile)) {
    try { fs.unlinkSync(tempFile); } catch (_) {}
  }

  const response = await fetch(resolved.downloadUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    },
    signal: abortSignal
  });

  if (!response.ok) {
    throw new Error(`Falha no streaming do vídeo HTTP: status ${response.status}`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  let receivedBytes = 0;
  let lastBytes = 0;
  let lastTime = Date.now();

  const fileStream = fs.createWriteStream(tempFile);

  await new Promise((resolve, reject) => {
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        fileStream.destroy();
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
        reject(new Error('Download cancelado pelo usuário.'));
      });
    }

    fileStream.on('error', (err) => reject(err));
    fileStream.on('finish', () => resolve());

    const stream = Readable.fromWeb(response.body);

    stream.on('data', (chunk) => {
      receivedBytes += chunk.length;
      const now = Date.now();

      if (now - lastTime >= 500) {
        const timeDiff = (now - lastTime) / 1000;
        const bytesDiff = receivedBytes - lastBytes;
        const speedMb = (bytesDiff / timeDiff / 1024 / 1024).toFixed(2);
        const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0;
        const totalMb = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) : '?';
        const currentMb = (receivedBytes / 1024 / 1024).toFixed(1);

        lastTime = now;
        lastBytes = receivedBytes;

        onProgress({
          percent: Math.min(99.9, percent),
          speed: `${speedMb} MB/s`,
          downloadedMb: currentMb,
          totalMb: `${totalMb} MB`,
          quality: `${resolved.quality}p`
        });
      }
    });

    stream.on('error', (err) => {
      fileStream.destroy();
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
      reject(err);
    });

    stream.pipe(fileStream);
  });

  // Validação do arquivo baixado
  if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size < 10240) {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
    throw new Error('Arquivo baixado é inválido ou incompleto.');
  }

  // Renomeia o temporário para o destino final
  fs.renameSync(tempFile, targetFile);
  const finalSize = fs.statSync(targetFile).size;

  return {
    success: true,
    filePath: targetFile,
    fileSize: finalSize,
    title: resolved.title,
    quality: resolved.quality
  };
}
