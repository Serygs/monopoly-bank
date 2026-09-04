CREATE TABLE game_invitations (
  token_hash TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX game_invitations_by_game_id ON game_invitations(game_id);
CREATE INDEX game_invitations_by_expiry ON game_invitations(expires_at);
