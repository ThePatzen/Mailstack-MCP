-- Stores only hashed refresh tokens so their one-time use and replay can be enforced.
ALTER TABLE oauth_clients ADD COLUMN grant_types TEXT NOT NULL DEFAULT '["authorization_code"]';

CREATE TABLE oauth_refresh_tokens (
  refresh_token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX oauth_refresh_tokens_grant ON oauth_refresh_tokens(grant_id, expires_at);
CREATE INDEX oauth_refresh_tokens_expiration ON oauth_refresh_tokens(expires_at);
