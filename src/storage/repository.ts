import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { EncryptedSecret } from '../security/crypto.js';
import { generateToken, hashEmailLoginValue, hashToken, tokenDigestMatches } from '../security/tokens.js';
import { getDatabase } from './database.js';

export interface AccountRecord {
  id: string;
  username: string;
  createdAt: number;
  updatedAt: number;
}

export interface TokenSummary {
  id: string;
  accountId: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  enabledTools: string[];
  permissions: Record<string, boolean>;
}

export interface AuthenticatedToken extends TokenSummary {
  username: string;
}

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

const MAX_OAUTH_CLIENTS = 10_000;
const OAUTH_CLIENT_IDLE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const OAUTH_GRANT_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Reports that an instance reached its bounded OAuth client registry capacity. */
export class OAuthClientCapacityError extends Error {
  constructor() {
    super('This instance has reached its OAuth client registration limit.');
    this.name = 'OAuthClientCapacityError';
  }
}

export interface OAuthAuthorizationRequest {
  requestId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  state: string;
  codeChallenge: string;
  requestedScopes: string[];
  accountId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface OAuthGrantSummary {
  id: string;
  accountId: string;
  userTokenId: string;
  userTokenLabel: string;
  clientId: string;
  clientName: string;
  resource: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AuthenticatedOAuthToken extends AuthenticatedToken {
  grantId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
}

interface AccountRow {
  id: string; username: string; created_at: number; updated_at: number;
  password_ciphertext: string; password_nonce: string; password_tag: string;
}
interface TokenRow {
  id: string; account_id: string; label: string; created_at: number;
  last_used_at: number | null; revoked_at: number | null; token_hash: string;
}

interface OAuthClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string;
  created_at: number;
  last_used_at: number;
}

interface OAuthAuthorizationRequestRow {
  request_id_hash: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  state: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  requested_scopes: string;
  account_id: string | null;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

interface OAuthAccessTokenRow extends TokenRow {
  grant_id: string;
  resource: string;
  granted_scopes: string;
  grant_expires_at: number;
  grant_revoked_at: number | null;
  access_expires_at: number;
}

/** Maps the database row to the public account shape without exposing encrypted credentials. */
function accountRecord(row: AccountRow): AccountRecord {
  return { id: row.id, username: row.username, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** Adds the token's per-tool permissions while keeping its secret hash private. */
function tokenSummary(row: TokenRow): TokenSummary {
  const permissions = Object.fromEntries((getDatabase().prepare('SELECT tool_name, allowed FROM tool_permissions WHERE token_id = ? ORDER BY tool_name').all(row.id) as Array<{ tool_name: string; allowed: number }>).map((permission) => [permission.tool_name, permission.allowed === 1]));
  return {
    id: row.id, accountId: row.account_id, label: row.label, createdAt: row.created_at,
    lastUsedAt: row.last_used_at, revokedAt: row.revoked_at, permissions,
    enabledTools: Object.keys(permissions).filter((name) => permissions[name]),
  };
}

/** Parses a stored JSON string array and rejects corrupted authorization data. */
function storedStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('Stored OAuth data is invalid.');
  }
  return parsed;
}

/** Deletes expired one-time OAuth data and retains grant history for ninety days. */
function cleanupExpiredOAuthData(db: ReturnType<typeof getDatabase>, now: number): void {
  db.prepare('DELETE FROM oauth_authorization_requests WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM oauth_authorization_codes WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM oauth_access_tokens WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM oauth_grants WHERE expires_at <= ?').run(now - OAUTH_GRANT_HISTORY_RETENTION_MS);
  db.prepare(`DELETE FROM oauth_clients WHERE last_used_at <= ?
    AND NOT EXISTS (SELECT 1 FROM oauth_grants WHERE client_id = oauth_clients.client_id)`)
    .run(now - OAUTH_CLIENT_IDLE_RETENTION_MS);
}

/** Maps a registered public client row without exposing storage fields. */
function oauthClientRecord(row: OAuthClientRow): OAuthClient {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: storedStringArray(row.redirect_uris),
    createdAt: row.created_at,
  };
}

/** Maps a pending authorization row and its unpersisted request identifier. */
function authorizationRequestRecord(row: OAuthAuthorizationRequestRow, requestId: string): OAuthAuthorizationRequest {
  return {
    requestId,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    resource: row.resource,
    state: row.state,
    codeChallenge: row.code_challenge,
    requestedScopes: storedStringArray(row.requested_scopes),
    accountId: row.account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Creates an account or replaces its encrypted password, returning only non-secret account fields. */
export function createOrUpdateAccount(username: string, encryptedPassword: EncryptedSecret): AccountRecord {
  if (!username || username.length > 1024 || /[\r\n\0]/.test(username)) throw new Error('Invalid account username.');
  const db = getDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO accounts (id, username, password_ciphertext, password_nonce, password_tag, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET
    password_ciphertext = excluded.password_ciphertext, password_nonce = excluded.password_nonce,
    password_tag = excluded.password_tag, updated_at = excluded.updated_at`).run(randomUUID(), username, encryptedPassword.ciphertext, encryptedPassword.nonce, encryptedPassword.tag, now, now);
  return accountRecord(db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as AccountRow);
}

/** Returns the stored login credentials for one account, or null when that account is missing. */
export function getAccountCredentials(accountId: string): { username: string; encryptedPassword: EncryptedSecret } | null {
  const row = getDatabase().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined;
  if (!row) return null;
  return { username: row.username, encryptedPassword: { ciphertext: row.password_ciphertext, nonce: row.password_nonce, tag: row.password_tag } };
}

/** Creates a token for one account and returns its raw value only at creation time. */
export function createUserToken(accountId: string, label: string): { token: string; summary: TokenSummary } {
  const cleanLabel = label.trim();
  if (!cleanLabel || cleanLabel.length > 100 || /[\r\n\0]/.test(cleanLabel)) throw new Error('Token label must contain 1 to 100 characters.');
  const token = generateToken();
  const id = randomUUID();
  const db = getDatabase();
  db.prepare('INSERT INTO tokens (id, account_id, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, accountId, cleanLabel, hashToken(token), Date.now());
  return { token, summary: tokenSummary(db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow) };
}

/** Authenticates an active token, updates its last-use time, and returns its account permissions. */
export function findUserToken(token: string): AuthenticatedToken | null {
  // All issued tokens are a canonical 32-byte base64url encoding.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND revoked_at IS NULL').get(hashToken(token)) as TokenRow | undefined;
    if (!row || !tokenDigestMatches(token, row.token_hash)) return null;
    const account = db.prepare('SELECT username FROM accounts WHERE id = ?').get(row.account_id) as { username: string } | undefined;
    if (!account) return null;
    const now = Date.now();
    db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, row.id);
    return { ...tokenSummary({ ...row, last_used_at: now }), username: account.username };
  })();
}

/** Lists tokens belonging to the requested account, including revoked entries for management. */
export function listTokens(accountId: string): TokenSummary[] {
  return (getDatabase().prepare('SELECT * FROM tokens WHERE account_id = ? ORDER BY created_at DESC, id').all(accountId) as TokenRow[]).map(tokenSummary);
}

/** Revokes an active token only when it belongs to the requested account. */
export function revokeToken(accountId: string, tokenId: string): boolean {
  return getDatabase().prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL').run(Date.now(), tokenId, accountId).changes > 0;
}

/** Permanently deletes a revoked token owned by the requested account. */
export function deleteToken(accountId: string, tokenId: string): boolean {
  return getDatabase().prepare('DELETE FROM tokens WHERE id = ? AND account_id = ? AND revoked_at IS NOT NULL').run(tokenId, accountId).changes > 0;
}

/** Registers one OAuth public client and stores its exact callback allowlist. */
export function registerOAuthClient(clientName: string, redirectUris: string[]): OAuthClient {
  const cleanName = clientName.trim();
  if (!cleanName || cleanName.length > 100 || /[\r\n\0]/.test(cleanName) ||
      !Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 16 ||
      !redirectUris.every((uri) => typeof uri === 'string' && uri.length > 0 && uri.length <= 2048 && !/[\r\n\0]/.test(uri))) {
    throw new Error('Invalid OAuth client registration.');
  }
  const clientId = generateToken();
  const now = Date.now();
  const db = getDatabase();
  db.transaction(() => {
    cleanupExpiredOAuthData(db, now);
    const count = (db.prepare('SELECT COUNT(*) AS count FROM oauth_clients').get() as { count: number }).count;
    if (count >= MAX_OAUTH_CLIENTS) throw new OAuthClientCapacityError();
    db.prepare(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?)`).run(clientId, cleanName, JSON.stringify([...new Set(redirectUris)]), now, now);
  }).immediate();
  return { clientId, clientName: cleanName, redirectUris: [...new Set(redirectUris)], createdAt: now };
}

/** Resolves a registered public client by its public identifier. */
export function findOAuthClient(clientId: string): OAuthClient | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(clientId)) return null;
  const db = getDatabase();
  db.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?').run(Date.now(), clientId);
  const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as OAuthClientRow | undefined;
  return row ? oauthClientRecord(row) : null;
}

