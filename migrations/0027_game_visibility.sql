-- Lobby visibility. A public lobby (no table password) is listed for every signed-in user; a
-- private one is reachable only with its join code (and password, when it has one). Existing
-- games become private, so a passwordless lobby is no longer visible to everyone.
ALTER TABLE games ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1));
