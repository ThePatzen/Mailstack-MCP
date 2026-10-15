-- Stores OAuth public clients, short-lived authorization data, grants, and hashed bearer tokens.
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE oauth_authorization_requests (
  request_id_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  requested_scopes TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX oauth_authorization_requests_expiration ON oauth_authorization_requests(expires_at);

CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  request_id_hash TEXT NOT NULL UNIQUE REFERENCES oauth_authorization_requests(request_id_hash) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_token_id TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  granted_scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX oauth_authorization_codes_expiration ON oauth_authorization_codes(expires_at);

CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_token_id TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  granted_scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX oauth_grants_token ON oauth_grants(user_token_id, revoked_at);
CREATE INDEX oauth_grants_account ON oauth_grants(account_id, created_at);

CREATE TABLE oauth_access_tokens (
  access_token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX oauth_access_tokens_expiration ON oauth_access_tokens(expires_at);
