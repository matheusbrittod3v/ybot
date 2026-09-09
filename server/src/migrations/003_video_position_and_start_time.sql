-- Migration 003: Add position tracking and custom start time to queue items

ALTER TABLE queue_items
  ADD COLUMN IF NOT EXISTS last_position_seconds INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_at_seconds INT DEFAULT 0;
