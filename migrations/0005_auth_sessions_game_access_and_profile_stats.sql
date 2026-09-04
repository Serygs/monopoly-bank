-- Phase 5/6 additions.  This migration deliberately leaves owner_user_id nullable:
-- pre-existing games must be claimed explicitly using docs/legacy-game-ownership.md.
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX user_sessions_by_token_hash ON user_sessions(token_hash);

ALTER TABLE games ADD COLUMN join_code TEXT;
ALTER TABLE games ADD COLUMN game_access_password_hash TEXT;
ALTER TABLE games ADD COLUMN game_access_password_salt TEXT;
CREATE UNIQUE INDEX games_by_join_code ON games(join_code) WHERE join_code IS NOT NULL;

ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0);
ALTER TABLE users ADD COLUMN games_won INTEGER NOT NULL DEFAULT 0 CHECK (games_won >= 0);

-- A finish can be retried safely: one row per user/game is the idempotency key.
CREATE TABLE game_completion_participants (
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  won INTEGER NOT NULL CHECK (won IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
