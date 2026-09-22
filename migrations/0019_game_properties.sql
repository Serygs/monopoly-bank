-- Ownership is per game and per catalogued space. Rows exist only for games that
-- opted into a board; a game with games.board_id IS NULL never gets a row here.
-- houses = 5 means a hotel, which is why the column is bounded at 5 rather than 4.
-- The last CHECK keeps the two states that must never coexist apart: buildings
-- cannot stand on an unowned space, and mortgaging requires selling them first.
CREATE TABLE game_properties (
  game_id TEXT NOT NULL,
  board_space_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  owner_player_id TEXT,
  houses INTEGER NOT NULL DEFAULT 0 CHECK (houses BETWEEN 0 AND 5),
  mortgaged INTEGER NOT NULL DEFAULT 0 CHECK (mortgaged IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, board_space_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (board_space_id, board_id) REFERENCES board_spaces(id, board_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  CHECK (houses = 0 OR (owner_player_id IS NOT NULL AND mortgaged = 0))
);

CREATE INDEX game_properties_by_owner ON game_properties(game_id, owner_player_id);

-- Houses and hotels are a finite shared pool, so the remaining counts are stored
-- per game and decremented in the same atomic write as the purchase.
CREATE TABLE game_building_banks (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  houses_available INTEGER NOT NULL CHECK (houses_available >= 0),
  hotels_available INTEGER NOT NULL CHECK (hotels_available >= 0)
);

-- A rent or purchase confirmation names the space it was raised for.
ALTER TABLE payment_requests ADD COLUMN board_space_id TEXT REFERENCES board_spaces(id);

-- SQLite cannot widen a CHECK constraint in place, so transactions is rebuilt
-- exactly as in 0010: the old rows are copied verbatim, so PAY_RENT and every
-- other legacy type survives and no history is rewritten. transaction_participants
-- is rebuilt alongside it because DROP TABLE fires its ON DELETE CASCADE, which
-- defer_foreign_keys defers the *check* of but still performs.
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
    'BANKRUPTCY_TRANSFER',
    'PROPERTY_PURCHASE',
    'PROPERTY_RENT',
    'PROPERTY_BUILD',
    'PROPERTY_SELL_BUILDINGS',
    'PROPERTY_MORTGAGE',
    'PROPERTY_UNMORTGAGE',
    'PROPERTY_AUCTION',
    'PROPERTY_TRADE',
    'JAIL_BAIL'
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

-- Both index sets the dropped tables carried are restored: the pair added in
-- 0010 and the pair added in 0015.
CREATE INDEX transactions_by_game_id_created_at_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transactions_by_game_id_created_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transaction_participants_by_player_id ON transaction_participants(player_id, transaction_id);
CREATE INDEX transaction_participants_by_game_player_transaction ON transaction_participants(game_id, player_id, transaction_id);
