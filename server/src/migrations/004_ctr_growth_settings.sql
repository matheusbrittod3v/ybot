-- Migration 004: CTR Growth Title Template and High CTR Tags

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS live_title_template VARCHAR(255) DEFAULT '🔴 AO VIVO: {title} | ASSISTA AGORA!',
  ADD COLUMN IF NOT EXISTS enable_dynamic_tags TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_live_tags TEXT,
  ADD COLUMN IF NOT EXISTS enable_dynamic_description TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_live_description_template TEXT;
