-- A trade is an offer ledger entry, modelled on payment_requests: it holds the
-- proposal until both sides agree, and the single settling transaction id is
-- written back on acceptance so the swap of cash and deeds stays atomic.
CREATE TABLE property_trades (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  proposer_player_id TEXT NOT NULL,
  responder_player_id TEXT NOT NULL,
  cash_from_proposer INTEGER NOT NULL DEFAULT 0 CHECK (cash_from_proposer >= 0),
  cash_from_responder INTEGER NOT NULL DEFAULT 0 CHECK (cash_from_responder >= 0),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  transaction_id TEXT UNIQUE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (proposer_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (responder_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE RESTRICT,
  UNIQUE (id, game_id),
  CHECK (proposer_player_id <> responder_player_id)
);

CREATE INDEX property_trades_inbox ON property_trades(game_id, responder_player_id, state, expires_at);
CREATE INDEX property_trades_by_game_created ON property_trades(game_id, created_at DESC, id DESC);

-- One row per deed moving in the trade. mortgage_resolution records what the
-- receiving side chose for a mortgaged deed: pay the interest now and keep it
-- mortgaged, or redeem it outright. It stays NULL for unmortgaged deeds.
-- game_id and board_id are carried so the parent trade, the deed and the giver
-- are pinned by the same composite foreign keys used by game_properties and
-- payment_requests: a single-column reference would let a trade item name a
-- space from another board, a player from another game, or a game other than
-- the one its parent trade belongs to.
CREATE TABLE property_trade_items (
  trade_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  board_space_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  from_player_id TEXT NOT NULL,
  mortgage_resolution TEXT CHECK (mortgage_resolution IN ('PAY_INTEREST', 'REDEEM')),
  PRIMARY KEY (trade_id, board_space_id),
  FOREIGN KEY (trade_id, game_id) REFERENCES property_trades(id, game_id) ON DELETE CASCADE,
  FOREIGN KEY (board_space_id, board_id) REFERENCES board_spaces(id, board_id) ON DELETE RESTRICT,
  FOREIGN KEY (from_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT
);

CREATE INDEX property_trade_items_by_from_player ON property_trade_items(from_player_id, trade_id);
