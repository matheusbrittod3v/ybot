-- Migration 005: Multi-Stream Twitch Support

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS enable_twitch_stream TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS twitch_rtmp_url VARCHAR(255) DEFAULT 'rtmp://live.twitch.tv/app/',
  ADD COLUMN IF NOT EXISTS twitch_stream_key VARCHAR(255) DEFAULT '';
