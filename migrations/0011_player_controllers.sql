-- Wallet control is intentionally independent from game membership. A member
-- can control one PRIMARY wallet and one optional LOCAL wallet in a game.
CREATE TABLE player_controllers (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  controller_kind TEXT NOT NULL CHECK (controller_kind IN ('PRIMARY', 'LOCAL')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, user_id, controller_kind),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id, game_id) REFERENCES players(id, game_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX player_controllers_by_user_game ON player_controllers(user_id, game_id);

-- Backfill the legacy membership link as the primary controller. The WHERE
-- clause makes the migration safe for databases that already contain a row.
INSERT INTO player_controllers (game_id, player_id, user_id, controller_kind)
SELECT game_id, player_id, user_id, 'PRIMARY'
FROM game_members
WHERE player_id IS NOT NULL
ON CONFLICT(game_id, player_id) DO NOTHING;
