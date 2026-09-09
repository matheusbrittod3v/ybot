-- Migration 002: Add EPG Schedule Overlay Settings

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS enable_schedule_overlay TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS schedule_overlay_interval INT DEFAULT 10,
  ADD COLUMN IF NOT EXISTS schedule_overlay_duration INT DEFAULT 12;
