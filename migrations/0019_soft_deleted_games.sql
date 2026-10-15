-- Removing a game is reversible for 30 days. The owner's "delete" stamps deleted_at (and the
-- game is stored as finished, ARCHIVED, so nothing can be played in it); restoring clears the
-- stamp. The scheduled cleanup removes games whose deleted_at is older than 30 days.
-- Expand-only: a nullable column and a partial index, no existing row changes.
ALTER TABLE games ADD COLUMN deleted_at TEXT;

CREATE INDEX games_by_deleted_at ON games(deleted_at) WHERE deleted_at IS NOT NULL;
