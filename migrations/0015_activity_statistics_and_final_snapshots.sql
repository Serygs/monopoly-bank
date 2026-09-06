-- Ledger-derived statistics are stored only when a game is finished.  The JSON
-- snapshot makes the published result immutable even if historical records are
-- later inspected or migrated.
CREATE TABLE game_final_snapshots (
  game_id TEXT PRIMARY KEY,
  winner_player_ids_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX transactions_by_game_id_created_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transaction_participants_by_game_player_transaction ON transaction_participants(game_id, player_id, transaction_id);
CREATE INDEX payment_requests_by_game_created ON payment_requests(game_id, created_at DESC, id DESC);
