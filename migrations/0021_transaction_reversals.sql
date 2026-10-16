-- A mistaken transaction is corrected with a new REVERSAL transaction that moves exactly the
-- original amounts back; the original is never edited or deleted. Each transaction can be
-- reversed once (UNIQUE), and a reversal cannot be reversed (the application rejects it).
--
-- SQLite cannot widen a CHECK constraint, so `transactions` is rebuilt, as migration 0010 did.
-- payment_requests references transactions, so it is rebuilt with it, parent first and child last:
-- the order tables are created in decides the order a deleted game cascades through them, and
-- the old RESTRICT link from payment_requests to transactions made deleting a game fail whenever
-- the transactions table was newer than payment_requests. That link is now NO ACTION, which is
-- checked when the statement ends and so no longer depends on the order.
-- Every existing row is copied unchanged; reverses_transaction_id starts NULL.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE transactions_backup AS
SELECT id, game_id, type, amount, total_amount, comment, created_at FROM transactions;
CREATE TABLE transaction_participants_backup AS
SELECT transaction_id, game_id, player_id, balance_delta FROM transaction_participants;
CREATE TABLE payment_requests_backup AS
SELECT id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id,
       amount, comment, state, expires_at, created_at, resolved_at, transaction_id
FROM payment_requests;

DROP TABLE payment_requests;
DROP TABLE transaction_participants;
DROP TABLE transactions;

CREATE TABLE transactions (
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
    'BANKRUPTCY_TRANSFER',
    'REVERSAL'
  )),
  amount INTEGER NOT NULL CHECK (amount > 0),
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reverses_transaction_id TEXT,
  UNIQUE (id, game_id),
  UNIQUE (reverses_transaction_id),
  CHECK ((type = 'REVERSAL') = (reverses_transaction_id IS NOT NULL)),
  CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  -- NO ACTION (checked when the statement ends), not RESTRICT (checked row by row): deleting a
  -- whole game cascades to the original and its reversal in either order and must still work,
  -- while deleting a reversed original on its own is rejected.
  FOREIGN KEY (reverses_transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION
);

INSERT INTO transactions (id, game_id, type, amount, total_amount, comment, created_at)
SELECT id, game_id, type, amount, total_amount, comment, created_at
FROM transactions_backup;

CREATE TABLE transaction_participants (
  transaction_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  balance_delta INTEGER NOT NULL CHECK (balance_delta <> 0),
  PRIMARY KEY (transaction_id, player_id),
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE CASCADE,
  FOREIGN KEY (player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT
);

INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
SELECT transaction_id, game_id, player_id, balance_delta
FROM transaction_participants_backup;

CREATE TABLE payment_requests (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  payer_player_id TEXT NOT NULL,
  recipient_player_id TEXT NOT NULL,
  creator_player_id TEXT NOT NULL,
  approver_player_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  comment TEXT,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  transaction_id TEXT UNIQUE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (payer_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (recipient_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (creator_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (approver_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION,
  CHECK (payer_player_id <> recipient_player_id)
);

INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at, transaction_id)
SELECT id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at, transaction_id
FROM payment_requests_backup;

DROP TABLE payment_requests_backup;
DROP TABLE transaction_participants_backup;
DROP TABLE transactions_backup;

CREATE INDEX transactions_by_game_id_created_at_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transactions_by_game_id_created_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transaction_participants_by_player_id ON transaction_participants(player_id, transaction_id);
CREATE INDEX transaction_participants_by_game_player_transaction ON transaction_participants(game_id, player_id, transaction_id);
CREATE INDEX payment_requests_inbox ON payment_requests(game_id, approver_player_id, state, expires_at);
CREATE INDEX payment_requests_recipient ON payment_requests(game_id, recipient_player_id, state, expires_at);
CREATE INDEX payment_requests_by_game_created ON payment_requests(game_id, created_at DESC, id DESC);
