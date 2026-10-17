-- A property trade that waits for the counterparty to accept. Pure workflow state: ownership
-- still changes only through the PROPERTY_TRANSFER transaction written when it is accepted.
CREATE TABLE trade_requests (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  proposer_player_id TEXT NOT NULL,
  counterparty_player_id TEXT NOT NULL,
  give_tile_ids TEXT NOT NULL CHECK (json_valid(give_tile_ids) AND json_type(give_tile_ids) = 'array'),
  take_tile_ids TEXT NOT NULL CHECK (json_valid(take_tile_ids) AND json_type(take_tile_ids) = 'array'),
  cash_give INTEGER NOT NULL DEFAULT 0 CHECK (cash_give >= 0),
  cash_take INTEGER NOT NULL DEFAULT 0 CHECK (cash_take >= 0),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  transaction_id TEXT UNIQUE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (proposer_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (counterparty_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION,
  CHECK (proposer_player_id <> counterparty_player_id),
  CHECK (json_array_length(give_tile_ids) + json_array_length(take_tile_ids) + cash_give + cash_take > 0),
  CHECK ((state = 'PENDING') = (resolved_at IS NULL)),
  CHECK ((state = 'ACCEPTED') = (transaction_id IS NOT NULL))
);

CREATE INDEX trade_requests_inbox ON trade_requests(game_id, counterparty_player_id, state, expires_at);
CREATE INDEX trade_requests_proposer ON trade_requests(game_id, proposer_player_id, state);
