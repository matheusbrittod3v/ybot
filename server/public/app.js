// TV Braza - Studio Playout 24/7 Frontend Controller

let ws = null;
let currentPlayoutState = null;
let currentQueue = [];
let pendingVideoPreview = null;
let playbackTimer = null;
let playoutStartTime = null;
let currentDuration = 0;

// Elementos DOM
const elLiveStatusPill = document.getElementById('live-status-pill');
const elLiveStatusText = document.getElementById('live-status-text');
const elStatDiskVal = document.getElementById('stat-disk-val');
const elStatDiskBar = document.getElementById('stat-disk-bar');
const elStatRamVal = document.getElementById('stat-ram-val');
const elStatCpuVal = document.getElementById('stat-cpu-val');
const elStatMediaVal = document.getElementById('stat-media-val');

const elAlertNoKey = document.getElementById('alert-no-key');
const elBtnConfigKeyNow = document.getElementById('btn-config-key-now');

// No Ar Agora
const elCurrentThumb = document.getElementById('current-thumb');
const elStandbyDisplay = document.getElementById('standby-display');
const elNowPlayingBadge = document.getElementById('now-playing-badge');
const elCurrentTitle = document.getElementById('current-title');
const elCurrentChannel = document.getElementById('current-channel');
const elMetricFps = document.getElementById('metric-fps');
const elMetricBitrate = document.getElementById('metric-bitrate');
const elPlaybackProgressBar = document.getElementById('playback-progress-bar');
const elPlaybackElapsed = document.getElementById('playback-elapsed');
const elPlaybackTotal = document.getElementById('playback-total');
const elBtnSkipVideo = document.getElementById('btn-skip-video');
const elBtnToggleStream = document.getElementById('btn-toggle-stream');
const elLblStreamToggle = document.getElementById('lbl-stream-toggle');
const elBtnRestartStream = document.getElementById('btn-restart-stream');

// A Seguir
const elUpNextStatusBadge = document.getElementById('up-next-status-badge');
const elNextThumb = document.getElementById('next-thumb');
const elNextEmptyState = document.getElementById('next-empty-state');
const elNextInfoBox = document.getElementById('next-info-box');
const elNextTitle = document.getElementById('next-title');
const elNextChannel = document.getElementById('next-channel');
const elNextDuration = document.getElementById('next-duration');
const elDlProgressBar = document.getElementById('dl-progress-bar');
const elDlPercent = document.getElementById('dl-percent');
const elDlSpeedLabel = document.getElementById('dl-speed-label');

// Adicionar Programação
const elInputYtUrl = document.getElementById('input-yt-url');
const elBtnInspectUrl = document.getElementById('btn-inspect-url');
const elSpinnerInspect = document.getElementById('spinner-inspect');
const elUrlPreviewCard = document.getElementById('url-preview-card');
const elPreviewCardThumb = document.getElementById('preview-card-thumb');
const elPreviewCardTitle = document.getElementById('preview-card-title');
const elPreviewCardChannel = document.getElementById('preview-card-channel');
const elPreviewCardDuration = document.getElementById('preview-card-duration');
const elBtnConfirmAdd = document.getElementById('btn-confirm-add');
const elBtnCancelPreview = document.getElementById('btn-cancel-preview');

// Fila e Histórico
const elQueueList = document.getElementById('queue-list');
const elQueueCount = document.getElementById('queue-count');
const elEmptyQueueMsg = document.getElementById('empty-queue-msg');
const elBtnClearQueue = document.getElementById('btn-clear-queue');
const elHistoryList = document.getElementById('history-list');
const elEmptyHistoryMsg = document.getElementById('empty-history-msg');
const elBtnClearHistory = document.getElementById('btn-clear-history');

// Modais e Drawers
const elModalSettings = document.getElementById('modal-settings');
const elBtnOpenSettings = document.getElementById('btn-open-settings');
const elBtnCloseSettings = document.getElementById('btn-close-settings');
const elBtnCancelSettings = document.getElementById('btn-cancel-settings');
const elFormSettings = document.getElementById('form-settings');
const elCfgStreamKey = document.getElementById('cfg-stream-key');
const elCfgRtmpUrl = document.getElementById('cfg-rtmp-url');
const elCfgResolution = document.getElementById('cfg-resolution');
const elCfgBitrate = document.getElementById('cfg-bitrate');
const elCfgWatermark = document.getElementById('cfg-watermark');
const elCfgAutoDelete = document.getElementById('cfg-auto-delete');
const elCfgAutoStandby = document.getElementById('cfg-auto-standby');
const elBtnToggleKeyEye = document.getElementById('btn-toggle-key-eye');

// Watermark Customization
const elCfgWatermarkText = document.getElementById('cfg-watermark-text');
const elInputWatermarkLogo = document.getElementById('input-watermark-logo');
const elWatermarkLogoPreview = document.getElementById('watermark-logo-preview');
const elBtnResetLogo = document.getElementById('btn-reset-logo');
const elWatermarkCustomPanel = document.getElementById('watermark-customization-panel');

// Schedule Overlay / Banner "A SEGUIR"
const elCfgEnableScheduleOverlay = document.getElementById('cfg-enable-schedule-overlay');
const elCfgScheduleInterval = document.getElementById('cfg-schedule-interval');
const elCfgScheduleDuration = document.getElementById('cfg-schedule-duration');

// YouTube Live Metadata Settings
const elCfgBroadcastVideoId = document.getElementById('cfg-broadcast-video-id');
const elCfgTitlePrefix = document.getElementById('cfg-title-prefix');
const elCfgGoogleClientId = document.getElementById('cfg-google-client-id');
const elCfgGoogleClientSecret = document.getElementById('cfg-google-client-secret');
const elCfgGoogleRefreshToken = document.getElementById('cfg-google-refresh-token');
const elBtnDetectLive = document.getElementById('btn-detect-live');
const elSpinnerDetectLive = document.getElementById('spinner-detect-live');

// Título da Live & Upload de Thumbnail no Preview
const elCurrentLiveTitle = document.getElementById('current-live-title');
const elInputLiveTitle = document.getElementById('input-live-title');
const elInputCustomThumb = document.getElementById('input-custom-thumb');
const elPreviewCustomThumbBadge = document.getElementById('preview-custom-thumb-badge');
const elBtnRemoveCustomThumb = document.getElementById('btn-remove-custom-thumb');

// Modal de Edição de Item da Grade
const elModalEditItem = document.getElementById('modal-edit-item');
const elFormEditItem = document.getElementById('form-edit-item');
const elEditItemId = document.getElementById('edit-item-id');
const elEditLiveTitle = document.getElementById('edit-live-title');
const elEditThumbImg = document.getElementById('edit-thumb-img');
const elEditInputCustomThumb = document.getElementById('edit-input-custom-thumb');
const elEditBtnRestoreThumb = document.getElementById('edit-btn-restore-thumb');
const elBtnCloseEditItem = document.getElementById('btn-close-edit-item');
const elBtnCancelEditItem = document.getElementById('btn-cancel-edit-item');
let editingItemOriginalThumb = '';
let editingItemCustomThumbPath = null;
let editingItemCustomThumbUrl = null;

