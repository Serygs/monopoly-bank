-- Existing games retain NULL timestamps until they are next explicitly finished.
ALTER TABLE games ADD COLUMN started_at TEXT;
ALTER TABLE games ADD COLUMN finished_at TEXT;
UPDATE games SET started_at = created_at WHERE started_at IS NULL;
