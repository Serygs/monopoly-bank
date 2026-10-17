-- Property trades: one PROPERTY_TRANSFER transaction swaps tiles (and optionally cash) between two
-- players. `transactions` is rebuilt (as in 0029) to
--   * add PROPERTY_TRANSFER and drop the never-written PROPERTY_TRADE;
--   * allow amount / total_amount = 0 for a PROPERTY_TRANSFER (a gift or a straight swap) and for
--     the REVERSAL that undoes one;
--   * add initiator_player_id, the player who made the trade and so may reverse it (set only on
--     a PROPERTY_TRANSFER; the participants alone cannot tell, as a swap has zero deltas).
-- Both traders always get a transaction_participants row so the trade shows in their history even
-- when no money moved; that row may carry a zero delta only for a PROPERTY_TRANSFER or the
-- REVERSAL that undoes one (a trigger, since a CHECK cannot read the parent row).
-- property_changes references transactions with ON DELETE CASCADE, so it is backed up and refilled
-- like transaction_participants; dropping `transactions` would otherwise delete its rows.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE transactions_backup AS
SELECT id, game_id, type, amount, total_amount, comment, created_at, reverses_transaction_id,
       tile_id, price_overridden
FROM transactions;
CREATE TABLE transaction_participants_backup AS
SELECT transaction_id, game_id, player_id, balance_delta FROM transaction_participants;
CREATE TABLE property_changes_backup AS
SELECT transaction_id, game_id, tile_id, before_owner_player_id, before_mortgaged, before_houses,
       after_owner_player_id, after_mortgaged, after_houses
FROM property_changes;

DROP TABLE property_changes;
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
    'PROPERTY_TRANSFER'
  )),
  amount INTEGER NOT NULL CHECK (amount > 0 OR (type IN ('PROPERTY_TRANSFER', 'REVERSAL') AND amount = 0)),
  total_amount INTEGER NOT NULL CHECK (total_amount > 0 OR (type IN ('PROPERTY_TRANSFER', 'REVERSAL') AND total_amount = 0)),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reverses_transaction_id TEXT,
  tile_id TEXT,
  price_overridden INTEGER NOT NULL DEFAULT 0
    CHECK (price_overridden IN (0, 1) AND (price_overridden = 0 OR type = 'PROPERTY_PURCHASE')),
  initiator_player_id TEXT,
  UNIQUE (id, game_id),
  UNIQUE (reverses_transaction_id),
  CHECK ((type = 'REVERSAL') = (reverses_transaction_id IS NOT NULL)),
  CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id),
  CHECK (initiator_player_id IS NULL OR type = 'PROPERTY_TRANSFER'),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (reverses_transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION,
  FOREIGN KEY (initiator_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT
);

INSERT INTO transactions (id, game_id, type, amount, total_amount, comment, created_at,
                          reverses_transaction_id, tile_id, price_overridden)
SELECT id, game_id, type, amount, total_amount, comment, created_at, reverses_transaction_id,
       tile_id, price_overridden
FROM transactions_backup;

CREATE TABLE transaction_participants (
  transaction_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  balance_delta INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, player_id),
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE CASCADE,
  FOREIGN KEY (player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT
);

INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
SELECT transaction_id, game_id, player_id, balance_delta
FROM transaction_participants_backup;

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

INSERT INTO property_changes (transaction_id, game_id, tile_id, before_owner_player_id,
                              before_mortgaged, before_houses, after_owner_player_id,
                              after_mortgaged, after_houses)
SELECT transaction_id, game_id, tile_id, before_owner_player_id, before_mortgaged, before_houses,
       after_owner_player_id, after_mortgaged, after_houses
FROM property_changes_backup;

DROP TABLE property_changes_backup;
DROP TABLE transaction_participants_backup;
DROP TABLE transactions_backup;

CREATE INDEX transactions_by_game_id_created_at_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transactions_by_game_id_created_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transaction_participants_by_player_id ON transaction_participants(player_id, transaction_id);
CREATE INDEX transaction_participants_by_game_player_transaction ON transaction_participants(game_id, player_id, transaction_id);
CREATE INDEX property_changes_by_game_tile ON property_changes(game_id, tile_id);

-- Money moves exactly as recorded: a zero delta is meaningless except on a trade (both traders are
-- listed whatever moved) and on the reversal that mirrors it.
CREATE TRIGGER transaction_participants_nonzero_delta
BEFORE INSERT ON transaction_participants
WHEN NEW.balance_delta = 0
  AND COALESCE((SELECT type FROM transactions WHERE id = NEW.transaction_id AND game_id = NEW.game_id), '')
      NOT IN ('PROPERTY_TRANSFER', 'REVERSAL')
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: balance_delta <> 0');
END;