/** Stores a browser authorization transaction under a hash of its random handle. */
export function createOAuthAuthorizationRequest(input: {
  clientId: string; redirectUri: string; resource: string; state: string;
  codeChallenge: string; requestedScopes: string[]; expiresAt: number;
}): string {
  const now = Date.now();
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.clientId) || !input.redirectUri || !input.resource ||
      !input.state || input.state.length > 1024 || !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge) ||
      !input.requestedScopes.length || !input.requestedScopes.every((scope) => /^mailstack:[a-z][a-z0-9_]{0,99}$/.test(scope)) ||
      !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
    throw new Error('Invalid OAuth authorization request.');
  }
  const requestId = generateToken();
  const db = getDatabase();
  db.transaction(() => {
    cleanupExpiredOAuthData(db, now);
    db.prepare(`INSERT INTO oauth_authorization_requests (
    request_id_hash, client_id, redirect_uri, resource, state, code_challenge,
    code_challenge_method, requested_scopes, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'S256', ?, ?, ?)`).run(
      hashToken(requestId), input.clientId, input.redirectUri, input.resource, input.state,
      input.codeChallenge, JSON.stringify(input.requestedScopes), now, input.expiresAt,
    );
  }).immediate();
  return requestId;
}

/** Loads an unexpired, unconsumed authorization transaction by its random handle. */
export function findOAuthAuthorizationRequest(requestId: string, now = Date.now()): OAuthAuthorizationRequest | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestId) || !Number.isSafeInteger(now)) return null;
  const digest = hashToken(requestId);
  const row = getDatabase().prepare(`SELECT * FROM oauth_authorization_requests
    WHERE request_id_hash = ? AND expires_at > ? AND consumed_at IS NULL`).get(digest, now) as OAuthAuthorizationRequestRow | undefined;
  if (!row || !tokenDigestMatches(requestId, row.request_id_hash)) return null;
  return authorizationRequestRecord(row, requestId);
}

