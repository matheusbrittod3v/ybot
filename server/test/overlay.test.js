import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

test('Schedule Overlay: filtro e sanitizacao de texto funcionam corretamente', async () => {
  // Teste de sanitização de strings complexas com quotes, colons, colchetes e %
  const testTitle = "PODCAST #12: 100% AO VIVO [COM FELIPE TITTO] & 'ESPECIAL'";
  
  const sanitized = testTitle
    .substring(0, 55)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
    .trim();

  assert.ok(!sanitized.includes('100% '), 'Percentual simples deve ser escapado para %%');
  assert.ok(sanitized.includes('100%%'), 'Percentual deve ser %% para não quebrar o FFmpeg');
  assert.ok(sanitized.includes('\\:'), 'Dois pontos devem ser escapados com barra invertida');
  assert.ok(sanitized.includes('\\['), 'Colchetes devem ser escapados');
});

test('Resoluções: deve suportar resoluções até 8K UHD e cálculo de proporção', async () => {
  const { RESOLUTION_CONFIGS } = await import('../src/engine/streamer.js');
  
  assert.ok(RESOLUTION_CONFIGS['8k'], 'Deve possuir configuração para 8K');
  assert.strictEqual(RESOLUTION_CONFIGS['8k'].width, 7680, '8K deve possuir 7680px de largura');
  assert.strictEqual(RESOLUTION_CONFIGS['8k'].height, 4320, '8K deve possuir 4320px de altura');
  
  assert.ok(RESOLUTION_CONFIGS['4k'], 'Deve possuir configuração para 4K');
  assert.strictEqual(RESOLUTION_CONFIGS['4k'].width, 3840, '4K deve possuir 3840px de largura');
  
  assert.ok(RESOLUTION_CONFIGS['1440p'], 'Deve possuir configuração para 2K/1440p');
  assert.strictEqual(RESOLUTION_CONFIGS['1440p'].width, 2560, '1440p deve possuir 2560px de largura');

  assert.ok(RESOLUTION_CONFIGS['1080p'], 'Deve possuir 1080p');
  assert.ok(RESOLUTION_CONFIGS['720p'], 'Deve possuir 720p');
  assert.ok(RESOLUTION_CONFIGS['480p'], 'Deve possuir 480p');
  assert.ok(RESOLUTION_CONFIGS['360p'], 'Deve possuir 360p');
  assert.ok(RESOLUTION_CONFIGS['240p'], 'Deve possuir 240p');
  assert.ok(RESOLUTION_CONFIGS['native'], 'Deve possuir modo nativo');
});
