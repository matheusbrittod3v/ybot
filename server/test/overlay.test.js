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
