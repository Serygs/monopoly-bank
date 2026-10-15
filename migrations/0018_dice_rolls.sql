-- Dice rolls are a table tool, not game state: they never touch balances or the
-- ledger. A player's history lives only while the game is active; the trigger
-- removes it the moment the game is finished, whichever code path finished it.
-- A finished game is stored as ARCHIVED (the repository maps it to FINISHED).
CREATE TABLE dice_rolls (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  die_one INTEGER NOT NULL CHECK (die_one BETWEEN 1 AND 6),
  die_two INTEGER NOT NULL CHECK (die_two BETWEEN 1 AND 6),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id, game_id) REFERENCES players(id, game_id) ON DELETE CASCADE
);

CREATE INDEX dice_rolls_by_game_player_created ON dice_rolls(game_id, player_id, created_at DESC);

CREATE TRIGGER dice_rolls_deleted_when_game_finishes
AFTER UPDATE OF status ON games
WHEN NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED'
BEGIN
  DELETE FROM dice_rolls WHERE game_id = NEW.id;
END;
