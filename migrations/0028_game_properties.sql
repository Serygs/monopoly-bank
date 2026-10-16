-- Board property state per game: owner, mortgage flag and house count.
-- Expand-only; legacy games get no rows.
CREATE TABLE game_properties (
  game_id TEXT NOT NULL,
  tile_id TEXT NOT NULL,
  owner_player_id TEXT,
  mortgaged INTEGER NOT NULL DEFAULT 0 CHECK (mortgaged IN (0, 1)),
  houses INTEGER NOT NULL DEFAULT 0 CHECK (houses BETWEEN 0 AND 5),
  PRIMARY KEY (game_id, tile_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  CHECK (mortgaged = 0 OR houses = 0)
);

CREATE INDEX game_properties_by_owner ON game_properties(game_id, owner_player_id);
