-- Mortgages: a player mortgages a property (free-text name, value from its card) to the bank and
-- later redeems it for the value plus 10%. Every step is an explicit transaction (MORTGAGE,
-- MORTGAGE_REDEMPTION); this table only remembers which properties are currently mortgaged so the
-- table can see them, redeem them, and not charge rent on them. It stores no property ownership.
--
-- SQLite cannot widen a CHECK constraint, so `transactions` is rebuilt, exactly as migration 0021
-- did (rows are refilled into a table that already carries the final name, so the deferred
-- foreign-key checks from payment_requests and from reversals resolve before the commit). The
-- type list also reserves the names that the loan, jackpot and auction features will use, so
-- those features do not each have to rebuild this table again; the application does not accept
-- them yet.
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
    'AUCTION_PAYMENT'
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

-- The id is the id of the MORTGAGE transaction that created it, so a retried command can never
-- create two. Links to transactions are NO ACTION (checked when the statement ends) so deleting a
-- whole game works whatever order SQLite cascades through its tables.
CREATE TABLE mortgages (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  property_name TEXT NOT NULL CHECK (length(property_name) BETWEEN 1 AND 60),
  -- The name as compared for duplicates (Unicode-normalized and lower-cased by the application;
  -- SQLite's own lower() only folds ASCII, which would let "Київ" and "КИЇВ" through).
  name_key TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120),
  mortgage_value INTEGER NOT NULL CHECK (mortgage_value > 0),
  -- RELEASED: the owner went bankrupt to the bank, so the property is no longer mortgaged to anyone.
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'REDEEMED', 'RELEASED')),
  redeemed_by_transaction_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT,
  CHECK ((state = 'REDEEMED') = (redeemed_by_transaction_id IS NOT NULL)),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION,
  FOREIGN KEY (redeemed_by_transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION
);

-- A player cannot have two active mortgages on the same property name (compared ignoring case).
CREATE UNIQUE INDEX mortgages_one_active_per_name ON mortgages(player_id, name_key) WHERE state = 'ACTIVE';
CREATE INDEX mortgages_by_game_state ON mortgages(game_id, state);