const elDrawerLogs = document.getElementById('drawer-logs');
const elBtnOpenLogs = document.getElementById('btn-open-logs');
const elBtnCloseLogs = document.getElementById('btn-close-logs');
const elTerminalBody = document.getElementById('terminal-body');
const elBtnClearTerminal = document.getElementById('btn-clear-terminal');
const elToastContainer = document.getElementById('toast-container');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  // Carregamento paralelo ultra-rápido de estado inicial
  Promise.allSettled([
    fetchStatus(),
    fetchQueue(),
    fetchHistory()
  ]);
  setupEventListeners();

  // Inicia contador contínuo de tempo
  playbackTimer = setInterval(updateLiveTimeTicker, 1000);
});

// ============================================================
// WEBSOCKET EM TEMPO REAL
// ============================================================
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    logTerminal('info', 'WebSocket conectado ao servidor da TV Braza.');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('Erro ao processar mensagem WS:', e);
    }
  };

  ws.onclose = () => {
    logTerminal('warning', 'Conexão WebSocket perdida. Reconectando em 3s...');
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.warn('Erro WS:', err);
  };
}

function handleWsMessage(msg) {
  const { type, data } = msg;

  switch (type) {
    case 'init_state':
      if (data.system) updateSystemStats(data.system);
      if (data.playout) updatePlayoutDisplay(data.playout);
      if (data.queue) renderQueue(data.queue);
      break;

    case 'queue_updated':
      if (data.queue) renderQueue(data.queue);
      fetchStatus();
      break;

    case 'telemetry':
      if (data.system) updateSystemStats(data.system);
      if (data.playout) updateStreamMetrics(data.playout);
      break;

    case 'stream_stats':
      if (data.fps) elMetricFps.textContent = `${data.fps.toFixed(1)} FPS`;
      if (data.bitrate) elMetricBitrate.textContent = data.bitrate;
      break;

    case 'download_start':
      logTerminal('info', `[Download] Iniciando: ${data.item?.title || 'Vídeo'}`);
      fetchQueue();
      fetchStatus();
      break;

    case 'download_progress':
      updateDownloadProgress(data);
      break;

    case 'download_complete':
      logTerminal('success', `[Download] Concluído: ${data.item?.title}`);
      showToast(`Vídeo "${data.item?.title}" pré-baixado no disco!`, 'success');
      fetchQueue();
      fetchStatus();
      break;

    case 'download_error':
      logTerminal('error', `[Download] Falha no download: ${data.item?.title || data.error}`);
      showToast('Erro ao baixar vídeo do YouTube', 'error');
      fetchQueue();
      break;

    case 'video_started':
      logTerminal('success', `[Playout] NO AR AGORA: "${data.item?.title}"`);
      showToast(`Iniciada transmissão: ${data.item?.title}`, 'info');
      fetchStatus();
      fetchQueue();
      break;

    case 'standby_started':
      logTerminal('info', '[Playout] Vinheta Standby TV Braza ativada (Sem interrupção no YouTube).');
      fetchStatus();
      break;

    case 'playout_stopped':
      logTerminal('warning', '[Playout] Transmissão interrompida.');
      fetchStatus();
      break;
  }
}

// ============================================================
// ATUALIZAÇÃO DA INTERFACE
// ============================================================
function updateSystemStats(sys) {
  if (!sys) return;

  // Disco da VPS
  if (sys.disk) {
    elStatDiskVal.textContent = `${sys.disk.usedFormatted} / ${sys.disk.totalFormatted} (${sys.disk.usedPercent}%)`;
    elStatDiskBar.style.width = `${Math.min(sys.disk.usedPercent, 100)}%`;
    if (sys.disk.usedPercent > 85) {
      elStatDiskBar.style.background = 'var(--braza-red)';
    } else {
      elStatDiskBar.style.background = 'linear-gradient(90deg, #10b981, #f59e0b)';
    }
  }

  // RAM e CPU
  if (sys.memory) {
    elStatRamVal.textContent = `${sys.memory.usedPercent}%`;
  }
  if (sys.cpu) {
    elStatCpuVal.textContent = `${sys.cpu.cores}c (${sys.cpu.load1m})`;
  }

  // Quantidade de arquivos MP4 no disco
  if (sys.media) {
    elStatMediaVal.textContent = `${sys.media.fileCount} vídeos (${sys.media.totalSizeFormatted})`;
  }
}

function updatePlayoutDisplay(playout) {
  currentPlayoutState = playout;

  // Status Pill
  elLiveStatusPill.className = 'live-status-pill';
  if (playout.state === 'PLAYING') {
    elLiveStatusText.textContent = 'NO AR AO VIVO';
    elNowPlayingBadge.textContent = 'AO VIVO NO YOUTUBE';
    elNowPlayingBadge.style.backgroundColor = 'rgba(239, 68, 68, 0.9)';
    elLblStreamToggle.textContent = 'Parar Playout';
  } else if (playout.state === 'STANDBY') {
    elLiveStatusPill.classList.add('standby');
    elLiveStatusText.textContent = 'STANDBY 24H';
    elNowPlayingBadge.textContent = 'STANDBY ATIVO';
    elNowPlayingBadge.style.backgroundColor = 'rgba(245, 158, 11, 0.9)';
    elLblStreamToggle.textContent = 'Parar Playout';
  } else {
    elLiveStatusPill.classList.add('stopped');
    elLiveStatusText.textContent = 'OFFLINE';
    elNowPlayingBadge.textContent = 'SINAL PARADO';
    elNowPlayingBadge.style.backgroundColor = 'rgba(100, 116, 139, 0.9)';
    elLblStreamToggle.textContent = 'Iniciar Playout';
  }

  // Alerta de Chave
  if (playout.isConfigured === false) {
    elAlertNoKey.classList.remove('hidden');
  } else {
    elAlertNoKey.classList.add('hidden');
  }
}

function updateStreamMetrics(playout) {
  if (playout.fps !== undefined) {
    elMetricFps.textContent = `${playout.fps.toFixed(1)} FPS`;
  }
  if (playout.bitrate) {
    elMetricBitrate.textContent = playout.bitrate;
  }
}

function updateDownloadProgress(data) {
  // Se for o próximo vídeo, atualiza a barra de progresso do card "A Seguir"
  elDlPercent.textContent = `${data.progress.toFixed(0)}%`;
  elDlProgressBar.style.width = `${data.progress}%`;
  elDlSpeedLabel.textContent = `Velocidade: ${data.speed} | Restante: ${data.eta}`;
  elUpNextStatusBadge.className = 'badge-status downloading';
  elUpNextStatusBadge.textContent = `BAIXANDO ${data.progress.toFixed(0)}%`;

  // Atualiza também o chip na lista de fila
  const chip = document.getElementById(`status-chip-${data.id}`);
  if (chip) {
    chip.className = 'queue-status-chip downloading';
    chip.textContent = `Baixando ${data.progress.toFixed(0)}%`;
  }
}