/** Binds a pending authorization transaction to the account established by Mailstack login. */
export function bindOAuthAuthorizationRequest(requestId: string, accountId: string, now = Date.now()): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestId) || !accountId || !Number.isSafeInteger(now)) return false;
  const result = getDatabase().prepare(`UPDATE oauth_authorization_requests SET account_id = ?
    WHERE request_id_hash = ? AND expires_at > ? AND consumed_at IS NULL
      AND (account_id IS NULL OR account_id = ?)
      AND EXISTS (SELECT 1 FROM accounts WHERE id = ?)`)
    .run(accountId, hashToken(requestId), now, accountId, accountId);
  return result.changes === 1;
}

/** Closes an unconsumed authorization request only for the account bound to it. */
export function cancelOAuthAuthorizationRequest(requestId: string, accountId: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestId) || !accountId) return false;
  return getDatabase().prepare(`UPDATE oauth_authorization_requests SET consumed_at = ?
    WHERE request_id_hash = ? AND account_id = ? AND consumed_at IS NULL AND expires_at > ?`)
    .run(Date.now(), hashToken(requestId), accountId, Date.now()).changes === 1;
}

/** Issues a one-time code only for the authenticated account's active, permission-compatible User-Token. */
export function createOAuthAuthorizationCode(input: {
  requestId: string; accountId: string; userTokenId: string; grantedScopes: string[]; expiresAt: number;
}): string | null {
  const now = Date.now();
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.requestId) || !input.accountId || !input.userTokenId ||
      !input.grantedScopes.length || !input.grantedScopes.every((scope) => /^mailstack:[a-z][a-z0-9_]{0,99}$/.test(scope)) ||
      !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) return null;
  const db = getDatabase();
  return db.transaction(() => {
    cleanupExpiredOAuthData(db, now);
    const requestDigest = hashToken(input.requestId);
    const request = db.prepare(`SELECT * FROM oauth_authorization_requests
      WHERE request_id_hash = ? AND account_id = ? AND expires_at > ? AND consumed_at IS NULL`)
      .get(requestDigest, input.accountId, now) as OAuthAuthorizationRequestRow | undefined;
    if (!request || !tokenDigestMatches(input.requestId, request.request_id_hash)) return null;

    const token = db.prepare(`SELECT id FROM tokens
      WHERE id = ? AND account_id = ? AND revoked_at IS NULL`).get(input.userTokenId, input.accountId) as { id: string } | undefined;
    if (!token) return null;
    const allowedScopes = new Set((db.prepare(`SELECT tool_name FROM tool_permissions
      WHERE token_id = ? AND allowed = 1`).all(input.userTokenId) as Array<{ tool_name: string }>).map((row) => `mailstack:${row.tool_name}`));
    const requestedScopes = new Set(storedStringArray(request.requested_scopes));
    if (input.grantedScopes.some((scope) => !requestedScopes.has(scope) || !allowedScopes.has(scope))) return null;

    const code = generateToken();
    const expiresAt = Math.min(input.expiresAt, request.expires_at, now + 600_000);
    if (expiresAt <= now) return null;
    const consumed = db.prepare(`UPDATE oauth_authorization_requests SET consumed_at = ?
      WHERE request_id_hash = ? AND consumed_at IS NULL AND expires_at > ?`).run(now, requestDigest, now);
    if (!consumed.changes) return null;
    db.prepare(`INSERT INTO oauth_authorization_codes (
      code_hash, request_id_hash, account_id, user_token_id, granted_scopes, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      hashToken(code), requestDigest, input.accountId, input.userTokenId,
      JSON.stringify(input.grantedScopes), now, expiresAt,
    );
    return code;
  }).immediate();
}

/** Redeems a PKCE-bound authorization code once and issues an opaque, short-lived access token. */
export function exchangeOAuthAuthorizationCode(input: {
  code: string; clientId: string; redirectUri: string; resource: string;
  codeVerifier: string; now?: number; accessTokenTtlMs: number;
}): { accessToken: string; grantId: string; scopes: string[]; expiresAt: number } | null {
  const now = input.now ?? Date.now();
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.code) || !/^[A-Za-z0-9_-]{43}$/.test(input.clientId) ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier) || !input.redirectUri || !input.resource ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(input.accessTokenTtlMs) || input.accessTokenTtlMs <= 0) return null;
  const challenge = createHash('sha256').update(input.codeVerifier, 'ascii').digest('base64url');
  const db = getDatabase();
  return db.transaction(() => {
    cleanupExpiredOAuthData(db, now);
    const codeDigest = hashToken(input.code);
    const row = db.prepare(`SELECT c.code_hash, c.request_id_hash, c.account_id, c.user_token_id,
      c.granted_scopes, c.expires_at AS code_expires_at, c.consumed_at,
      r.client_id, r.redirect_uri, r.resource, r.code_challenge,
      t.id AS active_token_id
      FROM oauth_authorization_codes c
      JOIN oauth_authorization_requests r ON r.request_id_hash = c.request_id_hash
      JOIN tokens t ON t.id = c.user_token_id AND t.account_id = c.account_id AND t.revoked_at IS NULL
      WHERE c.code_hash = ? AND c.expires_at > ? AND c.consumed_at IS NULL`)
      .get(codeDigest, now) as {
        code_hash: string; request_id_hash: string; account_id: string; user_token_id: string;
        granted_scopes: string; code_expires_at: number; consumed_at: number | null;
        client_id: string; redirect_uri: string; resource: string; code_challenge: string; active_token_id: string;
      } | undefined;
    if (!row || !tokenDigestMatches(input.code, row.code_hash) || row.client_id !== input.clientId ||
        row.redirect_uri !== input.redirectUri || row.resource !== input.resource ||
        !timingSafeEqual(Buffer.from(challenge), Buffer.from(row.code_challenge))) return null;

    const requestedGrantScopes = storedStringArray(row.granted_scopes);
    const currentScopes = new Set((db.prepare(`SELECT tool_name FROM tool_permissions
      WHERE token_id = ? AND allowed = 1`).all(row.user_token_id) as Array<{ tool_name: string }>).map((entry) => `mailstack:${entry.tool_name}`));
    const grantedScopes = requestedGrantScopes.filter((scope) => currentScopes.has(scope));
    if (!grantedScopes.length) return null;

    const consumed = db.prepare(`UPDATE oauth_authorization_codes SET consumed_at = ?
      WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?`).run(now, codeDigest, now);
    if (!consumed.changes) return null;
    const grantId = randomUUID();
    const expiresAt = now + input.accessTokenTtlMs;
    const accessToken = generateToken();
    db.prepare(`INSERT INTO oauth_grants (
      id, account_id, user_token_id, client_id, resource, granted_scopes, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      grantId, row.account_id, row.user_token_id, row.client_id, row.resource,
      JSON.stringify(grantedScopes), now, expiresAt,
    );
    db.prepare(`INSERT INTO oauth_access_tokens (access_token_hash, grant_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)`).run(hashToken(accessToken), grantId, now, expiresAt);
    return { accessToken, grantId, scopes: grantedScopes, expiresAt };
  }).immediate();
}

