import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.resolve(__dirname, '../../proto/playout.proto');
const GRPC_TARGET = process.env.GRPC_ENGINE_HOST || '127.0.0.1:50051';

let client = null;
let isConnected = false;
let metricsStream = null;
let engineProcess = null;

/**
 * Procura e inicia o binário C++ tvbraza-engine caso esteja presente no sistema.
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
    console.log(`[C++ Engine Spawner] Inicializando motor nativo em: ${binPath}`);
    engineProcess = spawn(binPath, [GRPC_TARGET], {
      stdio: ['ignore', 'inherit', 'inherit']
    });

    engineProcess.on('exit', (code, sig) => {
      console.warn(`[C++ Engine Spawner] Processo C++ encerrou (código: ${code}, sinal: ${sig})`);
      engineProcess = null;
      isConnected = false;
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

/**
 * Inicializa e carrega a definição do Protobuf para o cliente gRPC.
 */
function getClient() {
  if (client) return client;

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

    client = new PlayoutEngine(
      GRPC_TARGET,
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
 */
export async function checkCppEngineHealth() {
  ensureCppEngineRunning();
  const c = getClient();
  if (!c) return { ok: false, message: 'gRPC client não inicializado' };

  return new Promise((resolve) => {
    const deadline = new Date(Date.now() + 2000); // 2s timeout
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
          cpuUsagePercent: response.cpu_usage_percent
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
