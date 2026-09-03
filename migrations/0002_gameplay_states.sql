ALTER TABLE players ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BANKRUPT'));
ALTER TABLE players ADD COLUMN is_in_jail INTEGER NOT NULL DEFAULT 0 CHECK (is_in_jail IN (0, 1));
ALTER TABLE players ADD COLUMN consecutive_doubles INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_doubles >= 0 AND consecutive_doubles <= 2);

CREATE TABLE game_favorite_amounts (
  game_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, amount),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX game_favorite_amounts_by_game_id ON game_favorite_amounts(game_id, created_at DESC);

CREATE TABLE game_recent_amounts (
  game_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, amount),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX game_recent_amounts_by_game_id ON game_recent_amounts(game_id, used_at DESC);
