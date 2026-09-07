-- A game's payment mode is chosen in the lobby and intentionally never edited.
ALTER TABLE games ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'FAST'
  CHECK (payment_mode IN ('FAST', 'CONFIRMATION'));

-- A request reserves available funds logically; player.balance remains the
-- settled balance until the recipient accepts it.
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
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE RESTRICT,
  CHECK (payer_player_id <> recipient_player_id)
);

CREATE INDEX payment_requests_inbox ON payment_requests(game_id, approver_player_id, state, expires_at);
CREATE INDEX payment_requests_recipient ON payment_requests(game_id, recipient_player_id, state, expires_at);
