import test from 'node:test';
import assert from 'node:assert';
import { streamer } from '../src/engine/streamer.js';
import { db } from '../src/db.js';

test('Multi-Stream: getStreamTargets retorna apenas YouTube quando Twitch estiver desativada', () => {
  db.updateSettings({
    youtubeStreamKey: 'yt-test-key-123',
    youtubeRtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    enableTwitchStream: false,
    twitchStreamKey: ''
  });

  const targets = streamer.getStreamTargets();
  assert.strictEqual(targets.length, 1);
  assert.strictEqual(targets[0].name, 'YouTube');
  assert.ok(targets[0].url.includes('yt-test-key-123'));
});

test('Multi-Stream: getStreamTargets retorna YouTube e Twitch simultaneamente quando ativado', () => {
  db.updateSettings({
    youtubeStreamKey: 'yt-test-key-123',
    youtubeRtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    enableTwitchStream: true,
    twitchRtmpUrl: 'rtmp://sao01.contribute.live-video.net/app/',
    twitchStreamKey: 'live_test_twitch_456'
  });

  const targets = streamer.getStreamTargets();
  assert.strictEqual(targets.length, 2);
  assert.strictEqual(targets[0].name, 'YouTube');
  assert.strictEqual(targets[1].name, 'Twitch');
  assert.ok(targets[1].url.includes('live_test_twitch_456'));
});

test('Multi-Stream: appendRtmpOutputs duplica fluxo codificado via tee muxer com ZERO re-encoding', () => {
  db.updateSettings({
    youtubeStreamKey: 'yt-key',
    enableTwitchStream: true,
    twitchRtmpUrl: 'rtmp://live.twitch.tv/app/',
    twitchStreamKey: 'twitch-key'
  });

  const args = ['-i', 'input.mp4', '-c:v', 'libx264', '-c:a', 'aac'];
  const targets = streamer.appendRtmpOutputs(args);

  assert.strictEqual(targets.length, 2);
  assert.ok(args.includes('-flags'), 'Deve incluir -flags');
  assert.ok(args.includes('+global_header'), 'Deve incluir +global_header');
  assert.ok(args.includes('tee'), 'Deve usar o muxer tee para duplicar stream sem re-encoding');
  assert.ok(args.includes('-map'), 'Deve incluir mapeamento explícito de streams (-map) para o tee');
  
  const teeOutputArg = args.find(a => typeof a === 'string' && a.includes('[f=flv:onfail=ignore:flvflags=no_duration_filesize]'));
  assert.ok(teeOutputArg, 'Deve conter a string do muxer tee com flvflags=no_duration_filesize');
  assert.ok(teeOutputArg.includes('rtmp://a.rtmp.youtube.com/live2/yt-key'), 'Deve conter destino YouTube no tee');
  assert.ok(teeOutputArg.includes('rtmp://live.twitch.tv/app/twitch-key'), 'Deve conter destino Twitch no tee');
});

test('Multi-Stream: getEffectiveBitrate limita a 4500k quando interface Twitch estiver ativa', () => {
  // Apenas YouTube: aceita bitrate customizado mais alto
  db.updateSettings({
    youtubeStreamKey: 'yt-key',
    enableTwitchStream: false,
    twitchStreamKey: '',
    videoBitrate: '6800k'
  });
  let effective = streamer.getEffectiveBitrate(db.getSettings());
  assert.strictEqual(effective.videoBitrate, '6800k');

  // Com Twitch conectada: força teto seguro de 4500k para não violar limite de 6000k da Twitch
  db.updateSettings({
    youtubeStreamKey: 'yt-key',
    enableTwitchStream: true,
    twitchStreamKey: 'twitch-key',
    videoBitrate: '6800k'
  });
  effective = streamer.getEffectiveBitrate(db.getSettings());
  assert.strictEqual(effective.videoBitrate, '4500k');
  assert.strictEqual(effective.numericBitrate, 4500);
});
