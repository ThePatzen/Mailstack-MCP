-- Establishes account-scoped credentials, user tokens, tool permissions, sessions, and deployment metadata.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_ciphertext TEXT NOT NULL,
  password_nonce TEXT NOT NULL,
  password_tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX tokens_account ON tokens(account_id);
CREATE TABLE tool_permissions (
  token_id TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  PRIMARY KEY (token_id, tool_name)
);
CREATE TABLE sessions (
  session_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiration ON sessions(expires_at);
CREATE TABLE deployment_metadata (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