function updateLiveTimeTicker() {
  if (!playoutStartTime || currentPlayoutState?.state !== 'PLAYING') {
    return;
  }

  const elapsedSec = Math.floor((Date.now() - playoutStartTime) / 1000);
  elPlaybackElapsed.textContent = formatTime(elapsedSec);

  if (currentDuration > 0) {
    const percent = Math.min((elapsedSec / currentDuration) * 100, 100);
    elPlaybackProgressBar.style.width = `${percent}%`;
    elPlaybackTotal.textContent = formatTime(currentDuration);
  }
}

// ============================================================
// REQUISIÇÕES REST API
// ============================================================
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      updatePlayoutDisplay(data.playout);
      updateSystemStats(data.system);

      // Atualiza No Ar Agora
      if (data.activeItem) {
        elCurrentTitle.textContent = data.activeItem.title;
        elCurrentChannel.textContent = `Canal: ${data.activeItem.channel || 'TV Braza'}`;
        const activeLiveTitle = data.playout?.currentLiveTitle || data.activeItem.liveTitle || data.activeItem.title;
        if (elCurrentLiveTitle) elCurrentLiveTitle.textContent = activeLiveTitle;
        
        const activeThumb = data.activeItem.customThumbUrl || data.activeItem.thumbnail;
        if (activeThumb) {
          elCurrentThumb.src = activeThumb;
          elCurrentThumb.classList.remove('hidden');
          elStandbyDisplay.classList.add('hidden');
        }
        playoutStartTime = data.playout.startedAt || Date.now();
        currentDuration = data.activeItem.duration || 0;
      } else {
        elCurrentTitle.textContent = 'TV Braza - Transmissão Contínua 24h';
        elCurrentChannel.textContent = 'Aguardando próxima atração';
        if (elCurrentLiveTitle) elCurrentLiveTitle.textContent = 'TV BRAZA - AO VIVO 24H';
        elCurrentThumb.classList.add('hidden');
        elStandbyDisplay.classList.remove('hidden');
        playoutStartTime = null;
        currentDuration = 0;
        elPlaybackProgressBar.style.width = '100%';
        elPlaybackElapsed.textContent = '24:00:00';
        elPlaybackTotal.textContent = 'STANDBY';
      }

      // Atualiza A Seguir
      if (data.nextItem) {
        elNextThumb.src = data.nextItem.customThumbUrl || data.nextItem.thumbnail || '';
        elNextThumb.classList.remove('hidden');
        elNextEmptyState.classList.add('hidden');
        elNextInfoBox.classList.remove('hidden');

        elNextTitle.textContent = data.nextItem.liveTitle || data.nextItem.title;
        elNextChannel.textContent = `Canal: ${data.nextItem.channel || 'Desconhecido'}`;
        elNextDuration.textContent = data.nextItem.durationFormatted || '00:00';

        elUpNextStatusBadge.className = 'badge-status ready';
        elUpNextStatusBadge.textContent = 'PRONTO (STREAM DIRETO ⚡)';
        elDlProgressBar.style.width = '100%';
        elDlPercent.textContent = '100%';
        elDlSpeedLabel.textContent = '⚡ Stream por link sem anúncios pronto para exibição imediata.';
      } else {
        elNextThumb.classList.add('hidden');
        elNextEmptyState.classList.remove('hidden');
        elNextInfoBox.classList.add('hidden');
        elUpNextStatusBadge.className = 'badge-status';
        elUpNextStatusBadge.textContent = 'VAZIO';
      }
    }
  } catch (err) {
    console.error('Erro ao consultar status:', err);
  }
}

async function fetchQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    if (data.success) {
      renderQueue(data.queue);
    }
  } catch (err) {
    console.error('Erro ao consultar fila:', err);
  }
}

function renderQueue(queue) {
  currentQueue = queue;
  elQueueCount.textContent = queue.length;

  if (queue.length === 0) {
    elEmptyQueueMsg.classList.remove('hidden');
    elQueueList.innerHTML = '';
    elQueueList.appendChild(elEmptyQueueMsg);
    return;
  }

  elEmptyQueueMsg.classList.add('hidden');
  elQueueList.innerHTML = '';

  queue.forEach((item, index) => {
    const isPlaying = item.status === 'playing';
    const row = document.createElement('div');
    row.className = `queue-item ${isPlaying ? 'playing' : ''}`;

    const isDirect = true;
    let statusClass = 'ready';
    let statusText = '⚡ Stream Direto';
    if (isPlaying) {
      statusClass = 'playing';
      statusText = '⚡ No Ar (Stream Direto)';
    } else if (item.status === 'error') {
      statusClass = 'error';
      statusText = 'Erro na Transmissão';
    }

    const thumbSrc = item.customThumbUrl || item.thumbnail || 'assets/logo.svg';
    const displayTitle = item.liveTitle || item.title;
    const hasCustomThumb = Boolean(item.customThumbUrl);

    row.innerHTML = `
      <div class="queue-order">${index + 1}</div>
      <div style="position: relative; width: 96px; aspect-ratio: 16/9;">
        <img src="${thumbSrc}" class="queue-thumb" style="width: 100%; height: 100%;" alt="Thumb" loading="lazy" decoding="async">
        ${hasCustomThumb ? '<span class="custom-thumb-indicator">CUSTOM</span>' : ''}
      </div>
      <div class="queue-info">
        <div class="queue-item-title" title="${escapeHtml(displayTitle)}">
          ${escapeHtml(displayTitle)}
          ${isDirect ? '<span style="display:inline-block; background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: bold; margin-left: 6px; vertical-align: middle;">⚡ SEM ANÚNCIOS</span>' : ''}
        </div>
        <div class="queue-item-meta">
          <span>Canal: ${escapeHtml(item.channel || 'YouTube')}</span>
          <span>Duração: <strong>${item.durationFormatted || '00:00'}</strong></span>
          <span class="queue-status-chip ${statusClass}" id="status-chip-${item.id}">${statusText}</span>
        </div>
      </div>
      <div class="queue-actions">
        ${!isPlaying && item.status !== 'ready' ? `
          <button class="btn-queue-retry" onclick="retryQueueItem('${item.id}')" title="Baixar agora / Tentar novamente">🔄</button>
        ` : ''}
        <button class="btn-queue-edit" onclick="openEditItemModal('${item.id}')" title="Editar Título e Capa da Live">✏️</button>
        ${!isPlaying && index > 0 ? `
          <button class="btn-queue-move" onclick="moveQueueItem('${item.id}', -1)" title="Subir na fila">▲</button>
        ` : ''}
        ${!isPlaying && index < queue.length - 1 ? `
          <button class="btn-queue-move" onclick="moveQueueItem('${item.id}', 1)" title="Descer na fila">▼</button>
        ` : ''}
        ${!isPlaying ? `
          <button class="btn-queue-delete" onclick="deleteQueueItem('${item.id}')" title="Remover da grade">✕</button>
        ` : ''}
      </div>
    `;

    elQueueList.appendChild(row);
  });
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    if (data.success) {
      renderHistory(data.history);
    }
  } catch (err) {
    console.error('Erro ao consultar histórico:', err);
  }
}

