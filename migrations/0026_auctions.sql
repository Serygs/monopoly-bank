-- Auctions: one lot at a time, sold to the highest bidder who then pays the bank. The table records
-- the lot (free text), the standing bid and its leader, and the AUCTION_PAYMENT transaction that
-- settled it. It stores no property ownership. The bid reserve on the leader is derived from
-- `current_bid` while the auction is ACTIVE; it is never stored. `transactions` already allows the
-- AUCTION_PAYMENT type (migration 0022), so nothing is rebuilt here.
--
-- A bidder who goes bankrupt withdraws the bid (current_bidder_id becomes NULL) but the floor
-- `current_bid` stays, so current_bid > 0 with no leader is valid; a leader always has a bid > 0.
-- Links to transactions are NO ACTION (checked when the statement ends) so deleting a whole game
-- works whatever order SQLite cascades through its tables.
CREATE TABLE auctions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  lot_name TEXT NOT NULL CHECK (length(lot_name) BETWEEN 1 AND 60),
  initiator_player_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'SOLD', 'NO_SALE')),
  current_bid INTEGER NOT NULL DEFAULT 0 CHECK (current_bid >= 0),
  current_bidder_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  settled_transaction_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, game_id),
  CHECK (current_bidder_id IS NULL OR current_bid > 0),
  CHECK ((state = 'SOLD') = (settled_transaction_id IS NOT NULL)),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (initiator_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (current_bidder_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (settled_transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION
);

-- At most one running auction per game.
CREATE UNIQUE INDEX auctions_one_active_per_game ON auctions(game_id) WHERE state = 'ACTIVE';
CREATE INDEX auctions_by_game_state ON auctions(game_id, state);
