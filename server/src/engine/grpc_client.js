import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.resolve(__dirname, '../../proto/playout.proto');

function getCandidateTargets() {
  const list = [];
  if (process.env.GRPC_ENGINE_HOST) {
    list.push(process.env.GRPC_ENGINE_HOST);
  }
  const hostname = process.env.HOSTNAME || os.hostname();
  if (hostname && hostname !== 'localhost') {
    list.push(`${hostname}:50051`);
  }
  list.push('127.0.0.1:50051');
  list.push('localhost:50051');
  return [...new Set(list)];
}

let activeTarget = getCandidateTargets()[0] || '127.0.0.1:50051';
let client = null;
let isConnected = false;
let metricsStream = null;
let engineProcess = null;

/**
 * Procura e inicia o binário C++ tvbraza-engine escutando em 0.0.0.0:50051
 * para aceitar chamadas tanto locais quanto pelo hostname do container.
 */
export function ensureCppEngineRunning() {
  if (engineProcess) return;

  const possibleBins = [
    '/usr/local/bin/tvbraza-engine',
    path.resolve(__dirname, '../../cpp-engine/build/tvbraza-engine'),
    path.resolve(__dirname, '../../../build/tvbraza-engine')
  ];

  const binPath = possibleBins.find(p => fs.existsSync(p));
  if (!binPath) {
    return;
  }

  try {
    console.log(`[C++ Engine Spawner] Inicializando motor nativo em: ${binPath} (escutando em 0.0.0.0:50051)`);
    engineProcess = spawn(binPath, ['0.0.0.0:50051'], {
      stdio: ['ignore', 'inherit', 'inherit']
    });

    engineProcess.on('exit', (code, sig) => {
      console.warn(`[C++ Engine Spawner] Processo C++ encerrou (código: ${code}, sinal: ${sig})`);
      engineProcess = null;
      isConnected = false;
      client = null;
    });

    process.on('exit', () => {
      if (engineProcess) {
        try { engineProcess.kill('SIGTERM'); } catch (_) {}
      }
    });
  } catch (err) {
    console.warn('[C++ Engine Spawner] Falha ao disparar binário nativo:', err.message);
  }
}

function isPortOpen(host, port, timeoutMs = 150) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Inicializa e carrega a definição do Protobuf para o cliente gRPC.
 */
function getClient(target = activeTarget) {
  if (client && activeTarget === target) return client;

  try {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const PlayoutEngine = protoDescriptor.tvbraza.playout.PlayoutEngine;

    activeTarget = target;
    client = new PlayoutEngine(
      target,
      grpc.credentials.createInsecure(),
      {
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.max_receive_message_length': 16 * 1024 * 1024
      }
    );

    return client;
  } catch (err) {
    console.warn('[gRPC Client] Erro ao carregar proto definition:', err.message);
    return null;
  }
}

/**
 * Health check assíncrono para verificar se o motor nativo C++ está ativo.
 * Testa tanto o hostname interno do container quanto 127.0.0.1.
 */
export async function checkCppEngineHealth() {
  ensureCppEngineRunning();

  const candidates = getCandidateTargets();
  let workingTarget = null;

  for (const target of candidates) {
    const [host, portStr] = target.split(':');
    const port = parseInt(portStr || '50051', 10);
    const open = await isPortOpen(host, port, 120);
    if (open) {
      workingTarget = target;
      break;
    }
  }

  if (!workingTarget) {
    isConnected = false;
    return { ok: false, message: 'Porta do motor C++ inacessível nos hosts candidatos (modo integrado padrão ativo)' };
  }

  const c = getClient(workingTarget);
  if (!c) return { ok: false, message: 'gRPC client não inicializado' };

  return new Promise((resolve) => {
    const deadline = new Date(Date.now() + 600); // 600ms timeout
    c.GetHealth({}, { deadline }, (err, response) => {
      if (err) {
        isConnected = false;
        resolve({ ok: false, error: err.message });
      } else {
        isConnected = true;
        resolve({
          ok: response.ok,
          version: response.version,
          engineType: response.engine_type,
          memoryRssKb: response.memory_rss_kb,
          cpuUsagePercent: response.cpu_usage_percent,
          target: workingTarget
        });
      }
    });
  });
}

export function isCppEngineAvailable() {
  return isConnected;
}

/**
 * Dispara requisição de início de transmissão para o motor C++.
 */
export async function startStreamViaGrpc({ sourceUrl, rtmpUrl, streamKey, videoTitle, directStream, startPosition = 0 }) {
  const c = getClient();
  if (!c) throw new Error('Cliente gRPC indisponível');

  return new Promise((resolve, reject) => {
    const payload = {
      source_url: sourceUrl,
      rtmp_url: rtmpUrl,
      stream_key: streamKey,
      video_title: videoTitle,
      direct_stream: Boolean(directStream),
      start_position: parseInt(startPosition, 10) || 0
    };

    c.StartStream(payload, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

/**
 * Alterna dinamicamente a fonte de vídeo (Seamless Switching).
 */
export async function switchSourceViaGrpc({ nextSourceUrl, videoTitle, startPosition = 0 }) {
  const c = getClient();
  if (!c) throw new Error('Cliente gRPC indisponível');

  return new Promise((resolve, reject) => {
    const payload = {
      next_source_url: nextSourceUrl,
      video_title: videoTitle,
      start_position: parseInt(startPosition, 10) || 0
    };

    c.SwitchSource(payload, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

/**
 * Aciona o modo de espera (Standby) nativo.
 */
export async function triggerStandbyViaGrpc(standbyFile, reason = 'Fim da fila') {
  const c = getClient();
  if (!c) throw new Error('Cliente gRPC indisponível');

  return new Promise((resolve, reject) => {
    c.TriggerStandby({ standby_file: standbyFile, reason }, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

/**
 * Interrompe o stream ativo no motor C++.
 */
export async function stopStreamViaGrpc(reason = 'Interrupção manual') {
  const c = getClient();
  if (!c) throw new Error('Cliente gRPC indisponível');

  return new Promise((resolve, reject) => {
    c.StopStream({ reason }, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

/**
 * Inscreve-se no stream contínuo de métricas nativas do C++.
 */
export function subscribeToNativeMetrics(onMetricCallback, intervalMs = 500) {
  const c = getClient();
  if (!c) return null;

  if (metricsStream) {
    try {
      metricsStream.cancel();
    } catch (_) {}
  }

  try {
    metricsStream = c.SubscribeMetrics({ interval_ms: intervalMs });

    metricsStream.on('data', (metric) => {
      isConnected = true;
      if (typeof onMetricCallback === 'function') {
        onMetricCallback(metric);
      }
    });

    metricsStream.on('error', (err) => {
      // Ignora cancelamentos intencionais
      if (err.code !== grpc.status.CANCELLED) {
        isConnected = false;
        console.warn('[gRPC Telemetria] Fluxo desconectado:', err.message);
      }
    });

    metricsStream.on('end', () => {
      isConnected = false;
    });

    return metricsStream;
  } catch (err) {
    console.warn('[gRPC Telemetria] Falha ao assinar métricas:', err.message);
    return null;
  }
}