/** Resolves a live OAuth token to its parent token's current account permissions. */
export function findOAuthAccessToken(token: string, resource: string, now = Date.now()): AuthenticatedOAuthToken | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !resource || !Number.isSafeInteger(now)) return null;
  const digest = hashToken(token);
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.prepare(`SELECT t.*, a.username, g.id AS grant_id, g.resource,
      g.granted_scopes, g.expires_at AS grant_expires_at, g.revoked_at AS grant_revoked_at,
      at.expires_at AS access_expires_at, at.access_token_hash
      FROM oauth_access_tokens at
      JOIN oauth_grants g ON g.id = at.grant_id
      JOIN tokens t ON t.id = g.user_token_id AND t.account_id = g.account_id AND t.revoked_at IS NULL
      JOIN accounts a ON a.id = g.account_id
      WHERE at.access_token_hash = ? AND at.expires_at > ? AND g.expires_at > ?
        AND g.revoked_at IS NULL AND g.resource = ?`)
      .get(digest, now, now, resource) as (OAuthAccessTokenRow & {
        username: string; access_token_hash: string;
      }) | undefined;
    if (!row || !tokenDigestMatches(token, row.access_token_hash)) return null;
    const scopes = storedStringArray(row.granted_scopes);
    const scopeSet = new Set(scopes.map((scope) => scope.slice('mailstack:'.length)));
    const summary = tokenSummary(row);
    const lastUsedAt = now;
    db.prepare('UPDATE oauth_access_tokens SET last_used_at = ? WHERE access_token_hash = ?').run(now, digest);
    db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, row.id);
    return {
      ...summary,
      username: row.username,
      enabledTools: summary.enabledTools.filter((tool) => scopeSet.has(tool)),
      grantId: row.grant_id,
      resource: row.resource,
      scopes,
      expiresAt: Math.min(row.access_expires_at, row.grant_expires_at),
      lastUsedAt,
    };
  })();
}

