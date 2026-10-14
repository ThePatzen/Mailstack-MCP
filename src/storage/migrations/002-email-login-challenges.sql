-- Stores short-lived email-login challenges with hashed identifiers and codes, encrypted credentials, and a bounded attempt counter.
CREATE TABLE email_login_challenges (
  challenge_id_digest TEXT PRIMARY KEY,
  normalized_username TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  code_hmac TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  password_nonce TEXT NOT NULL,
  password_tag TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX email_login_challenges_expiration ON email_login_challenges(expires_at);
