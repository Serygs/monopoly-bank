-- Existing nickname/password accounts remain valid registered accounts. New
-- accounts use normalized email identity; guests deliberately have no email.
ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'REGISTERED' CHECK (account_type IN ('REGISTERED', 'GUEST'));
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN normalized_email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
CREATE UNIQUE INDEX users_by_normalized_email ON users(normalized_email) WHERE normalized_email IS NOT NULL;

CREATE TABLE auth_email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX auth_email_tokens_by_hash ON auth_email_tokens(token_hash);
-- One usable token per purpose acts as a per-account email-send cooldown.
CREATE UNIQUE INDEX auth_email_tokens_active_by_user_purpose ON auth_email_tokens(user_id, purpose) WHERE consumed_at IS NULL;