/** Lists OAuth grants only for one account, including revoked connections for management. */
export function listOAuthGrants(accountId: string): OAuthGrantSummary[] {
  const rows = getDatabase().prepare(`SELECT g.id, g.account_id, g.user_token_id,
    t.label AS user_token_label, g.client_id, c.client_name, g.resource,
    g.granted_scopes, g.created_at, g.expires_at, g.revoked_at
    FROM oauth_grants g
    JOIN tokens t ON t.id = g.user_token_id
    JOIN oauth_clients c ON c.client_id = g.client_id
    WHERE g.account_id = ? ORDER BY g.created_at DESC, g.id`).all(accountId) as Array<{
      id: string; account_id: string; user_token_id: string; user_token_label: string;
      client_id: string; client_name: string; resource: string; granted_scopes: string;
      created_at: number; expires_at: number; revoked_at: number | null;
    }>;
  return rows.map((row) => ({
    id: row.id, accountId: row.account_id, userTokenId: row.user_token_id,
    userTokenLabel: row.user_token_label, clientId: row.client_id, clientName: row.client_name,
    resource: row.resource, scopes: storedStringArray(row.granted_scopes),
    createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at,
  }));
}

/** Revokes one OAuth grant only when it belongs to the signed-in account and selected User-Token. */
export function revokeOAuthGrant(accountId: string, userTokenId: string, grantId: string): boolean {
  return getDatabase().prepare(`UPDATE oauth_grants SET revoked_at = ?
    WHERE id = ? AND account_id = ? AND user_token_id = ? AND revoked_at IS NULL`)
    .run(Date.now(), grantId, accountId, userTokenId).changes === 1;
}