function renderHistory(history) {
  if (!history || history.length === 0) {
    elEmptyHistoryMsg.classList.remove('hidden');
    elHistoryList.innerHTML = '';
    elHistoryList.appendChild(elEmptyHistoryMsg);
    return;
  }

  elEmptyHistoryMsg.classList.add('hidden');
  elHistoryList.innerHTML = '';

  history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const finishedDate = item.finishedAt ? new Date(item.finishedAt).toLocaleTimeString('pt-BR') : '';

    row.innerHTML = `
      <span class="history-item-title">${escapeHtml(item.title)}</span>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="color: var(--text-dim); font-size: 11px;">Exibido às ${finishedDate}</span>
        <span class="history-cleaned-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Arquivo apagado (Espaço liberado)
        </span>
      </div>
    `;
    elHistoryList.appendChild(row);
  });
}

// ============================================================
// AÇÕES DO USUÁRIO
// ============================================================
function setupEventListeners() {
  // Adicionar rápido direto à grade (1 clique)
  const elBtnQuickAdd = document.getElementById('btn-quick-add');
  if (elBtnQuickAdd) {
    elBtnQuickAdd.addEventListener('click', handleQuickAdd);
  }

  // Tecla Enter no input aciona o Quick-Add direto
  elInputYtUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAdd();
    }
  });

  // Consultar link para personalização (título/capa)
  elBtnInspectUrl.addEventListener('click', handleInspectUrl);

  // Confirmar adição personalizada
  elBtnConfirmAdd.addEventListener('click', handleConfirmAdd);
  elBtnCancelPreview.addEventListener('click', () => {
    elUrlPreviewCard.classList.add('hidden');
    pendingVideoPreview = null;
  });

  // Pular vídeo
  elBtnSkipVideo.addEventListener('click', async () => {
    if (!confirm('Deseja realmente pular este vídeo? O arquivo será apagado imediatamente para liberar espaço e a próxima atração começará.')) {
      return;
    }
    try {
      const res = await fetch('/api/control/skip', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Vídeo pulado e arquivo excluído!', 'info');
        fetchStatus();
      }
    } catch (err) {
      showToast('Erro ao pular vídeo', 'error');
    }
  });

  // Iniciar / Parar Playout
  elBtnToggleStream.addEventListener('click', async () => {
    const isPlayingOrStandby = currentPlayoutState?.state === 'PLAYING' || currentPlayoutState?.state === 'STANDBY';
    const endpoint = isPlayingOrStandby ? '/api/control/stop' : '/api/control/start';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(isPlayingOrStandby ? 'Transmissão parada.' : 'Transmissão iniciada!', 'success');
        fetchStatus();
      }
    } catch (err) {
      showToast('Erro ao controlar transmissão', 'error');
    }
  });

  // Reiniciar FFmpeg
  elBtnRestartStream.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/control/restart', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Processo FFmpeg reiniciado.', 'info');
        fetchStatus();
      }
    } catch (err) {
      showToast('Erro ao reiniciar FFmpeg', 'error');
    }
  });

  // Limpar fila
  elBtnClearQueue.addEventListener('click', async () => {
    if (!confirm('Deseja limpar todos os vídeos não exibidos da fila?')) return;
    try {
      await fetch('/api/queue/clear', { method: 'POST' });
      fetchQueue();
      fetchStatus();
      showToast('Fila limpa com sucesso.', 'info');
    } catch (err) {
      showToast('Erro ao limpar fila', 'error');
    }
  });

  // Limpar Histórico
  elBtnClearHistory.addEventListener('click', async () => {
    await fetch('/api/history/clear', { method: 'POST' });
    fetchHistory();
    showToast('Histórico limpo.', 'info');
  });

  // Modais
  elBtnOpenSettings.addEventListener('click', openSettingsModal);
  elBtnConfigKeyNow.addEventListener('click', openSettingsModal);
  elBtnCloseSettings.addEventListener('click', () => elModalSettings.classList.add('hidden'));
  elBtnCancelSettings.addEventListener('click', () => elModalSettings.classList.add('hidden'));

  elBtnToggleKeyEye.addEventListener('click', () => {
    elCfgStreamKey.type = elCfgStreamKey.type === 'password' ? 'text' : 'password';
  });

  elFormSettings.addEventListener('submit', handleSaveSettings);

  // Upload de Thumbnail Personalizada no Preview de Adição
  if (elInputCustomThumb) {
    elInputCustomThumb.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || !pendingVideoPreview) return;

      try {
        showToast('Enviando thumbnail personalizada...', 'info');
        const uploadRes = await uploadThumbFile(file);
        if (uploadRes.success) {
          pendingVideoPreview.customThumbPath = uploadRes.thumbPath;
          pendingVideoPreview.customThumbUrl = uploadRes.thumbUrl;
          elPreviewCardThumb.src = uploadRes.thumbUrl;
          elPreviewCustomThumbBadge.classList.remove('hidden');
          elBtnRemoveCustomThumb.classList.remove('hidden');
          showToast('Thumbnail personalizada aplicada!', 'success');
        } else {
          showToast(uploadRes.error || 'Erro no upload da imagem', 'error');
        }
      } catch (err) {
        showToast('Falha no upload da thumbnail', 'error');
      }
    });
  }

  if (elBtnRemoveCustomThumb) {
    elBtnRemoveCustomThumb.addEventListener('click', () => {
      if (!pendingVideoPreview) return;
      pendingVideoPreview.customThumbPath = null;
      pendingVideoPreview.customThumbUrl = null;
      elPreviewCardThumb.src = pendingVideoPreview.thumbnail;
      elPreviewCustomThumbBadge.classList.add('hidden');
      elBtnRemoveCustomThumb.classList.add('hidden');
      if (elInputCustomThumb) elInputCustomThumb.value = '';
      showToast('Capa original restaurada.', 'info');
    });
  }

  // Eventos do Modal de Edição de Item
  if (elBtnCloseEditItem) {
    elBtnCloseEditItem.addEventListener('click', () => elModalEditItem.classList.add('hidden'));
  }
  if (elBtnCancelEditItem) {
    elBtnCancelEditItem.addEventListener('click', () => elModalEditItem.classList.add('hidden'));
  }
  if (elFormEditItem) {
    elFormEditItem.addEventListener('submit', handleSaveEditedItem);
  }
  if (elEditInputCustomThumb) {
    elEditInputCustomThumb.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        showToast('Enviando nova thumbnail...', 'info');
        const res = await uploadThumbFile(file);
        if (res.success) {
          editingItemCustomThumbPath = res.thumbPath;
          editingItemCustomThumbUrl = res.thumbUrl;
          elEditThumbImg.src = res.thumbUrl;
          showToast('Thumbnail atualizada no preview!', 'success');
        }
      } catch (err) {
        showToast('Erro ao enviar imagem', 'error');
      }
    });
  }
  if (elEditBtnRestoreThumb) {
    elEditBtnRestoreThumb.addEventListener('click', () => {
      editingItemCustomThumbPath = null;
      editingItemCustomThumbUrl = null;
      elEditThumbImg.src = editingItemOriginalThumb;
      if (elEditInputCustomThumb) elEditInputCustomThumb.value = '';
      showToast('Capa original restaurada.', 'info');
    });
  }

  // Salvar e Remover Cookies do YouTube
  if (elBtnSaveCookies) {
    elBtnSaveCookies.addEventListener('click', async () => {
      const text = elCfgCookiesText?.value.trim();
      if (!text) {
        showToast('Cole o conteúdo do cookies.txt primeiro', 'warning');
        return;
      }
      try {
        const res = await fetch('/api/cookies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: text })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Cookies do YouTube salvos na VPS!', 'success');
          if (elCfgCookiesText) elCfgCookiesText.value = '';
          checkCookiesStatus();
        } else {
          showToast(data.error || 'Erro ao salvar cookies', 'error');
        }
      } catch (err) {
        showToast('Erro ao salvar cookies', 'error');
      }
    });
  }

  if (elBtnDeleteCookies) {
    elBtnDeleteCookies.addEventListener('click', async () => {
      if (!confirm('Deseja remover o arquivo cookies.txt da VPS?')) return;
      try {
        await fetch('/api/cookies', { method: 'DELETE' });
        showToast('Arquivo cookies.txt removido.', 'info');
        checkCookiesStatus();
      } catch (_) {}
    });
  }

  const elInputCookiesFile = document.getElementById('input-cookies-file');
  if (elInputCookiesFile) {
    elInputCookiesFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        showToast('Enviando cookies.txt para a VPS...', 'info');
        const formData = new FormData();
        formData.append('cookiesFile', file);
        const res = await fetch('/api/cookies', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          showToast('Arquivo cookies.txt instalado com sucesso!', 'success');
          checkCookiesStatus();
        } else {
          showToast(data.error || 'Erro ao enviar arquivo de cookies', 'error');
        }
      } catch (err) {
        showToast('Falha no upload do cookies.txt', 'error');
      }
    });
  }

  const elBtnGenCookies = document.getElementById('btn-generate-cookies');
  const elSpinnerGenCookies = document.getElementById('spinner-generate-cookies');
  if (elBtnGenCookies) {
    elBtnGenCookies.addEventListener('click', async () => {
      try {
        elBtnGenCookies.disabled = true;
        if (elSpinnerGenCookies) elSpinnerGenCookies.classList.remove('hidden');
        showToast('Gerando cookies sintéticos e tokens de visitante na VPS...', 'info');

        const res = await fetch('/api/cookies/generate', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Cookies sintéticos ativados com sucesso na VPS!', 'success');
          checkCookiesStatus();
        } else {
          showToast(data.error || 'Erro ao gerar cookies sintéticos', 'error');
        }
      } catch (err) {
        showToast('Falha ao acionar gerador de cookies', 'error');
      } finally {
        elBtnGenCookies.disabled = false;
        if (elSpinnerGenCookies) elSpinnerGenCookies.classList.add('hidden');
      }
    });
  }

  // Drawer de logs
  elBtnOpenLogs.addEventListener('click', () => elDrawerLogs.classList.remove('hidden'));
  elBtnCloseLogs.addEventListener('click', () => elDrawerLogs.classList.add('hidden'));
  elBtnClearTerminal.addEventListener('click', () => {
    elTerminalBody.innerHTML = '';
  });

  // Inicializa gerenciamento de Upload Manual de Vídeo
  setupManualVideoUpload();
}

