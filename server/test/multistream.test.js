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

test('Multi-Stream: appendRtmpOutputs duplica fluxo via stream copy (-c:v copy -c:a copy) com ZERO re-encoding', () => {
  db.updateSettings({
    youtubeStreamKey: 'yt-key',
    enableTwitchStream: true,
    twitchRtmpUrl: 'rtmp://live.twitch.tv/app/',
    twitchStreamKey: 'twitch-key'
  });

  const args = ['-i', 'input.mp4', '-c:v', 'libx264', '-c:a', 'aac'];
  const targets = streamer.appendRtmpOutputs(args);

  assert.strictEqual(targets.length, 2);
  // Primeiro destino usa saída FLV primária
  const ytIdx = args.indexOf('rtmp://a.rtmp.youtube.com/live2/yt-key');
  assert.ok(ytIdx !== -1, 'YouTube RTMP deve estar nos args');
  assert.strictEqual(args[ytIdx - 2], '-f');
  assert.strictEqual(args[ytIdx - 1], 'flv');

  // Segundo destino (Twitch) clona o bitstream sem re-codificar (Zero CPU extra)
  const twitchIdx = args.indexOf('rtmp://live.twitch.tv/app/twitch-key');
  assert.ok(twitchIdx !== -1, 'Twitch RTMP deve estar nos args');
  assert.strictEqual(args[twitchIdx - 6], '-c:v');
  assert.strictEqual(args[twitchIdx - 5], 'copy');
  assert.strictEqual(args[twitchIdx - 4], '-c:a');
  assert.strictEqual(args[twitchIdx - 3], 'copy');
  assert.strictEqual(args[twitchIdx - 2], '-f');
  assert.strictEqual(args[twitchIdx - 1], 'flv');
});
