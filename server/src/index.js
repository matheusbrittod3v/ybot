import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import { streamer } from './engine/streamer.js';
import { downloader } from './engine/downloader.js';
import { getSystemStats } from './utils/system.js';
import { db } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', apiRouter);

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// WebSocket broadcast helper
function broadcastWs(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.error('[WS] Erro ao enviar mensagem:', err.message);
      }
    }
  }
}

// Conectar eventos do Downloader e do Streamer ao WebSocket
downloader.onEvent((event, payload) => {
  broadcastWs(event, payload);
});

streamer.onEvent((event, payload) => {
  broadcastWs(event, payload);
});

wss.on('connection', (ws) => {
  // Envia estado inicial ao cliente que acabou de conectar
  const playout = db.getPlayoutState();
  const queue = db.getQueue();
  const system = getSystemStats();

  ws.send(JSON.stringify({
    type: 'init_state',
    data: {
      playout,
      queue,
      system
    }
  }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (_) {}
  });
});

// Envio periódico de telemetria da VPS e da transmissão (a cada 3s)
setInterval(() => {
  if (wss.clients.size > 0) {
    const system = getSystemStats();
    const playout = db.getPlayoutState();
    broadcastWs('telemetry', { system, playout });
  }
}, 3000);

// Inicialização do servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  TV BRAZA - STUDIO DE TRANSMISSAO 24/7 (YOUTUBE)   `);
  console.log(`====================================================`);
  console.log(`Painel Administrativo: http://0.0.0.0:${PORT}`);
  console.log(`Porta configurada:     ${PORT}`);
  console.log(`Ambiente:              ${process.env.NODE_ENV || 'development'}`);
  console.log(`====================================================`);

  // Inicia automaticamente o Playout se auto-start habilitado
  const settings = db.getSettings();
  if (settings.autoLoopStandby) {
    console.log('[Autostart] Inicializando motor de transmissão contínua...');
    streamer.start();
  }
});

// Finalização graciosa
function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] Recebido sinal ${signal}. Encerrando processos com segurança...`);
  streamer.stop();
  downloader.cancelActiveDownload();
  server.close(() => {
    console.log('[Shutdown] Servidor finalizado.');
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