function setupManualVideoUpload() {
  const elTabBtnYoutube = document.getElementById('tab-btn-youtube');
  const elTabBtnUpload = document.getElementById('tab-btn-upload');
  const elTabContentYoutube = document.getElementById('tab-content-youtube');
  const elTabContentUpload = document.getElementById('tab-content-upload');

  // Alternância de abas
  if (elTabBtnYoutube && elTabBtnUpload) {
    elTabBtnYoutube.addEventListener('click', () => {
      elTabBtnYoutube.classList.add('active');
      elTabBtnUpload.classList.remove('active');
      if (elTabContentYoutube) elTabContentYoutube.classList.remove('hidden');
      if (elTabContentUpload) elTabContentUpload.classList.add('hidden');
    });

    elTabBtnUpload.addEventListener('click', () => {
      elTabBtnUpload.classList.add('active');
      elTabBtnYoutube.classList.remove('active');
      if (elTabContentUpload) elTabContentUpload.classList.remove('hidden');
      if (elTabContentYoutube) elTabContentYoutube.classList.add('hidden');
    });
  }

  // Elementos do Upload Manual
  const elFormUploadVideo = document.getElementById('form-upload-video');
  const elVideoDropzone = document.getElementById('video-dropzone');
  const elInputVideoFile = document.getElementById('input-video-file');
  const elDropzonePrompt = document.getElementById('dropzone-prompt');
  const elDropzoneSelectedFile = document.getElementById('dropzone-selected-file');
  const elSelectedFileName = document.getElementById('selected-file-name');
  const elSelectedFileSize = document.getElementById('selected-file-size');
  const elBtnClearVideoFile = document.getElementById('btn-clear-video-file');

  const elInputManualTitle = document.getElementById('input-manual-title');
  const elInputManualLiveTitle = document.getElementById('input-manual-live-title');
  const elInputManualThumbFile = document.getElementById('input-manual-thumb-file');
  const elBtnTriggerManualThumb = document.getElementById('btn-trigger-manual-thumb');
  const elManualThumbName = document.getElementById('manual-thumb-name');

  const elUploadProgressBox = document.getElementById('upload-video-progress-box');
  const elUploadProgressBar = document.getElementById('upload-progress-bar');
  const elUploadProgressPercent = document.getElementById('upload-progress-percent');
  const elUploadProgressSpeed = document.getElementById('upload-progress-speed');
  const elBtnSubmitUploadVideo = document.getElementById('btn-submit-upload-video');
  const elSpinnerUploadVideo = document.getElementById('spinner-upload-video');

  let selectedVideoFile = null;
  let selectedThumbFile = null;

  if (elVideoDropzone && elInputVideoFile) {
    elVideoDropzone.addEventListener('click', (e) => {
      if (e.target !== elBtnClearVideoFile && !elBtnClearVideoFile.contains(e.target)) {
        elInputVideoFile.click();
      }
    });

    elVideoDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      elVideoDropzone.classList.add('dragover');
    });

    elVideoDropzone.addEventListener('dragleave', () => {
      elVideoDropzone.classList.remove('dragover');
    });

    elVideoDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      elVideoDropzone.classList.remove('dragover');
      const file = e.dataTransfer.files?.[0];
      if (file) handleVideoFileSelected(file);
    });

    elInputVideoFile.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleVideoFileSelected(file);
    });
  }

  function handleVideoFileSelected(file) {
    selectedVideoFile = file;
    const mbSize = (file.size / 1024 / 1024).toFixed(1);
    if (elSelectedFileName) elSelectedFileName.textContent = file.name;
    if (elSelectedFileSize) elSelectedFileSize.textContent = `${mbSize} MB`;

    if (elDropzonePrompt) elDropzonePrompt.classList.add('hidden');
    if (elDropzoneSelectedFile) elDropzoneSelectedFile.classList.remove('hidden');

    // Preenche títulos sugeridos a partir do nome do arquivo
    const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    if (elInputManualTitle && !elInputManualTitle.value.trim()) {
      elInputManualTitle.value = cleanName;
    }
    if (elInputManualLiveTitle && !elInputManualLiveTitle.value.trim()) {
      elInputManualLiveTitle.value = `TV BRAZA AO VIVO: ${cleanName}`;
    }
  }

  if (elBtnClearVideoFile) {
    elBtnClearVideoFile.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedVideoFile = null;
      if (elInputVideoFile) elInputVideoFile.value = '';
      if (elDropzonePrompt) elDropzonePrompt.classList.remove('hidden');
      if (elDropzoneSelectedFile) elDropzoneSelectedFile.classList.add('hidden');
    });
  }

  if (elBtnTriggerManualThumb && elInputManualThumbFile) {
    elBtnTriggerManualThumb.addEventListener('click', () => {
      elInputManualThumbFile.click();
    });

    elInputManualThumbFile.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        selectedThumbFile = file;
        if (elManualThumbName) elManualThumbName.textContent = file.name;
      }
    });
  }

  // Envio do formulário de upload manual com barra de progresso em tempo real
  if (elFormUploadVideo) {
    elFormUploadVideo.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!selectedVideoFile) {
        showToast('Selecione ou arraste um arquivo de vídeo primeiro!', 'warning');
        return;
      }

      const title = elInputManualTitle ? elInputManualTitle.value.trim() : '';
      const liveTitle = elInputManualLiveTitle ? elInputManualLiveTitle.value.trim() : '';

      if (elBtnSubmitUploadVideo) elBtnSubmitUploadVideo.disabled = true;
      if (elSpinnerUploadVideo) elSpinnerUploadVideo.classList.remove('hidden');
      if (elUploadProgressBox) elUploadProgressBox.classList.remove('hidden');
      if (elUploadProgressBar) elUploadProgressBar.style.width = '0%';
      if (elUploadProgressPercent) elUploadProgressPercent.textContent = '0%';

      let customThumbPath = null;
      let customThumbUrl = null;

      // 1. Se o usuário escolheu uma capa personalizada, envia ela primeiro
      if (selectedThumbFile) {
        try {
          const thumbRes = await uploadThumbFile(selectedThumbFile);
          if (thumbRes.success) {
            customThumbPath = thumbRes.thumbPath;
            customThumbUrl = thumbRes.thumbUrl;
          }
        } catch (_) {}
      }

      // 2. Upload do arquivo de vídeo com acompanhamento de progresso real via XHR
      const formData = new FormData();
      formData.append('video', selectedVideoFile);
      formData.append('title', title);
      formData.append('liveTitle', liveTitle);
      if (customThumbPath) formData.append('customThumbPath', customThumbPath);
      if (customThumbUrl) formData.append('customThumbUrl', customThumbUrl);

      const xhr = new XMLHttpRequest();
      let startTime = Date.now();
      let lastLoaded = 0;
      let lastTime = startTime;

      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) {
          const percent = ((ev.loaded / ev.total) * 100).toFixed(1);
          if (elUploadProgressBar) elUploadProgressBar.style.width = `${percent}%`;
          if (elUploadProgressPercent) elUploadProgressPercent.textContent = `${percent}%`;

          const now = Date.now();
          if (now - lastTime >= 500) {
            const timeDiff = (now - lastTime) / 1000;
            const bytesDiff = ev.loaded - lastLoaded;
            const speedMb = (bytesDiff / timeDiff / 1024 / 1024).toFixed(1);
            const loadedMb = (ev.loaded / 1024 / 1024).toFixed(1);
            const totalMb = (ev.total / 1024 / 1024).toFixed(1);

            if (elUploadProgressSpeed) {
              elUploadProgressSpeed.textContent = `Enviando a ${speedMb} MB/s (${loadedMb} / ${totalMb} MB)`;
            }
            lastTime = now;
            lastLoaded = ev.loaded;
          }
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success) {
              showToast(data.message || 'Vídeo enviado e adicionado à grade com sucesso!', 'success');
              // Limpa formulário
              selectedVideoFile = null;
              selectedThumbFile = null;
              if (elInputVideoFile) elInputVideoFile.value = '';
              if (elInputManualThumbFile) elInputManualThumbFile.value = '';
              if (elInputManualTitle) elInputManualTitle.value = '';
              if (elInputManualLiveTitle) elInputManualLiveTitle.value = '';
              if (elManualThumbName) elManualThumbName.textContent = 'Nenhuma capa selecionada';
              if (elDropzonePrompt) elDropzonePrompt.classList.remove('hidden');
              if (elDropzoneSelectedFile) elDropzoneSelectedFile.classList.add('hidden');

              fetchQueue();
              fetchStatus();
            } else {
              showToast(data.error || 'Falha no upload do vídeo', 'error');
            }
          } catch (err) {
            showToast('Erro ao processar resposta do servidor', 'error');
          }
        } else {
          showToast(`Erro no envio do vídeo (status ${xhr.status})`, 'error');
        }

        resetUploadUi();
      });

      xhr.addEventListener('error', () => {
        showToast('Falha na conexão durante o upload do vídeo', 'error');
        resetUploadUi();
      });

      xhr.addEventListener('abort', () => {
        showToast('Upload de vídeo cancelado', 'warning');
        resetUploadUi();
      });

      xhr.open('POST', '/api/queue/upload');
      xhr.send(formData);

      function resetUploadUi() {
        if (elBtnSubmitUploadVideo) elBtnSubmitUploadVideo.disabled = false;
        if (elSpinnerUploadVideo) elSpinnerUploadVideo.classList.add('hidden');
        setTimeout(() => {
          if (elUploadProgressBox) elUploadProgressBox.classList.add('hidden');
        }, 3000);
      }
    });
  }
}

