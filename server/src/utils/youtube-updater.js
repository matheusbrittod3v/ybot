import fs from 'fs';
import { db } from '../db.js';

class YouTubeMetadataUpdater {
  constructor() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
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
   * Atualiza o Título da Live no YouTube Studio
   */
  async updateTitle(videoId, newTitle) {
    if (!videoId || !newTitle) return false;

    const token = await this.getValidAccessToken();
    if (!token) {
      console.log(`[YouTube Updater] [Simulação] Título da Live atualizado para: "${newTitle}" (Configure o Google OAuth para enviar à API do YouTube)`);
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
        return false;
      }

      // 2. Atualiza o título preservando categoria e descrição
      const updatePayload = {
        id: videoId,
        snippet: {
          title: newTitle.substring(0, 100), // Limite do YouTube é 100 caracteres
          categoryId: currentSnippet.categoryId || '24',
          description: currentSnippet.description || ''
        }
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
        console.log(`[YouTube Updater] ✅ Título da Live atualizado no YouTube com sucesso: "${newTitle}"`);
        return true;
      } else {
        const err = await putRes.text();
        console.warn(`[YouTube Updater] Erro ao atualizar título na API do YouTube: ${err}`);
        return false;
      }
    } catch (err) {
      console.error('[YouTube Updater] Erro ao atualizar título:', err.message);
      return false;
    }
  }

  /**
   * Faz upload de Thumbnail Personalizada na Live do YouTube
   */
  async updateThumbnail(videoId, imagePath) {
    if (!videoId || !imagePath || !fs.existsSync(imagePath)) return false;

    const token = await this.getValidAccessToken();
    if (!token) {
      console.log(`[YouTube Updater] [Simulação] Thumbnail da Live atualizada para o arquivo: ${imagePath}`);
      return false;
    }

    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const isPng = imagePath.toLowerCase().endsWith('.png');
      const contentType = isPng ? 'image/png' : 'image/jpeg';

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
        console.log(`[YouTube Updater] ✅ Thumbnail personalizada enviada ao YouTube com sucesso!`);
        return true;
      } else {
        const err = await res.text();
        console.warn(`[YouTube Updater] Erro ao enviar thumbnail para o YouTube: ${err}`);
        return false;
      }
    } catch (err) {
      console.error('[YouTube Updater] Erro ao enviar thumbnail:', err.message);
      return false;
    }
  }

  /**
   * Sincroniza metadados completos (Título e Thumbnail) quando um programa entra no ar
   */
  async syncItemMetadata(item) {
    if (!item) return;

    const settings = db.getSettings();
    const videoId = settings.youtubeBroadcastVideoId?.trim();
    const liveTitle = item.liveTitle || item.title;

    console.log(`[YouTube Updater] Sincronizando metadados da nova atração: "${liveTitle}"`);

    // Atualiza estado do playout com o título ativo
    db.updatePlayoutState({
      currentLiveTitle: liveTitle,
      currentLiveThumb: item.customThumbUrl || item.thumbnail
    });

    if (!videoId) {
      console.log('[YouTube Updater] ID do Vídeo da Live não configurado. O título foi atualizado no Painel TV Braza.');
      return;
    }

    // 1. Atualiza Título no YouTube
    if (liveTitle) {
      await this.updateTitle(videoId, liveTitle);
    }

    // 2. Atualiza Thumbnail no YouTube se houver imagem personalizada
    if (item.customThumbPath && fs.existsSync(item.customThumbPath)) {
      await this.updateThumbnail(videoId, item.customThumbPath);
    }
  }
}

export const youtubeUpdater = new YouTubeMetadataUpdater();
