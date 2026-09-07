-- Invitations are unlisted by default. Token material remains hashed; the
-- short code is an owner-facing identifier and is never accepted as access.
ALTER TABLE game_invitations ADD COLUMN short_code TEXT;
ALTER TABLE game_invitations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'UNLISTED' CHECK (visibility IN ('UNLISTED'));
ALTER TABLE game_invitations ADD COLUMN revoked_at TEXT;
CREATE UNIQUE INDEX game_invitations_by_short_code ON game_invitations(short_code) WHERE short_code IS NOT NULL;
CREATE INDEX game_invitations_active_by_game ON game_invitations(game_id, revoked_at, expires_at);