async function uploadThumbFile(file) {
  const formData = new FormData();
  formData.append('thumbnail', file);
  const res = await fetch('/api/upload-thumb', {
    method: 'POST',
    body: formData
  });
  return await res.json();
}

async function handleInspectUrl() {
  const url = elInputYtUrl.value.trim();
  if (!url) {
    showToast('Cole uma URL válida do YouTube!', 'warning');
    return;
  }

  elBtnInspectUrl.disabled = true;
  elSpinnerInspect.classList.remove('hidden');

  try {
    const res = await fetch('/api/queue/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (data.success && data.info) {
      pendingVideoPreview = {
        ...data.info,
        customThumbPath: null,
        customThumbUrl: null
      };

      elPreviewCardThumb.src = data.info.thumbnail;
      elPreviewCardTitle.textContent = data.info.title;
      elPreviewCardChannel.textContent = `Canal: ${data.info.channel}`;
      elPreviewCardDuration.textContent = `Duração: ${data.info.durationFormatted}`;
      
      // Preenche o campo de título da Live
      if (elInputLiveTitle) {
        elInputLiveTitle.value = data.info.suggestedLiveTitle || data.info.title;
      }
      if (elPreviewCustomThumbBadge) elPreviewCustomThumbBadge.classList.add('hidden');
      if (elBtnRemoveCustomThumb) elBtnRemoveCustomThumb.classList.add('hidden');
      if (elInputCustomThumb) elInputCustomThumb.value = '';

      elUrlPreviewCard.classList.remove('hidden');
    } else {
      showToast(data.error || 'Não foi possível obter dados do vídeo', 'error');
    }
  } catch (err) {
    showToast('Erro de comunicação ao consultar link', 'error');
  } finally {
    elBtnInspectUrl.disabled = false;
    elSpinnerInspect.classList.add('hidden');
  }
}

