import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import protoLoader from '@grpc/proto-loader';
import grpc from '@grpc/grpc-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.resolve(__dirname, '../proto/playout.proto');

test('Protobuf: deve carregar a definição playout.proto com sucesso', () => {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });

  assert.ok(packageDef, 'packageDefinition deve existir');
  const proto = grpc.loadPackageDefinition(packageDef);
  assert.ok(proto.tvbraza, 'Namespace tvbraza deve existir');
  assert.ok(proto.tvbraza.playout, 'Namespace playout deve existir');
  assert.ok(proto.tvbraza.playout.PlayoutEngine, 'Service PlayoutEngine deve estar definido');
});

test('gRPC Client: métodos exportados devem existir e responder graciosamente se motor offline', async () => {
  const { checkCppEngineHealth, isCppEngineAvailable } = await import('../src/engine/grpc_client.js');
  
  assert.strictEqual(typeof checkCppEngineHealth, 'function');
  assert.strictEqual(typeof isCppEngineAvailable, 'function');
  
  // Como o daemon C++ ainda não está escutando na porta, deve retornar ok: false sem crash
  const health = await checkCppEngineHealth();
  assert.strictEqual(health.ok, false);
  assert.strictEqual(isCppEngineAvailable(), false);
});
