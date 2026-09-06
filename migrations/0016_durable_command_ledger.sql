CREATE TABLE command_ledger (
  game_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')),
  result_status INTEGER,
  result_json TEXT,
  result_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY (game_id, command_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
CREATE INDEX command_ledger_by_game_created ON command_ledger(game_id, created_at DESC);