async function handleConfirmAdd() {
  if (!pendingVideoPreview) return;

  const streamModeEl = document.querySelector('input[name="playback-mode"]:checked');
  const streamMode = streamModeEl ? streamModeEl.value : 'direct';

  const payload = {
    ...pendingVideoPreview,
    streamMode,
    liveTitle: elInputLiveTitle ? elInputLiveTitle.value.trim() : pendingVideoPreview.title
  };

  try {
    const res = await fetch('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast(`"${data.item.liveTitle || data.item.title}" adicionado à grade [${streamMode === 'direct' ? '⚡ Stream Direto sem Anúncios' : '💾 Download'}]!`, 'success');
      elInputYtUrl.value = '';
      elUrlPreviewCard.classList.add('hidden');
      pendingVideoPreview = null;
      fetchQueue();
      fetchStatus();
    } else {
      showToast(data.error || 'Erro ao enfileirar vídeo', 'error');
    }
  } catch (err) {
    showToast('Erro ao salvar vídeo na grade', 'error');
  }
}

async function handleQuickAdd() {
  const url = elInputYtUrl.value.trim();
  if (!url) {
    showToast('Cole o link do YouTube primeiro!', 'warning');
    return;
  }

  const streamModeEl = document.querySelector('input[name="playback-mode"]:checked');
  const streamMode = streamModeEl ? streamModeEl.value : 'direct';

  const elBtnQuickAdd = document.getElementById('btn-quick-add');
  const elSpinnerQuickAdd = document.getElementById('spinner-quick-add');
  if (elBtnQuickAdd) elBtnQuickAdd.disabled = true;
  if (elSpinnerQuickAdd) elSpinnerQuickAdd.classList.remove('hidden');

  try {
    showToast(streamMode === 'direct' ? '⚡ Configurando Stream Direto sem anúncios estilo Brave...' : 'Consultando vídeo e iniciando download...', 'info');
    const res = await fetch('/api/queue/quick-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, streamMode })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`"${data.item.title}" pronto na grade [${streamMode === 'direct' ? '⚡ Stream Direto sem Anúncios' : '💾 Baixando'}]!`, 'success');
      elInputYtUrl.value = '';
      elUrlPreviewCard.classList.add('hidden');
      pendingVideoPreview = null;
      fetchQueue();
      fetchStatus();
    } else {
      showToast(data.error || 'Erro ao adicionar vídeo', 'error');
    }
  } catch (err) {
    showToast('Erro de comunicação ao adicionar vídeo', 'error');
  } finally {
    if (elBtnQuickAdd) elBtnQuickAdd.disabled = false;
    if (elSpinnerQuickAdd) elSpinnerQuickAdd.classList.add('hidden');
  }
}

window.retryQueueItem = async function(id) {
  try {
    showToast('Disparando download do vídeo na VPS...', 'info');
    const res = await fetch(`/api/queue/${id}/retry`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Download iniciado com sucesso!', 'success');
      fetchQueue();
      fetchStatus();
    } else {
      showToast(data.error || 'Erro ao reiniciar download', 'error');
    }
  } catch (err) {
    showToast('Erro ao reiniciar download', 'error');
  }
};

window.openEditItemModal = function(id) {
  const item = currentQueue.find(i => i.id === id);
  if (!item) return;

  elEditItemId.value = item.id;
  elEditLiveTitle.value = item.liveTitle || item.title;
  editingItemOriginalThumb = item.thumbnail || 'assets/logo.svg';
  editingItemCustomThumbPath = item.customThumbPath || null;
  editingItemCustomThumbUrl = item.customThumbUrl || null;
  elEditThumbImg.src = item.customThumbUrl || item.thumbnail || 'assets/logo.svg';
  if (elEditInputCustomThumb) elEditInputCustomThumb.value = '';

  elModalEditItem.classList.remove('hidden');
};

