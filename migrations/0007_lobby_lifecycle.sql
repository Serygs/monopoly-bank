-- SQLite cannot alter a CHECK constraint in place. Rebuild only the games table
-- so the persisted lifecycle can represent LOBBY -> ACTIVE -> FINISHED.
PRAGMA foreign_keys = OFF;

CREATE TABLE games_lifecycle (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starting_balance INTEGER NOT NULL CHECK (starting_balance >= 0),
  pass_go_reward INTEGER NOT NULL CHECK (pass_go_reward >= 0),
  currency TEXT NOT NULL DEFAULT 'K',
  status TEXT NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY', 'ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_user_id TEXT REFERENCES users(id),
  join_code TEXT,
  game_access_password_hash TEXT,
  game_access_password_salt TEXT,
  started_at TEXT,
  finished_at TEXT
);

INSERT INTO games_lifecycle (
  id, name, starting_balance, pass_go_reward, currency, status, created_at, updated_at,
  owner_user_id, join_code, game_access_password_hash, game_access_password_salt, started_at, finished_at
)
SELECT id, name, starting_balance, pass_go_reward, currency, status, created_at, updated_at,
       owner_user_id, join_code, game_access_password_hash, game_access_password_salt, started_at, finished_at
FROM games;

DROP TABLE games;
ALTER TABLE games_lifecycle RENAME TO games;
CREATE INDEX games_by_owner_user_id ON games(owner_user_id);
CREATE UNIQUE INDEX games_by_join_code ON games(join_code) WHERE join_code IS NOT NULL;

PRAGMA foreign_keys = ON;
