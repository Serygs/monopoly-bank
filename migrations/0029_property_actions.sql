-- Property actions: board tiles can be bought, built on, sold and traded. `transactions` is rebuilt
-- (as in 0022) to widen the type CHECK: PROPERTY_PURCHASE is used now; PROPERTY_BUILD,
-- PROPERTY_SELL_BUILDING and PROPERTY_TRADE are reserved. It also gains a nullable tile_id.
-- `property_changes` records the before/after state of every tile an operation touched; a stored
-- transaction is never edited.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE transactions_backup AS
SELECT id, game_id, type, amount, total_amount, comment, created_at, reverses_transaction_id
FROM transactions;
CREATE TABLE transaction_participants_backup AS
SELECT transaction_id, game_id, player_id, balance_delta FROM transaction_participants;

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
    'REVERSAL',
    'MORTGAGE',
    'MORTGAGE_REDEMPTION',
    'LOAN_ISSUE',
    'LOAN_REPAYMENT',
    'TO_JACKPOT',
    'JACKPOT_PAYOUT',
    'AUCTION_PAYMENT',
    'PROPERTY_PURCHASE',
    'PROPERTY_BUILD',
    'PROPERTY_SELL_BUILDING',
    'PROPERTY_TRADE'
  )),
  amount INTEGER NOT NULL CHECK (amount > 0),
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reverses_transaction_id TEXT,
  tile_id TEXT,
  UNIQUE (id, game_id),
  UNIQUE (reverses_transaction_id),
  CHECK ((type = 'REVERSAL') = (reverses_transaction_id IS NOT NULL)),
  CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (reverses_transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION
);

INSERT INTO transactions (id, game_id, type, amount, total_amount, comment, created_at, reverses_transaction_id)
SELECT id, game_id, type, amount, total_amount, comment, created_at, reverses_transaction_id
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

DROP TABLE transaction_participants_backup;
DROP TABLE transactions_backup;

CREATE INDEX transactions_by_game_id_created_at_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transactions_by_game_id_created_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transaction_participants_by_player_id ON transaction_participants(player_id, transaction_id);
CREATE INDEX transaction_participants_by_game_player_transaction ON transaction_participants(game_id, player_id, transaction_id);

ALTER TABLE mortgages ADD COLUMN tile_id TEXT;
CREATE UNIQUE INDEX mortgages_one_active_per_tile ON mortgages(game_id, tile_id)
  WHERE state = 'ACTIVE' AND tile_id IS NOT NULL;

ALTER TABLE auctions ADD COLUMN tile_id TEXT;

CREATE TABLE property_changes (
  transaction_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  tile_id TEXT NOT NULL,
  before_owner_player_id TEXT,
  before_mortgaged INTEGER NOT NULL CHECK (before_mortgaged IN (0, 1)),
  before_houses INTEGER NOT NULL CHECK (before_houses BETWEEN 0 AND 5),
  after_owner_player_id TEXT,
  after_mortgaged INTEGER NOT NULL CHECK (after_mortgaged IN (0, 1)),
  after_houses INTEGER NOT NULL CHECK (after_houses BETWEEN 0 AND 5),
  PRIMARY KEY (transaction_id, tile_id),
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, tile_id) REFERENCES game_properties(game_id, tile_id) ON DELETE CASCADE
);

CREATE INDEX property_changes_by_game_tile ON property_changes(game_id, tile_id);