/** Sets one tool permission for an active token owned by the requested account. */
export function setToolPermission(accountId: string, tokenId: string, toolName: string, allowed: boolean): void {
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(toolName) || typeof allowed !== 'boolean') throw new Error('Invalid tool permission.');
  const db = getDatabase();
  // An INSERT SELECT keeps the ownership and active-token checks in the mutation itself.
  const result = db.prepare(`INSERT INTO tool_permissions (token_id, tool_name, allowed)
    SELECT id, ?, ? FROM tokens WHERE id = ? AND account_id = ? AND revoked_at IS NULL
    ON CONFLICT(token_id, tool_name) DO UPDATE SET allowed = excluded.allowed`).run(toolName, allowed ? 1 : 0, tokenId, accountId);
  if (!result.changes) throw new Error('Active token not found for this account.');
}

/** Stores a hash of a new session identifier and removes expired sessions in the same transaction. */
export function createSession(accountId: string, expiresAt: number): string {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('Session expiration must be in the future.');
  const sessionId = generateToken();
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)').run(hashToken(sessionId), accountId, expiresAt);
  })();
  return sessionId;
}

/** Resolves a valid session identifier to its account and expiration, deleting expired records. */
export function findSession(sessionId: string): { accountId: string; expiresAt: number } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
  const db = getDatabase();
  const digest = hashToken(sessionId);
  const row = db.prepare('SELECT account_id, expires_at, session_hash FROM sessions WHERE session_hash = ?').get(digest) as { account_id: string; expires_at: number; session_hash: string } | undefined;
  if (!row || !tokenDigestMatches(sessionId, row.session_hash)) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE session_hash = ?').run(digest);
    return null;
  }
  return { accountId: row.account_id, expiresAt: row.expires_at };
}

/** Deletes a session by its one-way identifier hash. */
export function deleteSession(sessionId: string): void {
  getDatabase().prepare('DELETE FROM sessions WHERE session_hash = ?').run(hashToken(sessionId));
}

interface EmailLoginChallengeRow {
  challenge_id_digest: string;
  username: string;
  code_hmac: string;
  password_ciphertext: string;
  password_nonce: string;
  password_tag: string;
  expires_at: number;
  attempts: number;
}

const EMAIL_LOGIN_MAX_ATTEMPTS = 5;

/** Compares fixed-size digest bytes without leaking their contents through timing differences. */
function emailLoginDigestMatches(candidateDigest: string, storedDigest: string): boolean {
  const candidate = Buffer.from(candidateDigest, 'hex');
  const stored = Buffer.from(storedDigest, 'hex');
  return stored.length === candidate.length && timingSafeEqual(candidate, stored);
}

