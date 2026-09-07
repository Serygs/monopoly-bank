CREATE TABLE security_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0)
);
CREATE INDEX security_rate_limits_expiry ON security_rate_limits(window_started_at);
