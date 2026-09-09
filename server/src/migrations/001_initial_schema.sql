-- Migration 001: Initial Schema for TV Braza Playout 24/7

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1,
  youtube_stream_key VARCHAR(255) DEFAULT '',
  youtube_rtmp_url VARCHAR(255) DEFAULT 'rtmp://a.rtmp.youtube.com/live2',
  youtube_broadcast_video_id VARCHAR(255) DEFAULT '',
  google_client_id VARCHAR(255) DEFAULT '',
  google_client_secret VARCHAR(255) DEFAULT '',
  google_refresh_token TEXT,
  auto_update_youtube_metadata TINYINT(1) DEFAULT 1,
  default_live_title_prefix VARCHAR(255) DEFAULT 'TV BRAZA AO VIVO: ',
  resolution VARCHAR(50) DEFAULT '1080p',
  fps INT DEFAULT 30,
  video_bitrate VARCHAR(50) DEFAULT '4500k',
  audio_bitrate VARCHAR(50) DEFAULT '160k',
  auto_delete_finished TINYINT(1) DEFAULT 1,
  enable_watermark TINYINT(1) DEFAULT 1,
  watermark_text VARCHAR(255) DEFAULT 'TV BRAZA - AO VIVO',
  custom_logo_path VARCHAR(255) DEFAULT '',
  auto_loop_standby TINYINT(1) DEFAULT 1,
  enable_sponsor_block TINYINT(1) DEFAULT 1,
  default_stream_mode VARCHAR(50) DEFAULT 'direct',
  admin_password VARCHAR(255) DEFAULT 'admin123',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue_items (
  id VARCHAR(64) PRIMARY KEY,
  order_index INT NOT NULL DEFAULT 0,
  title VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  duration INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'queued',
  stream_mode VARCHAR(50) DEFAULT 'direct',
  file_path TEXT,
  thumbnail_url TEXT,
  custom_thumb_path TEXT,
  download_progress INT DEFAULT 0,
  download_speed VARCHAR(100) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS playback_history (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  duration INT DEFAULT 0,
  stream_mode VARCHAR(50) DEFAULT 'direct',
  thumbnail_url TEXT,
  finished_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playout_state (
  id INT PRIMARY KEY DEFAULT 1,
  state VARCHAR(50) DEFAULT 'STANDBY',
  active_item_id VARCHAR(64) DEFAULT NULL,
  started_at BIGINT DEFAULT NULL,
  elapsed_seconds INT DEFAULT 0,
  elapsed_formatted VARCHAR(50) DEFAULT '00:00:00',
  duration INT DEFAULT 0,
  fps INT DEFAULT 0,
  bitrate VARCHAR(50) DEFAULT '0k',
  stream_uptime INT DEFAULT 0,
  current_live_title VARCHAR(255) DEFAULT '',
  current_live_thumb TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
