PRAGMA defer_foreign_keys = ON;

CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'PLAYER_TO_PLAYER',
    'PLAYER_TO_BANK',
    'BANK_TO_PLAYER',
    'PLAYER_TO_ALL',
    'ALL_TO_PLAYER',
    'PAY_RENT',
    'PASS_GO',
    'BANKRUPTCY_TRANSFER'
  )),
  amount INTEGER NOT NULL CHECK (amount > 0),
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, game_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

INSERT INTO transactions_new (id, game_id, type, amount, total_amount, comment, created_at)
SELECT id, game_id, type, amount, total_amount, comment, created_at
FROM transactions;

CREATE TABLE transaction_participants_new (
  transaction_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  balance_delta INTEGER NOT NULL CHECK (balance_delta <> 0),
  PRIMARY KEY (transaction_id, player_id),
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions_new(id, game_id) ON DELETE CASCADE,
  FOREIGN KEY (player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT
);

INSERT INTO transaction_participants_new (transaction_id, game_id, player_id, balance_delta)
SELECT transaction_id, game_id, player_id, balance_delta
FROM transaction_participants;

DROP TABLE transaction_participants;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;
ALTER TABLE transaction_participants_new RENAME TO transaction_participants;

CREATE INDEX transactions_by_game_id_created_at_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transaction_participants_by_player_id ON transaction_participants(player_id, transaction_id);
