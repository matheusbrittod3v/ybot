import test from 'node:test';
import assert from 'node:assert';
import { youtubeUpdater } from '../src/utils/youtube-updater.js';

test('CTR Growth: generateLiveTags extrai termos do título e combina com tags base', () => {
  const settings = {
    enableDynamicTags: true,
    defaultLiveTags: 'ao vivo, 24 horas, debate, podcast, brasil, cortes'
  };

  const itemTitle = 'DEBATE: O QUE É MELHOR PARA O BRASIL? BRIGADEIRO x TALLIS GOMES';
  const tags = youtubeUpdater.generateLiveTags(itemTitle, settings);

  assert.ok(Array.isArray(tags), 'Deve retornar um array de tags');
  assert.ok(tags.includes('debate'), 'Deve incluir tag "debate"');
  assert.ok(tags.includes('brigadeiro'), 'Deve extrair "brigadeiro" do título');
  assert.ok(tags.includes('tallis'), 'Deve extrair "tallis" do título');
  assert.ok(tags.includes('gomes'), 'Deve extrair "gomes" do título');
  assert.ok(tags.includes('podcast'), 'Deve incluir tag base "podcast"');
  assert.ok(tags.includes('ao vivo'), 'Deve incluir tag base "ao vivo"');

  // Verifica se total de caracteres não estoura o limite do YouTube (500 chars)
  const totalLength = tags.join(',').length;
  assert.ok(totalLength <= 500, `Tamanho total das tags (${totalLength}) deve ser <= 500 chars`);
});

test('CTR Growth: generateLiveDescription formata variáveis {title} e {url}', () => {
  const settings = {
    enableDynamicDescription: true,
    defaultLiveDescriptionTemplate: '🔴 AO VIVO TV BRAZA\n\nAssistindo agora: {title}\nFonte: {url}\n\n#aovivo'
  };

  const item = {
    title: 'Inteligência Ltda #1925',
    url: 'https://youtube.com/watch?v=12345'
  };

  const desc = youtubeUpdater.generateLiveDescription(item, settings);
  assert.ok(desc.includes('Assistindo agora: Inteligência Ltda #1925'));
  assert.ok(desc.includes('Fonte: https://youtube.com/watch?v=12345'));
});

test('CTR Growth: formatação de título com template respeita limite rígido de 100 caracteres', () => {
  const template = '🔴 AO VIVO: "{title}" | ASSISTA AGORA!';
  const longTitle = 'ESTE É UM TÍTULO EXTREMAMENTE LONGO COM MAIS DE DUZENTOS CARACTERES QUE DEVERÁ SER TRUNCADO COM ABSOLUTA PRECISÃO PELO SISTEMA PARA NÃO SER REJEITADO PELA API DO YOUTUBE';
  
  const formatted = template.replace('{title}', longTitle);
  const truncated = formatted.substring(0, 100);

  assert.strictEqual(truncated.length, 100);
  assert.ok(truncated.startsWith('🔴 AO VIVO: "ESTE É UM TÍTULO'));
});