async function handleSaveEditedItem(e) {
  e.preventDefault();
  const id = elEditItemId.value;
  if (!id) return;

  const updates = {
    liveTitle: elEditLiveTitle.value.trim(),
    customThumbPath: editingItemCustomThumbPath,
    customThumbUrl: editingItemCustomThumbUrl
  };

  try {
    const res = await fetch(`/api/queue/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Programação atualizada com sucesso!', 'success');
      elModalEditItem.classList.add('hidden');
      fetchQueue();
      fetchStatus();
    } else {
      showToast(data.error || 'Erro ao atualizar programação', 'error');
    }
  } catch (err) {
    showToast('Erro ao salvar edição', 'error');
  }
}

window.deleteQueueItem = async function(id) {
  try {
    await fetch(`/api/queue/${id}`, { method: 'DELETE' });
    showToast('Vídeo removido da programação.', 'info');
    fetchQueue();
    fetchStatus();
  } catch (err) {
    showToast('Erro ao remover vídeo', 'error');
  }
};

window.moveQueueItem = async function(id, direction) {
  const ids = currentQueue.map(i => i.id);
  const idx = ids.indexOf(id);
  if (idx === -1) return;

  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= ids.length) return;

  const temp = ids[idx];
  ids[idx] = ids[targetIdx];
  ids[targetIdx] = temp;

  try {
    await fetch('/api/queue/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids })
    });
    fetchQueue();
    fetchStatus();
  } catch (err) {
    showToast('Erro ao reordenar grade', 'error');
  }
};

// Cookies do YouTube
const elCookiesStatusBadge = document.getElementById('cookies-status-badge');
const elBtnDeleteCookies = document.getElementById('btn-delete-cookies');
const elCfgCookiesText = document.getElementById('cfg-cookies-text');
const elBtnSaveCookies = document.getElementById('btn-save-cookies');

async function checkCookiesStatus() {
  if (!elCookiesStatusBadge) return;
  try {
    const res = await fetch('/api/cookies');
    const data = await res.json();
    if (data.exists) {
      elCookiesStatusBadge.className = 'badge-status ready';
      elCookiesStatusBadge.textContent = `✓ Cookies Ativos (${(data.size / 1024).toFixed(1)} KB)`;
      if (elBtnDeleteCookies) elBtnDeleteCookies.classList.remove('hidden');
    } else {
      elCookiesStatusBadge.className = 'badge-status';
      elCookiesStatusBadge.textContent = 'Cliente Android Ativo (Sem cookies)';
      if (elBtnDeleteCookies) elBtnDeleteCookies.classList.add('hidden');
    }
  } catch (_) {}
}

// ============================================================
// CONFIGURAÇÕES
// ============================================================
async function openSettingsModal() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success) {
      const s = data.settings;
      elCfgStreamKey.value = s.youtubeStreamKey || '';
      elCfgRtmpUrl.value = s.youtubeRtmpUrl || 'rtmp://a.rtmp.youtube.com/live2';
      elCfgResolution.value = s.resolution || '1080p';
      elCfgBitrate.value = s.videoBitrate || '4500k';
      elCfgWatermark.checked = s.enableWatermark !== false;
      elCfgAutoDelete.checked = s.autoDeleteFinished !== false;
      elCfgAutoStandby.checked = s.autoLoopStandby !== false;

      // Watermark text personalizado
      if (elCfgWatermarkText) {
        const rawText = s.watermarkText || 'TV BRAZA';
        // Remove o sufixo "- AO VIVO" se existir, mostrando só o label principal
        elCfgWatermarkText.value = rawText.replace(/\s*[-|]\s*AO VIVO\s*$/i, '');
      }
      // Mostra/oculta painel de customização conforme o estado do checkbox
      if (elWatermarkCustomPanel) {
        elWatermarkCustomPanel.style.display = elCfgWatermark.checked ? 'block' : 'none';
      }
      // Atualiza preview da logo
      if (elWatermarkLogoPreview) {
        elWatermarkLogoPreview.src = '/api/watermark/logo?t=' + Date.now();
        elWatermarkLogoPreview.style.display = '';
      }

      // Configuração do Banner "A SEGUIR"
      if (elCfgEnableScheduleOverlay) elCfgEnableScheduleOverlay.checked = s.enableScheduleOverlay !== false;
      if (elCfgScheduleInterval) elCfgScheduleInterval.value = s.scheduleOverlayInterval || 5;
      if (elCfgScheduleDuration) elCfgScheduleDuration.value = s.scheduleOverlayDuration || 12;

      // Configurações do YouTube Live Metadata
      if (elCfgBroadcastVideoId) elCfgBroadcastVideoId.value = s.youtubeBroadcastVideoId || '';
      if (elCfgTitlePrefix) elCfgTitlePrefix.value = s.defaultLiveTitlePrefix || '';
      if (elCfgGoogleClientId) elCfgGoogleClientId.value = s.googleClientId || '';
      if (elCfgGoogleClientSecret) elCfgGoogleClientSecret.value = s.googleClientSecret || '';
      if (elCfgGoogleRefreshToken) elCfgGoogleRefreshToken.value = s.googleRefreshToken || '';

      checkCookiesStatus();
      elModalSettings.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Erro ao carregar configurações', 'error');
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const updates = {
    youtubeStreamKey: elCfgStreamKey.value.trim(),
    youtubeRtmpUrl: elCfgRtmpUrl.value.trim(),
    resolution: elCfgResolution.value,
    videoBitrate: elCfgBitrate.value,
    enableWatermark: elCfgWatermark.checked,
    watermarkText: elCfgWatermarkText ? elCfgWatermarkText.value.trim() || 'TV BRAZA' : 'TV BRAZA',
    autoDeleteFinished: elCfgAutoDelete.checked,
    autoLoopStandby: elCfgAutoStandby.checked,
    enableScheduleOverlay: elCfgEnableScheduleOverlay ? elCfgEnableScheduleOverlay.checked : true,
    scheduleOverlayInterval: elCfgScheduleInterval ? Number(elCfgScheduleInterval.value) || 5 : 5,
    scheduleOverlayDuration: elCfgScheduleDuration ? Number(elCfgScheduleDuration.value) || 12 : 12,
    youtubeBroadcastVideoId: elCfgBroadcastVideoId ? elCfgBroadcastVideoId.value.trim() : '',
    defaultLiveTitlePrefix: elCfgTitlePrefix ? elCfgTitlePrefix.value : '',
    googleClientId: elCfgGoogleClientId ? elCfgGoogleClientId.value.trim() : '',
    googleClientSecret: elCfgGoogleClientSecret ? elCfgGoogleClientSecret.value.trim() : '',
    googleRefreshToken: elCfgGoogleRefreshToken ? elCfgGoogleRefreshToken.value.trim() : ''
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Configurações salvas com sucesso!', 'success');
      elModalSettings.classList.add('hidden');
      fetchStatus();
    }
  } catch (err) {
    showToast('Erro ao salvar configurações', 'error');
  }
}

// Botão de Detecção Automática da Live Ativa no YouTube
if (elBtnDetectLive) {
  elBtnDetectLive.addEventListener('click', async () => {
    if (elSpinnerDetectLive) elSpinnerDetectLive.classList.remove('hidden');
    elBtnDetectLive.disabled = true;
    try {
      showToast('Buscando transmissão ao vivo ativa no seu canal...', 'info');
      const res = await fetch('/api/settings/detect-live', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.broadcast) {
        if (elCfgBroadcastVideoId) {
          elCfgBroadcastVideoId.value = data.broadcast.id;
        }
        showToast(`Live detectada: "${data.broadcast.title}" (${data.broadcast.id})`, 'success');
      } else {
        showToast(data.error || 'Nenhuma live ativa encontrada no canal.', 'warning');
      }
    } catch (err) {
      showToast('Erro ao detectar live: ' + err.message, 'error');
    } finally {
      if (elSpinnerDetectLive) elSpinnerDetectLive.classList.add('hidden');
      elBtnDetectLive.disabled = false;
    }
  });
}

// ============================================================
// WATERMARK: Toggle painel, Upload de Logo, Reset Logo
// ============================================================
if (elCfgWatermark && elWatermarkCustomPanel) {
  elCfgWatermark.addEventListener('change', () => {
    elWatermarkCustomPanel.style.display = elCfgWatermark.checked ? 'block' : 'none';
  });
}

if (elInputWatermarkLogo) {
  elInputWatermarkLogo.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    try {
      showToast('Enviando nova logo...', 'info');
      const res = await fetch('/api/watermark/logo', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        showToast('Logo atualizada com sucesso! Será aplicada no próximo segmento.', 'success');
        if (elWatermarkLogoPreview) {
          elWatermarkLogoPreview.src = '/api/watermark/logo?t=' + Date.now();
          elWatermarkLogoPreview.style.display = '';
        }
      } else {
        showToast(data.error || 'Erro ao enviar logo', 'error');
      }
    } catch (err) {
      showToast('Erro ao enviar logo: ' + err.message, 'error');
    }
    // Limpa input para permitir re-upload do mesmo arquivo
    e.target.value = '';
  });
}

if (elBtnResetLogo) {
  elBtnResetLogo.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/watermark/logo', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Logo restaurada para o padrão!', 'success');
        if (elWatermarkLogoPreview) {
          elWatermarkLogoPreview.src = '/api/watermark/logo?t=' + Date.now();
          elWatermarkLogoPreview.style.display = '';
        }
      } else {
        showToast(data.error || 'Erro ao restaurar logo', 'error');
      }
    } catch (err) {
      showToast('Erro ao restaurar logo: ' + err.message, 'error');
    }
  });
}

// ============================================================
// LOGS E TOASTS
// ============================================================
function logTerminal(level, text) {
  const line = document.createElement('div');
  line.className = `term-line ${level}`;
  const time = new Date().toLocaleTimeString('pt-BR');
  line.textContent = `[${time}] ${text}`;
  elTerminalBody.appendChild(line);
  elTerminalBody.scrollTop = elTerminalBody.scrollHeight;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elToastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function formatTime(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds)) return '00:00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