/** Stores a short-lived email code challenge while replacing any older challenge for that username. */
export function createEmailLoginChallenge(input: {
  username: string;
  encryptedPassword: EncryptedSecret;
  code: string;
  expiresAt: number;
  encryptionKey: Buffer;
}): string {
  if (typeof input.code !== 'string' || !/^[0-9]{6}$/.test(input.code)) throw new Error('Email login code must contain exactly six digits.');
  if (!input.username || input.username.length > 1024 || /[\r\n\0]/.test(input.username)) throw new Error('Invalid account username.');
  const now = Date.now();
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) throw new Error('Email login challenge expiration must be in the future.');
  const db = getDatabase();
  return db.transaction(() => {
    db.prepare('DELETE FROM email_login_challenges WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM email_login_challenges WHERE normalized_username = ?').run(input.username.toLocaleLowerCase('en-US'));
    const challengeId = generateToken();
    db.prepare(`INSERT INTO email_login_challenges (
      challenge_id_digest, normalized_username, username, code_hmac,
      password_ciphertext, password_nonce, password_tag, expires_at, attempts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
      hashEmailLoginValue(challengeId, 'email-login-challenge-id', input.encryptionKey),
      input.username.toLocaleLowerCase('en-US'), input.username,
      hashEmailLoginValue(input.code, 'email-login-code', input.encryptionKey),
      input.encryptedPassword.ciphertext, input.encryptedPassword.nonce, input.encryptedPassword.tag,
      input.expiresAt,
    );
    return challengeId;
  }).immediate();
}

/** Checks a login code once, limits guesses, and returns credentials only after successful consumption. */
export function consumeEmailLoginChallenge(input: {
  challengeId: string;
  code: string;
  now: number;
  encryptionKey: Buffer;
}): { username: string; encryptedPassword: EncryptedSecret } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.challengeId) || !Number.isSafeInteger(input.now)) return null;
  const challengeDigest = hashEmailLoginValue(input.challengeId, 'email-login-challenge-id', input.encryptionKey);
  const db = getDatabase();
  // Acquire the write lock before reading so separate connections cannot consume or increment the same row concurrently.
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM email_login_challenges WHERE challenge_id_digest = ?').get(challengeDigest) as EmailLoginChallengeRow | undefined;
    if (!row || !emailLoginDigestMatches(challengeDigest, row.challenge_id_digest)) return null;
    if (row.expires_at <= input.now || row.attempts >= EMAIL_LOGIN_MAX_ATTEMPTS) {
      db.prepare('DELETE FROM email_login_challenges WHERE challenge_id_digest = ?').run(challengeDigest);
      return null;
    }
    // Malformed submissions consume an attempt too, but are never hashed or matched against the stored code.
    const codeMatches = typeof input.code === 'string' && /^[0-9]{6}$/.test(input.code)
      && emailLoginDigestMatches(hashEmailLoginValue(input.code, 'email-login-code', input.encryptionKey), row.code_hmac);
    if (!codeMatches) {
      if (row.attempts + 1 >= EMAIL_LOGIN_MAX_ATTEMPTS) {
        db.prepare('DELETE FROM email_login_challenges WHERE challenge_id_digest = ?').run(challengeDigest);
      } else {
        db.prepare('UPDATE email_login_challenges SET attempts = attempts + 1 WHERE challenge_id_digest = ?').run(challengeDigest);
      }
      return null;
    }
    db.prepare('DELETE FROM email_login_challenges WHERE challenge_id_digest = ?').run(challengeDigest);
    return {
      username: row.username,
      encryptedPassword: { ciphertext: row.password_ciphertext, nonce: row.password_nonce, tag: row.password_tag },
    };
  }).immediate();
}

/** Removes a pending email login challenge using its keyed identifier digest. */
export function invalidateEmailLoginChallenge(challengeId: string, encryptionKey: Buffer): void {
  getDatabase().prepare('DELETE FROM email_login_challenges WHERE challenge_id_digest = ?').run(
    hashEmailLoginValue(challengeId, 'email-login-challenge-id', encryptionKey),
  );
}
