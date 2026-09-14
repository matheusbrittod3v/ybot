import fs from 'fs';
import path from 'path';
import { db, THUMBS_DIR } from '../db.js';
import { extractYouTubeId } from './youtube.js';

class YouTubeMetadataUpdater {
  constructor() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.detectPromise = null;
    this.lastUploadedThumbKey = null;
    this.thumbCooldownUntil = 0;
  }

  /**
   * Obtém token de acesso atualizado usando o Google Refresh Token
   */
  async getValidAccessToken() {
    const settings = db.getSettings();
    const { googleClientId, googleClientSecret, googleRefreshToken } = settings;

    if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
      return null;
    }

    // Se o token ainda for válido, reaproveita
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    try {
      console.log('[YouTube Updater] Renovando Access Token com o Google OAuth...');
      const params = new URLSearchParams({
        client_id: googleClientId.trim(),
        client_secret: googleClientSecret.trim(),
        refresh_token: googleRefreshToken.trim(),
        grant_type: 'refresh_token'
      });

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[YouTube Updater] Falha na renovação do token OAuth: ${errText}`);
        return null;
      }

      const data = await res.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
      return this.accessToken;
    } catch (err) {
      console.error('[YouTube Updater] Erro ao obter token do Google:', err.message);
      return null;
    }
  }

  /**
   * Valida se uma transmissão está ativa ou pronta para transmitir (NÃO concluída/complete)
   */
  async validateBroadcastAlive(broadcastId) {
    if (!broadcastId) return false;
    const token = await this.getValidAccessToken();
    if (!token) return true;
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,status&id=${broadcastId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return false;
      const data = await res.json();
      const broadcast = data.items?.[0];
      if (!broadcast) return false;
      const lifeCycle = broadcast.status?.lifeCycleStatus;
      // Se a live foi encerrada (complete) ou revogada, ela NÃO está viva e não aceita mais stream!
      if (lifeCycle === 'complete' || lifeCycle === 'revoked') {
        console.warn(`[YouTube Updater] ⚠️ Transmissão "${broadcastId}" foi finalizada pelo YouTube (status: ${lifeCycle}). Descartando ID expirado...`);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Obtém o ID da Live ativa no YouTube com auto-recuperação (auto-healing).
   * Prioriza transmissões ativas no canal; se não houver, valida o ID salvo.
   */
  async getActiveBroadcastId() {
    // 1. Sempre tenta detectar primeiro se há uma transmissão viva no canal
    const autoDetected = await this.detectAndSaveActiveBroadcast();
    if (autoDetected && autoDetected.id) {
      return autoDetected.id;
    }

    // 2. Se não encontrou na busca geral, verifica se o ID configurado ainda é válido e vivo
    const settings = db.getSettings();
    const configuredId = settings.youtubeBroadcastVideoId?.trim();

    if (configuredId) {
      const cleanId = extractYouTubeId(configuredId) || configuredId;
      if (cleanId && cleanId.length === 11) {
        const isAlive = await this.validateBroadcastAlive(cleanId);
        if (isAlive) {
          return cleanId;
        } else {
          console.warn(`[YouTube Updater] ID configurado anteriormente "${cleanId}" está encerrado ou inválido. Limpando ID desatualizado...`);
          db.updateSettings({ youtubeBroadcastVideoId: '' });
        }
      }
    }

    return null;
  }

  /**
   * Consulta a API oficial do YouTube para descobrir a transmissão ativa ou mais recente do canal
   * (Inclui deduplicação para chamadas concorrentes)
   */
  async detectAndSaveActiveBroadcast() {
    if (this.detectPromise) {
      return this.detectPromise;
    }

    this.detectPromise = this._doDetectAndSaveActiveBroadcast().finally(() => {
      this.detectPromise = null;
    });

    return this.detectPromise;
  }

  async _doDetectAndSaveActiveBroadcast() {
    const token = await this.getValidAccessToken();
    if (!token) return null;

    try {
      console.log('[YouTube Updater] Detectando Live ativa automaticamente no canal...');

      // 1. Tenta buscar transmissão em status 'active' (ao vivo agora)
      let res = await fetch('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status,contentDetails&broadcastStatus=active', {
        headers: { Authorization: `Bearer ${token}` }
      });

      let data = res.ok ? await res.json() : null;
      let broadcast = data?.items?.find(i => i.status?.lifeCycleStatus !== 'complete' && i.status?.lifeCycleStatus !== 'revoked');

      // 2. Se não encontrar ativa, busca próxima transmissão programada (upcoming)
      if (!broadcast) {
        res = await fetch('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status,contentDetails&broadcastStatus=upcoming&maxResults=5', {
          headers: { Authorization: `Bearer ${token}` }
        });
        data = res.ok ? await res.json() : null;
        broadcast = data?.items?.find(i => i.status?.lifeCycleStatus !== 'complete' && i.status?.lifeCycleStatus !== 'revoked');
      }

      // 3. Fallback: busca transmissões recentes (all) e filtra as que NÃO estão em complete
      if (!broadcast) {
        res = await fetch('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status,contentDetails&broadcastStatus=all&maxResults=10', {
          headers: { Authorization: `Bearer ${token}` }
        });
        data = res.ok ? await res.json() : null;
        broadcast = data?.items?.find(i => i.status?.lifeCycleStatus !== 'complete' && i.status?.lifeCycleStatus !== 'revoked');
      }

      if (broadcast && broadcast.id) {
        const liveId = broadcast.id;
        const liveTitle = broadcast.snippet?.title || 'Live TV Braza';
        const liveStatus = broadcast.status?.lifeCycleStatus || 'unknown';

        console.log(`[YouTube Updater] 🔴 Live ativa detectada com sucesso no canal: ${liveId} ("${liveTitle}", status: ${liveStatus})`);

        const settingsUpdate = { youtubeBroadcastVideoId: liveId };

        // 4. Obtém automaticamente a Stream Key e a RTMP Ingestion URL vinculada a esta Live
        const streamId = broadcast.contentDetails?.boundStreamId;
        if (streamId) {
          try {
            const streamRes = await fetch(`https://www.googleapis.com/youtube/v3/liveStreams?part=cdn,status&id=${streamId}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (streamRes.ok) {
              const streamData = await streamRes.json();
              const cdn = streamData.items?.[0]?.cdn?.ingestionInfo;
              if (cdn && cdn.streamName) {
                console.log(`[YouTube Updater] 🔑 Chave de Transmissão (Stream Key) obtida automaticamente do YouTube Studio!`);
                settingsUpdate.youtubeStreamKey = cdn.streamName;
                if (cdn.ingestionAddress) {
                  settingsUpdate.youtubeRtmpUrl = cdn.ingestionAddress;
                }
              }
            }
          } catch (streamErr) {
            console.warn('[YouTube Updater] Falha ao consultar stream bound:', streamErr.message);
          }
        }

        // Salva automaticamente nas configurações para cache e uso imediato no Streamer
        db.updateSettings(settingsUpdate);

        return {
          id: liveId,
          title: liveTitle,
          status: liveStatus,
          url: `https://www.youtube.com/watch?v=${liveId}`
        };
      } else {
        console.warn('[YouTube Updater] Nenhuma transmissão ao vivo encontrada no canal.');
        return null;
      }
    } catch (err) {
      console.error('[YouTube Updater] Erro ao detectar live automaticamente:', err.message);
      return null;
    }
  }

  /**
   * Transiciona a transmissão para status 'live' (aberta ao público) caso esteja em 'ready' ou 'testing'
   */
  async transitionBroadcastToLive(broadcastId) {
    if (!broadcastId) return false;
    const token = await this.getValidAccessToken();
    if (!token) return false;

    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=live&id=${broadcastId}&part=id,status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[YouTube Updater] 🚀 Live ativada AO VIVO no YouTube com sucesso! (status: ${data.status?.lifeCycleStatus})`);
        return true;
      }
    } catch (_) {}
    return false;
  }

  /**
  /**
   * Gera lista de tags otimizadas de alto CTR para a Live
   */
  generateLiveTags(itemTitle, settings) {
    if (settings.enableDynamicTags === false) return null;

    const baseTags = (settings.defaultLiveTags || '')
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const dynamicTags = [];
    if (itemTitle) {
      const cleanTitle = itemTitle.replace(/[[\]()#|:-]/g, ' ');
      const words = cleanTitle
        .split(/\s+/)
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length >= 4 && !['para', 'com', 'onde', 'qual', 'quem', 'pelo', 'pela', 'mais', 'como', 'isso', 'esse', 'essa', 'tudo', 'sobre'].includes(w));
      
      if (itemTitle.length <= 40) {
        dynamicTags.push(itemTitle.toLowerCase());
      }
      dynamicTags.push(...words);
    }

    const combined = Array.from(new Set([...dynamicTags, ...baseTags]));
    const finalTags = [];
    let charCount = 0;
    for (const tag of combined) {
      if (charCount + tag.length + 1 <= 480 && finalTags.length < 50) {
        finalTags.push(tag);
        charCount += tag.length + 1;
      }
    }
    return finalTags.length > 0 ? finalTags : null;
  }

  /**
   * Gera descrição dinâmica para a Live com base no template
   */
  generateLiveDescription(item, settings) {
    if (settings.enableDynamicDescription === false) return null;
    const template = settings.defaultLiveDescriptionTemplate;
    if (!template) return null;

    return template
      .replace(/\{title\}/g, item.title || 'Ao Vivo')
      .replace(/\{url\}/g, item.url || '')
      .replace(/\{channel\}/g, item.channel || 'TV Braza')
      .substring(0, 5000);
  }

  /**
   * Atualiza o Título e Metadados da Live no YouTube Studio
   */
  async updateTitle(videoId, newTitle, tags = null, description = null, isRetry = false) {
    if (!videoId || !newTitle) return false;

    const token = await this.getValidAccessToken();
    if (!token) {
      console.log(`[YouTube Updater] [Simulação] Metadados da Live atualizados: "${newTitle}"`);
      return false;
    }

    try {
      // 1. Consulta categoria e descrição atuais do vídeo
      const getRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!getRes.ok) {
        const err = await getRes.text();
        console.warn(`[YouTube Updater] Não foi possível consultar vídeo ${videoId}: ${err}`);
        return false;
      }

      const getData = await getRes.json();
      const currentSnippet = getData.items?.[0]?.snippet;
      if (!currentSnippet) {
        console.warn(`[YouTube Updater] Vídeo ${videoId} não encontrado no canal.`);
        if (!isRetry) {
          console.log('[YouTube Updater] Redetectando live ativa para corrigir ID...');
          db.updateSettings({ youtubeBroadcastVideoId: '' });
          const fresh = await this.detectAndSaveActiveBroadcast();
          if (fresh && fresh.id && fresh.id !== videoId) {
            return this.updateTitle(fresh.id, newTitle, tags, description, true);
          }
        }
        return false;
      }

      // 2. Atualiza o título preservando ou atualizando categoria, tags e descrição
      const snippetUpdate = {
        title: newTitle.substring(0, 100), // Limite do YouTube é 100 caracteres
        categoryId: currentSnippet.categoryId || '24',
        description: (description !== null && description !== undefined) ? description : (currentSnippet.description || '')
      };

      if (Array.isArray(tags) && tags.length > 0) {
        snippetUpdate.tags = tags;
      } else if (currentSnippet.tags) {
        snippetUpdate.tags = currentSnippet.tags;
      }

      const updatePayload = {
        id: videoId,
        snippet: snippetUpdate
      };

      const putRes = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      });

      if (putRes.ok) {
        console.log(`[YouTube Updater] ✅ Metadados da Live atualizados no YouTube com sucesso: "${newTitle}"${Array.isArray(tags) ? ` (${tags.length} tags de CTR)` : ''}`);
        return true;
      } else {
        const err = await putRes.text();
        console.warn(`[YouTube Updater] Erro ao atualizar metadados na API do YouTube: ${err}`);
        return false;
      }
    } catch (err) {
      console.error('[YouTube Updater] Erro ao atualizar metadados:', err.message);
      return false;
    }
  }

  /**
   * Faz upload de Thumbnail Personalizada na Live do YouTube
   */
  async updateThumbnail(videoId, imagePath, isRetry = false) {
    if (!videoId || !imagePath || !fs.existsSync(imagePath)) return false;

    // Se estiver em cooldown por limite de taxa do YouTube (429), não faz requisição inútil
    if (this.thumbCooldownUntil && Date.now() < this.thumbCooldownUntil) {
      const remainingMin = Math.ceil((this.thumbCooldownUntil - Date.now()) / 60000);
      console.log(`[YouTube Updater] ⏳ Em cooldown de envio de thumbnails do YouTube (Rate Limit 429). Retomando em ~${remainingMin} min.`);
      return false;
    }

    const token = await this.getValidAccessToken();
    if (!token) {
      console.log(`[YouTube Updater] [Simulação] Thumbnail da Live atualizada para o arquivo: ${imagePath}`);
      return false;
    }

    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const isPng = imagePath.toLowerCase().endsWith('.png');
      const contentType = isPng ? 'image/png' : 'image/jpeg';

      // Evita re-enviar a mesma thumbnail se já foi enviada para este videoId
      const currentKey = `${videoId}_${path.basename(imagePath)}_${imageBuffer.length}`;
      if (this.lastUploadedThumbKey === currentKey) {
        console.log('[YouTube Updater] 🖼️ Thumbnail da atração já está sincronizada com a Live no YouTube Studio.');
        return true;
      }

      const uploadUrl = `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`;

      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': contentType,
          'Content-Length': imageBuffer.length.toString()
        },
        body: imageBuffer
      });

      if (res.ok) {
        console.log(`[YouTube Updater] ✅ Thumbnail enviada ao YouTube com sucesso!`);
        this.lastUploadedThumbKey = currentKey;
        return true;
      } else {
        const err = await res.text();
        if (res.status === 429 || err.includes('uploadRateLimitExceeded')) {
          this.thumbCooldownUntil = Date.now() + (5 * 60 * 1000); // 5 minutos de cooldown
          console.warn(`[YouTube Updater] ⏳ Limite de envio de thumbnails atingido no YouTube (Rate Limit 429). A transmissão continua normalmente e nova tentativa ocorrerá após o cooldown.`);
          return false;
        }

        if ((res.status === 404 || err.includes('videoNotFound')) && !isRetry) {
          console.warn(`[YouTube Updater] Vídeo ${videoId} não encontrado ao enviar thumbnail. Redetectando live ativa...`);
          db.updateSettings({ youtubeBroadcastVideoId: '' });
          const fresh = await this.detectAndSaveActiveBroadcast();
          if (fresh && fresh.id && fresh.id !== videoId) {
            return this.updateThumbnail(fresh.id, imagePath, true);
          }
        }
        console.warn(`[YouTube Updater] Erro ao enviar thumbnail para o YouTube: ${err}`);
        return false;
      }
    } catch (err) {
      console.error('[YouTube Updater] Erro ao enviar thumbnail:', err.message);
      return false;
    }
  }

  /**
   * Garante a thumbnail local: se for customizada usa ela, se não, baixa automaticamente
   * a capa original em alta definição (1080p maxres) do vídeo do YouTube para enviar à Live.
   */
  async ensureLocalThumbnail(item) {
    if (item.customThumbPath && fs.existsSync(item.customThumbPath)) {
      return item.customThumbPath;
    }

    const ytid = extractYouTubeId(item.url);
    const candidateUrls = [
      ytid ? `https://i.ytimg.com/vi/${ytid}/maxresdefault.jpg` : null,
      ytid ? `https://i.ytimg.com/vi/${ytid}/hqdefault.jpg` : null,
      item.thumbnail
    ].filter(Boolean);

    for (const url of candidateUrls) {
      if (!url.startsWith('http')) continue;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          // Evita placeholders vazios do YouTube (imagens menores que 2KB)
          if (buffer.length > 2048) {
            const ext = url.includes('.png') ? '.png' : '.jpg';
            const localFile = path.join(THUMBS_DIR, `auto_thumb_${item.id || Date.now()}${ext}`);
            fs.writeFileSync(localFile, buffer);
            return localFile;
          }
        }
      } catch (_) {}
    }

    return null;
  }

  /**
   * Sincroniza metadados completos (Título e Thumbnail) quando um programa entra no ar
   */
  async syncItemMetadata(item) {
    if (!item) return;

    // Detecta automaticamente o ID da Live ativa no canal caso não esteja configurado
    const videoId = await this.getActiveBroadcastId();
    const settings = db.getSettings();
    const prefix = settings.defaultLiveTitlePrefix || 'TV BRAZA AO VIVO: ';
    const template = settings.liveTitleTemplate || '🔴 AO VIVO: "{title}" | ASSISTA AGORA!';

    let formattedTitle = '';
    if (item.liveTitle) {
      formattedTitle = item.liveTitle;
    } else if (item.title) {
      if (template.includes('{title}')) {
        formattedTitle = template.replace('{title}', item.title).replace('{prefix}', prefix);
      } else {
        formattedTitle = item.title.startsWith(prefix) ? item.title : `${prefix}${item.title}`;
      }
    } else {
      formattedTitle = 'TV BRAZA AO VIVO';
    }

    const liveTitle = formattedTitle.trim().substring(0, 100);

    console.log(`[YouTube Updater] Sincronizando metadados da nova atração: "${liveTitle}"`);

    // Atualiza estado do playout com o título ativo
    db.updatePlayoutState({
      currentLiveTitle: liveTitle,
      currentLiveThumb: item.customThumbUrl || item.thumbnail
    });

    if (!videoId) {
      console.log('[YouTube Updater] Nenhuma live ativa encontrada no YouTube. O título foi atualizado localmente no Painel TV Braza.');
      return;
    }

    // 1. Atualiza Título, Tags e Descrição de Alto CTR no YouTube
    if (liveTitle) {
      const liveTags = this.generateLiveTags(item.title, settings);
      const liveDescription = this.generateLiveDescription(item, settings);
      await this.updateTitle(videoId, liveTitle, liveTags, liveDescription);
    }

    // 2. Atualiza Thumbnail no YouTube automaticamente (customizada ou original em HD)
    try {
      const thumbFile = await this.ensureLocalThumbnail(item);
      if (thumbFile && fs.existsSync(thumbFile)) {
        console.log(`[YouTube Updater] Enviando thumbnail da atração para a Live no YouTube Studio...`);
        await this.updateThumbnail(videoId, thumbFile);
      }
    } catch (err) {
      console.warn('[YouTube Updater] Falha ao atualizar thumbnail da Live:', err.message);
    }
  }
}

export const youtubeUpdater = new YouTubeMetadataUpdater();
