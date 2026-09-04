-- Existing games deliberately remain unowned until an operator assigns them.
-- New application-created games must supply an owner_user_id in the application transaction.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL UNIQUE,
  avatar TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE games ADD COLUMN owner_user_id TEXT REFERENCES users(id);
CREATE INDEX games_by_owner_user_id ON games(owner_user_id);

CREATE TABLE game_members (
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'PLAYER')),
  player_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  UNIQUE (game_id, player_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id, game_id) REFERENCES players(id, game_id) ON DELETE SET NULL
);

CREATE INDEX game_members_by_user_id ON game_members(user_id, game_id);
